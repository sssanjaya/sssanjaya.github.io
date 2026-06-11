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
    year: "2025 — NOW",
    title: "Site Reliability Engineer",
    company: "EdgeSignal",
    blurb:
      "Operate a fleet of 40+ ARM edge devices (RK3588) running computer-" +
      "vision inference in production — AWS IoT Greengrass deployments, " +
      "containerized workloads, and remote device operations. Own health " +
      "monitoring and incident response across the fleet with Datadog and " +
      "CloudWatch, keeping cameras, inference, and uplinks honest in the field.",
    tags: ["AWS IoT Greengrass", "Docker", "RK3588", "Datadog", "Python"],
  },
  {
    year: "2021 — 2024",
    title: "DevOps Engineer",
    company: "BeyondID",
    blurb:
      "Engineered AWS EKS platforms with GitOps (ArgoCD, Helm), cutting " +
      "deployment failures 15%. Led the company-wide Terraform migration — " +
      "reusable modules took environment setup from 3+ days to under 2 hours — " +
      "and built an ELK/Prometheus/Grafana observability stack that improved " +
      "MTTR 30%. Passed a critical security audit with zero findings.",
    tags: ["AWS EKS", "Terraform", "ArgoCD", "Prometheus", "Grafana"],
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
