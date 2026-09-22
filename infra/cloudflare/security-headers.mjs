// Upserts a Cloudflare Response Header Transform Rule that adds security
// headers to the main site (GitHub Pages can't set response headers).
//
// The API replaces the whole phase ruleset on PUT, so this reads the current
// rules, swaps in ours (matched by `ref`), and writes everything back. Rules
// you created elsewhere are preserved.
//
// Env: CLOUDFLARE_ZONE_TOKEN  token scoped to this zone with
//                              Zone > Zone > Read and Zone > Transform Rules > Edit
//      CF_ZONE_NAME           e.g. sanjayhona.com.np
//      CF_API                 optional API base (tests)
// Flags: --dry-run  print the ruleset that would be written, change nothing

const API = process.env.CF_API ?? "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_ZONE_TOKEN;
const ZONE = process.env.CF_ZONE_NAME ?? "sanjayhona.com.np";
const DRY = process.argv.includes("--dry-run");
const PHASE = "http_response_headers_transform";

// The blog (blog.*) sets its own headers from blog/public/_headers, and www
// redirects to the apex, so the rule only targets the apex host.
export const rule = {
  ref: "site_security_headers",
  description: "Security headers for sanjayhona.com.np (managed in repo: infra/cloudflare)",
  expression: `(http.host eq "${ZONE}")`,
  action: "rewrite",
  action_parameters: {
    headers: {
      "X-Frame-Options": { operation: "set", value: "DENY" },
      // Only frame-ancestors: the full CSP ships as a <meta> tag from the build.
      "Content-Security-Policy": { operation: "set", value: "frame-ancestors 'none'" },
      "Permissions-Policy": { operation: "set", value: "camera=(), microphone=(), geolocation=()" },
      "Referrer-Policy": { operation: "set", value: "strict-origin-when-cross-origin" },
      "X-Content-Type-Options": { operation: "set", value: "nosniff" },
    },
  },
  enabled: true,
};

async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 404 && method === "GET") return null;
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
  }
  return json.result;
}

// Keep only the fields the PUT accepts; drop read-only ones like last_updated.
const writable = ({ id, ref, description, expression, action, action_parameters, enabled }) =>
  ({ id, ref, description, expression, action, action_parameters, enabled });

async function main() {
  if (!TOKEN) throw new Error("CLOUDFLARE_ZONE_TOKEN is not set");
  const zones = await cf("GET", `/zones?name=${encodeURIComponent(ZONE)}`);
  if (!zones?.length) throw new Error(`zone ${ZONE} not visible to this token`);
  const zoneId = zones[0].id;

  const current = await cf("GET", `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`);
  const others = (current?.rules ?? []).filter((r) => r.ref !== rule.ref).map(writable);
  const existing = (current?.rules ?? []).find((r) => r.ref === rule.ref);
  const rules = [...others, existing ? { ...rule, id: existing.id } : rule];

  console.log(`zone ${ZONE}: ${others.length} other rule(s) kept, ours ${existing ? "updated" : "created"}`);
  if (DRY) {
    console.log(JSON.stringify({ rules }, null, 2));
    return;
  }
  const out = await cf("PUT", `/zones/${zoneId}/rulesets/phases/${PHASE}/entrypoint`, { rules });
  console.log(`ruleset ${out.id} now at version ${out.version} with ${out.rules.length} rule(s)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
