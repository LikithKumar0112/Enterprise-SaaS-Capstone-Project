# Chaos Engineering Experiments

## Network Latency
```bash
# Add latency to network
kubectl run network-chaos --image=alpine -- \
  tc qdisc add dev eth0 root netem delay 100ms

# Test application under latency
curl -w "Time: %{time_total}s\n" http://app-url/health
