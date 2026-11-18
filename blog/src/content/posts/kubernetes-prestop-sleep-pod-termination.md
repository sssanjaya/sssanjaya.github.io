---
title: "Kubernetes preStop sleep: Stop 502s When Pods Terminate"
description: "Kubernetes sends SIGTERM and pulls a pod from Service routing in parallel, so deploys drop requests. Add a preStop sleep hook and size the grace period to fit."
date: 2026-11-18T11:13:43Z
tags: [kubernetes, availability, deployments]
takeaways:
  - "When a pod is deleted, the kubelet starts shutdown and the control plane updates EndpointSlices at the same time, so nothing guarantees proxies stop routing to the pod before it gets SIGTERM."
  - "The EndpointSlice for a deleted pod flips to ready false, serving true, terminating true as soon as the control plane processes the delete, typically before its containers exit."
  - "A preStop sleep hook keeps the container serving for a fixed time before SIGTERM, which gives kube-proxy, ingress controllers, and load balancers time to drop the pod."
  - "The sleep lifecycle action is stable and locked on since Kubernetes 1.34, and the API server rejects a sleep that is not less than terminationGracePeriodSeconds."
  - "terminationGracePeriodSeconds covers the preStop hook and the app shutdown together, so a 10-second sleep in a 45-second grace period leaves 35 seconds for the app."
---

Kubernetes does not wait for traffic to stop before it tells your pod to stop. The [pod termination docs](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/) say the control plane decides whether to remove a pod from Service routing "At the same time as the kubelet is starting graceful shutdown of the Pod." If your app exits fast on SIGTERM, every rollout sends a few requests to a pod that has already closed its socket. The fix is one stanza of YAML, a `preStop` sleep, sized inside the grace period.

<figure>
  <img src="/diagrams/kubernetes-prestop-sleep-pod-termination-race.svg" alt="Sequence diagram. The API server sets deletionTimestamp at t=0. The kubelet and the EndpointSlice controller both watch it at the same time. The kubelet sends SIGTERM and the app closes its listener and exits. The EndpointSlice controller marks the endpoint terminating, and kube-proxy, ingress, and load balancers update routes later. A new connection sent in the gap gets refused or a 502." width="960" height="620" loading="lazy" />
  <figcaption>Two watchers react to one delete, and nothing orders them. Requests that land between SIGTERM and the route update fail. Source: <a href="https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/">Kubernetes docs, Termination of Pods</a>.</figcaption>
</figure>

## What is supposed to happen on pod delete

The docs walk through the flow for `kubectl delete` with the default 30-second grace period. The API server records the time after which the pod is considered dead. On the node, the kubelet sees the pod is terminating, runs any `preStop` hook, then has the container runtime send TERM to process 1 in each container. When the grace period expires, the runtime sends `SIGKILL` to whatever is still running.

In parallel, the EndpointSlice controller updates every Service that selects the pod. The endpoint stays in the slice, but with new conditions. The [EndpointSlice docs](https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/) define them:

| Condition | Meaning after delete |
| --- | --- |
| `serving` | Maps to the pod's Ready condition. Still `true` while the app passes readiness. |
| `terminating` | "set when the Pod is first deleted", "most likely before the Pod's containers exit" |
| `ready` | Shortcut for "`serving` and not `terminating`", so it goes `false` |

Consumers act on that. The same page says "Service proxies will normally ignore endpoints that are `terminating`", and may still use endpoints that are both serving and terminating "if all available endpoints are `terminating`".

## Where it goes wrong

Every consumer of that EndpointSlice has to see the change and act on it: kube-proxy on every node rewrites its rules, and an ingress controller or cloud load balancer updates its upstream list. That is a chain of watches across many machines. The kubelet path is one watch on one node.

