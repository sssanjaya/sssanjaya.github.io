---
title: "LMCache CVE-2026-105192: unauthenticated RCE on port 5555"
description: "One unauthenticated ZeroMQ message runs code on LMCache servers bound to a routable address. No release fixes it yet. Restrict the port and check operator pods."
date: 2026-10-12T10:09:54Z
tags: [ai-security, security, kubernetes, devsecops]
takeaways:
  - "CVE-2026-105192 lets a single unauthenticated ZeroMQ message to LMCache's multiprocess port, 5555 by default, run code as the LMCache process user."
  - "The flaw affects LMCache 0.3.9 and later, and as of October 12, 2026 no PyPI release contains the fix."
  - "LMCache binds the multiprocess port to localhost by default, but its Kubernetes operator always passes --host 0.0.0.0."
  - "The upstream fix, commit 160b6de merged on October 12, 2026, replaces pickle with data-only MessagePack descriptors but does not add authentication."
  - "Until a fixed release ships, allow the LMCache port only from the vLLM pods that use it, with a NetworkPolicy or a host firewall."
---

LMCache, a KV cache layer used with the vLLM inference engine, has a critical remote code execution flaw, CVE-2026-105192. In multiprocess mode, one unauthenticated message to the server port runs code as the LMCache user, and official images run that user as root. No release fixes it yet, so restrict who can reach the port today and upgrade once a release carries the fix.

## What CVE-2026-105192 is

JFrog published the [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-105192) on October 7, 2026, with a CVSS v3.1 score of 9.8 (`CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H`). The record scores one scenario: "Multiprocess mode bound to a routable address, the documented multi-node deployment".

The record describes the bug this way: "A single unauthenticated ZMQ DEALER message to the transport port (default 5555) therefore executes code as the user the LMCache process runs as. Official container images run that process as root."

