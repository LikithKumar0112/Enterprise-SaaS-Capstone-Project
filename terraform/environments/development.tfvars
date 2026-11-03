aws_region      = "us-east-1"
environment     = "development"
cluster_version = "1.34"
vpc_cidr        = "10.0.0.0/16"

enable_redis          = true
redis_num_cache_nodes = 1

# alert_email is not stored in git: export TF_VAR_alert_email before plan/apply.

# 3 nodes: kube-prometheus-stack, the LB controller and the CloudWatch add-on do not
# fit in 2 t3.small nodes' 22-pod ceiling with room left for rolling updates.
node_groups = {
  spot = {
    instance_type = "t3.small"
    min_size      = 1
    max_size      = 4
    desired_size  = 3
    spot          = true
  }
}
