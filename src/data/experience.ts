// ─────────────────────────────────────────────────────────────────────────
// Experience timeline, newest first. Edit entries here.
// NOTE: the EdgeSignal entry is a draft framing — add exact start month and
// any metrics you want to surface. Past-role copy is from your resume.
// ─────────────────────────────────────────────────────────────────────────

export interface Role {
  year: string;
  title: string;
  company: string;
  blurb: string;
  tags: string[];
}

export const experience: Role[] = [
  {
    year: "2025 — now",
    title: "Site Reliability Engineer",
    company: "EdgeSignal",
    blurb:
      "Own production reliability for a distributed system — deployment " +
      "automation, fleet-wide observability, and incident response on Datadog " +
      "and CloudWatch. Keep the rollout pipeline boring and the pager quiet.",
    tags: ["AWS", "Docker", "Datadog", "CloudWatch", "Python"],
  },
  {
    year: "2021 — 2024",
    title: "DevOps / DevSecOps Engineer",
    company: "BeyondID",
    blurb:
      "Built AWS EKS platforms on GitOps (ArgoCD, Helm) and cut deploy " +
      "failures 15%. Led the company-wide Terraform migration — env setup from " +
      "3+ days to under 2 hours — and stood up ELK/Prometheus/Grafana that took " +
      "30% off MTTR. Passed a critical security audit with zero findings.",
    tags: ["AWS EKS", "Terraform", "ArgoCD", "Prometheus", "Security Audit"],
  },
  {
    year: "2019 — 2021",
    title: "DevOps Engineer",
    company: "Innovate Tech",
    blurb:
      "Migrated legacy CloudFormation to a modular Terraform framework; " +
      "standardized CI/CD across 10+ microservices — deployment errors down " +
      "35%, release frequency tripled. Built proactive security monitoring " +
      "with Prometheus and AWS CloudTrail.",
    tags: ["Terraform", "GitLab CI", "CloudTrail"],
  },
  {
    year: "2016 — 2019",
    title: "Software Engineer",
    company: "Sastra Creations · Three Monks",
    blurb:
      "Containerized a monolithic GPS platform with Docker to absorb a 200% " +
      "IoT traffic spike; built a real-time layer with Spring Boot and " +
      "WebSockets delivering sub-second fleet telemetry. Earlier, shipped " +
      "data-driven Java/JSP web apps on Nginx and Tomcat.",
    tags: ["Docker", "Spring Boot", "Node.js", "Java"],
  },
];
