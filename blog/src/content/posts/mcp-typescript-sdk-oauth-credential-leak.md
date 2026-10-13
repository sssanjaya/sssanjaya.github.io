---
title: "MCP TypeScript SDK CVE-2026-104850: OAuth secrets leak"
description: "A malicious MCP server can collect OAuth client secrets from MCP TypeScript SDK clients. Upgrade to 1.31.0 or 2.2.0, set expectedIssuer, and rotate secrets."
date: 2026-10-13T10:07:32Z
tags: [mcp, ai-security, aiops, devsecops, security]
takeaways:
  - "CVE-2026-104850 lets a malicious or compromised MCP server make an MCP TypeScript SDK client send its OAuth client secret or refresh token to an authorization server the MCP server picks."
  - "Affected versions are @modelcontextprotocol/sdk 1.12.0 up to 1.31.0 and @modelcontextprotocol/client 2.0.0 up to 2.2.0; only clients that use the SDK's OAuth support over HTTP are affected."
  - "Upgrading alone does not protect the bundled machine-to-machine providers such as ClientCredentialsProvider: they also need expectedIssuer set to the real authorization server."
  - "In a local test, @modelcontextprotocol/sdk 1.31.0 without expectedIssuer still sent client_id and client_secret to the attacker's token endpoint, and with expectedIssuer it threw before sending anything."
  - "Any MCP client that may have talked to an untrusted MCP server while affected should have its client secret or signing key rotated and its tokens revoked."
---

