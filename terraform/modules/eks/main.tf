terraform {
  required_version = ">= 1.5.0"
}

variable "cluster_name" { type = string }
variable "cluster_version" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "node_groups" { type = any }

variable "enable_irsa" {
  type    = bool
  default = true
}
variable "cluster_addons" {
  type    = any
  default = {}
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.0"

  cluster_name    = var.cluster_name
  cluster_version = var.cluster_version
  vpc_id          = var.vpc_id
  subnet_ids      = var.subnet_ids
  enable_irsa     = var.enable_irsa
  cluster_addons  = var.cluster_addons

  cluster_endpoint_public_access = true

  # Without this, the IAM principal that creates the cluster (us) has no
  # way to authenticate to the Kubernetes API afterwards - kubectl gets
  # "the server has asked for the client to provide credentials".
  enable_cluster_creator_admin_permissions = true

  eks_managed_node_groups = {
    for name, cfg in var.node_groups : name => {
      instance_types = [cfg.instance_type]
      min_size       = cfg.min_size
      max_size       = cfg.max_size
      desired_size   = cfg.desired_size
      capacity_type  = cfg.spot ? "SPOT" : "ON_DEMAND"
    }
  }
}

output "cluster_name" { value = module.eks.cluster_name }
output "cluster_endpoint" { value = module.eks.cluster_endpoint }
output "oidc_provider_arn" { value = module.eks.oidc_provider_arn }
output "oidc_issuer" { value = replace(module.eks.cluster_oidc_issuer_url, "https://", "") }
output "cluster_primary_security_group_id" { value = module.eks.cluster_primary_security_group_id }
