# Production Readiness Checklist

Status of each item against the current code. An item is ticked only when the evidence column
points at something that exists. Items needing a live deployment stay open until they have been run. The review changes have not been redeployed to AWS; see `docs/REVIEW-FOLLOWUP.md`.

## Build and test

| Done | Item | Evidence |
|---|---|---|
| [x] | Unit and integration tests pass in CI | `ci.yml`; includes Redis outage and circuit-breaker recovery |
| [x] | Deployment is blocked unless CI passes | `cd.yml`: deploy jobs need the `ci` job |
| [x] | Dependency scan is blocking | Snyk in `ci.yml` |
| [x] | Image scan is blocking | Trivy in `ci.yml` (CRITICAL, HIGH) |
| [x] | Load test with thresholds in CI | `app/tests/load/k6-load.js`: p95 < 500 ms, p99 < 1 s, errors < 1% |
| [ ] | Load test against a deployed environment | Not yet run |

## Environment isolation

| Done | Item | Evidence |
|---|---|---|
| [x] | Production has its own cluster, ECR repository, VPC and state | `terraform/environments/production.tfvars`, `terraform/backend/production.hcl` |
| [x] | Deploy roles are scoped to one environment | `terraform/oidc.tf` |
| [x] | Production requires manual approval | GitHub `production` environment (set in repository settings) |
| [ ] | Production deployed through the pipeline | Not yet run |

## Deployment safety

| Done | Item | Evidence |
|---|---|---|
| [x] | Failed rollouts roll back automatically | `helm upgrade --atomic` in `deploy.yml` |
| [x] | Post-deploy smoke test rolls back on failure | `deploy.yml` |
| [ ] | Rollback demonstrated with a deliberately broken release | Not yet run |

## Security

| Done | Item | Evidence |
|---|---|---|
| [x] | Non-root, no capabilities, read-only filesystem | Helm Deployment; image tested locally with these settings |
| [x] | Fault-injection and cache endpoints off in production | `app/tests/unit/production-mode.test.js` |
| [x] | `/metrics` not exposed through the ALB | Helm Ingress |
| [x] | Redis auth and TLS configured | `aws_elasticache_replication_group` in `terraform/main.tf` |
| [ ] | App reads its secret through IRSA on EKS | Implemented and unit tested; not yet run on EKS |
| [ ] | NetworkPolicy enforced and tested on EKS | Implemented; not yet run on EKS |
| [ ] | HTTPS on the ALB | Not implemented; needs a domain and ACM certificate |
| [ ] | Exposed plan files removed from git history | Removed from current files only; see `docs/REVIEW-FOLLOWUP.md` |

## Observability

| Done | Item | Evidence |
|---|---|---|
| [x] | Application metrics and ServiceMonitor | `/metrics`, `monitoring/servicemonitor.yaml` |
| [ ] | Logs reach CloudWatch | Add-on configured; not yet run |
| [ ] | CloudWatch alarms leave Insufficient Data | Metrics corrected; not yet run |

## Resilience

| Done | Item | Evidence |
|---|---|---|
| [x] | Redis outage does not restart pods | `/livez` and `/readyz` check no dependencies; automated test |
| [ ] | Chaos experiments on EKS | `docs/chaos-engineering.md`; not yet run |
