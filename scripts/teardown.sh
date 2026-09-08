#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../terraform"

# Delete anything the AWS Load Balancer Controller created directly in AWS
# (the ALB) before destroying the cluster it depends on - otherwise the
# orphaned ALB's ENIs block subnet/VPC deletion and terraform destroy hangs.
echo "Cleaning up Kubernetes-created AWS resources (ALB)..."
kubectl delete ingress --all -n default --ignore-not-found --timeout=60s || true

echo "⚠️  Destroying billable infra (EKS, nodes, NAT, ALB)..."
terraform destroy -auto-approve
echo "✅ Done. S3 state bucket, DynamoDB lock and budget remain (near-zero cost)."
