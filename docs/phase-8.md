# Phase 8 — Final Report

## Goal

Pull the seven phases together into one reference: what the whole system
looks like end to end, what actually happens between a `git commit` and a
user loading the storefront in a browser, and the exact commands to
operate every part of it — with a section on the real bugs the pipeline
itself surfaced and fixed along the way, since that's the actual proof a
DevSecOps pipeline is doing its job rather than just existing.

## 1. System architecture

**Components:**

| Component | What it is | Where it runs |
|---|---|---|
| `client` | React (Vite) SPA — catalog, cart, checkout, auth | nginx container, in-cluster |
| `server` | Node/Express API — products, checkout, auth, payments, metrics | Node container, in-cluster |
| `mongo` | MongoDB 7 | Container + PVC, in-cluster |
| GitHub repo | Source of truth for app code **and** cluster state | github.com |
| GitHub Actions | CI, static analysis trigger, AI review trigger, image build/scan/sign/publish | GitHub-hosted runners |
| SonarCloud | Static analysis + quality gate | SonarSource-hosted (free, public repo) |
| Gemini API | LLM-generated PR review comments | Google-hosted (free tier) |
| GHCR | Container registry for signed images | ghcr.io |
| Sigstore/Rekor | Keyless image-signing transparency log | Public Sigstore infrastructure |
| ArgoCD | GitOps controller — reconciles the cluster to match git | `argocd` namespace, in-cluster |
| kube-prometheus-stack | Prometheus + Grafana + kube-state-metrics + node-exporter | `monitoring` namespace, in-cluster |
| Minikube | The Kubernetes cluster itself | Local machine (Docker driver) |

**Diagram — commit to running pod:**

```
 DEVELOPER MACHINE                       GITHUB (github.com)
 ┌───────────────────┐   git push   ┌──────────────────────────────────────┐
 │ client/  server/   │ ───────────►│ Rakesh00523/CICD-Automation (main)    │
 │ (edits, tests run  │              └───────────────┬────────────────────-┘
 │  locally first)    │                              │ triggers on push/PR
 └────────────────────┘                              ▼
                                     ┌──────────────────────────────────────┐
                                     │            GitHub Actions            │
                                     │ ┌────┐ ┌───────────┐ ┌─────────────┐ │
                                     │ │ CI │ │SonarCloud │ │ AI Review   │ │ ← PR only
                                     │ │lint│ │(scan+gate)│ │  (Gemini)   │ │
                                     │ │test│ └───────────┘ └─────────────┘ │
                                     │ │bld │                               │
                                     │ └────┘                               │
                                     │ ┌──────────────┐ ┌──────────────────┐│
                                     │ │Docker Build  │ │ Docker Publish   ││ ← push to
                                     │ │build+Trivy   │ │ build→Trivy gate ││   main only
                                     │ │(report+gate) │ │ →GHCR push→SBOM  ││
                                     │ └──────────────┘ │ →Cosign sign     ││
                                     │                   └────────┬─────────┘│
                                     └────────────────────────────┼──────────┘
                                                                   ▼
                                                    ┌───────────────────────────┐
                                                    │  GHCR: signed, scanned,    │
                                                    │  SBOM'd server+client imgs │
                                                    └──────────────┬─────────────┘
                                                                   │ pulled by
                                                                   ▼
        ┌──────────────────────────────────────────────────────────────────────┐
        │                      Minikube cluster (local machine)                 │
        │  ┌──────────────┐   watches this repo's   ┌─────────────────────────┐ │
        │  │ argocd ns    │◄── k8s/manifests/ ───────┤ same GitHub repo above  │ │
        │  │ ArgoCD       │   (shoppipe app) +       └─────────────────────────┘ │
        │  │              │   Helm chart (monitoring app)                       │
        │  └──────┬───────┘                                                     │
        │         │ sync + self-heal + prune (continuous)                       │
        │         ▼                                                             │
        │  ┌────────────────────────────────────────────────────┐              │
        │  │ shoppipe namespace                                  │              │
        │  │  ┌────────┐        ┌─────────┐        ┌─────────┐  │              │
        │  │  │ client │──HTTP─►│ server  │──driver─►│  mongo  │  │              │
        │  │  │ (nginx)│        │(Express)│        │         │  │              │
        │  │  └────────┘        └────┬────┘        └─────────┘  │              │
        │  │                          │ GET /metrics              │              │
        │  └──────────────────────────┼─────────────────────────┘              │
        │                             ▼                                        │
        │  ┌────────────────────────────────────────────────────┐              │
        │  │ monitoring namespace (kube-prometheus-stack)         │              │
        │  │  Prometheus ──scrapes /metrics──┘   Grafana reads    │              │
        │  │  (via ServiceMonitor)               from Prometheus  │              │
        │  └────────────────────────────────────────────────────┘              │
        └──────────────────────────────────────────────────────────────────────┘
                             ▲
                             │ kubectl port-forward (local access only —
                             │ no ingress/public exposure in this project)
                     developer's browser
```

