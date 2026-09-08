aws_region      = "us-east-1"
environment     = "development"
alert_email     = "kumarg452k@gmail.com"
cluster_version = "1.34"
enable_redis    = false

# Bumped from 1 -> 2 for Phase 9: the full kube-prometheus-stack (Prometheus,
# Alertmanager, node-exporter, kube-state-metrics, Grafana) doesn't fit
# alongside the app/Redis/LB-controller within one t3.small's 11-pod ceiling.
node_groups = {
  spot = {
    instance_type = "t3.small"
    min_size      = 1
    max_size      = 3
    desired_size  = 2
    spot          = true
  }
}
