# Deployment Guide

This describes how the application is actually deployed to EKS — both the automated
CI/CD path and how to deploy or roll back manually.

## CI/CD overview

Two workflows drive delivery (see `.github/workflows/`):

- **`ci.yml`** runs on PRs to `main`/`develop` and on pushes to `develop`. It lints,
  runs unit + integration tests (against a `redis:7-alpine` service container), runs a
  Snyk dependency scan, builds the image, and scans it with Trivy (fails on CRITICAL/HIGH)
  and Hadolint. Nothing is deployed from CI.
- **`cd.yml`** runs on pushes to `develop` (→ development) and `main` (→ production).

```
push to develop ──► CD: deploy-dev ──────────────► development environment (auto)
push to main ─────► CD: deploy-production ──►[approval]──► production environment
```

## How the CD pipeline deploys

The `deploy-dev` job in `.github/workflows/cd.yml`:

1. **Assumes an AWS role via OIDC.** `aws-actions/configure-aws-credentials` exchanges
   the GitHub OIDC token for temporary AWS credentials by assuming
   `secrets.AWS_DEPLOY_ROLE_ARN`. No static AWS keys are stored in GitHub.
2. **Logs in to ECR** with `aws-actions/amazon-ecr-login`.
3. **Builds and pushes the image** to
   `.../enterprise-devops-app-development`, tagged with the commit SHA
   (`github.sha`):
   ```bash
   IMG=$REGISTRY/enterprise-devops-app-development
   docker build -t $IMG:$GITHUB_SHA ./app/src
   docker push $IMG:$GITHUB_SHA
   ```
4. **Deploys with Helm.** It updates kubeconfig, then runs an idempotent
   `helm upgrade --install` using the dev values file, overriding the image, and
   **waits** for resources to become ready:
   ```bash
   aws eks update-kubeconfig --name $EKS_CLUSTER_NAME_DEV --region $AWS_REGION
   helm upgrade --install saas-app ./helm/saas-app -n default \
     -f ./helm/saas-app/values-dev.yaml \
     --set image.repository=$REGISTRY/enterprise-devops-app-development \
     --set image.tag=$GITHUB_SHA --wait --timeout 5m
   ```
5. **Smoke test + auto-rollback.** It checks the rollout status and, if the new
   ReplicaSet doesn't become healthy in time, **rolls back to the previous release**:
   ```bash
   kubectl rollout status deployment/enterprise-devops-app -n default --timeout=180s \
     || { echo "Rollout failed — rolling back"; helm rollback saas-app -n default; exit 1; }
   ```

![CD pipeline — deploy-dev job: OIDC, ECR login, build/push, Helm deploy, smoke test + auto-rollback](../images/cd-deploy-dev.png)

### Production

The `deploy-production` job is identical in shape but runs against the GitHub
**`production` environment**, which is configured with a required reviewer. That means a
push to `main` **pauses for manual approval** before it builds, pushes, and deploys.

## Prerequisites for a manual deploy

- `aws`, `kubectl`, and `helm` installed and on `PATH`
- AWS credentials with access to the cluster (the CI deploy role, or your own admin)
- kubeconfig pointed at the cluster:

  ```bash
  aws eks update-kubeconfig --name devops-app-development --region us-east-1
  ```

## Manual deploy

Deploy a specific image tag (a commit SHA that exists in ECR):

```bash
# Get the ECR repository URL from Terraform outputs
ECR_URL=$(cd terraform && terraform output -raw ecr_repository_url)

helm upgrade --install saas-app ./helm/saas-app -n default \
  -f ./helm/saas-app/values-dev.yaml \
  --set image.repository=$ECR_URL \
  --set image.tag=<commit-sha> \
  --wait --timeout 5m
```

For production, use the prod values file instead:

```bash
helm upgrade --install saas-app ./helm/saas-app -n default \
  -f ./helm/saas-app/values-prod.yaml \
  --set image.repository=$ECR_URL \
  --set image.tag=<commit-sha> \
  --wait --timeout 5m
```

The `scripts/bootstrap.sh` helper provisions the cluster and prints the exact deploy
command for a fresh environment.

## Verifying a deploy

```bash
kubectl rollout status deployment/enterprise-devops-app -n default
kubectl get pods,svc,ingress,hpa -n default
helm history saas-app -n default
```

The `ADDRESS` on the Ingress is the ALB DNS name; `curl http://<alb-dns>/health` should
return healthy.

## Rolling back

Helm keeps release history, so rollback is one command:

```bash
helm history saas-app -n default          # find the last good REVISION
helm rollback saas-app <revision> -n default
# or roll back to the immediately previous release:
helm rollback saas-app -n default
```

This is the same command the CD pipeline runs automatically when a rollout fails its
smoke test.

## Teardown

To destroy the billable infrastructure, use the teardown script — it deletes the
Ingress first so the AWS Load Balancer Controller removes the ALB before Terraform tries
to delete the VPC:

```bash
./scripts/teardown.sh
```

## Related documents

- [System Design](../architecture/system-design.md)
- [Branching Strategy](../branching-strategy.md)
- [Troubleshooting](../troubleshooting/common-issues.md)