**Why it's shaped this way:** every arrow is either "git" (source of truth
in, reconciliation out) or "pull" (images pulled by digest, never pushed
into the cluster by a person). Nobody ever runs `kubectl apply` against
the app manifests directly, and nobody ever `docker push`es an
unscanned/unsigned image — both paths are structurally impossible
because the gates that would block them run before the step that would
let them happen (Trivy before GHCR push; ArgoCD sync before anything
reaches a pod).

## 2. Flow of execution

### 2a. Local development loop
Edit code → tests run locally (`npm test`) → commit → push to a branch →
open a PR against `main`.

### 2b. Pull request path (parallel, all on the PR)
- **CI** (`ci.yml`): `npm ci` → lint → test, separately for `server/` and
  `client/`; client also runs `npm run build`.
- **SonarCloud** (`sonar.yml`): both test suites run *with coverage*,
  lcov paths rewritten to be repo-root-relative, then scanned — quality
  gate posts to the PR.
- **AI Review** (`ai-review.yml`): fetches the PR's diff, sends it to
  Gemini with a prompt scoped to logic/security issues (not style), posts
  or updates one PR comment.

None of these three block each other — a SonarCloud outage doesn't stop
CI, and vice versa.

### 2c. Merge to `main` (build → scan → sign → publish)
- **Docker Build** (`docker-build.yml`, push *and* PR): builds both
  images, reports CRITICAL+HIGH to GitHub's Security tab (SARIF,
  non-blocking), then re-scans CRITICAL-only as a hard gate
  (`exit-code: 1`).
