# Repository Structure

This document describes the actual layout of the repository and what lives where.

```
.
├── app/                         # Node.js application
│   ├── src/                     # Application source
│   │   ├── server.js            # Express app (probes, metrics, cache API, circuit breaker)
│   │   ├── secrets.js           # Loads the Redis token from Secrets Manager at startup
│   │   ├── package.json         # App manifest + npm scripts + Jest config
│   │   ├── package-lock.json    # Locked dependency tree (used by `npm ci`)
│   │   ├── Dockerfile           # Multi-stage build (deps → runtime, non-root, digest-pinned base)
│   │   ├── .dockerignore
│   │   ├── .eslintrc.json
│   │   └── .env.example         # Template for local environment variables
│   └── tests/
│       ├── unit/                        # `npm test` (Jest, with coverage, needs nothing else)
│       ├── integration/                 # `npm run test:integration` (needs Redis), includes outage recovery
│       ├── load/k6-load.js              # `npm run test:load` (needs k6)
│       └── setup.js                     # Global Jest setup
│
├── terraform/                   # Infrastructure as Code (AWS)
│   ├── bootstrap/               # Run once: state bucket, lock table, GitHub OIDC provider
│   ├── backend/                 # Backend settings per environment (development, production)
│   ├── environments/            # Variable values per environment (development, production)
│   ├── main.tf                  # Root module: VPC + EKS + ECR + ElastiCache + Secrets/IAM/SNS/Budget
│   ├── variables.tf             # Input variables (region, node_groups, enable_redis, ...)
│   ├── observability.tf         # CloudWatch add-on (metrics, log shipping), alarms
│   ├── oidc.tf                  # GitHub Actions deploy role, scoped to one environment
│   ├── github-actions-eks-access.tf   # EKS access entry/RBAC for the deploy role
│   ├── lb-controller-irsa.tf    # IRSA role for the AWS Load Balancer Controller
│   └── modules/
│       ├── vpc/                 # Wraps terraform-aws-modules/vpc (single NAT, 2 AZs)
│       └── eks/                 # Wraps terraform-aws-modules/eks (managed node group, IRSA, addons)
│
├── helm/
│   └── saas-app/               # Helm chart for the application
│       ├── Chart.yaml
│       ├── values.yaml         # Base values
│       ├── values-dev.yaml     # Development overrides (used by the CD pipeline)
│       ├── values-prod.yaml    # Production overrides
│       └── templates/          # Deployment, Service, ServiceAccount, Ingress, HPA, PDB, NetworkPolicy
│
├── monitoring/
│   └── servicemonitor.yaml     # ServiceMonitor scraped by kube-prometheus-stack
│
├── scripts/
│   ├── bootstrap.sh            # Provision one environment and install the LB controller
│   ├── teardown.sh             # Remove the app and its ALB, then terraform destroy
│   └── chaos-test.sh           # Controlled failure experiments with measured recovery
│
├── .github/
│   ├── dependabot.yml          # npm, base image and action updates
│   └── workflows/
│       ├── ci.yml              # Lint, tests, k6 load test, Snyk, image build, Trivy, Hadolint
│       ├── cd.yml              # CI, then deploy (develop to dev, main to production with approval)
│       ├── deploy.yml          # Reusable deploy: build/push, Helm --atomic, smoke test
│       ├── terraform.yml       # fmt/init/validate/tfsec/plan on terraform/** PRs
│       └── security.yml        # Nightly Trivy filesystem scan → GitHub Security tab
│
├── docs/                        # Project documentation
│   ├── architecture/system-design.md
│   ├── development/getting-started.md
│   ├── deployment/deployment-guide.md
│   ├── troubleshooting/common-issues.md
│   ├── branching-strategy.md
│   ├── chaos-engineering.md
│   ├── production-checklist.md
│   ├── REVIEW-FOLLOWUP.md
│   ├── cost-optimization-report.md
│   └── images/                  # Screenshots referenced by the docs
│
├── .pre-commit-config.yaml
├── CONTRIBUTING.md
├── LICENSE
├── STRUCTURE.md
└── README.md
```

## At a glance

| Area           | Directory        | Technology                                   |
|----------------|------------------|----------------------------------------------|
| Application    | `app/`           | Node.js 22, Express, Redis, prom-client      |
| Infrastructure | `terraform/`     | Terraform, AWS (VPC, EKS, ECR, ElastiCache, IAM/OIDC) |
| Packaging      | `helm/saas-app/` | Helm chart, the single source for all app Kubernetes resources |
| Observability  | `monitoring/`    | Prometheus ServiceMonitor (kube-prometheus-stack) |
| Automation     | `scripts/`       | Bash bootstrap / teardown                    |
| CI/CD          | `.github/`       | GitHub Actions                               |
| Docs           | `docs/`          | Markdown                                      |