[CVE-2026-104850](https://cveawg.mitre.org/api/cve/CVE-2026-104850), published October 6, 2026, lets a malicious MCP server collect the OAuth credentials of clients built on the MCP (Model Context Protocol) TypeScript SDK. It affects ops agents, gateways, and internal tools that connect to remote MCP servers over HTTP with OAuth. Upgrade to `@modelcontextprotocol/sdk` 1.31.0 or `@modelcontextprotocol/client` 2.2.0, set `expectedIssuer` on every bundled OAuth provider, and rotate any secret that may have reached an untrusted server.

![Flow of CVE-2026-104850: the MCP server answers 401, its metadata names an authorization server it chose, and the client sends client_id and client_secret there on 1.30.1 or on 1.31.0 without expectedIssuer; with expectedIssuer on 1.31.0 the client throws first](/diagrams/mcp-typescript-sdk-oauth-flow.svg)

## What CVE-2026-104850 is

MCP clients that use OAuth find their authorization server from the MCP server. The server answers `401` and points to its protected resource metadata, which lists `authorization_servers`. Before the fix, the SDK trusted that list for every credential it held.

The [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-104850), filed by GitHub as the CVE Numbering Authority, describes the result:

> A malicious or compromised MCP server could name its own authorization server in its protected resource metadata. Without any user interaction, the client would send that server the `refresh_token` and `client_secret` stored from an earlier sign-in (1.x), or the configured `client_secret` or signed assertion of a bundled non-interactive provider (1.x and 2.x).

| Field | Value |
| --- | --- |
| Advisory | [GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h) |
| CVSS 3.1 (GitHub) | 7.5 High, `CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N` |
| Weaknesses | CWE-345, CWE-522 |
| Affected 1.x | `@modelcontextprotocol/sdk` >= 1.12.0, < 1.31.0 |
| Affected 2.x | `@modelcontextprotocol/client` >= 2.0.0, < 2.2.0 |
| Fixed | `@modelcontextprotocol/sdk` 1.31.0, `@modelcontextprotocol/client` 2.2.0 |
| CISA-ADP SSVC | Exploitation: none, Automatable: yes |

CISA's Known Exploited Vulnerabilities (KEV) catalog did not list this CVE when checked on October 13, 2026.

## Who is affected

The [GitHub advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) scopes it to apps that use the SDK's OAuth client over HTTP, through an `authProvider` on a transport, the `withOAuth()` middleware, or direct calls to `auth()` or `fetchToken()`, and that may connect to an MCP server they do not fully trust while holding credentials for a real authorization server. It lists MCP servers built with the SDK and stdio clients as not affected.

The highest risk is the machine-to-machine case. An ops agent that holds a `client_secret` or private key for your identity provider and connects to many MCP servers can hand that secret to any one of them. The bundled providers named in the advisory are `ClientCredentialsProvider`, `PrivateKeyJwtProvider`, `StaticPrivateKeyJwtProvider`, and, in 2.x, `CrossAppAccessProvider`.

Interactive clients on 1.x are exposed too: the stored `refresh_token` and `client_secret` from an earlier sign-in could go to the attacker's server.

## Test results: 1.30.1 versus 1.31.0

On October 13, 2026, a local test ran a fake MCP server that answered `401` and named a second local server as its authorization server. That second server logged every request to its token endpoint. The client used `ClientCredentialsProvider` with `StreamableHTTPClientTransport` on Node.js 22.

| SDK version | `expectedIssuer` | What the attacker's token endpoint received |
| --- | --- | --- |
| 1.30.1 | not set | `POST /token` with `Authorization: Basic` holding `client_id:client_secret` |
| 1.30.1 | set (option ignored) | Same as above |
| 1.31.0 | not set | Same as above, plus a deprecation warning |
| 1.31.0 | set | Nothing. The client threw first |

On 1.31.0 without `expectedIssuer`, the SDK printed this warning and still sent the secret:

```text
[mcp-sdk] Omitting `expectedIssuer` is deprecated. Without it, the MCP server decides which authorization server receives this client's credentials; pass your authorization server's issuer URL as `expectedIssuer` so they are only sent there.
```

With `expectedIssuer` set, the connect call failed with:

```text
OAuth client information is bound to authorization server https://idp.example.com and is not presented to http://127.0.0.1:7002. Clear the stored client information, or correct `expectedIssuer`, if the authorization server has moved.
```

The 2.x packages, custom providers, and interactive sign-ins were not tested here.

## How to fix MCP clients that use OAuth

Upgrade first. The [1.31.0 release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.31.0) say stored tokens and client information now carry an `issuer` field, and "Storage that rejects unknown fields needs to allow it." The [2.2.0 release notes](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/v2.2.0) say `fetchToken()` throws `AuthorizationServerMismatchError` before sending a request when the stored client information belongs to a different authorization server.

Then pin each bundled provider to your real authorization server. This works on 1.31.0:

```javascript
import { ClientCredentialsProvider } from '@modelcontextprotocol/sdk/client/auth-extensions.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const authProvider = new ClientCredentialsProvider({
  clientId: process.env.MCP_CLIENT_ID,
  clientSecret: process.env.MCP_CLIENT_SECRET,
  expectedIssuer: 'https://auth.example.com',
});

const transport = new StreamableHTTPClientTransport(
  new URL('https://mcp.example.com/mcp'),
  { authProvider },
);
```

The advisory adds three more steps:

- Credentials saved before the upgrade have no `issuer`. Add it, or clear them so users sign in again.
- A custom `OAuthClientProvider` must save exactly what `saveTokens()` and `saveClientInformation()` receive, `issuer` included.
- If you cannot upgrade, the [CVE record](https://cveawg.mitre.org/api/cve/CVE-2026-104850) says: "On 1.x, the only workaround is to connect OAuth-enabled clients only to MCP servers you trust."

## What the fix does not cover

The [advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) lists gaps that remain after the upgrade:

- A new interactive sign-in still goes to the authorization server the MCP server names. Complete sign-ins only for servers you trust.
- Direct calls to `refreshAuthorization()` and `exchangeAuthorization()` are not checked.
- 2.x with `skipIssuerMetadataValidation: true` is not protected.

The Python SDK had a related OAuth fix in September. [Cycode's write-up](https://cycode.com/blog/mcp-python-sdk-oauth-account-takeover/) says `mcp` 1.30.0 and 2.2.0 fix it, and that `ClientCredentialsOAuthProvider` and `PrivateKeyJWTOAuthProvider` should be given `issuer=` explicitly. If you run agents in both languages, fix both.

## What to check

1. Find every install of the affected packages in each service and agent repo:

   ```bash
   npm ls @modelcontextprotocol/sdk @modelcontextprotocol/client --all
   ```

   Anything on `@modelcontextprotocol/sdk` below 1.31.0 or `@modelcontextprotocol/client` below 2.2.0 needs an upgrade. Check lockfiles of vendored tools and container images too, not only your own `package.json`.
2. Find code that sets up OAuth for MCP:

   ```bash
   grep -rnE "ClientCredentialsProvider|PrivateKeyJwtProvider|StaticPrivateKeyJwtProvider|CrossAppAccessProvider|authProvider|withOAuth\(" \
     --include='*.ts' --include='*.js' --include='*.mjs' --exclude-dir=node_modules .
   ```

   Each bundled provider needs `expectedIssuer`. Each custom provider needs to store `issuer`.
3. Search logs for the deprecation warning ``Omitting `expectedIssuer` is deprecated``. It marks a process that runs a fixed SDK but is still unprotected.
4. List the MCP servers each OAuth-holding client may connect to. If any is third-party, user-supplied, or was ever compromised, rotate that client's secret or signing key and revoke its tokens at your identity provider.
5. Give each agent its own OAuth client with the narrowest scopes. A leaked secret then exposes one agent, not the fleet.

MCP clients now sit in the same trust path as CI runners and deploy bots. For other recent AI infrastructure exposure, see [the LMCache unauthenticated RCE on port 5555](/lmcache-zmq-pickle-rce/), and for agent-side controls, [the Claude Code mods security guide](/claude-code-mods-security-guide/).
