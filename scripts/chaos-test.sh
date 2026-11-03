#!/usr/bin/env bash
# Controlled failure experiments against a deployed environment. Each one sends a request
# per second through the ALB, injects a failure and reports impact and recovery time.
#
#   ./scripts/chaos-test.sh pod-kill       <alb-dns>
#   ./scripts/chaos-test.sh node-drain     <alb-dns>
#   ./scripts/chaos-test.sh redis-failover <alb-dns> production   # needs 2+ Redis nodes
#
# Runs against the cluster in your current kubeconfig context. The probe sends more than
# the default rate limit allows from one IP, so deploy with --set env.RATE_LIMIT_MAX=1000000
# for the test. Record results in docs/chaos-engineering.md.
set -euo pipefail

EXPERIMENT=${1:?usage: chaos-test.sh pod-kill|node-drain|redis-failover <alb-dns> [environment]}
ALB=${2:?ALB DNS name required}
ENVIRONMENT=${3:-production}
OBSERVE_SECONDS=${OBSERVE_SECONDS:-180}
NS=default
APP_LABEL=app=enterprise-devops-app

LOG=$(mktemp)
probe() {
  while true; do
    code=$(curl -s -m 3 -o /tmp/chaos-body.$$ -w '%{http_code}' "http://$ALB/api/v1/products" || echo 000)
    degraded=$(grep -c '"degraded":true' /tmp/chaos-body.$$ 2>/dev/null || true)
    echo "$(date +%s) $code $degraded" >> "$LOG"
    sleep 1
  done
}

probe &
PROBE_PID=$!
UNCORDON=""
cleanup() {
  kill "$PROBE_PID" 2>/dev/null || true
  rm -f "/tmp/chaos-body.$$"
  if [ -n "$UNCORDON" ]; then kubectl uncordon "$UNCORDON" > /dev/null; fi
}
trap cleanup EXIT

echo "Baseline: 30s"
sleep 30
INJECTED_AT=$(date +%s)

case "$EXPERIMENT" in
  pod-kill)
    POD=$(kubectl get pod -n "$NS" -l "$APP_LABEL" -o jsonpath='{.items[0].metadata.name}')
    echo "Deleting pod $POD"
    kubectl delete pod -n "$NS" "$POD" --wait=false
    ;;
  node-drain)
    POD_NODE=$(kubectl get pod -n "$NS" -l "$APP_LABEL" -o jsonpath='{.items[0].spec.nodeName}')
    echo "Draining node $POD_NODE (the PodDisruptionBudget applies)"
    UNCORDON=$POD_NODE
    kubectl drain "$POD_NODE" --ignore-daemonsets --delete-emptydir-data --timeout=300s
    ;;
  redis-failover)
    GROUP=devops-redis-$ENVIRONMENT
    echo "Triggering failover of $GROUP"
    aws elasticache test-failover --replication-group-id "$GROUP" --node-group-id 0001
    ;;
  *)
    echo "Unknown experiment: $EXPERIMENT" >&2
    exit 2
    ;;
esac

echo "Observing: ${OBSERVE_SECONDS}s"
sleep "$OBSERVE_SECONDS"

kubectl get pods -n "$NS" -l "$APP_LABEL" -o wide
kubectl get pods -n "$NS" -l "$APP_LABEL" \
  -o jsonpath='{range .items[*]}{.metadata.name}{" restarts="}{.status.containerStatuses[0].restartCount}{"\n"}{end}'

awk -v t="$INJECTED_AT" -v name="$EXPERIMENT" '
  { total++; if ($2 != 200) { failed++; if ($1 >= t) last_bad = $1 } if ($3 > 0) { degraded++; if ($1 >= t) last_bad = $1 } }
  END {
    printf "\nExperiment:         %s\n", name
    printf "Requests:           %d\n", total
    printf "Failed (non-200):   %d (%.2f%%)\n", failed, 100 * failed / total
    printf "Degraded responses: %d\n", degraded
    if (last_bad) printf "Recovered after:    %ds\n", last_bad - t + 1
    else printf "Recovered after:    no visible impact\n"
  }' "$LOG"
rm -f "$LOG"
