# Repository Structure

This document describes the actual layout of the repository and what lives where.

```
.
├── app/                         # Node.js application
│   ├── src/                     # Application source
│   │   ├── server.js            # Express app (health, metrics, cache API, circuit breaker)
│   │   ├── package.json         # App manifest + npm scripts + Jest config
│   │   ├── package-lock.json    # Locked dependency tree (used by `npm ci`)
│   │   ├── Dockerfile           # Multi-stage build (deps → runtime, non-root, distroless-style)
│   │   ├── .dockerignore
│   │   ├── .eslintrc.json
│   │   └── .env.example         # Template for local environment variables
│   └── tests/
│       ├── unit/server.test.js          # `npm test` (Jest, with coverage)
│       ├── integration/api.test.js      # `npm run test:integration` (needs Redis)
│       ├── e2e/load.test.js             # `npm run test:e2e`
│       └── setup.js                     # Global Jest setup
│
├── terraform/                   # Infrastructure as Code (AWS)
│   ├── main.tf                  # Root module: wires VPC + EKS + ECR + Secrets/IAM/SNS/Budget
│   ├── variables.tf             # Input variables (region, node_groups, enable_redis, ...)
│   ├── terraform.tfvars         # Concrete values for the development environment
│   ├── oidc.tf                  # GitHub Actions OIDC provider + deploy role
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
│       └── templates/          # Deployment, Service, Ingress (ALB), HPA, PDB
│
├── k8s/                         # Raw manifests applied outside the chart
│   ├── redis-deployment.yaml   # In-cluster Redis (ConfigMap + Deployment + Service)
│   ├── network-policy.yaml     # NetworkPolicy for the app pods
│   ├── cpu-stress.yaml         # Load generator used to demonstrate HPA scaling
│   ├── hpa.yaml
│   └── pod-disruption-budget.yaml
│
├── monitoring/
│   └── servicemonitor.yaml     # ServiceMonitor scraped by kube-prometheus-stack
│
├── scripts/
│   ├── bootstrap.sh            # terraform init/apply + update-kubeconfig
│   └── teardown.sh             # Deletes ALB-owning Ingress, then terraform destroy
│
├── .github/
│   └── workflows/
│       ├── ci.yml              # Lint, unit + integration tests, Snyk, image build, Trivy, Hadolint
│       ├── cd.yml              # Build/push to ECR + Helm deploy (dev auto, prod gated)
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
| Application    | `app/`           | Node.js 20, Express, Redis, prom-client      |
| Infrastructure | `terraform/`     | Terraform, AWS (VPC, EKS, ECR, IAM/OIDC)     |
| Packaging      | `helm/saas-app/` | Helm chart (Deployment/Service/Ingress/HPA/PDB) |
| Cluster extras | `k8s/`           | Redis, NetworkPolicy, HPA, PDB, load test    |
| Observability  | `monitoring/`    | Prometheus ServiceMonitor (kube-prometheus-stack) |
| Automation     | `scripts/`       | Bash bootstrap / teardown                    |
| CI/CD          | `.github/`       | GitHub Actions                               |
| Docs           | `docs/`          | Markdown                                      |
