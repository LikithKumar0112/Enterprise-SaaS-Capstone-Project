terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    kubernetes = {
      source  = "hashicorp/kubernetes"
      version = "~> 2.20"
    }
    helm = {
      source  = "hashicorp/helm"
      version = "~> 2.10"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
  }

  # Using the existing state bucket + lock table created in Phase 4.
  backend "s3" {
    bucket         = "capstone-tf-bucket"
    key            = "development/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Environment = var.environment
      Project     = "Enterprise-DevOps-Capstone"
      ManagedBy   = "Terraform"
      CostCenter  = var.cost_center
    }
  }
}

# Generate random password for Redis
resource "random_password" "redis_auth" {
  length           = 16
  special          = true
  override_special = "!#$%&*()-_=+[]{}<>:?"
}

# App secrets (Redis auth token, etc.) - the app service account reads
# this at runtime instead of having credentials baked into the image.
resource "aws_secretsmanager_secret" "app_secrets" {
  name        = "enterprise-devops-app-secrets-${var.environment}"
  description = "Runtime secrets for the enterprise-devops-app"
}

resource "aws_secretsmanager_secret_version" "app_secrets" {
  secret_id = aws_secretsmanager_secret.app_secrets.id
  secret_string = jsonencode({
    redis_auth_token = random_password.redis_auth.result
  })
}

# VPC Module
module "vpc" {
  source = "./modules/vpc"

  vpc_cidr           = var.vpc_cidr
  availability_zones = ["us-east-1a", "us-east-1b"]
  environment        = var.environment
  enable_nat_gateway = true
  single_nat_gateway = true # ONE NAT for all AZs — saves ~$64/mo
}

# EKS Module
module "eks" {
  source = "./modules/eks"

  cluster_name    = "${var.cluster_name}-${var.environment}"
  cluster_version = var.cluster_version
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  node_groups = var.node_groups

  # IRSA for service accounts
  enable_irsa = true

  # Addon configurations
  # NOTE: aws-ebs-csi-driver is intentionally left out - nothing in this
  # app uses PersistentVolumeClaims, and the addon needs its own IAM role
  # (IRSA) to work properly, which adds complexity for no benefit here.
  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
    }
  }
}

# ECR Repository with lifecycle policies
resource "aws_ecr_repository" "app_repository" {
  name                 = "enterprise-devops-app-${var.environment}"
  image_tag_mutability = "IMMUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }
}

resource "aws_ecr_lifecycle_policy" "app_lifecycle" {
  repository = aws_ecr_repository.app_repository.name

  policy = jsonencode({
    rules = [{
      rulePriority = 1
      description  = "Expire untagged images older than 7 days"
      selection = {
        tagStatus   = "untagged"
        countType   = "sinceImagePushed"
        countNumber = 7
        countUnit   = "days"
      }
      action = {
        type = "expire"
      }
      },
      {
        # tagStatus "any" must be the highest rulePriority (evaluated last) -
        # AWS rejects a policy where it isn't.
        rulePriority = 2
        description  = "Keep last 30 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 30
        }
        action = {
          type = "expire"
        }
    }]
  })
}

# Elasticache Redis (disabled by default - see k8s/redis-deployment.yaml
# for the in-cluster Redis this app uses instead; set enable_redis = true
# only if you want to move Redis to a managed AWS service)
resource "aws_elasticache_cluster" "redis" {
  count = var.enable_redis ? 1 : 0

  cluster_id           = "devops-redis-${var.environment}"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis[0].name
  security_group_ids   = [aws_security_group.redis[0].id]

  snapshot_retention_limit = 7
  maintenance_window       = "sun:05:00-sun:09:00"

  tags = {
    Name        = "devops-redis-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_elasticache_subnet_group" "redis" {
  count = var.enable_redis ? 1 : 0

  name       = "redis-subnet-group-${var.environment}"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_security_group" "redis" {
  count = var.enable_redis ? 1 : 0

  name        = "redis-sg-${var.environment}"
  description = "Security group for Redis"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "Redis from EKS"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.cluster_primary_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# IAM Roles for Service Accounts with fine-grained permissions
resource "aws_iam_role" "app_service_account" {
  name = "eks-app-service-account-${var.environment}"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRoleWithWebIdentity"
        Effect = "Allow"
        Principal = {
          Federated = module.eks.oidc_provider_arn
        }
        Condition = {
          StringEquals = {
            "${module.eks.oidc_issuer}:sub" = "system:serviceaccount:default:enterprise-devops-app"
            "${module.eks.oidc_issuer}:aud" = "sts.amazonaws.com"
          }
        }
      }
    ]
  })
}

