---
title: "tensorlake 0.5.144 npm worm plants .claude/settings.json"
description: "Malicious tensorlake 0.5.144 on npm stole tokens and planted .claude and .vscode files in repos. Remove its token monitor before revoking, then rotate."
date: 2026-10-11T10:07:45Z
tags: [npm, supply-chain, claude-code, ai-security, devsecops]
takeaways:
  - "tensorlake 0.5.144 was a malicious npm release, published October 8, 2026 at 01:12 UTC through the project's own release workflow, so it carried valid npm provenance."
  - "Its preinstall hook stole GitHub, npm, cloud, Kubernetes, Vault, and SSH credentials, plus config files for AI tools such as Claude."
  - "With a stolen GitHub token, the worm commits .claude/settings.json and .vscode/tasks.json into repos so it runs again when someone opens the project in Claude Code or VS Code."
  - "Remove the gh-token-monitor service before revoking any GitHub token, because the monitor wipes the home directory when the token stops working."
  - "Claude Code runs hooks from a repository's .claude/settings.json in claude -p and SDK sessions without a trust prompt, so CI jobs that run Claude on untrusted repos need --bare or disableAllHooks."
---

The npm package `tensorlake` (the TypeScript SDK for Tensorlake) shipped a malicious version, 0.5.144, on October 8, 2026. It stole credentials on install, spread through stolen npm and GitHub tokens, and planted `.claude/settings.json` and `.vscode/tasks.json` files in other repos. If any machine installed it, remove its `gh-token-monitor` service first, then rotate every credential, then audit repos the stolen tokens could write to.

## What happened to tensorlake on npm

The maintainers' [security advisory GHSA-8g63-53c9-65j2](https://github.com/tensorlakeai/tensorlake/security/advisories/GHSA-8g63-53c9-65j2), published October 8, rates it Critical (CVSS 9.6) and attributes it to a compromised maintainer account. The attacker pushed code to the repository and the project's own release workflow published it, "so the package carries valid npm provenance."

The advisory says: "The package was live on npm for approximately 1 hour 40 minutes (01:12–02:54 UTC)." It also says: "Only the npm package was affected, the PyPI and crates.io `tensorlake` packages and the `tensorlake` CLI were not."

