aws_region      = "us-east-1"
environment     = "production"
cluster_version = "1.34"
vpc_cidr        = "10.1.0.0/16"

# Primary and replica across two AZs with automatic failover.
enable_redis          = true
redis_num_cache_nodes = 2

# alert_email is not stored in git: export TF_VAR_alert_email before plan/apply.

node_groups = {
  on_demand = {
    instance_type = "t3.medium"
    min_size      = 2
    max_size      = 4
    desired_size  = 3
    spot          = false
  }
}
