---
title: "LangGraph SDK CVE-2026-104873: auth actions= ignored"
description: "langgraph-sdk 0.1.45 to 0.4.3 ignores actions= on @auth.on.threads, assistants, and crons, so one handler covers every action. Upgrade to 0.4.4."
date: 2026-10-05T10:32:18Z
tags: [ai-agents, security, langgraph, python]
takeaways:
  - "CVE-2026-104873 affects langgraph-sdk 0.1.45 through 0.4.3 and is fixed in 0.4.4."
  - "In affected versions, @auth.on.threads(actions=[\"create\"]) registers the handler for every action on threads, not just create."
  - "Because LangGraph calls only the most specific matching handler, the misregistered handler can replace a stricter global or per-action check for reads, updates, and deletes."
  - "Only Python deployments that pass actions= to @auth.on.threads, @auth.on.assistants, or @auth.on.crons are affected; the attribute form such as @auth.on.threads.create registers correctly."
  - "langgraph-sdk 0.4.4 raises ValueError on empty, duplicate, or invalid action lists, so an upgrade can stop a misconfigured auth module from loading."
---

CVE-2026-104873 is an authorization bypass in `langgraph-sdk`, the Python package that LangGraph agent servers use to define custom auth handlers. In versions 0.1.45 through 0.4.3, the `actions=` argument on `@auth.on.threads`, `@auth.on.assistants`, and `@auth.on.crons` is ignored, so a handler meant for one action runs for all of them and can let an authenticated user read, update, or delete another user's threads. Upgrade to `langgraph-sdk` 0.4.4, then grep your auth module for `actions=` to see whether you were exposed.

## What the LangGraph advisory says

