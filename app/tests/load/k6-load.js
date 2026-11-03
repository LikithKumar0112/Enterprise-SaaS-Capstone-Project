// Sustained load test reporting throughput, p95/p99 latency and error rate.
//
//   k6 run -e BASE_URL=http://<alb-dns> app/tests/load/k6-load.js
//
// Options: -e VUS=20 -e DURATION=5m
// The target needs a high RATE_LIMIT_MAX, because all k6 traffic comes from one IP:
//   helm upgrade ... --set env.RATE_LIMIT_MAX=1000000
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const VUS = Number(__ENV.VUS || 20);
const DURATION = __ENV.DURATION || '5m';

const errors = new Rate('errors');

export const options = {
  scenarios: {
    sustained: {
      executor: 'ramping-vus',
      stages: [
        { duration: '30s', target: VUS },
        { duration: DURATION, target: VUS },
        { duration: '30s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    http_req_failed: ['rate<0.01'],
    errors: ['rate<0.01'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'max', 'p(95)', 'p(99)'],
};

export default function () {
  const res = http.get(`${BASE_URL}/api/v1/products`);
  errors.add(!check(res, {
    'status is 200': (r) => r.status === 200,
    'has products': (r) => r.json('count') > 0,
  }));
  sleep(0.1);
}
