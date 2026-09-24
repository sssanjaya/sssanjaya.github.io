---
title: "AWS CloudWatch Omni: what it is, setup, and pricing"
description: "Amazon CloudWatch Omni is a new web UI and IDE extension on top of CloudWatch for app and AI agent telemetry over OpenTelemetry. Setup, gotchas, and pricing."
date: 2026-09-24T09:00:00Z
tags: [aws, cloudwatch, observability, opentelemetry]
takeaways:
  - "CloudWatch Omni is a layer on top of CloudWatch: existing alarms, dashboards, and APIs keep working, and telemetry already in CloudWatch shows up without reconfiguration."
  - "Omni runs as its own web app behind IAM Identity Center SSO, so engineers can use it without AWS Console access."
  - "AI agents send traces with the AWS Distro for OpenTelemetry, and Transaction Search must be enabled first or the traces are not searchable."
  - "Transaction Search indexes 1 percent of spans by default, so most agent invocations are stored but not listed until you raise the indexing percentage."
  - "Omni bills ingestion and storage at standard CloudWatch rates, and queries are free up to 5 times your monthly log and span ingestion."
---

Amazon CloudWatch Omni, announced on September 22, 2026, is a new observability experience built on top of CloudWatch. It adds a standalone web UI with single sign-on (SSO) and an IDE extension, and it covers both applications and AI agents through OpenTelemetry. It does not replace CloudWatch: data you already send appears in Omni as is, and ingestion and storage cost what they cost today.

My day job includes incident response on CloudWatch, so I read the launch posts, the docs, and the pricing page with one question: what changes for a team that already runs on it. This post covers what Omni is, how to get agent traces into it, the setup details that are easy to miss, and what it costs.

## What CloudWatch Omni adds on top of CloudWatch

