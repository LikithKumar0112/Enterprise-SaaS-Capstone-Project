# Skillfyme-DevOps-Enterprise-Capstone-Project
**Project Domain**:Enterprise SaaS


Production-grade DevOps platform demonstrating enterprise-level practices including CI/CD, Infrastructure as Code, Kubernetes operations, security, observability, and cost optimization.

## Project Overview

This project implements a complete DevOps lifecycle for a Node.js application deployed on AWS EKS, incorporating:

- **CI/CD**: GitHub Actions with multi-stage pipelines
- **Infrastructure**: Terraform-managed AWS resources
- **Containerization**: Docker with multi-stage builds
- **Orchestration**: Kubernetes (EKS) with Helm
- **Security**: DevSecOps practices, scanning, RBAC
- **Observability**: Comprehensive monitoring and logging
- **Cost Optimization**: Budget tracking and optimization

## Quick Start

### Prerequisites
- AWS Account with appropriate permissions
- GitHub Account
- Tools: `aws-cli`, `kubectl`, `terraform`, `helm`, `docker`

### Initial Setup
1. Clone repository: `git clone <repo-url>`
2. Configure AWS: `aws configure`
3. Create the state backend and OIDC provider, once per account: see [terraform/bootstrap](./terraform/bootstrap/README.md)
4. Provision an environment: `TF_VAR_alert_email=you@example.com ./scripts/bootstrap.sh development`
5. Deploy through CI/CD, or manually: see the [Deployment Guide](./docs/deployment/deployment-guide.md)

## Repository Structure

See [STRUCTURE.md](./STRUCTURE.md) for detailed repository organization.

## Documentation

- [Getting Started](./docs/development/getting-started.md)
- [Architecture](./docs/architecture/system-design.md)
- [Deployment Guide](./docs/deployment/deployment-guide.md)
- [Troubleshooting](./docs/troubleshooting/common-issues.md)
- [Chaos Experiments](./docs/chaos-engineering.md)
- [Production Checklist](./docs/production-checklist.md)
- [Review Follow-up](./docs/REVIEW-FOLLOWUP.md): what is implemented, tested, and not yet run

## Branching Strategy

- `main` - Production releases
- `develop` - Integration branch
- `feature/*` - Feature development
- `hotfix/*` - Production hotfixes

See [branching-strategy.md](./docs/branching-strategy.md) for details.

## Testing
```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Load test: p95, p99, throughput, error rate (needs k6)
npm run test:load
```

## Monitoring

- **CloudWatch**: AWS native monitoring
- **Prometheus**: Metrics collection
- **Grafana**: Visualization dashboards

## Security

All of these must pass before anything deploys:
- Trivy (container scanning)
- Snyk (dependency scanning)
- Hadolint (Dockerfile linting)

Gitleaks runs as a pre-commit hook, and a Trivy filesystem scan runs nightly.

## Cost Optimization

Monthly budget: $100
Current spend tracking in [cost-optimization-report.md](./docs/cost-optimization-report.md)

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT License - See [LICENSE](./LICENSE)

## Support

For issues and questions, please use GitHub Issues.
