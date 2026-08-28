# Production Deployment Checklist

## Pre-Deployment
- [ ] All tests passing (unit, integration, e2e)
- [ ] Security scans completed (Trivy, Snyk, OWASP)
- [ ] Code review completed by 2+ engineers
- [ ] Performance testing completed
- [ ] Rollback plan documented
- [ ] Database migrations tested
- [ ] Monitoring dashboards configured

## Deployment
- [ ] Deploy to staging environment
- [ ] Run smoke tests on staging
- [ ] Performance validation on staging
- [ ] Get approval from product owner
- [ ] Deploy using blue-green strategy
- [ ] Monitor metrics during deployment
- [ ] Verify all health checks pass

## Post-Deployment
- [ ] Verify application functionality
- [ ] Monitor error rates for 1 hour
- [ ] Check performance metrics
- [ ] Update deployment documentation
- [ ] Notify stakeholders
- [ ] Schedule post-mortem if issues

## Monitoring
- [ ] CPU usage below 70%
- [ ] Memory usage below 80%
- [ ] Error rate below 0.1%
- [ ] Response time p95 < 500ms
- [ ] All health checks passing
- [ ] No security alerts
