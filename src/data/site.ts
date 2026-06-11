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
  email: "sanjay.hona@gmail.com",
  available: true,
  availableLabel: "Available",

  // One-line lede shown under the hero headline.
  lede:
    "DevOps & Site Reliability engineer. For seven years I've built cloud " +
    "infrastructure that ships fast and stays up — Kubernetes platforms, " +
    "Terraform everywhere, and a fleet of 40+ edge devices running in the " +
    "field. Boring deploys are a feature.",

  socials: [
    { label: "GitHub", href: "https://github.com/sssanjaya" },
    { label: "LinkedIn", href: "https://linkedin.com/in/sanjayhona" },
    { label: "Email", href: "mailto:sanjay.hona@gmail.com" },
  ],

  resumeUrl: "/resume.pdf",

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