| Field | Value | Source |
| --- | --- | --- |
| Affected | `lmcache` 0.3.9 and later | [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-105192) |
| Weakness | CWE-502 (deserialization of untrusted data), CWE-306 (missing authentication) | [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-105192) |
| Score | 9.8 Critical, scored by JFrog as the CVE issuer | [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-105192) |
| CISA-ADP SSVC | Exploitation: none, Automatable: yes, Technical Impact: total | [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-105192) |
| Fixed release | None on PyPI as of October 12, 2026 | [PyPI](https://pypi.org/project/lmcache/) |

The SSVC (Stakeholder-Specific Vulnerability Categorization) entry from CISA-ADP is dated October 7, 2026. "Exploitation: none" means CISA had no evidence of exploitation at that time. Treat that as still developing.

## How the bug works

LMCache multiprocess mode, also called distributed mode, runs a cache server that vLLM workers talk to over ZeroMQ (ZMQ). Requests are MessagePack. The decoder in [`custom_types.py`](https://github.com/LMCache/LMCache/blob/v0.5.5/lmcache/v1/multiprocess/custom_types.py) maps MessagePack extension code 1 to `DeviceIPCWrapper.Deserialize`. In v0.5.5 that function is one line, at [`ipc_wrapper.py` line 169](https://github.com/LMCache/LMCache/blob/v0.5.5/lmcache/v1/platform/base/ipc_wrapper.py#L169):

```python
return pickle.loads(data)
```

Python's `pickle` runs code during loading. The decode happens while the server parses the request, before any handler runs, and there is no authentication on the socket. Anyone who can open a TCP connection to the port can run code.

The [JFrog advisory](https://research.jfrog.com/vulnerabilities/lmcache-is-vulnerable-to-unauthenticated-remote-code-execution-via-pickle-deserialization-on-the-multiprocess-zmq-transport-cve-2026-105192-jfsa-2026-001694382/) states: "No fixed release is available as of 2026-10-07." It also says the same code is in v0.5.6rc3 and the dev branch.

## Why Kubernetes deployments are the ones at risk

The server's [`--host` flag](https://github.com/LMCache/LMCache/blob/v0.5.5/lmcache/v1/multiprocess/config.py) defaults to `localhost`. A single-node Docker setup that keeps that default is not reachable from the network.

Kubernetes setups usually change it:

| Deployment path | `--host` | Who can reach the port |
| --- | --- | --- |
| Default `lmcache server` | `localhost` | Local processes only |
| LMCache Kubernetes operator (`LMCacheEngine`) | `0.0.0.0`, always | Any pod that can reach the pod IP, unless a NetworkPolicy blocks it |
| Example DaemonSet in the repo | `0.0.0.0` with `hostNetwork: true` | Anything that can reach the node IP on that port |

The operator code builds the server arguments in [`compute.go`](https://github.com/LMCache/LMCache/blob/v0.5.5/operator/internal/resources/compute.go) with `"--host", "0.0.0.0"` and no way to turn it off. The [operator docs](https://github.com/LMCache/LMCache/blob/v0.5.5/docs/source/mp/operator.rst) explain why: "Binds the server to all interfaces so the node-local Service can route to it." The operator does not create a NetworkPolicy. The [example DaemonSet](https://github.com/LMCache/LMCache/blob/v0.5.5/examples/multi_process/lmcache-daemonset.yaml) sets `hostNetwork: true` and `--host "0.0.0.0"` on port 6555.

In a cluster with no default-deny policy, one compromised pod anywhere can reach a cache server on a GPU node. On a host-network setup, the port is open on the node address itself.

![Four checks to decide whether an LMCache server is exposed to CVE-2026-105192](/diagrams/lmcache-zmq-pickle-rce-exposure.svg)

## What the upstream fix changes

LMCache merged [commit 160b6de](https://github.com/LMCache/LMCache/commit/160b6dec469edb765efd1fad42aca5a438b08bb5), "[Security][MP] Remove pickle from device IPC descriptors (CVE-2026-105192)", on October 12, 2026. It replaces the pickle payload with versioned MessagePack descriptors and picks the wrapper class from a local allowlist. It is not in the `0.5.6rc4` tag or in any PyPI release as of October 12, 2026.

Two parts of the change matter for operators:

- The docs added in the commit say "Legacy pickle descriptors are rejected; upgrade workers and servers together." A mixed fleet of old vLLM workers and a new server will fail.
- The same docs say: "It does not add RPC authentication or replace engine-driven tensor-data pickle payloads. Keep MP endpoints restricted to trusted clients." The network restriction is not a stopgap you can drop after upgrading.

## What to check

1. Find LMCache servers and their bind address. This lists every container whose command or args mention `lmcache`, with its `--host` value:

```bash
kubectl get pods -A -o json | jq -r '.items[] | . as $p | .spec.containers[]
  | ((.command // []) + (.args // []) | join(" ")) as $cmd
  | select($cmd | test("lmcache"))
  | [$p.metadata.namespace + "/" + $p.metadata.name,
     "hostNetwork=" + (($p.spec.hostNetwork // false) | tostring),
     .image,
     ($cmd | capture("--host[ =](?<h>[^ ]+)").h // "localhost")] | @tsv'
```

It can also list vLLM pods that pass LMCache settings in their args; their `--host` is the vLLM API bind, not LMCache. For LMCache server rows, focus on `0.0.0.0` or another routable address.

2. List operator-managed engines with `kubectl get lmcacheengines -A`. Every engine the operator runs binds to `0.0.0.0`.

3. Check whether the installed code still has the vulnerable call. Run this inside the server container. `find_spec` locates the package without importing it:

```bash
d=$(python3 -c "import importlib.util as u; print(u.find_spec('lmcache').submodule_search_locations[0])")
grep -rnE "return pickle\.loads\(data\)" "$d/v1/platform" "$d/v1/multiprocess/custom_types.py" 2>/dev/null
```

A hit in `v1/platform/base/ipc_wrapper.py` (v0.5.x) or `v1/multiprocess/custom_types.py` (v0.3.9) means the image has the vulnerable path. Images built from commit 160b6de or later return nothing.

4. On host-network nodes, confirm what is listening: `ss -ltnp | grep -E ':(5555|6555)\b'`. A local address of `0.0.0.0` or `*` means the port is open on every interface.

## What to do

- **Allow the port only from vLLM.** For operator-managed engines on the pod network, apply a NetworkPolicy. The operator labels engine pods `app.kubernetes.io/name: lmcache` and `app.kubernetes.io/component: cache-engine` ([`labels.go`](https://github.com/LMCache/LMCache/blob/v0.5.5/operator/internal/resources/labels.go)). Set the namespace to where the engines run, use the labels your vLLM pods actually carry, add a `namespaceSelector` if vLLM runs in another namespace, and add the HTTP port if another client needs it:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: lmcache-allow-vllm-only
  namespace: lmcache
spec:
  podSelector:
    matchLabels:
      app.kubernetes.io/name: lmcache
      app.kubernetes.io/component: cache-engine
  policyTypes:
  - Ingress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app.kubernetes.io/name: vllm
    ports:
    - protocol: TCP
      port: 5555
```

The [Kubernetes docs](https://kubernetes.io/docs/concepts/services-networking/network-policies/) note that when a pod is isolated for ingress, connections from the pod's own node stay allowed, so kubelet TCP probes keep working.

- **Do not rely on NetworkPolicy for `hostNetwork` pods.** The Kubernetes docs say "NetworkPolicy behaviour for `hostNetwork` pods is undefined". For the DaemonSet pattern, block the port at the node firewall or the cloud security group, and allow only the addresses your vLLM clients use.
- **Keep single-node setups on `localhost`.** Do not add `--host 0.0.0.0` to a deployment where vLLM and LMCache share a host.
- **Upgrade when a release ships.** Watch [PyPI](https://pypi.org/project/lmcache/) for a version that includes commit 160b6de. Roll vLLM workers and LMCache servers together, because the new server rejects old descriptors.
- **Treat a reachable server as possibly compromised.** If a cache server bound to a routable address was reachable from untrusted pods or networks, review it as a root shell on a GPU node. Check for unexpected processes and outbound connections, and rotate credentials the node or pod could read, such as the service account token and any model registry or cloud keys.

The same pattern shows up in other AI tooling that ships fast and binds wide. The post on [Claude Code mods and the managed settings that lock them down](/claude-code-mods-security-guide/) covers a similar question for agent tooling: what code runs, with whose permissions, and who decides.
