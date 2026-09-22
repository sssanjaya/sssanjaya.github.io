// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for identity, contact, signals, status rows, stack
// topology, and the "Currently" block. Edit this file to update the site —
// no component changes needed.
// ─────────────────────────────────────────────────────────────────────────

export const site = {
  name: "Sanjay Hona",
  handle: "sanjay-hona",
  currentTitle: "Site Reliability Engineer",
  currentCompany: "EdgeSignal",
  location: "Ottawa, Canada",
  // Decorative "region" shown in the console breadcrumb and terminal.
  region: "ca-ottawa-1",
  timezone: "America/Toronto",
  // Fallback label before the client-side clock resolves EDT/EST.
  timezoneLabel: "ET",
  email: "devops@sanjayhona.com.np",
  available: true,
  availableLabel: "open to new roles",

  // Canonical production origin (no trailing slash). Used for OG/JSON-LD.
  url: "https://sanjayhona.com.np",
  // 1200×630 social share card under /public.
  ogImage: "/og.png",
  jobTitle: "Site Reliability Engineer",

  // Tight ≤160-char snippet for <meta name="description"> & social cards.
  metaDescription:
    "Sanjay Hona — DevOps, DevSecOps & SRE engineer in Ottawa. 7+ years " +
    "building secure, reliable cloud platforms on Kubernetes and Terraform.",

  socials: [
    { label: "LinkedIn", handle: "/in/sanjayhona", href: "https://linkedin.com/in/sanjayhona" },
    { label: "Email", handle: "devops@sanjayhona.com.np", href: "mailto:devops@sanjayhona.com.np" },
  ],

  // Disciplines shown under the name; AIOps is in-progress.
  disciplines: ["DevOps", "DevSecOps", "SRE"],
  learning: "AIOps",
  yearsLabel: "7+ years",
  // First year in production. Drives the status-page history bars.
  careerStart: 2016,
  // First year in DevOps. Drives the "years" signal and the terminal AGE.
  opsStart: 2019,

  // In-page section nav (top bar + command palette).
  nav: [
    { label: "signals", href: "/#signals" },
    { label: "status", href: "/#status" },
    { label: "experience", href: "/#experience" },
    { label: "stack", href: "/#stack" },
    { label: "about", href: "/#about" },
    { label: "contact", href: "/#contact" },
  ],

  // Golden-signal panels — career numbers from the resume.
  //   viz "years": one cell per year since opsStart
  //   viz "fleet": one dot per device (count)
  //   viz "delta": before/after bars, widths scaled to the larger value
  //   viz "zero":  severity counters, all zero
  signals: [
    {
      label: "Time in production",
      value: "7+",
      unit: "years",
      note: "DevOps → DevSecOps → SRE, since 2019",
      viz: "years",
    },
    {
      label: "Edge fleet operated",
      value: "40+",
      unit: "devices",
      note: "Running in the field, watched remotely",
      viz: "fleet",
      count: 40,
    },
    {
      label: "Incident resolution",
      value: "−30%",
      unit: "MTTR",
      note: "ELK + Prometheus + Grafana · BeyondID",
      viz: "delta",
      before: { label: "baseline", n: 100 },
      after: { label: "−30%", n: 70 },
    },
    {
      label: "Release frequency",
      value: "3×",
      unit: "more releases",
      note: "Standard CI/CD over 10+ services · Innovate Tech",
      viz: "delta",
      before: { label: "1×", n: 1 },
      after: { label: "3×", n: 3 },
    },
    {
      label: "Environment setup",
      value: "<2h",
      unit: "was 3+ days",
      note: "Company-wide Terraform migration · BeyondID",
      viz: "delta",
      before: { label: "3+ days", n: 72 },
      after: { label: "< 2 h", n: 2 },
    },
    {
      label: "Critical security audit",
      value: "0",
      unit: "findings",
      note: "Passed clean · BeyondID",
      viz: "zero",
    },
  ],

  // Status-page rows. `since` is the first year in production for that
  // discipline; cells before it render as "no data".
  status: [
    { name: "Software engineering", since: 2016, state: "operational" },
    { name: "DevOps", since: 2019, state: "operational" },
    { name: "DevSecOps", since: 2021, state: "operational" },
    { name: "SRE", since: 2025, state: "operational" },
    { name: "AIOps", since: 2026, state: "canary" },
  ],

  // Stack topology. `place`: "core" layers stack top → bottom in order, and
  // `flow` labels the arrow down to the next layer; "left"/"right" are
  // cross-cutting bands on either side.
  stack: [
    { key: "iac_cicd", label: "Delivery", sub: "IaC · CI/CD", place: "core", flow: "deploys to", items: ["Terraform", "GitLab CI", "GitHub Actions", "ArgoCD"] },
    { key: "orchestration", label: "Runtime", sub: "Orchestration", place: "core", flow: "runs on", items: ["Kubernetes", "Docker", "Helm"] },
    { key: "cloud", label: "Infrastructure", sub: "Cloud", place: "core", items: ["AWS", "Azure"] },
    { key: "security", label: "Security", sub: "cross-cutting", place: "left", items: ["CloudTrail", "audits", "least-privilege", "supply-chain"] },
    { key: "observability", label: "Observability", sub: "cross-cutting", place: "right", items: ["Datadog", "Prometheus", "Grafana", "ELK"] },
  ],

  // Operating principles — pulled from my own copy elsewhere on the site.
  principles: [
    "Boring deploys are a feature.",
    "Reliability and security are the same job.",
    "The best infrastructure is the kind nobody notices.",
  ],

  // "Currently" — rendered as `kubectl describe` in the hero. Keep it honest.
  currently: [
    { key: "Role", value: "SRE · EdgeSignal" },
    { key: "Focus", value: "AWS · K8s · Terraform" },
    { key: "Learning", value: "CKA · in progress" },
    { key: "Reading", value: "Designing Data-Intensive Apps" },
    { key: "Practicing", value: "Vim · mastery goal 2027" },
  ],
} as const;

export type Site = typeof site;
