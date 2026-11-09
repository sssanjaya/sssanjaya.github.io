---
title: "ingress-nginx CVE-2026-116472: No Patch, Block mirror-target"
description: "One ingress-nginx annotation can drop all traffic through the controller, and no upstream fix is coming. Block mirror-target with a ValidatingAdmissionPolicy."
date: 2026-11-09T16:08:17Z
tags: [kubernetes, security, ingress-nginx, admission-control]
takeaways:
  - "CVE-2026-116472 lets anyone who can create an Ingress use the mirror-target annotation to write to the ingress-nginx configuration API and drop all traffic through that controller."
  - "Kubernetes will not ship a fix because ingress-nginx maintenance ended in March 2026; SUSE's Rancher Prime fork has a fix in 1.15.2-prime1."
  - "A ValidatingAdmissionPolicy that rejects any annotation key ending in /mirror-target blocks 1 annotation, while annotations-risk-level Medium blocks 15 and Low blocks 60."
  - "Admission policies only run on writes, so Ingresses that already carry mirror-target stay in the cluster until you find them with a kubectl and jq audit."
  - "A localhost address in a mirror-target annotation may indicate an exploitation attempt, according to the Kubernetes advisory."
---

One annotation on one Ingress can drop every request through an ingress-nginx controller, and the Kubernetes project will not patch it. [CVE-2026-116472](https://cveawg.mitre.org/api/cve/CVE-2026-116472), published on 5 November 2026, lets a user who can create an Ingress point the `mirror-target` annotation at the controller's own unauthenticated configuration API. If you still run ingress-nginx, block that annotation at the API server today with a ValidatingAdmissionPolicy, then audit what is already stored.

<figure>
  <img src="/diagrams/ingress-nginx-mirror-target-cve-path.svg" alt="Diagram of two writers to the same API. Blue: the ingress-nginx controller posts to /configuration/backends on a status server at 127.0.0.1:10246 with no auth, which writes the backends shared dict that the balancer reads for every request. Red: an Ingress with mirror-target pointing at 127.0.0.1 is rendered into an internal /_mirror-uid location with proxy_pass to the target, mirrored requests reach the same status server, backend data is corrupted, and all traffic is dropped until an Ingress change or controller restart." width="960" height="600" loading="lazy" />
  <figcaption>The controller and a hostile Ingress end up writing to the same localhost API. Source: <a href="https://cveawg.mitre.org/api/cve/CVE-2026-116472">CVE record</a> and the ingress-nginx <a href="https://github.com/kubernetes/ingress-nginx/blob/main/rootfs/etc/nginx/template/nginx.tmpl">nginx.tmpl</a>.</figcaption>
</figure>

## What CVE-2026-116472 breaks

The [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-116472), issued by the Kubernetes CNA (CVE Numbering Authority), says it plainly:

> Due to a missing check, the mirror-target Ingress annotation can be used to target an unauthenticated configuration API within the ingress-nginx controller, allowing write commands to be submitted.

The result is a full data plane outage for that controller: "all traffic through ingress-nginx being dropped until an Ingress configuration change or a controller restart causes the data to be recreated correctly." The record also mentions possible redirection of other Ingresses' traffic, and calls the extra risk "negligible."

The CNA scores it CVSS 3.1 2.7, Low (`AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:N/A:L`). The low score comes from `PR:H`: the attacker needs Ingress create rights. In a shared cluster, that often includes every team that owns a namespace.

## Why no patch is coming

The [Kubernetes advisory issue #143852](https://github.com/kubernetes/kubernetes/issues/143852) is labeled `cve/wontfix`:

> Kubernetes will not be issuing a fix for this CVE, because ingress-nginx maintenance ended in March 2026.

That end date was announced a year earlier. The [November 2025 retirement post](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) promised "no further releases, no bugfixes, and no updates to resolve any security vulnerabilities that may be discovered."

The CVE record lists every upstream ingress-nginx version as affected. It also lists SUSE's Rancher Prime RKE2 ingress-nginx as affected below `1.15.2-prime1`, which is the fixed build for that fork.

## How a mirror annotation reaches a localhost API

The [mirror annotation docs](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations/#mirror) describe a traffic-shadowing feature: "Enables a request to be mirrored to a mirror backend. Responses by mirror backends are ignored." The value is a URL, for example `https://test.env.com$request_uri`.

The controller turns that URL into nginx config. In [`template.go`](https://github.com/kubernetes/ingress-nginx/blob/main/internal/ingress/controller/template/template.go), `buildMirrorLocations` writes the annotation value straight into a `proxy_pass`:

```go
buffer.WriteString(fmt.Sprintf(`location = %v {
internal;
proxy_set_header Host %v;
proxy_pass %v;
}

`, strconv.Quote(loc.Mirror.Source), strconv.Quote(loc.Mirror.Host), strconv.Quote(loc.Mirror.Target)))
```

The same nginx process runs a status server, defined in [`nginx.tmpl`](https://github.com/kubernetes/ingress-nginx/blob/main/rootfs/etc/nginx/template/nginx.tmpl), that listens only on localhost and has no authentication:

```nginx
listen 127.0.0.1:{{ .StatusPort }};
...
location /configuration {
    content_by_lua_file /etc/nginx/lua/nginx/ngx_conf_configuration.lua;
}
```

`StatusPort` is `10246` in [`internal/nginx/main.go`](https://github.com/kubernetes/ingress-nginx/blob/main/internal/nginx/main.go). The controller pushes routing data there with `POST /configuration/backends`, and [`configuration.lua`](https://github.com/kubernetes/ingress-nginx/blob/main/rootfs/etc/nginx/lua/configuration.lua) stores the body in a shared dictionary that the balancer reads for every request.

"Localhost only" was the access control. A proxy that can be told to fetch localhost URLs on behalf of a tenant removes it. The advisory gives the matching detection hint: "Localhost addresses in the mirror-target annotation of an Ingress resource may indicate an attempt" at exploitation.

## Pick a mitigation that fits your cluster

The advisory lists two mitigations before upgrading: an admission controller that rejects Ingresses with `mirror-target`, or the controller's `annotations-risk-level` ConfigMap setting. They differ a lot in what else they break.

The [ConfigMap docs](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/configmap/) set the default to `High` and explain the rule: "If the risk is, for instance `Medium`, annotations with risk High and Critical will not be accepted." The [annotation risk table](https://kubernetes.github.io/ingress-nginx/user-guide/nginx-configuration/annotations-risk/) rates `mirror-target` as High, alongside `auth-url` and `auth-signin`. Dropping to `Medium` blocks the mirror and every OAuth2 proxy setup that uses those two.

<figure>
  <img src="/diagrams/ingress-nginx-mirror-target-cve-blast.svg" alt="Bar chart of annotations blocked out of 136 in the ingress-nginx risk table: a ValidatingAdmissionPolicy on mirror-target blocks 1, annotations-risk-level Medium blocks 15, annotations-risk-level Low blocks 60." width="960" height="470" loading="lazy" />
  <figcaption>The admission policy removes one feature; the risk-level switch removes up to 60. Source: counted from the <a href="https://github.com/kubernetes/ingress-nginx/blob/main/docs/user-guide/nginx-configuration/annotations-risk.md">ingress-nginx annotations-risk table</a>.</figcaption>
</figure>

| Mitigation | Annotations blocked | Where it acts | Also blocks |
|---|---|---|---|
| ValidatingAdmissionPolicy on `*/mirror-target` | 1 | API server, before storage | Nothing else |
| `annotations-risk-level: "Medium"` | 15 (Critical and High) | Controller ConfigMap | `auth-url`, `auth-signin`, all snippets |
| `annotations-risk-level: "Low"` | 60 (Critical, High, Medium) | Controller ConfigMap | Also `rewrite-target`, `proxy-body-size` |

The admission policy is the narrow cut. ValidatingAdmissionPolicy is built into the API server and has been [generally available since Kubernetes 1.30](https://kubernetes.io/blog/2024/04/24/validating-admission-policy-ga/), so it needs no webhook to run or keep healthy.

## Block mirror-target with a ValidatingAdmissionPolicy

The policy matches any key that ends in `/mirror-target`. That covers controllers started with a custom [`--annotations-prefix`](https://kubernetes.github.io/ingress-nginx/user-guide/cli-arguments/) instead of the default `nginx.ingress.kubernetes.io`.

```yaml
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicy
metadata:
  name: deny-ingress-mirror-target
spec:
  failurePolicy: Fail
  matchConstraints:
    resourceRules:
    - apiGroups: ["networking.k8s.io"]
      apiVersions: ["v1"]
      operations: ["CREATE", "UPDATE"]
      resources: ["ingresses"]
  validations:
  - expression: >-
      !has(object.metadata.annotations) ||
      !object.metadata.annotations.exists(k, k.endsWith('/mirror-target'))
    message: "mirror-target is blocked (CVE-2026-116472)"
    reason: Forbidden
---
apiVersion: admissionregistration.k8s.io/v1
kind: ValidatingAdmissionPolicyBinding
metadata:
  name: deny-ingress-mirror-target
spec:
  policyName: deny-ingress-mirror-target
  validationActions: ["Warn"]
```

Start with `Warn`, then switch to `Deny`. Running it against kube-apiserver v1.37.2 in a sandbox, with user `dev` holding Ingress rights in namespace `team-a`, shows each stage.

Before the policy, the Ingress goes straight in:

```console
$ kubectl --user=dev apply -f ing-mirror.yaml
ingress.networking.k8s.io/shop-mirror created
```

With the binding in `Warn` mode, it still goes in, and the client sees why it will fail later:

```console
$ kubectl --user=dev apply -f ing-mirror.yaml
Warning: Validation failed for ValidatingAdmissionPolicy 'deny-ingress-mirror-target' with binding 'deny-ingress-mirror-target': mirror-target is blocked (CVE-2026-116472)
ingress.networking.k8s.io/shop-mirror created
```

With `validationActions: ["Deny"]`:

```console
$ kubectl --user=dev apply -f ing-mirror.yaml
Error from server (Forbidden): error when creating "ing-mirror.yaml": ingresses.networking.k8s.io "shop-mirror" is forbidden: ValidatingAdmissionPolicy 'deny-ingress-mirror-target' with binding 'deny-ingress-mirror-target' denied request: mirror-target is blocked (CVE-2026-116472)
$ kubectl --user=dev apply -f ing-plain.yaml
ingress.networking.k8s.io/shop created
```

In this run, a new binding took a few seconds to start rejecting requests. Test with a throwaway Ingress after you apply it, not right away.

<figure>
  <img src="/diagrams/ingress-nginx-mirror-target-cve-lab.svg" alt="Table of seven sandbox requests. Warn binding: create with mirror-target is created with a warning. Deny binding: create with mirror-target is forbidden; create with only proxy-body-size is created; adding mirror-target to an existing Ingress is forbidden; adding custom.example.io/mirror-target is forbidden; labeling an old Ingress that still has mirror-target is forbidden; removing mirror-target from that old Ingress is allowed." width="960" height="560" loading="lazy" />
  <figcaption>The policy blocks every way to add the annotation, but an Ingress stored before the policy keeps it and can only be edited to remove it. Source: sandbox run against kube-apiserver v1.37.2.</figcaption>
</figure>

The last two rows matter during rollout. An Ingress that already had `mirror-target` stays in etcd. Every later update to it, even a label, is rejected until someone removes the annotation, which is allowed:

```console
$ kubectl --user=dev -n team-a label ingress shop-mirror owner=payments
Error from server (Forbidden): ingresses.networking.k8s.io "shop-mirror" is forbidden: ValidatingAdmissionPolicy 'deny-ingress-mirror-target' with binding 'deny-ingress-mirror-target' denied request: mirror-target is blocked (CVE-2026-116472)
$ kubectl --user=dev -n team-a annotate ingress shop-mirror nginx.ingress.kubernetes.io/mirror-target-
ingress.networking.k8s.io/shop-mirror annotated
```

## Audit the Ingresses you already have

Find every stored `mirror-target`, with its value. Treat any `127.0.0.1`, `localhost` or `[::1]` target as an incident:

```bash
kubectl get ingress -A -o json \
  | jq -r '.items[] | .metadata as $m | ($m.annotations // {}) | to_entries[]
      | select(.key | endswith("/mirror-target"))
      | [$m.namespace, $m.name, .value] | @tsv'
```

```console
team-a	shop-mirror	http://127.0.0.1$request_uri
```

If you are weighing `annotations-risk-level: "Medium"` instead, list which High and Critical annotations are in use first. This joins the live Ingresses with the upstream risk table:

```bash
curl -s https://raw.githubusercontent.com/kubernetes/ingress-nginx/main/docs/user-guide/nginx-configuration/annotations-risk.md \
  | awk -F'|' '$4 ~ /High|Critical/ {gsub(/ /, "", $3); print $3}' > high-risk.txt

kubectl get ingress -A -o json \
  | jq -r '.items[] | .metadata as $m | ($m.annotations // {}) | keys[]
      | select(startswith("nginx.ingress.kubernetes.io/"))
      | "\($m.namespace)/\($m.name)\t\(sub("^nginx.ingress.kubernetes.io/"; ""))"' \
  | awk -F'\t' 'NR==FNR {high[$1]; next} $2 in high' high-risk.txt -
```

```console
team-a/shop-mirror	auth-url
```

Any line in that output is an Ingress that `Medium` would break.

## What to do

1. Find out if you run it: `kubectl get pods --all-namespaces --selector app.kubernetes.io/name=ingress-nginx`, the check from the [retirement post](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/). Run it in every cluster.
2. Run the `mirror-target` audit above. Remove the annotation where nobody needs traffic mirroring, and report localhost targets to your security team and to security@kubernetes.io, as the [advisory](https://github.com/kubernetes/kubernetes/issues/143852) asks.
3. Apply the ValidatingAdmissionPolicy with `validationActions: ["Warn"]`, watch for warnings in CI and kubectl output for a day, then switch to `["Deny"]` and confirm a test Ingress is rejected.
4. On Rancher Prime RKE2, upgrade the ingress-nginx fork to `1.15.2-prime1` or later. On other managed platforms, check your vendor's guidance.
5. Plan the move off ingress-nginx. The project ships no more security fixes, and the [retirement post](https://kubernetes.io/blog/2025/11/11/ingress-nginx-retirement/) recommends Gateway API or another Ingress controller.
