# Chaos Engineering Experiments

Each experiment has a hypothesis, a failure to inject, and a measured result. Run them with
`scripts/chaos-test.sh`, while `k6` provides background load if you want results under traffic.

## Results so far

| Experiment | Where it ran | Result |
|---|---|---|
| Redis outage and recovery | Automated test (`app/tests/integration/resilience.test.js`), real Redis behind a TCP proxy | Passing: stayed up, then reconnected |
| External API failure | Same test file, local failing HTTP server | Passing: circuit opened, then closed after recovery |
| Redis stopped under the built image | Local Docker, read-only container with all capabilities dropped | `/livez` 200, `/health` 503, products served with `degraded: true` |
| App pod deleted | EKS | **Not yet run** |
| Node drained | EKS | **Not yet run** |
| ElastiCache failover | EKS production | **Not yet run** |

## 1. App pod deleted

- **Hypothesis:** with at least 3 replicas, the ALB and readiness probes route around the lost pod. Few or no requests fail, and the Deployment replaces it within 60 seconds.
- **Run:** `./scripts/chaos-test.sh pod-kill <alb-dns>`
- **Pass if:** failed requests stay under 1% and the replica count returns to its previous value.
- **Result:** *fill in after the run.*

## 2. Node drained

This simulates a Spot reclamation or node upgrade.

- **Hypothesis:** the PodDisruptionBudget keeps at least 2 production replicas available while pods move, so users see no outage.
- **Run:** `./scripts/chaos-test.sh node-drain <alb-dns>`
- **Pass if:** failed requests stay under 1%, and the drain respects the budget.
- **Result:** *fill in after the run.*

## 3. ElastiCache failover

- **Hypothesis:** Redis is only a cache, so products keep returning 200 during the failover, flagged `degraded: true`. Caching resumes after the replica is promoted. No pods restart.
- **Run:** `./scripts/chaos-test.sh redis-failover <alb-dns> production`
- **Pass if:** no non-200 responses, degraded responses end by themselves, and the restart count stays 0.
- **Result:** *fill in after the run.*
