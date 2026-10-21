---
title: "Claude Code 2.1.305: Linux sandbox blocks user namespaces"
description: "Claude Code's Linux sandbox now blocks user namespaces, so Chromium and rootless podman fail. The opt-out drops write denies. Pin it off in policy."
date: 2026-10-21T10:06:57Z
tags: [claude, claude-code, ai-security, devsecops, aiops]
takeaways:
  - "Claude Code 2.1.305, published to npm on October 20, 2026, added sandbox.allowNestedUserNamespaces so sandboxed Linux commands can create user namespaces."
  - "On Linux, every sandbox write deny is a read-only bind mount, and a command that creates its own user namespace can remove those binds from its own view."
  - "By default the sandbox runtime now refuses user namespace creation, so Chromium's namespace sandbox, rootless podman and buildah, nested bubblewrap, and unshare -r fail with EPERM."
  - "Turning on allowNestedUserNamespaces means denyWrite and the mandatory write denies no longer hold against any command run under it."
  - "Setting allowAllUnixSockets and enableWeakerNestedSandbox together also leaves the user namespace limit off, so lock all three in managed settings."
---

Claude Code's Linux sandbox now stops sandboxed commands from creating their own user namespaces, because a command that could do so was able to undo the sandbox's write protections. Version 2.1.305, released October 20, 2026, adds `sandbox.allowNestedUserNamespaces` as an opt-out for tools that need namespaces, such as Chromium and rootless podman. Leave it off, set it to `false` in managed settings, and move browser and container work to a narrow exclusion or a real container instead.

## What changed in 2.1.305

The [Claude Code changelog](https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md) entry for 2.1.305 reads:

> Added `sandbox.allowNestedUserNamespaces` so sandboxed commands on Linux can create user namespaces (Chromium, rootless podman); this lets them get around the sandbox's file protections

