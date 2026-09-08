# Contributing

Thanks for contributing to the Enterprise SaaS DevOps Capstone project. This guide
covers how to branch, commit, and get changes merged. For the full branching model
see [docs/branching-strategy.md](./docs/branching-strategy.md).

## Branching

| Change type          | Branch from | Branch name        | Merges into |
|----------------------|-------------|--------------------|-------------|
| New feature / change | `develop`   | `feature/<name>`   | `develop`   |
| Non-critical bug fix | `develop`   | `bugfix/<name>`    | `develop`   |
| Critical prod fix    | `main`      | `hotfix/<name>`    | `main` (and back into `develop`) |

```bash
# Feature work
git checkout develop
git pull origin develop
git checkout -b feature/my-change

# Production emergency
git checkout main
git pull origin main
git checkout -b hotfix/fix-broken-thing
```

## Before you commit

- **Commit small.** Keep each commit focused on one logical change with a clear message.
- **Run tests and lint locally** from `app/src/` before pushing:

  ```bash
  cd app/src
  npm install
  npm run lint
  npm test                  # unit tests + coverage
  npm run test:integration  # needs a local Redis on :6379
  ```

- Make sure the Docker image still builds if you touched the app or `Dockerfile`:

  ```bash
  npm run docker:build
  ```

## Pull requests

1. Push your branch and open a PR **into `develop`** (feature/bugfix) or **into `main`** (hotfix).
2. **CI must pass.** The GitHub Actions CI workflow runs lint, unit tests, integration
   tests, a Snyk dependency scan, an image build, a Trivy image scan, and Hadolint.
   Terraform changes additionally run `fmt`/`validate`/`tfsec`/`plan`.
3. **At least one approval** is required before merge (hotfixes require two — see the
   branching strategy).
4. Keep your branch up to date with its base before merging.

## Releases & deployment

- Releases flow **`develop` → `main`**. Merging to `develop` auto-deploys to the
  development environment; merging to `main` deploys to production.
- **Production deploys require environment approval.** The `deploy-production` job in
  `.github/workflows/cd.yml` runs against the GitHub `production` environment, which is
  configured with a required reviewer, so a human must approve the run before it deploys.

## Commit message format

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <summary>
```

Common types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `ci`, `hotfix`.