- **Docker Publish** (`docker-publish.yml`, push to `main` only): builds
  both images again → its own Trivy CRITICAL gate (doesn't trust the
  sibling workflow already passed) → pushes to GHCR → generates an SPDX
  SBOM per image → signs the pushed digest with Cosign (keyless, via the
  runner's GitHub OIDC identity — no stored private key).

An image only exists in GHCR if it passed its own scan in this same
workflow run, immediately followed by SBOM + signature — there's no
window where an unsigned or unscanned image sits in the registry.

### 2d. GitOps reconciliation (continuous, not push-triggered)
ArgoCD runs two `Application` resources, polling this same repo/chart on
its own schedule (plus on-demand via a hard refresh):
- `shoppipe` — source is the **whole** `k8s/manifests/` directory,
  applied to the `shoppipe` namespace. `automated.selfHeal: true` means
  any manual `kubectl` drift gets reverted; `prune: true` means removing
  a file from that directory deletes the matching resource from the
  cluster.
- `monitoring` — source is the `kube-prometheus-stack` Helm chart
  directly (not a directory in this repo), values pinned in
  `k8s/monitoring/argocd-application.yaml`.
- A **new image digest only reaches a running pod once someone commits
  the updated `image:` line** in `server.yaml`/`client.yaml` — publishing
  to GHCR and deploying it are two separate, deliberate steps.

### 2e. Runtime request flow (a real checkout)
Browser (via `client`'s nginx) → `POST /api/auth/register` or `/login`
→ JWT returned, stored client-side → cart built up client-side
(`localStorage`) → `POST /api/checkout` with `Authorization: Bearer
<jwt>` and a payment block → `server` validates the JWT
(`requireAuth` middleware) → validates stock → calls the fake payment
gateway (deterministic test-card rules) → on approval, decrements stock
and writes an `Order` tied to the user → `GET /api/orders/me` returns
that user's order history.

### 2f. Observability path
`server`'s `/metrics` endpoint (via `prom-client`) exposes default
Node.js process metrics plus `http_requests_total` /
`http_request_duration_seconds`. Prometheus (deployed by the
`monitoring` Application) discovers `server`'s `ServiceMonitor`
(`k8s/manifests/server-servicemonitor.yaml`, lives with the app, not the
monitoring stack, since it's app-specific config) and scrapes every 15s.
Grafana reads from that same Prometheus.

## 3. Command reference — what to run, and where

### One-time machine setup (local machine, PowerShell/terminal)
```powershell
winget install OpenJS.NodeJS.LTS Git.Git
# Docker Desktop installed separately (WSL2 backend) — not winget in this project
winget install --id GitHub.cli        # gh CLI, for watching Actions runs from a terminal
winget install --id Sigstore.Cosign   # cosign, for verifying signed images locally
gh auth login                          # interactive — needed once per machine
```
Minikube and ArgoCD's CLI are portable binaries (no installer): download
from GitHub Releases into a directory on `PATH`. `kubectl` ships with
Docker Desktop.

### Local development, no containers (local machine)
```powershell
# server — terminal 1
cd server
copy .env.example .env      # set JWT_SECRET, MONGODB_URI, etc.
npm install
npm run seed                 # populate sample products
npm run dev                  # http://localhost:5000

# client — terminal 2
cd client
copy .env.example .env
npm install
npm run dev                  # http://localhost:5173
```
Requires a local MongoDB (or a free Atlas cluster) reachable via
`MONGODB_URI`.

### Local development, Docker Compose (local machine)
```powershell
docker compose up -d --build
docker compose exec server node src/seed/seedProducts.js
docker compose ps                 # health of all 3 services
docker compose logs -f server      # tail one service
docker compose down                # stop (add -v to also drop the mongo volume)
```
App at `http://localhost:5173`, API at `http://localhost:5000/api`.

### Running tests / lint / build (local machine or CI — same commands)
```powershell
cd server
npm test               # Jest + Supertest, in-memory MongoDB, no setup needed
npm run test:coverage  # same, plus lcov output for SonarCloud
npm run lint

cd client
npm test               # Vitest + Testing Library
npm run test:coverage
npm run lint
npm run build           # production bundle → client/dist
```

### Building/scanning/signing images locally, *before* pushing (local machine)
Mirrors exactly what `docker-publish.yml` does, useful to catch a failing
gate before it fails in CI:
```powershell
docker build -t shoppipe-server:local ./server
docker build -t shoppipe-client:local ./client

# same gate CI enforces
trivy image --severity CRITICAL --exit-code 1 shoppipe-server:local
trivy image --severity CRITICAL --exit-code 1 shoppipe-client:local
```

### Verifying a published image's signature (local machine)
```powershell
cosign verify `
  --certificate-identity-regexp "https://github.com/Rakesh00523/CICD-Automation" `
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com" `
  ghcr.io/rakesh00523/cicd-automation/server@sha256:<digest>
```
Run this **before** bumping a digest into `k8s/manifests/*.yaml` — never
trust a digest string without re-verifying it.

### Kubernetes cluster bootstrap — one time only (local machine)
```powershell
minikube start --cpus=4 --memory=3800
kubectl create namespace argocd
kubectl apply --server-side --force-conflicts -n argocd `
  -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
# (--server-side needed: ArgoCD's CRDs exceed client-side apply's annotation size limit)

kubectl apply -f k8s/argocd-application.yaml       # bootstraps the shoppipe app
kubectl apply -f k8s/monitoring/argocd-application.yaml   # bootstraps the monitoring app
# Everything after this is GitOps-managed — no more manual kubectl apply
# for anything under k8s/manifests/.
```

### Day-to-day cluster operations (local machine)
```powershell
kubectl get pods -n shoppipe                        # app pod health
kubectl get application shoppipe -n argocd           # sync/health status
kubectl get application monitoring -n argocd
kubectl logs -n shoppipe deployment/server            # tail a workload's logs
kubectl -n argocd patch application shoppipe `
  --type merge -p '{"metadata":{"annotations":{"argocd.argoproj.io/refresh":"hard"}}}'
  # force an immediate resync instead of waiting for ArgoCD's poll interval
```

### Accessing the deployed app (local machine, one terminal per port-forward)
```powershell
kubectl port-forward -n shoppipe svc/server 5000:5000
kubectl port-forward -n shoppipe svc/client 5173:8080   # separate terminal
```
App: `http://localhost:5173` · API: `http://localhost:5000/api/products`.
Re-run after any rollout replaces the pod a port-forward was attached to
— it dies with `Connection refused`, it doesn't follow the Service.

### Accessing observability (local machine)
```powershell
kubectl port-forward -n monitoring svc/monitoring-grafana 3000:80
kubectl port-forward -n monitoring svc/monitoring-kube-prometheus-prometheus 9090:9090
```
Grafana: `http://localhost:3000` · Prometheus: `http://localhost:9090`.

### Managing the JWT signing secret (local machine — never in git)
```powershell
$jwt = node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
kubectl create secret generic shoppipe-secrets -n shoppipe --from-literal=jwt-secret=$jwt
```
The shape is documented in `k8s/server-secret.example.yaml` — deliberately
kept **outside** `k8s/manifests/` (ArgoCD's `shoppipe` source syncs that
whole directory with no filter; a real secret ever committed there would
become a real, publicly-readable live secret — this happened once during
Phase 7 and was fixed by relocating the file, not just re-wording a
comment).

### Watching CI/CD from a terminal (local machine, after `gh auth login`)
```powershell
gh run list --repo Rakesh00523/CICD-Automation --branch main --limit 10
gh run watch <run-id> --repo Rakesh00523/CICD-Automation --exit-status
gh run view <run-id> --repo Rakesh00523/CICD-Automation --log-failed
gh run rerun <run-id> --repo Rakesh00523/CICD-Automation --failed
```

### What runs automatically, with no command at all
Everything in section 2b/2c above — `ci.yml`, `sonar.yml`, `ai-review.yml`,
`docker-build.yml`, `docker-publish.yml` — triggers on GitHub's own
infrastructure from a `git push`/PR event. The only manual steps in the
entire pipeline are: writing code, pushing/opening a PR, bumping an image
digest into a manifest, and the one-time cluster bootstrap above.

## 4. Security & quality gates — what blocks what

| Gate | Blocks | Doesn't block |
|---|---|---|
| CI lint/test | A broken build/test from merging | — |
| SonarCloud quality gate | New CRITICAL security rating, <80% new-code coverage, new duplication | Pre-existing issues (tracked, not blocking) |
| Trivy (`docker-build.yml`) | Any CRITICAL CVE, on every push/PR | HIGH (reported to Security tab, not blocking) |
| Trivy (`docker-publish.yml`) | Any CRITICAL CVE, specifically before GHCR push | Same HIGH policy |
| Cosign signing | Nothing blocks — it's a proof, not a gate: an unsigned image simply never happened in this pipeline | — |
| ArgoCD `selfHeal` | Manual cluster drift (reverted automatically) | A bad commit — GitOps deploys what git says, correct or not |

## 5. Real bugs the pipeline found and fixed — the actual evidence it works

A pipeline is only as good as what it catches. Across all 8 phases, the
tooling (not guesswork) surfaced:

- **BLOCKER NoSQL injection** (SonarCloud, Phase 2) — `?category[$ne]=x`
  reaching a live Mongo query operator. Fixed with a type guard, then
  `express-mongo-sanitize` app-wide as defense-in-depth.
- **8 dependency vulnerabilities** (Phase 2, `npm audit`) in the client's
  vite/vitest/react-router chain — fixed via major-version bumps,
  verified with a full Playwright walkthrough before/after.
- **A stale/wrong CI action pin** (Phase 2) — `sonarqube-scan-action@v4`
  was 4 major versions behind `v8`, the actual cause of a job failing
  despite a successful analysis.
- **A CRITICAL CVE from npm's own bundled deps** (Phase 4, Trivy) —
  `node_modules/npm` shipping in the *production* server image with zero
  runtime use; stripped entirely.
- **nginx running as root** (Phase 4, SonarLint) — switched to
  `nginx-unprivileged`.
- **A mongo liveness-probe crash loop** (Phase 5, then again worse under
  load in Phase 6) — `mongosh`'s own startup cost exceeded probe
  timeouts; fixed architecturally (cheap TCP liveness, thorough `mongosh`
  readiness only) rather than by repeatedly raising a number.
- **A `ServiceMonitor`/Service label bug** (Phase 6) — Prometheus silently
  dropped the server's scrape target because the Service had a
  `spec.selector` but no `metadata.labels` of its own.
- **An insecure PRNG** (Phase 7, SonarCloud) — `Math.random()` building a
  payment transaction ID; fixed with `crypto.randomUUID()`.
- **A genuine client test-coverage gap** (Phase 7, SonarCloud quality
  gate) — several new auth/payment files had *no* test touching them at
  all; closed with real tests, not filler.
- **An ArgoCD secret-scoping bug** (Phase 7, live redeploy) — an
  "example" secret template, committed inside the directory ArgoCD syncs
  wholesale, got applied for real with its placeholder value as the live
  JWT secret. Caught before anything signed a token with it; fixed by
  moving the file outside the synced path, not by re-wording a comment.
- **3 of 5 action SHAs from a summarizer tool were simply wrong**
  (Phase 4) — caught by cross-checking every new action pin against
  `git ls-remote` directly before committing it. Repeated as standing
  practice in every phase since.

Every one of these was found by running the actual tool/scanner/cluster
against the actual artifact — never assumed, never guessed.

## 6. Cost: zero, and why

| Piece | Why it's free |
|---|---|
| GitHub Actions | Free minutes for public repos |
| SonarCloud | Free tier for public/open-source projects |
| Gemini API | Google AI Studio's free tier (rate-limited, no billing setup) |
| GHCR | Free for public images |
| Cosign / Sigstore | Open source, public keyless-signing infrastructure, no key management |
| Minikube / kubectl / ArgoCD | Open source, run on the developer's own machine |
| kube-prometheus-stack | Open source Helm chart |

The one deliberate exception: Claude API was the original choice for AI
review (Phase 2), but a chat subscription doesn't fund Console API
credits — switched to Gemini specifically to keep the whole pipeline at
zero infrastructure cost rather than require a purchase.

## 7. Project status

| # | Phase | Status |
|---|---|---|
| 1 | Foundation (app + basic CI) | Complete |
| 2 | Code Quality + AI Review | Complete — verified on a live PR |
| 3 | Containerization | Complete — verified locally + in CI |
| 4 | Supply Chain Security | Complete — images signed and live in GHCR |
| 5 | GitOps Deployment | Complete — deployed, self-heal verified |
| 6 | Observability | Complete — metrics pipeline verified end-to-end |
| 7 | Feature Expansion (auth, fake payment) | Complete — deployed and verified end-to-end on the live cluster |
| 8 | Final Report | Complete — this document |

## Tasks accomplished

- [x] Full architecture diagram covering every component and how they connect
- [x] End-to-end flow of execution documented for all six paths (dev loop,
      PR, merge-to-main, GitOps reconciliation, a real runtime request,
      observability)
- [x] Complete command reference, organized by exactly where each command
      runs (local machine vs. automatic on GitHub vs. one-time cluster
      bootstrap)
- [x] Security/quality gate matrix — what actually blocks a merge/publish
      versus what's reported but non-blocking
- [x] Consolidated retrospective of every real bug the pipeline itself
      found and fixed across all 8 phases
- [x] Cost breakdown explaining why every component is free at this scale
- [x] README's phase table updated to reflect all 8 phases complete
