# IRSA role for the AWS Load Balancer Controller (installed via Helm in
# Phase 6). Without this, the controller pod has no AWS permissions and
# can never actually create the ALB behind the app's Ingress.
module "load_balancer_controller_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                              = "aws-lb-controller-${var.environment}"
  attach_load_balancer_controller_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["kube-system:aws-load-balancer-controller"]
    }
  }
}

output "load_balancer_controller_role_arn" {
  value       = module.load_balancer_controller_irsa.iam_role_arn
  description = "Annotate the aws-load-balancer-controller service account with this"
}
