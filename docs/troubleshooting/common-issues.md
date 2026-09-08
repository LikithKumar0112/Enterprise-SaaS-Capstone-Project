# Troubleshooting: Common Issues

Real problems hit while building this project and how they were fixed. Where useful,
the actual error text is quoted verbatim.

## Quick reference

| # | Symptom                                             | Root cause                                   | Fix |
|---|-----------------------------------------------------|----------------------------------------------|-----|
| 1 | App/monitoring pods stuck `Pending`                 | `t3.small` ~11-pod ceiling                   | Add a second node (`desired_size = 2`) |
| 2 | GitHub Actions can't assume the AWS role            | OIDC subject-claim format changed            | Match both `sub` formats in the trust policy |
| 3 | `npm ci` fails in CI **and** Docker build           | `package-lock.json` drift                    | Regenerate and commit the lockfile |
| 4 | Jest hangs after tests finish                       | Redis pool left open                         | Close `app.redisPool.clients` in `afterAll` |
| 5 | `terraform destroy` hangs on subnet/VPC deletion    | Orphaned ALB from the LB Controller          | Delete the Ingress before destroy |
| 6 | `terraform destroy` fails on the ECR repo           | Repo still contains images                   | Set `force_delete = true` on the repo |

---

## 1. Pods stuck `Pending` — the `t3.small` 11-pod ceiling

**Symptom.** After installing the full kube-prometheus-stack, new pods would not
schedule:

```
0/1 nodes are available: 1 Too many pods. preemption: 0/1 nodes are available: 1 No preemption victims found for incoming pod.
```

**Cause.** With the AWS VPC CNI, the number of pods a node can run is bounded by how many
IP addresses its instance type's ENIs can hold. A `t3.small` tops out at roughly **11
pods**. Between the app, in-cluster Redis, the AWS Load Balancer Controller, CoreDNS, and
the kube-prometheus-stack (Prometheus, Alertmanager, node-exporter, kube-state-metrics,
Grafana), a single node runs out of IP slots.

**Fix.** Add a second node so there's room for the monitoring stack (`terraform/terraform.tfvars`):

```hcl
node_groups = {
  spot = {
    instance_type = "t3.small"
    min_size      = 1
    max_size      = 3
    desired_size  = 2   # bumped from 1 for Phase 9 monitoring
    spot          = true
  }
}
```

---

## 2. GitHub Actions OIDC — subject-claim format change

**Symptom.** The CD pipeline failed at the "Configure AWS via OIDC" step:

```
Error: Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

**Cause.** GitHub changed the OIDC token **subject (`sub`) claim** to embed immutable
numeric owner/repo IDs — `repo:OWNER@ownerID/REPO@repoID:...` — instead of the plain
`repo:OWNER/REPO:...` string the IAM trust policy was matching. The `StringLike`
condition no longer matched, so STS refused the assume-role.

**Fix.** Match **both** formats in the trust policy (`terraform/oidc.tf`):

```hcl
"token.actions.githubusercontent.com:sub" = [
  "repo:LikithKumar0112/Enterprise-SaaS-Capstone-Project:*",
  "repo:LikithKumar0112@*/Enterprise-SaaS-Capstone-Project@*:*",
]
```

---

## 3. `npm ci` lockfile drift — breaks CI and the Docker build

**Symptom.** Both the CI `test` job and the Docker build (which runs `npm ci --omit=dev`)
failed with:

```
npm error `npm ci` can only install packages when your package.json and package-lock.json or npm-shrinkwrap.json are in sync. Please update your lock file with `npm install` before continuing.
```

**Cause.** A dependency was edited in `package.json` without regenerating
`package-lock.json`. Unlike `npm install`, `npm ci` refuses to reconcile the two and
exits — and because the `Dockerfile` also uses `npm ci` for reproducible builds, the same
drift breaks image builds, not just CI.

**Fix.** Regenerate the lockfile and commit it:

```bash
cd app/src
npm install          # updates package-lock.json to match package.json
git add package-lock.json
git commit -m "chore: sync package-lock.json"
```

---

## 4. Jest hangs after the test run completes

**Symptom.** The integration suite passed but the process never exited:

```
Jest did not exit one second after the test run has completed.

This usually means that there are asynchronous operations that weren't stopped in your tests. Consider running Jest with `--detectOpenHandles` to troubleshoot this issue.
```

**Cause.** The routes under test open Redis connections through `server.js`'s own
connection pool (`app.redisPool.clients`), which is separate from the client the test
creates. Closing only the test's client left the pool's sockets open, so Jest's event
loop stayed alive.

**Fix.** Close every pooled client in `afterAll` (`app/tests/integration/api.test.js`):

```js
afterAll(async () => {
  await redisClient.quit();
  await Promise.all(
    Object.values(app.redisPool.clients).map((client) => client.quit())
  );
});
```

---

## 5. Orphaned ALB blocks `terraform destroy`

**Symptom.** `terraform destroy` would hang and eventually error while deleting the
network, e.g.:

```
Error: deleting EC2 Subnet (subnet-xxxxxxxx): DependencyViolation: The subnet 'subnet-xxxxxxxx' has dependencies and cannot be deleted.
```

**Cause.** The ALB is not managed by Terraform — the **AWS Load Balancer Controller**
creates it in response to the Kubernetes Ingress. When Terraform tears down the cluster,
that ALB (and its ENIs) is left behind, and the leftover ENIs keep the subnets/VPC from
being deleted.

**Fix.** Delete the Ingress first so the controller removes the ALB, *then* destroy. This
is exactly what `scripts/teardown.sh` does:

```bash
kubectl delete ingress --all -n default --ignore-not-found --timeout=60s || true
terraform destroy -auto-approve
```

---

## 6. ECR repository won't delete — needs `force_delete`

**Symptom.** `terraform destroy` failed on the ECR repository:

```
Error: ECR Repository (enterprise-devops-app-development) not empty, consider using force_delete: RepositoryNotEmptyException: The repository with name 'enterprise-devops-app-development' in registry with id 'xxxxxxxxxxxx' cannot be deleted because it still contains images
```

**Cause.** The pipeline pushes an image per commit SHA, so by teardown time the repo is
full of images. AWS refuses to delete a non-empty repository unless it's forced.

**Fix.** Allow Terraform to delete the repository (and its images) by setting
`force_delete = true` on `aws_ecr_repository.app_repository`, or empty the repo manually
first:

```bash
aws ecr batch-delete-image --repository-name enterprise-devops-app-development \
  --image-ids "$(aws ecr list-images --repository-name enterprise-devops-app-development \
  --query 'imageIds[*]' --output json)"
```

---

## Related documents

- [Deployment Guide](../deployment/deployment-guide.md)
- [System Design](../architecture/system-design.md)
- [Getting Started](../development/getting-started.md)
