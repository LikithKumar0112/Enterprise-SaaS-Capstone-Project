# GitHub Actions OIDC provider
data "tls_certificate" "github" {
  url = "https://token.actions.githubusercontent.com/.well-known/openid-configuration"
}

resource "aws_iam_openid_connect_provider" "github" {
  url             = "https://token.actions.githubusercontent.com"
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.github.certificates[0].sha1_fingerprint]
}

# Deploy role that GitHub Actions assumes
resource "aws_iam_role" "github_deploy" {
  name = "github-actions-deploy-${var.environment}"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Federated = aws_iam_openid_connect_provider.github.arn }
      Action    = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = { "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com" }
        StringLike = {
          # GitHub now embeds immutable owner/repo IDs in the subject claim
          # (repo:OWNER@ownerID/REPO@repoID:...) instead of the plain
          # repo:OWNER/REPO:... format - match both so this survives either.
          "token.actions.githubusercontent.com:sub" = [
            "repo:LikithKumar0112/Enterprise-SaaS-Capstone-Project:*",
            "repo:LikithKumar0112@*/Enterprise-SaaS-Capstone-Project@*:*",
          ]
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
        Effect = "Allow"
        Action = ["dynamodb:GetItem", "dynamodb:PutItem", "dynamodb:DeleteItem"]
        Resource = "arn:aws:dynamodb:${var.aws_region}:*:table/terraform-state-lock"
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
  description = "Paste this into the AWS_DEPLOY_ROLE_ARN GitHub secret"
}