The [npm registry record](https://registry.npmjs.org/@anthropic-ai/claude-code) shows 2.1.305 published at 19:29 UTC on October 20, 2026. As of October 21, `latest` points to 2.1.306 and `stable` to 2.1.304.

Claude Code builds its sandbox on the open source [`@anthropic-ai/sandbox-runtime`](https://github.com/anthropics/sandbox-runtime) package, per the [sandboxing docs](https://code.claude.com/docs/en/sandboxing). The limit itself landed there in [commit 9a277e5](https://github.com/anthropics/sandbox-runtime/commit/9a277e5e04af1ab1b04feea4400a6ed8a5b72039) on October 14, titled "linux: a sandboxed command stays in the namespaces made for it (#588)". It shipped in sandbox-runtime 0.0.80, which [npm](https://registry.npmjs.org/@anthropic-ai/sandbox-runtime) shows published on October 16.

The changelog does not say which Claude Code release started enforcing the limit. A string search of the npm Linux x64 binaries finds the runtime's `SRT_ALLOW_NESTED_USERNS` variable and `--disable-userns` in 2.1.304 and 2.1.305, and neither in 2.1.303. Treat 2.1.304 as the likely first release with the limit, unconfirmed as of October 21, 2026.

## Why a user namespace undoes the write denies

The commit message explains the hole:

> Every write deny on Linux is a read-only bind mount, and a bind protects a path only in the mount namespace it was made in. Creating a user namespace needs no capability and gives its creator a full capability set over a private copy of the mount tree, so a command that may create one can take the binds out of its own view.

In plain terms, the sandbox protects write-denied paths by mounting them read-only inside bubblewrap, the unprivileged sandbox tool Claude Code uses on Linux. A command that runs `unshare` to make a new user and mount namespace becomes "root" over its own copy of those mounts. It can then move them aside and write to the real files through a directory it opened earlier. The commit's test does exactly that: it "tries to replace a denied file through the directory it kept", and with `allowNestedUserNamespaces` on, it "does replace the file".

For an agent, this matters because the sandbox is what lets Claude Code [run shell commands without asking](https://code.claude.com/docs/en/sandboxing) you to approve each one. The same docs warn that writes to "user shell configuration files such as `.bashrc` or `.zshrc` can lead to code execution in different security contexts". A prompt-injected command that gets past the write denies can plant code that runs outside the sandbox later.

## How the sandbox enforces the limit

The [sandbox-runtime README](https://github.com/anthropics/sandbox-runtime/blob/main/README.md) describes two mechanisms. Which one applies depends on your setup:

![Decision flow: if allowNestedUserNamespaces is true, no limit. Otherwise, if the seccomp helper is in use, a seccomp filter refuses namespace and mount calls and user.max_user_namespaces is set to 0. Otherwise, if bubblewrap is 0.8.0 or later, not setuid, and enableWeakerNestedSandbox is off, bubblewrap gets --disable-userns. Otherwise no limit applies and a warning is logged once.](/diagrams/claude-code-sandbox-userns-limit-flow.svg)

| Path | When it applies | What the command sees |
| --- | --- | --- |
| Seccomp helper | The seccomp helper is in the chain | `unshare`, `clone` with namespace flags, `setns`, `mount`, `umount2`, `pivot_root` refused with `EPERM`. `clone3` returns `ENOSYS` |
| bubblewrap `--disable-userns` | No helper (`allowAllUnixSockets`, or none for the architecture), bubblewrap 0.8.0 or later, not setuid, `enableWeakerNestedSandbox` off | New user namespace refused with `ENOSPC` (`No space left on device`) |
| No limit | `allowNestedUserNamespaces: true`, or no helper plus old or setuid bubblewrap or `enableWeakerNestedSandbox` | Namespaces allowed. Write denies can be undone |

The README states the last row directly: "So `allowAllUnixSockets` and `enableWeakerNestedSandbox` together leave the limit off, as `allowNestedUserNamespaces` does". The [runtime source](https://github.com/anthropics/sandbox-runtime/blob/main/src/sandbox/linux-sandbox-utils.ts) logs one warning per process in that case, ending "a sandboxed command that creates one can undo the write denies".

## What breaks under the default

Per the README, anything that sandboxes itself with user namespaces now fails inside Claude Code's Linux sandbox:

- Chromium's and Electron's namespace sandbox
- Rootless podman and buildah
- A nested bubblewrap or `srt`
- `unshare -r` in a build script

The expected error is `unshare: unshare failed: Operation not permitted`. The README warns that "a nested bubblewrap blames a kernel setting and suggests a `sysctl`, which does not apply here." Do not change host sysctls to fix this. When Claude Code runs as root, commands also lose `unshare -m`, `nsenter`, and `ip netns exec`.

This is separate from the Ubuntu 24.04 AppArmor setting `kernel.apparmor_restrict_unprivileged_userns`, which the [sandboxing docs](https://code.claude.com/docs/en/sandboxing) cover as a setup step for bubblewrap itself.

## What to do

1. **Upgrade to 2.1.305 or later** on Linux and WSL2 machines that use the sandbox, so the setting exists and policy can pin it.
2. **Pin the setting off in managed settings.** The [sandboxing docs](https://code.claude.com/docs/en/sandboxing) say: "When managed settings set a Boolean key such as `enabled` or `failIfUnavailable`, Claude Code uses the managed value and ignores anything a developer sets locally." The docs' list of weakening keys does not include `allowNestedUserNamespaces` as of October 21, 2026, so set it explicitly:

   ```json
   {
     "sandbox": {
       "enabled": true,
       "allowNestedUserNamespaces": false,
       "enableWeakerNestedSandbox": false,
       "network": {
         "allowAllUnixSockets": false
       }
     }
   }
   ```

   Only set `enableWeakerNestedSandbox` to `false` where Claude Code does not run inside an unprivileged container that needs it.
3. **Find machines and repos that turned it on.** Search settings files for the key:

   ```bash
   grep -rn --include='settings*.json' 'allowNestedUserNamespaces' ~/.claude .claude 2>/dev/null
   ```

4. **Check which enforcement path you get.** Run `bwrap --version` (0.8.0 or later is needed for `--disable-userns`) and `stat -c '%A %n' "$(command -v bwrap)"`. An `s` in the owner execute position means setuid bubblewrap, which cannot apply `--disable-userns`. The `/sandbox` panel's Dependencies tab shows a missing seccomp filter.
5. **Test the limit.** In a sandboxed session, have Claude run `unshare -r true`. It should fail with `Operation not permitted` or `No space left on device`. Success means no limit is in force.
6. **Give browser and container work a different home.** The docs offer [`excludedCommands`](https://code.claude.com/docs/en/sandboxing) for tools that cannot run sandboxed, with the warning that "An excluded command runs with your full access." Keep patterns narrow. The docs also warn that a pattern covering an interpreter or a script inside your working directory lets Claude write that file and then run it outside the sandbox. For heavier work, the docs recommend running "the Claude Code process itself in a container, virtual machine, or the sandbox runtime".

## Choosing between the options

| Option | File protection kept | Cost |
| --- | --- | --- |
| Default (limit on) | Yes | Browser sandboxes and rootless containers fail |
| Narrow `excludedCommands` entry | Only for other commands | Matched command runs with full access |
| `allowNestedUserNamespaces: true` | No, for every command | Write denies stop holding session-wide |
| Claude Code inside a container or VM | Yes, at the outer boundary | Setup and image upkeep |

The opt-out is session-wide in Claude Code. The README notes that sandbox-runtime embedders can pass it "for a single command, in the configuration passed to `wrapWithSandbox`", which is the safer shape if you build your own agent on the runtime. Teams that wrote their own seccomp helper should note the README's warning: "A helper built before this release (an embedder's own, through `seccomp.applyPath` or `seccomp.argv0`) imposes no limit, and nothing says so".

## Related reading

For the permission side of Claude Code, see [how MCP allow rules changed in 2.1.299](/claude-code-mcp-allow-rules/). For locking down extensions through managed settings, see the [Claude Code mods security guide](/claude-code-mods-security-guide/).
