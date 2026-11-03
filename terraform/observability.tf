# Container Insights metrics and Fluent Bit log shipping, through the EKS add-on.
# Application logs: stdout -> Fluent Bit -> /aws/containerinsights/<cluster>/application
module "cloudwatch_observability_irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.0"

  role_name                              = "cloudwatch-observability-${var.environment}"
  attach_cloudwatch_observability_policy = true

  oidc_providers = {
    main = {
      provider_arn               = module.eks.oidc_provider_arn
      namespace_service_accounts = ["amazon-cloudwatch:cloudwatch-agent"]
    }
  }
}

# Created here so Terraform controls retention and removes it on destroy.
resource "aws_cloudwatch_log_group" "app_logs" {
  name              = "/aws/containerinsights/${module.eks.cluster_name}/application"
  retention_in_days = 30
}

resource "aws_eks_addon" "cloudwatch_observability" {
  cluster_name             = module.eks.cluster_name
  addon_name               = "amazon-cloudwatch-observability"
  service_account_role_arn = module.cloudwatch_observability_irsa.iam_role_arn

  depends_on = [aws_cloudwatch_log_group.app_logs]
}

resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "eks-high-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "node_cpu_utilization"
  namespace           = "ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 80
  alarm_description   = "Average node CPU above 80%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.eks.cluster_name
  }
}

resource "aws_cloudwatch_metric_alarm" "high_memory" {
  alarm_name          = "eks-high-memory-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "node_memory_utilization"
  namespace           = "ContainerInsights"
  period              = 300
  statistic           = "Average"
  threshold           = 85
  alarm_description   = "Average node memory above 85%"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.eks.cluster_name
  }
}
