# Getting Started (Local Development)

How to run and test the application on your own machine. Everything below assumes
you are working inside the app directory:

```bash
cd app/src
```

## Prerequisites

- **Node.js 22+** and **npm 9+** (CI and the Docker image use Node 22)
- **Docker** (for running Redis locally and building the image)

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

Copy the example file and adjust values as needed:

```bash
cp .env.example .env
```

The defaults in `.env.example` are:

```
NODE_ENV=development
PORT=3000
LOG_LEVEL=info
REDIS_URL=redis://localhost:6379
EXTERNAL_API_URL=https://api.mocki.io/v2/5143e9e3
APP_VERSION=2.0.0
ALLOWED_ORIGINS=http://localhost:3000
REDIS_PASSWORD=
AWS_SECRET_NAME=
TRUST_PROXY_HOPS=0
RATE_LIMIT_MAX=100
```

## 3. Run unit tests

Unit tests do not need Redis. They run with coverage (thresholds are enforced by the
Jest config in `package.json`):

```bash
npm test
```

![npm test — unit suite passing with coverage summary](../images/test-cases.png)

## 4. Run integration tests

Integration tests exercise the cache endpoints, a Redis outage and recovery, and
circuit-breaker recovery. They **require a Redis instance** on `localhost:6379`. Start one with Docker:

```bash
docker run -d --name dev-redis -p 6379:6379 redis:7-alpine
```

Then run the suite:

```bash
npm run test:integration
```

When you're done:

```bash
docker rm -f dev-redis
```

> This mirrors CI: the `test` job in `.github/workflows/ci.yml` spins up a
> `redis:7-alpine` service container and runs the integration tests against
> `redis://localhost:6379`.

## 5. Run the app locally

With Redis running (step 4) and a `.env` in place:

```bash
npm start        # node server.js
# or, with auto-reload:
npm run dev
```

The server listens on `http://localhost:3000`. Useful endpoints:

- `GET /livez` — liveness probe; no dependency checks
- `GET /readyz` — readiness probe and ALB health check; fails only while shutting down
- `GET /health` — detailed dependency status for humans and dashboards
- `GET /metrics` — Prometheus metrics
- `GET/POST/DELETE /api/v1/cache/:key` — Redis-backed cache API

The root endpoint returns app metadata (environment, request ID, feature list, endpoints):

![Application root response](../images/containerisation.png)

## 6. Build and run the Docker image

The app ships a multi-stage `Dockerfile`. Build and run it with the provided npm scripts:

```bash
npm run docker:build           # docker build -t enterprise-devops-app .
npm run docker:run             # docker run -p 3000:3000 --env-file .env enterprise-devops-app
```

Or directly:

```bash
docker build -t enterprise-devops-app .
docker run -p 3000:3000 --env-file .env enterprise-devops-app
```

The image runs as a non-root user (UID 1001) with `dumb-init` as PID 1 and a built-in
`HEALTHCHECK` hitting `/livez`.

The multi-stage build (`deps` → `runtime`) in action:

![Multi-stage Docker build completing](../images/multistage-build.png)

## 7. Run the load test

With the app running and `RATE_LIMIT_MAX` set high (all k6 traffic comes from one IP):

```bash
RATE_LIMIT_MAX=100000000 npm start
k6 run -e VUS=10 -e DURATION=1m ../tests/load/k6-load.js
```

k6 reports throughput, p95/p99 latency and error rate, and fails if a threshold is missed.

## Handy scripts

| Command                     | What it does                                  |
|-----------------------------|-----------------------------------------------|
| `npm test`                  | Unit tests with coverage                      |
| `npm run test:integration`  | Integration tests (needs Redis)               |
| `npm run test:load`         | k6 load test (needs k6 and a running app)     |
| `npm run lint`              | ESLint                                        |
| `npm run lint:fix`          | ESLint with autofix                           |
| `npm run security-check`    | `npm audit --audit-level=critical`            |
| `npm run docker:build`      | Build the container image                     |
| `npm run docker:run`        | Run the container image                        |

## Next steps

- [System Design](../architecture/system-design.md) — how it all fits together on AWS
- [Deployment Guide](../deployment/deployment-guide.md) — how CI/CD ships it
- [Troubleshooting](../troubleshooting/common-issues.md) — issues we actually hit
