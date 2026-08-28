# Branching Strategy

## Overview

This project follows a **GitFlow**-inspired branching model adapted for enterprise CI/CD with GitHub Actions and AWS EKS deployments. The strategy ensures stable production releases, parallel feature development, and fast hotfix response times.

---

## Branch Structure

```
main
 └── develop
      ├── feature/user-auth
      ├── feature/feature2
      └── release/v1.2.0
           └── hotfix/critical-bug-fix
```

---

## Core Branches

| Branch     | Purpose                         | Protected | Direct Push |
|------------|---------------------------------|-----------|-------------|
| `main`     | Production-ready code           | ✅ Yes     | ❌ No       |
| `develop`  | Integration / staging branch    | ✅ Yes     | ❌ No       |

### `main`
- Represents the **production** state at all times.
- Every commit on `main` is tagged with a version (e.g., `v1.2.3`).
- Only merged via Pull Requests from `release/*` or `hotfix/*` branches.
- Triggers the **production deployment pipeline** on merge.

### `develop`
- The primary **integration branch** where features are assembled.
- Continuously deployed to the **staging/dev environment** via CI/CD.
- Only merged via Pull Requests from `feature/*` or `bugfix/*` branches.

---

## Supporting Branches

### `feature/*`

| Property    | Value                                      |
|-------------|--------------------------------------------|
| Branches off | `develop`                                 |
| Merges into  | `develop`                                 |
| Naming       | `feature/<ticket-id>-short-description`   |
| Lifetime     | Short-lived (deleted after merge)          |

**Usage:**
```bash
# Create a feature branch
git checkout develop
git pull origin develop
git checkout -b feature/JIRA-123-add-oauth-login

# Work, commit, push
git push origin feature/JIRA-123-add-oauth-login

# Open Pull Request → develop
```

**Rules:**
- Must pass all CI checks (unit tests, linting, security scans).
- Requires at least **1 peer review** before merge.
- Branch name must reference a ticket ID.

---

### `release/*`

| Property    | Value                                         |
|-------------|-----------------------------------------------|
| Branches off | `develop`                                    |
| Merges into  | `main` AND `develop`                          |
| Naming       | `release/vMAJOR.MINOR.PATCH`                  |
| Lifetime     | Short-lived (until deployment is complete)    |

**Usage:**
```bash
# Cut a release branch from develop
git checkout develop
git pull origin develop
git checkout -b release/v1.3.0

# Only bug fixes allowed; no new features
# Bump version files, update CHANGELOG

git push origin release/v1.3.0

# Open PRs → main AND → develop
```

**Rules:**
- Only **bug fixes and version bumps** — no new feature commits.
- After merge to `main`, tag the release: `git tag -a v1.3.0 -m "Release v1.3.0"`.
- Merge back to `develop` to carry forward any last-minute fixes.

---

### `hotfix/*`

| Property    | Value                                         |
|-------------|-----------------------------------------------|
| Branches off | `main`                                       |
| Merges into  | `main` AND `develop`                          |
| Naming       | `hotfix/<ticket-id>-short-description`        |
| Lifetime     | Very short-lived (patch critical issues fast) |

**Usage:**
```bash
# Branch from main for the critical fix
git checkout main
git pull origin main
git checkout -b hotfix/JIRA-456-fix-payment-crash

# Apply fix, update patch version
git push origin hotfix/JIRA-456-fix-payment-crash

# Open PRs → main AND → develop
```

**Rules:**
- Reserved for **critical production issues only**.
- Requires **2 peer reviews** and all CI checks to pass.
- After merge, increment the **patch** version and tag: `v1.2.x`.
- Immediately triggers the production deployment pipeline.

---

### `bugfix/*`

| Property    | Value                                      |
|-------------|--------------------------------------------|
| Branches off | `develop`                                 |
| Merges into  | `develop`                                 |
| Naming       | `bugfix/<ticket-id>-short-description`    |
| Lifetime     | Short-lived                               |

Used for non-critical bug fixes found during development or QA. Follows the same process as `feature/*` branches.

