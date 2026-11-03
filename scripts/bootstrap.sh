#!/usr/bin/env bash
# Provision one environment. Requires terraform/bootstrap to have been applied once.
#   TF_VAR_alert_email=you@example.com ./scripts/bootstrap.sh development|production
set -euo pipefail

ENVIRONMENT=${1:?usage: bootstrap.sh development|production}
: "${TF_VAR_alert_email:?export TF_VAR_alert_email first}"
REGION=us-east-1

cd "$(dirname "$0")/../terraform"
terraform init -reconfigure -backend-config="backend/$ENVIRONMENT.hcl"
terraform apply -auto-approve -var-file="environments/$ENVIRONMENT.tfvars"

CLUSTER=$(terraform output -raw cluster_name)
aws eks update-kubeconfig --name "$CLUSTER" --region "$REGION"

helm repo add eks https://aws.github.io/eks-charts
helm repo update eks
helm upgrade --install aws-load-balancer-controller eks/aws-load-balancer-controller -n kube-system \
  --set clusterName="$CLUSTER" \
  --set region="$REGION" \
  --set vpcId="$(terraform output -raw vpc_id)" \
  --set serviceAccount.name=aws-load-balancer-controller \
  --set "serviceAccount.annotations.eks\.amazonaws\.com/role-arn=$(terraform output -raw load_balancer_controller_role_arn)" \
  --wait

echo "Cluster ready: $CLUSTER"
echo "Set the GitHub deploy role for this environment: $(terraform output -raw github_deploy_role_arn)"