| Time (UTC) | Event | Source |
| --- | --- | --- |
| Oct 7, 01:20 | Commit `e90c47b` adds `typescript/lib/setup.mjs` and `typescript/lib/Math_Symbol.js` to `main`, message `Add files via upload` | [commit e90c47b](https://github.com/tensorlakeai/tensorlake/commit/e90c47bbb208e99cac8aa678405b2133f6cb3f52) |
| Oct 7, later | Seven more commits tune the payload and add the `preinstall` line | [StepSecurity](https://www.stepsecurity.io/blog/tensorlake-npm-compromised-hostage-token-worm) |
| Oct 8, 01:12:07 | `tensorlake@0.5.144` published | [npm registry](https://registry.npmjs.org/tensorlake) |
| Oct 8, 01:23:10 | Socket flags the release | [Socket](https://socket.dev/blog/tensorlake-compromise) |
| Oct 8, 02:54 | Version no longer live | [GHSA-8g63-53c9-65j2](https://github.com/tensorlakeai/tensorlake/security/advisories/GHSA-8g63-53c9-65j2) |
| Oct 8, 20:24:05 | `0.5.145` published | [npm registry](https://registry.npmjs.org/tensorlake) |

The commit times above come from fetching the commit with `git fetch` and reading it with `git log`. The registry times come from the package's `time` field. As of October 11, 2026, the registry no longer serves 0.5.144, the latest version is 0.5.149, and 0.5.145 declares no install scripts.

The advisory also lists six `tensorlake-native-*` platform packages at 0.5.144 as affected. Pin those to the same safe version as the main package.

Provenance did its job here: it proved the tarball came from the project's workflow. It does not prove the code in that workflow was reviewed. StepSecurity notes the malicious commits went straight to `main` with no pull request.

## What the payload does

[Socket](https://socket.dev/blog/tensorlake-compromise) shows the hook in the manifest: `"preinstall": "node lib/setup.mjs"`. Installing is enough; nothing has to import the SDK. The loader downloads the Bun runtime and uses it to run `lib/Math_Symbol.js`, which [StepSecurity](https://www.stepsecurity.io/blog/tensorlake-npm-compromised-hostage-token-worm) describes as "an obfuscated 856 KB file." StepSecurity adds: "It skips itself on CI, so developer machines are the target."

What the reports describe:

- **Theft.** npm and GitHub tokens, AWS credentials (including from IMDS, ECS, Secrets Manager, and SSM per Socket), Vault, Kubernetes service account tokens and kubeconfig, SSH keys, `.env` files, wallets, browser logins, and config files for AI tools including Claude, Cursor, and Windsurf.
- **Spread through npm.** With an npm token, it republishes the victim's own packages with itself inside.
- **Spread through GitHub.** With a GitHub token, it commits `.claude` and `.vscode` files to the victim's repos, authored as `claude@users.noreply.github.com` with the message `chore: update dependencies` (StepSecurity). The advisory also names a branch `dependabot/github_actions/format/setup-formatter` as a sign of spread.
- **Exfiltration.** To a public GitHub repo in the victim's account described as "Shai-Hulud: Here We Go Again", or to `iseekaigogo.com`.
- **Hostage token.** A service called `gh-token-monitor` checks the stolen GitHub token every 60 seconds. If GitHub rejects it, the service deletes the home directory.

## Why the .claude/settings.json file matters

StepSecurity writes: "The malware also writes `.claude/settings.json` and `.vscode/tasks.json` files into repos it can reach, so it runs again when someone opens the project in Claude Code or VS Code."

In the payload from commit `e90c47b`, the table of files to plant is readable in plain text: `.vscode/tasks.json`, `.claude/settings.json`, `.claude/setup.mjs`, and `.vscode/setup.mjs`. The contents are encrypted inside the payload, so this post does not claim which settings keys the planted file uses. The relevant rules for both tools are in their docs.

**Claude Code.** The [hooks reference](https://code.claude.com/docs/en/hooks) says Claude Code checks workspace trust before it runs any hook from a settings file, and:

> **`-p` or SDK session**: Claude Code never shows the dialog and treats the folder as trusted, so hooks committed in a repository's `.claude/settings.json` run in a folder you've never trusted

In an interactive session, hooks wait until you accept the trust dialog. A developer who clicks through that dialog on a familiar repo has trusted the planted file too.

**VS Code.** The [tasks docs](https://code.visualstudio.com/docs/debugtest/tasks) say `task.allowAutomaticTasks` controls tasks with `"runOn": "folderOpen"`. The default is `off`, but if you have not chosen yet for a workspace "you are prompted once to **Allow** or **Disallow** automatic tasks." Automatic tasks never run in an untrusted workspace.

The worst case is automation. A scheduled job or CI step that clones a repo and runs `claude -p` in it runs that repo's settings-file hooks with no prompt at all. If a planted `.claude/settings.json` carries hooks, they run with the job's secrets.

## What to do now

Order matters. Revoking a GitHub token while `gh-token-monitor` is running is what triggers the wipe.

![Response order for tensorlake 0.5.144: check exposure, remove gh-token-monitor, rotate credentials from a clean machine, then clean repos and packages the tokens could reach, and rebuild the host](/diagrams/tensorlake-npm-worm-response-order.svg)

1. **Find installs.** Run `npm ls tensorlake` in each project. Search lockfiles, including the native packages:

   ```bash
   jq -r '.packages | to_entries[]
     | select(.key | test("(^|/)node_modules/tensorlake(-native-[^/]+)?$"))
     | "\(.key) \(.value.version)"' package-lock.json
   ```

   Any `0.5.144` is a hit. The advisory window is 01:12 to 02:54 UTC on October 8, so also check CI logs and caches for installs in that window.

2. **Look for the monitor on each hit.** These paths come from StepSecurity and Socket:

   ```bash
   # Linux
   systemctl --user status gh-token-monitor.service
   ls -la ~/.config/gh-token-monitor/ ~/.local/bin/gh-token-monitor.sh
   # macOS
   ls -la ~/Library/LaunchAgents/com.user.gh-token-monitor.plist
   ```

   On Windows, look in Task Scheduler for a logon task that runs `monitor.ps1`.

3. **Remove the monitor before revoking anything.** Back up what you cannot lose. Disconnect the machine from the network. On Linux, disable and stop `gh-token-monitor.service` with `systemctl --user`. On macOS, unload the LaunchAgent with `launchctl`. Delete the config directory and script.

4. **Rotate from a clean machine.** GitHub and npm tokens, cloud keys, SSH and GPG keys, Kubernetes and Vault credentials, `.env` secrets, and AI tool API keys.

5. **Audit what the tokens could write to.** In each repo:

   ```bash
   git fetch --all
   git log --all --since=2026-10-07 --format='%h %an <%ae> %ad %s' -- .claude .vscode
   git log --all --author='claude@users.noreply.github.com' --format='%h %an %ad %s'
   git ls-remote origin 'refs/heads/dependabot/github_actions/format/setup-formatter'
   ```

   Also look for new public repos in the account described as "Shai-Hulud: Here We Go Again", and for npm versions of your own packages you did not release.

6. **Rebuild** any machine you cannot prove clean.

## How to harden Claude Code and VS Code against planted settings

| Control | Where | Effect |
| --- | --- | --- |
| `claude -p --bare` | CI and scripts | Reads no hooks, skills, plugins, or `.mcp.json` servers from the project |
| `--settings '{"disableAllHooks": true}'` | CI and scripts | Turns hooks off for that run, over project settings |
| `allowManagedHooksOnly: true` | Managed settings | Blocks user, project, local, and plugin hooks, except plugins force-enabled in managed settings |
| `"task.allowAutomaticTasks": "off"` | VS Code user settings | No `folderOpen` tasks and no prompt |
| `ignore-scripts=true` | `.npmrc` | npm does not run `preinstall` and other lifecycle scripts |

Note from the [hooks reference](https://code.claude.com/docs/en/hooks): setting `disableAllHooks` in your user settings alone does not hold, because "a `"disableAllHooks": false` in a project's `.claude/settings.json` overrides a `true` in your user settings." Pass it with `--settings` or set it in managed settings. The [`--bare` limits](https://code.claude.com/docs/en/permissions) also matter: "The project's `env` block and helpers such as `awsAuthRefresh` in its settings files still apply."

Two more checks are worth adding to code review:

- Treat any change under `.claude/` or `.vscode/` like a change to a CI workflow. Require review through `CODEOWNERS` and branch protection.
- Do not trust a commit because its author is `claude`. Anyone can set that name and email.

This is the second npm compromise this month that shipped through a project's own publish workflow. The earlier case is in [the @subql/common trusted publishing breakdown](/subql-npm-trusted-publishing-compromise/). For hooks that enforce policy, see [Claude Code onFailure block](/claude-code-hooks-onfailure-block/), and for the wider plugin and hook setup, [the Claude Code mods security guide](/claude-code-mods-security-guide/).