---

## CI/CD Pipeline Integration

| Branch Pattern  | CI Triggered        | CD Deployed To      |
|-----------------|---------------------|---------------------|
| `feature/*`     | ✅ Build + Tests     | ❌ None             |
| `bugfix/*`      | ✅ Build + Tests     | ❌ None             |
| `develop`       | ✅ Full pipeline     | ✅ Dev / Staging    |
| `release/*`     | ✅ Full pipeline     | ✅ Staging / UAT    |
| `main`          | ✅ Full pipeline     | ✅ Production (EKS) |
| `hotfix/*`      | ✅ Full pipeline     | ✅ Production (EKS) |

---

## Pull Request Requirements

All PRs must satisfy the following before merge:

- [ ] CI/CD pipeline passes (GitHub Actions)
- [ ] Unit tests pass (`npm test`)
- [ ] Trivy container security scan — no CRITICAL vulnerabilities
- [ ] Snyk dependency scan passes
- [ ] Code review approval (1 reviewer for features, 2 for hotfixes)
- [ ] Branch is up-to-date with base branch
- [ ] Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/)

---

## Commit Message Convention

Follow **Conventional Commits** format:

```
<type>(<scope>): <short summary>

[optional body]

[optional footer — e.g., Closes JIRA-123]
```

**Types:**

| Type       | When to use                                   |
|------------|-----------------------------------------------|
| `feat`     | New feature                                   |
| `fix`      | Bug fix                                       |
| `docs`     | Documentation changes only                    |
| `style`    | Formatting, no logic change                   |
| `refactor` | Code restructure, no feature/fix              |
| `test`     | Adding or updating tests                      |
| `chore`    | Build process, tooling, dependency updates    |
| `ci`       | CI/CD configuration changes                   |
| `hotfix`   | Critical production fix                       |

**Examples:**
```
feat(auth): add OAuth2 login with Google
fix(payment): resolve crash on failed card decline
ci(pipeline): add Trivy scan to PR workflow
hotfix(api): patch SQL injection in user endpoint
```

---

## Versioning

This project follows [Semantic Versioning (SemVer)](https://semver.org/):

```
vMAJOR.MINOR.PATCH

MAJOR — Breaking API or architecture change
MINOR — New backward-compatible features
PATCH — Backward-compatible bug fixes / hotfixes
```

Version is maintained in `package.json` and updated during `release/*` or `hotfix/*` branches.

---

## Branch Protection Rules (GitHub)

Configure the following in **GitHub → Settings → Branches**:

### `main`
- Require pull request reviews before merging: **2 approvals**
- Require status checks to pass: **ci/build**, **ci/test**, **ci/security**
- Require branches to be up to date before merging: ✅
- Restrict direct pushes: ✅ (admins only in emergencies)
- Require signed commits: ✅

### `develop`
- Require pull request reviews before merging: **1 approval**
- Require status checks to pass: **ci/build**, **ci/test**
- Require branches to be up to date before merging: ✅
- Restrict direct pushes: ✅

---

## Workflow Summary

```
1. Pick up a JIRA ticket
2. Branch off develop → feature/<ticket-id>-description
3. Develop, commit (Conventional Commits), push
4. Open PR → develop; CI must pass + 1 review
5. Merge feature → develop (squash or merge commit)
6. Develop auto-deploys to staging

7. When ready to release:
   a. Branch off develop → release/vX.Y.Z
   b. Bug fixes only; bump version + update CHANGELOG
   c. PR → main (2 reviews) + PR → develop
   d. Merge to main → auto-deploy to production
   e. Tag: git tag -a vX.Y.Z

8. For production emergencies:
   a. Branch off main → hotfix/<ticket-id>-description
   b. Fix, PR → main (2 reviews) + PR → develop
   c. Merge → production deploy + patch tag
```

---

## Related Documentation

- [README](../README.md)
- [CI/CD Pipeline](../.github/workflows/)
- [Deployment Guide](./deployment/deployment-guide.md)
- [Contributing Guidelines](../CONTRIBUTING.md)