AWS published two launch posts: one on [application observability](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudwatch-omni-collaborative-ai-powered-observability-for-your-applications/) and one on [generative AI and agent workloads](https://aws.amazon.com/blogs/aws/introducing-amazon-cloudwatch-omni-ai-powered-observability-for-generative-ai-and-agentic-workloads/). The application post states the relationship plainly: "CloudWatch Omni extends CloudWatch. Existing alarms, dashboards, APIs, and console workflows continue unchanged."

What is new:

- **A separate web app.** Engineers reach Omni through one URL with enterprise SSO via [IAM Identity Center](https://aws.amazon.com/iam/identity-center/), which supports Okta, Entra ID, and other SAML 2.0 providers. The post says "No AWS Console access is required."
- **Spaces.** A space groups applications and telemetry for a team or environment. Spaces point at existing CloudWatch data, so nothing is copied.
- **Topology discovery.** Omni maps services and their dependencies automatically.
- **AI-guided investigation.** Omni takes natural language queries, and Amazon DevOps Agent joins investigation sessions to correlate signals and suggest next steps. When an investigation escalates, the next person joins the same session with its context.
- **Agent observability.** Traces, sessions, and topology for AI agents, plus evaluations, datasets, experiments, and a prompt playground.
- **An IDE extension.** The [docs](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/omni-monitor-ai-agents.html) list VS Code, Kiro, and Cursor. The agent launch post names VS Code and Kiro as the currently supported IDEs.

To try it on an account that already uses CloudWatch, open the CloudWatch console and choose "Try CloudWatch Omni".

## Omni web UI vs IDE extension

The two surfaces share one space, so a trace a developer opens in the editor is the same trace an operator sees in the web UI. They do not have the same features. From the docs:

| Capability | Omni web UI | IDE extension |
| --- | --- | --- |
| Agent traces, sessions, topology | Yes | Yes |
| Evaluators and evaluations | Yes | Yes |
| Online evaluations | Yes | No |
| Experiments | No | Yes |
| Prompt management and versioning | No | Yes |
| Test your agent locally | No | Yes |
| Aggregate and fleet views | Yes | No |

The agent launch post says the IDE extension works fully locally during development, and a "Cloud Login" step connects it to an AWS account when you want to keep traces in CloudWatch and share them.

## Sending AI agent traces with the AWS Distro for OpenTelemetry

Omni reads agent activity from OpenTelemetry traces. The [agent telemetry guide](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/omni-send-ai-agent-telemetry.html) documents Python and Node.js agents built with LangGraph, LangChain, Strands Agents, CrewAI, OpenAI Agents, LlamaIndex, or the Vercel AI SDK, running on Amazon Bedrock AgentCore, AWS Lambda, Amazon EC2, Amazon ECS, or Amazon EKS.

The recommended path is the [AWS Distro for OpenTelemetry](https://aws-otel.github.io/) (ADOT), which instruments model and tool calls with no code changes:

```bash
pip install "aws-opentelemetry-distro>=0.20.0"
```

On your own compute, a Python agent starts under the OpenTelemetry launcher with these variables, copied from the guide:

```bash
AGENT_OBSERVABILITY_ENABLED=true \
AWS_GENAI_CONTENT_EXTRACTION_OPT_OUT=true \
OTEL_PYTHON_DISTRO=aws_distro \
OTEL_PYTHON_CONFIGURATOR=aws_configurator \
OTEL_RESOURCE_ATTRIBUTES="service.name=<agent-name>,deployment.environment.name=<stage>,aws.log.group.names=<your-custom-log-group>" \
OTEL_EXPORTER_OTLP_TRACES_HEADERS="x-aws-log-group=<your-custom-log-group>,x-aws-log-stream=<your-custom-log-stream>" \
OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf \
OTEL_TRACES_EXPORTER=otlp \
OTEL_LOGS_EXPORTER=none \
OTEL_METRICS_EXPORTER=none \
opentelemetry-instrument python /path/to/your/agent.py
```

On Lambda, EC2, ECS, and EKS, the role the compute runs as needs the AWS managed policy [`AWSXrayWriteOnlyAccess`](https://docs.aws.amazon.com/aws-managed-policy/latest/reference/AWSXrayWriteOnlyAccess.html). On AgentCore, the runtime exports traces itself, and the only variable the guide asks you to set is `AWS_GENAI_CONTENT_EXTRACTION_OPT_OUT=true`.

## Setup details that are easy to miss

These come from the prerequisites and the troubleshooting table in the guide. Each one produces an agent that runs fine and traces that do not show up where you expect.

**Transaction Search comes first.** [Transaction Search](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Transaction-Search.html) must be enabled in the account and Region that receive traces. Traces sent before it is enabled are not searchable. To set the trace destination directly:

```bash
aws xray update-trace-segment-destination --destination CloudWatchLogs --region <region>
```

The guide says the change takes effect after about 10 minutes.

**Only 1 percent of spans are indexed by default.** In the guide's words: "Transaction Search indexes 1 percent of spans by default for the trace list, so not every invocation is listed until you raise the indexing percentage; the spans themselves are all stored." A quiet test agent can look broken because its one invocation was not in the indexed 1 percent.

**The opt-out flag keeps content.** `AWS_GENAI_CONTENT_EXTRACTION_OPT_OUT=true` keeps prompt and response text in the spans, and the evaluators read that text. The guide's fix for blank prompt, response, or tool content is setting this variable to `true`. Node.js captures message content by default. Decide on redaction before you turn this on for production data; the docs have a page on protecting sensitive data.

**One tracer provider only.** ADOT registers the global tracer provider at startup, and OpenTelemetry uses only the first one registered. Creating a second provider or exporter in your own code gives you spans that never export.

**A 200 is not proof.** The guide notes that a successful invocation does not mean traces arrived. Check for an agent span with a child span for each model call and each tool call.

**A 404 from the exporter usually means a doubled path.** `OTEL_EXPORTER_OTLP_ENDPOINT` appends `/v1/traces` automatically. If your value already ends in that path, set `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` instead.

## CloudWatch Omni pricing

The [Omni pricing page](https://aws.amazon.com/cloudwatch/omni/pricing/) shows US East (N. Virginia) prices. Ingestion and storage are standard CloudWatch rates. Omni adds a query charge above an allowance.

| Item | Price |
| --- | --- |
| Application and custom logs, ingestion | $0.50/GB |
| OpenTelemetry metrics, ingestion | $0.50/GB |
| Spans, ingestion | $0.35 to $0.15/GB, tiered |
| Standard storage | $0.030 per GB-month |
| Query, logs and traces | $0.005/GB scanned, above the allowance |

Query volume up to 5 times your monthly log and span ingestion is free. Dashboards and alerts are included, and the page offers $1,000 in free credits to start. The Omni pricing page does not list charges for Amazon DevOps Agent; [InfoWorld](https://www.infoworld.com/article/4225120/aws-launches-cloudwatch-omni-to-unify-observability-for-ai-agents-and-applications.html) reports that it is priced separately.

Agents make the span line the one to watch. Every model call and tool call is a span, and with content extraction on, each span carries the prompt and response text. Estimate span volume from a real test run before you point production traffic at it, and remember the default 1 percent indexing when you read the trace list.

## Who gains the most from trying Omni

For a team already on CloudWatch, the cost of trying it is low: nothing existing changes, and the data is already there. The web UI with SSO is the part that changes who can investigate an incident, since people no longer need Console access to look at telemetry. For agent workloads, the setup is a normal OpenTelemetry rollout plus the AWS-specific settings above. The same least-privilege habit from [hardening a static site](/hardening-a-static-site/) applies here: grant `AWSXrayWriteOnlyAccess` to the one role that exports traces, not to everything.
