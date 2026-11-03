#!/usr/bin/env bash
# Destroy one environment's billable infrastructure.
#   TF_VAR_alert_email=you@example.com ./scripts/teardown.sh development|production
set -euo pipefail

ENVIRONMENT=${1:?usage: teardown.sh development|production}
: "${TF_VAR_alert_email:?export TF_VAR_alert_email first}"

cd "$(dirname "$0")/../terraform"
terraform init -reconfigure -backend-config="backend/$ENVIRONMENT.hcl"
aws eks update-kubeconfig --name "$(terraform output -raw cluster_name)" --region us-east-1

# Delete the ALB through its controller first. Otherwise the orphaned ALB's ENIs block
# subnet and VPC deletion and terraform destroy hangs.
echo "Removing the application and its ALB..."
helm uninstall saas-app -n default --wait || true
kubectl delete ingress --all -n default --ignore-not-found --timeout=120s || true

echo "Destroying billable infra for $ENVIRONMENT (EKS, nodes, NAT, ElastiCache)..."
terraform destroy -auto-approve -var-file="environments/$ENVIRONMENT.tfvars"
echo "Done. Resources from terraform/bootstrap remain (near-zero cost)."