The [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-104873) was published on October 2, 2026. It references the [GitHub security advisory GHSA-fvww-7h3r-vfhp](https://github.com/langchain-ai/langgraph/security/advisories/GHSA-fvww-7h3r-vfhp) and the fixed [sdk==0.4.4 release](https://github.com/langchain-ai/langgraph/releases/tag/sdk==0.4.4), which reached [PyPI](https://pypi.org/project/langgraph-sdk/0.4.4/) on August 27, 2026. The CVE publication puts it in vulnerability scanners and CVE feeds this week.

The CVE description states the flaw directly: "From 0.1.45 until 0.4.4, the langgraph-sdk resource-scoped authorization decorators @auth.on.threads, @auth.on.assistants, and @auth.on.crons ignore the actions argument and register the selected handler for every action on the resource."

| Field | Value |
|---|---|
| CVE | CVE-2026-104873 |
| Package | `langgraph-sdk` (pip) |
| Affected | 0.1.45 through 0.4.3 |
| Fixed | 0.4.4 |
| Score | CVSS 4.0 7.6 (High) |
| Vector | `CVSS:4.0/AV:N/AC:L/AT:P/PR:L/UI:N/VC:H/VI:H/VA:N/SC:N/SI:N/SA:N` |
| Weakness | CWE-863, Incorrect Authorization |
| Fix | Upgrade to 0.4.4. The attribute form (`@auth.on.threads.create`) was never affected. |

The attacker needs a valid login (`PR:L`). This is not an unauthenticated remote code execution bug. It is a tenant isolation bug: one user of your agent reaching another user's conversation history, assistant configs, or scheduled runs.

## Why a misregistered handler becomes a bypass

LangGraph auth has three handler levels: global (`@auth.on`), per resource (`@auth.on.threads`), and per action (`@auth.on.threads.create`). The [LangGraph auth docs](https://docs.langchain.com/langsmith/auth) say "The most specific matching handler will be used" and "If a more specific handler is registered, the more general handler will not be called for that resource and action."

That rule is what turns a registration bug into an access bug. Take this handler:

```python
from langgraph_sdk import Auth

auth = Auth()

@auth.on.threads(actions=["create"])
async def stamp_owner(ctx: Auth.types.AuthContext, value):
    value.setdefault("metadata", {})["owner"] = ctx.user.identity
    return None
```

The author meant it to run only on thread creation, with an owner filter on reads coming from a global `@auth.on` handler. In 0.4.3 the handler is registered under `("threads", "*")` instead of `("threads", "create")`. That wildcard handler is more specific than the global one, so it wins for `read`, `search`, `update`, and `delete` on threads too. It returns `None`, and per the docs, "None and True mean 'authorize access to all underling resources'". The owner filter never runs.

The CVE record is clear that impact depends on the handler body: "a deployment remains protected when the selected handler independently enforces all required checks for every action it receives." A handler that always returns `{"owner": ctx.user.identity}` stays safe even when it runs for the wrong action. A handler that returns `None` or `True`, or that only does write-side work, is the dangerous case.

## Reproducing the registration bug

The registration difference is easy to confirm without a server. The script below reads `Auth._handlers`, which is a private attribute, so use it only as a one-off check:

```python
from langgraph_sdk import Auth

auth = Auth()

@auth.on.threads(actions=["create"])
async def only_create(ctx, value):
    return {"owner": ctx.user.identity}

for key, handlers in sorted(auth._handlers.items()):
    print(key, [h.__name__ for h in handlers])
```

Output with `langgraph-sdk==0.4.3`:

```text
('threads', '*') ['only_create']
```

Output with `langgraph-sdk==0.4.4`:

```text
('threads', 'create') ['only_create']
```

The attribute form, `@auth.on.threads.create`, registered correctly under `("threads", "create")` on both versions. Only the `actions=` keyword form is broken.

## What to check

1. **Find the installed version** in every image or virtualenv that serves a LangGraph API:

   ```bash
   python -c "import importlib.metadata as m; print(m.version('langgraph-sdk'))"
   ```

   Anything from 0.1.45 up to 0.4.3 is in the affected range.

2. **Find the vulnerable pattern.** Only code that passes `actions=` to the three named decorators is affected:

   ```bash
   grep -rnE "@auth\.on\.(threads|assistants|crons)\(" --include=*.py .
   ```

   Any hit with `actions=` on an affected version is exposed. If your decorators span multiple lines, review each hit by hand.

3. **Read each matching handler body.** Ask what it returns for a `read` or `delete` call. If it returns `None`, `True`, or a filter that does not restrict by owner or tenant, treat cross-user access as possible since the handler was deployed.

4. **Review access logs** for thread, assistant, and cron reads or deletes where the caller identity differs from the resource owner metadata. The advisory gives no indicators of compromise, so this depends on what your deployment logs.

## What to do

1. **Upgrade** to the fixed release and pin it:

   ```bash
   pip install --upgrade "langgraph-sdk>=0.4.4"
   ```

2. **Expect strict validation after the upgrade.** The [fix commit](https://github.com/langchain-ai/langgraph/commit/5a77be5e8bec1600ad0a865638d88c1368497559) adds a changelog entry saying resource-scoped decorators "now honor `actions=` and reject empty or invalid action lists." In a local test on 0.4.4, these raised at import time:

   | Decorator argument | Error on 0.4.4 |
   |---|---|
   | `actions=[]` | `ValueError: actions must not be empty` |
   | `actions=["write"]` | `ValueError: Invalid action(s) for threads: write` |
   | `actions=["read", "read"]` | `ValueError: actions must not contain duplicates` |

   On 0.4.3, `actions=[]` was silently accepted. Run your auth module once in CI after the bump so a typo fails the build instead of the deploy.

3. **Prefer the attribute form** (`@auth.on.threads.create`, `@auth.on.threads.read`) for single actions. It was never affected and it reads clearly in review.

4. **Make every handler fail closed.** A handler that returns an owner filter on every path is safe even if a future registration bug sends it the wrong action. Add a test that calls each protected endpoint as a second user and expects a 403 or an empty result.

## The same week in agent framework CVEs

LangGraph was not the only agent framework in this week's CVE feeds. These were published between September 30 and October 4, 2026:

| CVE | Project | Published | Issue |
|---|---|---|---|
| [CVE-2026-51857](https://cveawg.mitre.org/api/cve/CVE-2026-51857) | camel-ai camel 0.2.91a1 to 0.2.91a3 | Sep 30 | `CodeExecutionToolkit` "can run model-produced Python code through SubprocessInterpreter without an approval boundary" (CVSS 3.1 9.8, scored by CISA) |
| [CVE-2026-105135](https://cveawg.mitre.org/api/cve/CVE-2026-105135) | InternLM MindSearch 0.1.0 | Oct 4 | Code injection in `ExecutionAction.run` of the Planner Agent (CVSS 3.1 10.0) |
| CVE-2026-104873 | langgraph-sdk 0.1.45 to 0.4.3 | Oct 2 | `actions=` ignored on resource-scoped auth decorators (CVSS 4.0 7.6) |

The camel issue, [camel-ai/camel#4037](https://github.com/camel-ai/camel/issues/4037), is closed with a linked pull request. MindSearch had no fix listed in the CVE record as of October 5, 2026.

The pattern across all three is the same: the agent framework, not the model, decides what a request is allowed to do. Auth handlers and tool approval gates are framework code. They need the same version tracking, tests, and patch cadence as any other authorization layer in production.
