# The account-wide provider is created by terraform/bootstrap.
data "aws_iam_openid_connect_provider" "github" {
  url = "https://token.actions.githubusercontent.com"
}

# Older state still tracks the provider here. Forget it without deleting it from AWS.
removed {
  from = aws_iam_openid_connect_provider.github

  lifecycle {
    destroy = false
  }
}

locals {
  # Each environment's deploy role can only be assumed by jobs in that GitHub environment.
  # Terraform plans on pull requests use the development role, which holds no production access.
  github_oidc_contexts = var.environment == "production" ? ["environment:production"] : ["environment:development", "pull_request"]
  # GitHub may embed immutable owner/repo IDs in the subject claim, so match both formats.
  github_oidc_subjects = flatten([
    for context in local.github_oidc_contexts : [
      "repo:LikithKumar0112/Enterprise-SaaS-Capstone-Project:${context}",
      "repo:LikithKumar0112@*/Enterprise-SaaS-Capstone-Project@*:${context}",
    ]
  ])
}

# Deploy role that GitHub Actions assumes
resource "aws_iam_role" "github_deploy" {
  name = "github-actions-deploy-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = data.aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          "token.actions.githubusercontent.com:sub" = local.github_oidc_subjects
        }
      }
    }]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "github-deploy-permissions"
  role = aws_iam_role.github_deploy.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ecr:GetAuthorizationToken"]
        Resource = "*"
      },
      {
        Effect = "Allow"
        Action = [
          "ecr:BatchCheckLayerAvailability", "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage", "ecr:PutImage", "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart", "ecr:CompleteLayerUpload"
        ]
        Resource = aws_ecr_repository.app_repository.arn
      },
      {
        Effect   = "Allow"
        Action   = ["eks:DescribeCluster", "eks:ListClusters"]
        Resource = "*"
      },
      {
        # terraform init/plan reads state from S3 and locks it via DynamoDB.
        # ReadOnlyAccess (below) covers s3:GetObject, but not the DynamoDB
        # writes needed to acquire/release the state lock.
        Effect   = "Allow"
        Action   = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/terraform-state-lock"
      },
      {
        # ReadOnlyAccess deliberately excludes secret *values* - terraform
        # plan still needs to read this one to diff aws_secretsmanager_secret_version.
        Effect   = "Allow"
        Action   = ["secretsmanager:GetSecretValue", "secretsmanager:DescribeSecret"]
        Resource = aws_secretsmanager_secret.app_secrets.arn
      }
    ]
  })
}

# terraform plan needs to read/refresh every resource type in this stack
# (VPC, IAM, Secrets Manager, CloudWatch, SNS, Budgets, EKS...) - ReadOnlyAccess
# covers that broadly without granting any ability to change real infra.
resource "aws_iam_role_policy_attachment" "github_deploy_readonly" {
  role       = aws_iam_role.github_deploy.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

output "github_deploy_role_arn" {
  value       = aws_iam_role.github_deploy.arn
  description = "Set as AWS_DEPLOY_ROLE_ARN: repository secret for development, production environment secret for production"
}
