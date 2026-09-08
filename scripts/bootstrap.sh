#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../terraform"
terraform init
terraform apply -auto-approve
aws eks update-kubeconfig --name devops-app-development --region us-east-1
echo "✅ Cluster up. Deploy: helm upgrade --install saas-app ../helm/saas-app -f ../helm/saas-app/values-dev.yaml --set image.repository=\$(terraform output -raw ecr_repository_url) --set image.tag=<your-tag>"
