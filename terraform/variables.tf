variable "aws_region" {
  description = "AWS region"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Environment name"
  type        = string
  default     = "production"
}

variable "cluster_name" {
  description = "EKS cluster name"
  type        = string
  default     = "devops-app"
}

variable "cluster_version" {
  description = "Kubernetes version"
  type        = string
  default     = "1.34"
}

variable "vpc_cidr" {
  description = "VPC CIDR block"
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "AWS availability zones"
  type        = list(string)
  default     = ["us-east-1a", "us-east-1b", "us-east-1c"]
}

variable "enable_spot_instances" {
  description = "Enable spot instances for cost optimization"
  type        = bool
  default     = true
}

variable "spot_instance_types" {
  description = "Spot instance types"
  type        = list(string)
  default     = ["t3.medium", "t3a.medium", "m5.large", "m5a.large"]
}

variable "on_demand_instance_types" {
  description = "On-demand instance types"
  type        = list(string)
  default     = ["t3.medium", "t3a.medium"]
}

variable "node_groups" {
  description = "EKS node group configurations"
  type = map(object({
    instance_type = string
    min_size      = number
    max_size      = number
    desired_size  = number
    spot          = bool
  }))
  default = {
    spot = {
      instance_type = "t3.small"
      min_size      = 1
      max_size      = 3
      desired_size  = 1
      spot          = true
    }
  }
}

variable "enable_redis" {
  description = "Use AWS ElastiCache (true) or in-cluster Redis (false)"
  type        = bool
  default     = false
}

variable "redis_node_type" {
  description = "Redis node type"
  type        = string
  default     = "cache.t3.micro"
}

variable "enable_monitoring" {
  description = "Enable enhanced monitoring"
  type        = bool
  default     = true
}

variable "alert_email" {
  description = "Email for alerts"
  type        = string
}

variable "cost_center" {
  description = "Cost center tag"
  type        = string
  default     = "devops-capstone"
}
