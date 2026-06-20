// ─────────────────────────────────────────────────────────────────────────
// Single source of truth for identity, contact, stats, and the "Currently"
// block. Edit this file to update the site — no component changes needed.
// ─────────────────────────────────────────────────────────────────────────

export const site = {
  name: "Sanjay Hona",
  shortName: "S. Hona",
  role: "DevOps / SRE Engineer",
  currentTitle: "Site Reliability Engineer",
  currentCompany: "EdgeSignal",
  location: "Ottawa, Canada",
  timezone: "America/Toronto",
  timezoneLabel: "EDT",
  email: "devops@sanjayhona.com.np",
  available: true,
  availableLabel: "Available",

  // Canonical production origin (no trailing slash). Used for OG/JSON-LD.
  url: "https://sanjayhona.com.np",
  // 1200×630 social share card under /public.
  ogImage: "/og.png",
  jobTitle: "Site Reliability Engineer",

  // Tight ≤160-char snippet for <meta name="description"> & social cards.
  // The longer `lede` below is on-page hero copy, not the search snippet.
  metaDescription:
    "Sanjay Hona — DevOps, DevSecOps & SRE engineer in Ottawa. 7+ years " +
    "building secure, reliable cloud platforms on Kubernetes and Terraform.",

  // One-line lede shown under the hero headline.
  lede:
    "DevOps & Site Reliability engineer. For seven years I've built cloud " +
    "infrastructure that ships fast and stays up — Kubernetes platforms, " +
    "Terraform everywhere, and a fleet of 40+ edge devices running in the " +
    "field. Boring deploys are a feature.",

  socials: [
    { label: "LinkedIn", href: "https://linkedin.com/in/sanjayhona" },
    { label: "Email", href: "mailto:devops@sanjayhona.com.np" },
  ],

  // Identity rail — disciplines shown next to the name; AIOps is in-progress.
  disciplines: ["DevOps", "DevSecOps", "SRE"],
  learning: "AIOps",
  yearsLabel: "7+ years",

  // In-page section nav.
  nav: [
    { label: "experience", href: "/#experience" },
    { label: "stack", href: "/#stack" },
    { label: "about", href: "/#about" },
    { label: "contact", href: "/#contact" },
  ],

  // Stack table — rendered as key/value "syntax" rows.
  stack: [
    { key: "cloud", items: ["AWS", "Azure"] },
    { key: "orchestration", items: ["Kubernetes", "Docker", "Helm", "ArgoCD"] },
    { key: "iac_cicd", items: ["Terraform", "GitLab CI", "GitHub Actions"] },
    { key: "observability", items: ["Datadog", "Prometheus", "Grafana", "ELK"] },
    { key: "security", items: ["CloudTrail", "audits", "least-privilege", "supply-chain"] },
  ],

  // Hero stat row — career highlights drawn from the resume.
  stats: [
    { value: "7+", label: "Years in production" },
    { value: "40+", label: "Edge devices operated" },
    { value: "−30%", label: "Incident resolution time" },
    { value: "3×", label: "Release frequency" },
  ],

  // "Currently" — the learning-in-public block. Update freely; keep it honest.
  currently: [
    { key: "Role", value: "SRE · EdgeSignal" },
    { key: "Focus", value: "AWS · K8s · Terraform" },
    { key: "Learning", value: "CKA · in progress" },
    { key: "Reading", value: "Designing Data-Intensive Apps" },
    { key: "Practicing", value: "Vim — mastery goal 2027" },
  ],
} as const;

export type Site = typeof site;
