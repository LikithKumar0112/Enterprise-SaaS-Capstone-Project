# Access entry for the GitHub Actions deploy role. IAM lets it authenticate
# to the EKS API, but that's separate from Kubernetes RBAC - without this,
# `aws eks update-kubeconfig` succeeds in CD but every kubectl/helm command
# after it fails with "Unauthorized".
resource "aws_eks_access_entry" "github_deploy" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
}

resource "aws_eks_access_policy_association" "github_deploy_admin" {
  cluster_name  = module.eks.cluster_name
  principal_arn = aws_iam_role.github_deploy.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}
