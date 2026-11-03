terraform {
  required_version = ">= 1.7.0"
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

  # Settings per environment: terraform init -backend-config=backend/<environment>.hcl
  backend "s3" {}
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

# Changing these arguments replaces the token, which also rotates the earlier value that
# was exposed through committed plan files.
resource "random_password" "redis_auth" {
  length  = 32
  special = false
}

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

module "vpc" {
  source = "./modules/vpc"

  vpc_cidr           = var.vpc_cidr
  availability_zones = ["us-east-1a", "us-east-1b"]
  environment        = var.environment
  enable_nat_gateway = true
  single_nat_gateway = true
}

module "eks" {
  source = "./modules/eks"

  cluster_name    = "${var.cluster_name}-${var.environment}"
  cluster_version = var.cluster_version
  vpc_id          = module.vpc.vpc_id
  subnet_ids      = module.vpc.private_subnets

  node_groups = var.node_groups

  enable_irsa = true

  cluster_addons = {
    coredns = {
      most_recent = true
    }
    kube-proxy = {
      most_recent = true
    }
    vpc-cni = {
      most_recent = true
      # NetworkPolicy objects have no effect unless the CNI enforces them.
      configuration_values = jsonencode({ enableNetworkPolicy = "true" })
    }
  }
}

resource "aws_ecr_repository" "app_repository" {
  name                 = "enterprise-devops-app-${var.environment}"
  image_tag_mutability = "IMMUTABLE"
  force_delete         = true

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

resource "aws_elasticache_replication_group" "redis" {
  count = var.enable_redis ? 1 : 0

  replication_group_id = "devops-redis-${var.environment}"
  description          = "Application cache for ${var.environment}"
  engine               = "redis"
  engine_version       = "7.1"
  node_type            = var.redis_node_type
  parameter_group_name = "default.redis7"
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.redis[0].name
  security_group_ids   = [aws_security_group.redis[0].id]

  num_cache_clusters         = var.redis_num_cache_nodes
  automatic_failover_enabled = var.redis_num_cache_nodes > 1
  multi_az_enabled           = var.redis_num_cache_nodes > 1

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  snapshot_retention_limit = 1
  maintenance_window       = "sun:05:00-sun:09:00"
  apply_immediately        = true
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
    security_groups = [module.eks.node_security_group_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

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
        Action = ["secretsmanager:GetSecretValue"]
        Resource = [
          aws_secretsmanager_secret.app_secrets.arn
        ]
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "app_permissions" {
  role       = aws_iam_role.app_service_account.name
  policy_arn = aws_iam_policy.app_permissions.arn
}

resource "aws_sns_topic" "alerts" {
  name = "devops-alerts-${var.environment}"
}

resource "aws_sns_topic_subscription" "email_subscription" {
  topic_arn = aws_sns_topic.alerts.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

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
  value       = var.enable_redis ? aws_elasticache_replication_group.redis[0].primary_endpoint_address : null
  description = "Redis primary endpoint (TLS, requires the auth token)"
}

output "vpc_id" {
  value       = module.vpc.vpc_id
  description = "VPC ID, needed by the AWS Load Balancer Controller"
}

output "cluster_name" {
  value       = module.eks.cluster_name
  description = "EKS cluster name"
}

output "app_role_arn" {
  value       = aws_iam_role.app_service_account.arn
  description = "IAM role for the app's Kubernetes ServiceAccount"
}

output "sns_topic_arn" {
  value       = aws_sns_topic.alerts.arn
  description = "SNS topic ARN for alerts"
}