So the kubelet can deliver SIGTERM while some proxy still lists the pod as a backend. An app that stops accepting connections on SIGTERM turns those in-flight routing decisions into refused connections, which a reverse proxy in front typically turns into a 502. The design goal of the [sleep action proposal, KEP-3960](https://github.com/kubernetes/enhancements/tree/master/keps/sig-node/3960-pod-lifecycle-sleep-action), names the same gap: to "handle new connections from clients that have not yet finished endpoint termination during the pod termination."

On a Service with a [burn-rate SLO alert](/slo-burn-rate-alerts-prometheus/), those failures show up as a small error spike at every rollout.

## Seeing the EndpointSlice flip

The control-plane half of this is easy to watch. Running a v1.37.2 `kube-apiserver` and `kube-controller-manager` in the sandbox, with no kubelet and no containers, shows the slice change on delete. The pod object was created and its status patched to Ready by hand, with a Service selecting it.

```shell
S=$(kubectl get endpointslices -l kubernetes.io/service-name=web -o name)
kubectl get $S -w --output-watch-events \
  -o jsonpath='{.type}{" rv="}{.object.metadata.resourceVersion}{" "}{.object.endpoints[0].conditions}{"\n"}' &
kubectl delete pod web-1 --wait=false
```

```text
ADDED rv=229 {"ready":true,"serving":true,"terminating":false}
MODIFIED rv=234 {"ready":false,"serving":true,"terminating":true}
```

The pod was deleted at 11:11:30 UTC, and its `deletionTimestamp` reads `2026-11-18T11:12:15Z`, the delete time plus the 45-second grace period from the spec. No kubelet ran in this setup, so the slice change came entirely from the control plane.

<figure>
  <img src="/diagrams/kubernetes-prestop-sleep-pod-termination-slice.svg" alt="Before delete, the endpoint shows ready true, serving true, terminating false, and proxies send new connections to it. After kubectl delete, it shows ready false, serving true, terminating true, and proxies skip it unless every endpoint is terminating." width="960" height="470" loading="lazy" />
  <figcaption>Values captured from a v1.37.2 control plane in the sandbox. Proxy behavior per the <a href="https://kubernetes.io/docs/concepts/services-networking/endpoint-slices/">EndpointSlice docs</a>.</figcaption>
</figure>

One common habit does not help here: failing the readiness probe after SIGTERM. Terminating endpoints "always have their `ready` status as `false`", per the termination docs, so `ready` has already flipped. A failing probe only changes `serving`.

## The fix: sleep before SIGTERM

A `preStop` hook runs before the TERM signal. The [lifecycle hooks docs](https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/) are explicit: "the hook must complete its execution before the TERM signal can be sent." A hook that sleeps keeps the app serving normally for a fixed time while proxies catch up.

The old way was an `exec` hook running `sleep`, which runs inside the container and needs a `sleep` binary in the image. The built-in `sleep` action is run by the kubelet instead. Its feature gate, `PodLifecycleSleepAction`, was alpha in 1.29, beta and on by default from 1.30, and stable and locked on from 1.34, per the [feature gates reference](https://kubernetes.io/docs/reference/command-line-tools-reference/feature-gates/).

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
spec:
  replicas: 2
  selector:
    matchLabels: {app: web}
  template:
    metadata:
      labels: {app: web}
    spec:
      terminationGracePeriodSeconds: 45
      containers:
      - name: web
        image: nginx:1.29
        ports:
        - containerPort: 80
        readinessProbe:
          httpGet: {path: /, port: 80}
          periodSeconds: 5
        lifecycle:
          preStop:
            sleep:
              seconds: 10
```

A server-side dry run against the v1.37.2 API server accepts it:

```text
$ kubectl apply --dry-run=server -f deploy.yaml
deployment.apps/web created (server dry run)
```

## The grace period pays for both

The hook does not get its own timer. The hooks docs: "This grace period applies to the total time it takes for both the `PreStop` hook to execute and for the Container to stop normally." Their example: a 60-second grace period, a 55-second hook, and an app that needs 10 seconds after SIGTERM gets killed before it finishes.

<figure>
  <img src="/diagrams/kubernetes-prestop-sleep-pod-termination-budget.svg" alt="Three timelines from 0 to 65 seconds. Grace 45 with sleep 10: SIGTERM at 10 seconds, 35 seconds to drain, SIGKILL at 45. Grace 60 with a 55-second hook and an app needing 10 seconds: SIGTERM at 55, SIGKILL at 60, 5 seconds short. Grace 45 with sleep 50: rejected at apply." width="960" height="470" loading="lazy" />
  <figcaption>Sleep plus shutdown time must fit inside terminationGracePeriodSeconds. The middle row is the example from the <a href="https://kubernetes.io/docs/concepts/containers/container-lifecycle-hooks/">lifecycle hooks docs</a>.</figcaption>
</figure>

The API server catches the worst case. Raising the sleep to 50 in the same Deployment fails the dry run:

```text
The Deployment "web" is invalid: spec.template.spec.containers[0].lifecycle.preStop.sleep: Invalid value: 50: must be non-negative and less than terminationGracePeriodSeconds (45)
```

It does not catch a sleep that fits but leaves too little time for the app. That part is on you.

## Check what your app does with SIGTERM

The sleep only buys time before the signal. After it, the app still has to finish open requests and exit. The [termination docs](https://kubernetes.io/docs/concepts/workloads/pods/pod-termination/) note that many runtimes send the image's `STOPSIGNAL` instead of TERM when it is set.

nginx is a good example. Its [control docs](https://nginx.org/en/docs/control.html) list TERM and INT as "fast shutdown" and QUIT as "graceful shutdown". The official image's [Dockerfile](https://github.com/nginx/docker-nginx/blob/master/mainline/debian/Dockerfile) sets `STOPSIGNAL SIGQUIT`, so the stock image already asks for the graceful path. A custom image built `FROM scratch` with its own nginx would not inherit that.

For drain tooling that reads EndpointSlices directly, the Kubernetes tutorial [Pods And Endpoints Termination Flow](https://kubernetes.io/docs/tutorials/services/pods-and-endpoint-termination-flow/) shows the `serving` and `terminating` conditions during a real rollout.

## What to do

1. Find Deployments that serve traffic behind a Service and have no `preStop` hook: `kubectl get deploy -A -o json | jq -r '.items[] | select(any(.spec.template.spec.containers[]; .lifecycle.preStop == null)) | "\(.metadata.namespace)/\(.metadata.name)"'`.
2. Add `lifecycle.preStop.sleep.seconds` to the serving container. Pick a value that covers how long your slowest route consumer (kube-proxy, ingress controller, cloud load balancer) takes to drop a backend, and measure it rather than guess.
3. Set `terminationGracePeriodSeconds` to the sleep plus the longest request or drain your app needs. The default is 30 seconds.
4. Confirm the app handles its stop signal gracefully. Check the image's `STOPSIGNAL`: `docker image inspect --format '{{.Config.StopSignal}}' nginx:1.29` prints `SIGQUIT`. Run the same against your own images.
5. Validate with `kubectl apply --dry-run=server` before rollout, then watch 5xx rates through one deploy to confirm the spike is gone.
