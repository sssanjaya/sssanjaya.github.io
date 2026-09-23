// Sets the zone's HSTS (SSL/TLS > Edge Certificates > HSTS) to values that
// qualify for the browser preload list: max-age >= 1 year, includeSubDomains,
// preload. Only the HSTS block changes; the rest of security_header is kept.
//
// Preload is slow to undo (removal takes months to reach browsers), so every
// subdomain must serve HTTPS before this runs. Checked 2026-09-23: apex, www,
// blog and status serve HTTPS and redirect HTTP; devops and jenkins are NXDOMAIN.
//
// Env: CLOUDFLARE_ZONE_TOKEN  needs Zone > Zone Settings > Edit on the zone
//      CF_ZONE_NAME, CF_API, --dry-run   as in security-headers.mjs

const API = process.env.CF_API ?? "https://api.cloudflare.com/client/v4";
const TOKEN = process.env.CLOUDFLARE_ZONE_TOKEN;
const ZONE = process.env.CF_ZONE_NAME ?? "sanjayhona.com.np";
const DRY = process.argv.includes("--dry-run");

export const hsts = {
  enabled: true,
  max_age: 31536000, // 1 year, the preload list minimum
  include_subdomains: true,
  preload: true,
  nosniff: true,
};

async function cf(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => `${e.code}: ${e.message}`).join("; ") || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status} ${msg}`);
  }
  return json.result;
}

async function main() {
  if (!TOKEN) throw new Error("CLOUDFLARE_ZONE_TOKEN is not set");
  const zones = await cf("GET", `/zones?name=${encodeURIComponent(ZONE)}`);
  if (!zones?.length) throw new Error(`zone ${ZONE} not visible to this token`);
  const path = `/zones/${zones[0].id}/settings/security_header`;

  const current = (await cf("GET", path)).value?.strict_transport_security ?? {};
  const same = Object.entries(hsts).every(([k, v]) => current[k] === v);
  console.log(`HSTS now: ${JSON.stringify(current)}`);
  if (same) return console.log("already at target, nothing to change");
  if (DRY) return console.log(`would set: ${JSON.stringify(hsts)}`);

  const out = await cf("PATCH", path, { value: { strict_transport_security: hsts } });
  console.log(`HSTS set: ${JSON.stringify(out.value.strict_transport_security)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(`::error::${e.message}`);
    process.exit(1);
  });
}
