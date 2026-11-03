# Cost Optimization Report

This report documents the cost decisions actually implemented in this project's
Terraform, Helm, and Kubernetes configuration, and how they keep spend inside the
**$100/month** per-environment budget.

## Budget & guardrail

Terraform provisions an AWS Budget (`aws_budgets_budget.monthly` in `terraform/main.tf`)
with a **$100 USD monthly** limit and an email alert when **actual cost exceeds 80%
($80)**. As of the last check the budget is **Healthy — threshold not exceeded**.

![AWS Budgets — $100/month cost budget, "Actual cost > 80%" alert not exceeded](./images/aws-budget.png)

## Estimated monthly cost (running 24/7)

Approximate `us-east-1` list prices for the stack as configured. Actual spend is lower
because the environment is torn down when idle (see below).

| Component                 | Development                         | Production                      |
|---------------------------|-------------------------------------|---------------------------------|
| EKS control plane         | ~$73                                | ~$73                            |
| Worker nodes              | 3 × `t3.small` **SPOT**: ~$14       | 3 × `t3.medium` on-demand: ~$91 |
| NAT gateway               | **single** shared NAT: ~$32         | ~$32                            |
| Application Load Balancer | **one** shared ALB: ~$17            | ~$17                            |
| ElastiCache               | 1 × `cache.t3.micro`: ~$12          | 2 × `cache.t3.micro`: ~$25      |
| ECR / S3 state / misc     | ~$3                                 | ~$3                             |
| **Total if left running** | **~$151 per month** (about $0.21/h) | **~$241 per month** (about $0.33/h) |

CloudWatch log and metric charges from the add-on are extra and depend on volume.

> The EKS control plane and NAT gateway are the two largest fixed costs and cannot be
> optimized away while the cluster exists — which is exactly why the teardown-when-idle
> habit (below) matters most.

## Optimizations implemented

### 1. SPOT worker nodes (~70% off on-demand)
The managed node group uses `capacity_type = "SPOT"` (`terraform/modules/eks/main.tf`,
driven by `node_groups.*.spot = true`). SPOT `t3.small` instances run at roughly **70%
below on-demand**, taking 2 nodes from ~$30/month on-demand to ~$9/month. The workload is
stateless, so spot reclamation is tolerated. Production uses on-demand nodes.

### 2. Single NAT gateway (~$64/month saved)
`single_nat_gateway = true` (`terraform/main.tf`) routes all private-subnet egress through
**one** NAT gateway instead of one per AZ. At ~$32/month each, this saves ~$64/month versus
a per-AZ setup. The trade-off — reduced AZ isolation for egress — is acceptable here, including for a
short-lived production demonstration. A permanent production environment should use one per AZ.

### 3. One shared ALB
A single internet-facing ALB (created by the AWS Load Balancer Controller from the app's
Ingress) fronts the application, rather than a load balancer per service. ~$17/month.

### 4. Small ElastiCache nodes
`cache.t3.micro` is used in both environments, with one node in development and a primary and replica
in production. This replaced free in-cluster Redis because two independent Redis pods weren't highly
available and couldn't use the auth token. It adds about $12 per node per month while running.

### 5. ECR lifecycle policy
`aws_ecr_lifecycle_policy.app_lifecycle` (`terraform/main.tf`) automatically **expires
untagged images after 7 days** and **keeps only the last 30 images**. Since the CD pipeline
pushes an image per commit, this caps ECR storage growth instead of letting it accumulate
indefinitely.

### 6. Teardown-when-idle habit
The biggest fixed costs (EKS control plane ~$73/month, NAT ~$32/month) accrue whenever the
cluster is up, regardless of traffic. Running `scripts/teardown.sh <environment>` when an environment
isn't in use destroys the billable infra (EKS, nodes, NAT, ALB, ElastiCache) while **leaving the S3
state bucket, DynamoDB lock table, and budget in place** (near-zero cost), so the stack can
be recreated on demand with `scripts/bootstrap.sh`. Production in particular should only run for as long as a demonstration needs. Left running,
either environment exceeds the $100 budget, so teardown is what keeps spend under it. Each environment
has its own budget alert.

## Additional cost-aware choices

- **No EBS CSI driver / no PersistentVolumes** — the app is stateless, so no EBS volumes are
  provisioned.
- **Right-sized requests/limits** — dev pods request as little as 50m CPU / 96Mi memory
  (`helm/saas-app/values-dev.yaml`), fitting more onto each `t3.small`.
- **Cost allocation tags** — every resource is tagged `Project`, `Environment`, `ManagedBy`,
  and `CostCenter` via provider `default_tags` for spend attribution.

## Summary

| Lever                          | Status |
|--------------------------------|--------|
| SPOT worker nodes (development) | ✅ Implemented |
| Single NAT gateway             | ✅ Implemented |
| One shared ALB                 | ✅ Implemented |
| Small ElastiCache nodes        | ✅ Implemented |
| ECR lifecycle policy           | ✅ Implemented |
| Teardown when idle             | ✅ Habit / scripted |
| $100 budget + 80% alert        | ✅ Implemented |