resource "aws_iam_policy" "app_permissions" {
  name        = "app-permissions-${var.environment}"
  description = "Permissions for the application service account"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          aws_secretsmanager_secret.app_secrets.arn
        ]
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:GetAuthorizationToken",
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:GetRepositoryPolicy",
          "ecr:DescribeRepositories",
          "ecr:ListImages",
          "ecr:DescribeImages",
          "ecr:BatchGetImage"
        ]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "cloudwatch:PutMetricData",
          "cloudwatch:GetMetricData",
          "cloudwatch:GetMetricStatistics",
          "cloudwatch:ListMetrics"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "app_permissions" {
  role       = aws_iam_role.app_service_account.name
  policy_arn = aws_iam_policy.app_permissions.arn
}

# NOTE: no separate EKS cluster log group here - the EKS module already
# creates and manages "/aws/eks/<cluster-name>/cluster" itself when cluster
# logging is enabled, so a second resource with the same name would collide.

resource "aws_cloudwatch_log_group" "app_logs" {
  name              = "/aws/ecs/enterprise-devops-app-${var.environment}"
  retention_in_days = 90
}

# Enhanced CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "high_cpu" {
  alarm_name          = "eks-high-cpu-${var.environment}"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EKS"
  period              = "300"
  statistic           = "Average"
  threshold           = "80"
  alarm_description   = "This metric monitors EKS cluster CPU utilization"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.eks.cluster_name
  }
}

resource "aws_cloudwatch_metric_alarm" "low_memory" {
  alarm_name          = "eks-low-memory-${var.environment}"
  comparison_operator = "LessThanThreshold"
  evaluation_periods  = "2"
  metric_name         = "MemoryAvailable"
  namespace           = "ContainerInsights"
  period              = "300"
  statistic           = "Average"
  threshold           = "1073741824" # 1GB
  alarm_description   = "This metric monitors available memory"
  alarm_actions       = [aws_sns_topic.alerts.arn]
  ok_actions          = [aws_sns_topic.alerts.arn]

  dimensions = {
    ClusterName = module.eks.cluster_name
  }
}

# SNS Topic for alerts
resource "aws_sns_topic" "alerts" {
  name = "devops-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "email_subscription" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# AWS Budget for cost optimization
resource "aws_budgets_budget" "monthly" {
  name              = "monthly-devops-budget-${var.environment}"
  budget_type       = "COST"
  limit_amount      = "100"
  limit_unit        = "USD"
  time_unit         = "MONTHLY"
  time_period_start = "2026-08-01_00:00"

  cost_types {
    include_credit             = true
    include_discount           = true
    include_other_subscription = true
    include_recurring          = true
    include_refund             = true
    include_subscription       = true
    include_support            = true
    include_tax                = true
    include_upfront            = true
    use_blended                = false
  }

  notification {
    comparison_operator        = "GREATER_THAN"
    threshold                  = 80
    threshold_type             = "PERCENTAGE"
    notification_type          = "ACTUAL"
    subscriber_email_addresses = [var.alert_email]
  }
}

output "cluster_endpoint" {
  value       = module.eks.cluster_endpoint
  description = "EKS Cluster endpoint"
}

output "ecr_repository_url" {
  value       = aws_ecr_repository.app_repository.repository_url
  description = "ECR repository URL"
}

output "redis_endpoint" {
  value       = var.enable_redis ? aws_elasticache_cluster.redis[0].cache_nodes[0].address : null
  description = "Redis endpoint"
}

output "sns_topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "SNS topic ARN for alerts"
}
