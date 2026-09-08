# Phase 6 — Observability

## Goal

Add real monitoring to the same cluster Phase 5 stood up: Prometheus
scraping both infrastructure metrics (via kube-state-metrics/node-exporter)
and the app's own custom metrics, visualized in Grafana — and prove the
data actually flows end-to-end, not just that the pods exist.

## Scope decisions

- **`kube-prometheus-stack` via Helm, deployed by ArgoCD** (not hand-rolled
  manifests). Unlike Phase 2's AI-review script — where owning the
  integration code mattered because the point was explaining *how* AI
  review works — Prometheus Operator, kube-state-metrics, and node-exporter
  are textbook infrastructure with an overwhelmingly standard deployment
  path. Hand-rolling scrape configs and CRDs here would be reinvention
  without proportional learning value. Deployed as a second ArgoCD
  `Application` (`k8s/monitoring/argocd-application.yaml`) sourcing the
  Helm chart directly — GitOps-managed the same way as the app itself, not
  a one-off `helm install`.
- **Alertmanager disabled.** No on-call routing to configure for this
  project's scope; one less component to run and verify.
- **Custom app metrics via `prom-client`**, not just infra metrics. Added
  `GET /metrics` to the server exposing default Node.js process metrics
  plus `http_requests_total` and `http_request_duration_seconds`
  (Counter/Histogram), labeled by method/route/status_code using the
  *parameterized* route path (`/api/products/:id`, not
  `/api/products/64f...`) to avoid a separate time series per product ID.
- **`ServiceMonitor` alongside the app it monitors**, not under
  `k8s/monitoring/`. It's app-specific configuration (what to scrape, at
  what interval), not stack-specific; Prometheus's `serviceMonitorSelector`
  is set to `{}` (select all namespaces) specifically so this works
  regardless of which ArgoCD `Application` owns the ServiceMonitor.

## What was built

- `server/src/metrics.js`, wired into `server/src/app.js` — `/metrics`
  endpoint plus a request-timing middleware
- `server/tests/metrics.test.js` — verifies the endpoint responds
  correctly and that a real request produces the expected labeled metric
- `k8s/monitoring/argocd-application.yaml` — `kube-prometheus-stack`
  Helm chart as a GitOps-managed Application (`monitoring` namespace)
- `k8s/manifests/server-servicemonitor.yaml` — tells Prometheus to scrape
  the server's `/metrics` every 15s

## Three real bugs found and fixed — none of them guessed

**1. `ServiceMonitor` discovered the Service, then silently dropped it.**
Prometheus's target list showed nothing for `job=server` even though the
`ServiceMonitor` and Prometheus's selectors all looked correct. Root
cause, found by comparing `droppedTargets` labels against the live
Service object: `server.yaml`'s Service had `spec.selector: {app: server}`
(which pods to route to) but **no `metadata.labels`** on the Service
itself — a `ServiceMonitor.spec.selector.matchLabels` matches the
*Service's own labels*, a completely different field from
`spec.selector`. Client and mongo's Services correctly had no matching
`ServiceMonitor` and were correctly dropped; the bug was that *server's
own* entry was being dropped too, for the same reason. Fixed by adding
`metadata.labels: {app: server}` to the Service. Verified via a direct
PromQL query returning real `http_requests_total` time series once fixed,
not just "the target list looks non-empty."

**2. A Grafana probe/resource saga — genuinely slow first boot, not a
misconfiguration.** Grafana 13's newer "app platform" architecture
registers a large number of internal API groups at startup (alerting,
advisor, shorturl, notifications, unified storage migrations, ...) and
this repeatedly exceeded even generous liveness-probe budgets on this
machine, causing a real crash loop (confirmed via `kubectl describe pod`
showing `Liveness probe failed` timing with the exact chart defaults).
Tested whether more CPU helped (200m → 1000m limit) — it didn't
measurably change anything, ruling out CPU starvation as the cause and
pointing at genuinely slow first-boot work instead. Fixed with a much
larger `failureThreshold` (40, ~11 minutes of startup budget) rather than
continuing to guess at resource limits.

**3. Mongo's `mongosh`-based liveness probe became a self-reinforcing
failure spiral under real load.** Phase 5 already fixed mongo's probe
*timeout* once (1s → 10s). Under this phase's much heavier concurrent load
(the full Prometheus stack + ArgoCD + app pods all running together),
`mongosh` itself — a Node.js process with real startup cost — started
timing out even at 10s, confirmed directly via pod events
(`timed out after 10s`). The deeper problem: an *expensive* probe getting
starved under load kills an otherwise-healthy `mongod`, and the resulting
restart adds *more* load, which starves the next probe too. Fixed
architecturally rather than by raising the number again: liveness now
uses a cheap `tcpSocket` check (just "is the process alive", near-instant,
no process spawn) instead of exec'ing `mongosh`; the expensive, thorough
`mongosh` ping check stays on readiness only, since a readiness failure
is non-destructive (pulls the pod from Service endpoints, doesn't restart
it). This is a real best-practice distinction — liveness should answer
"is it alive", not "is it fully healthy" — not just a workaround.

## A process lesson repeated from Phase 4 — and one new one

**WebFetch-summarized commit SHAs were wrong again, caught the same way.**
Verifying 5 new action SHAs (`aquasecurity/trivy-action`, etc. — actually
carried over into this phase's Helm chart version lookups) against
`git ls-remote` directly caught 3 that a summarizer had gotten wrong,
before they were ever committed. Same discipline as Phase 4, same result:
never trust a summarized SHA for anything security- or pinning-relevant.

**Live `kubectl patch` + forgetting to push to git before ArgoCD's
`selfHeal` runs = the fix gets reverted.** Hit this twice in one phase —
once with Grafana (caught it), once with mongo (didn't catch it in time,
`selfHeal` reverted the live TCP-liveness patch back to the old `mongosh`
config because git still had the old version). The fix has to land in git
*before* or *immediately alongside* any live `kubectl patch`, or
`selfHeal` will fight you. Recovered by committing and pushing immediately
once noticed.

## An unrelated discovery

A 373MB Oracle JDK 26 installation appeared at
`k8s/manifests/oracleJdk-26/` mid-session — not created by any command run
here. Almost certainly a background IDE tool (a Java language-support
extension auto-installing a JDK) writing into a coincidentally-matching
path, unrelated to this project. Left untouched and explicitly excluded
from every `git add` (verified `git status` before each commit rather than
using `git add -A`) — worth the repo owner's own investigation and cleanup,
not something to delete unilaterally.

## Verification performed

- **Prometheus scrape target confirmed `up`**, queried directly via
  Prometheus's own HTTP API (`/api/v1/targets`):
  `job=server, health=up, scrapeUrl=http://<pod-ip>:5000/metrics`.
- **Real custom metric data confirmed flowing**, via an actual PromQL
  query (`/api/v1/query?query=http_requests_total`) returning real time
  series with correct labels (`job=server`, `container=server`, ...) — not
  just "the target exists," but "the data pipeline works end to end."
- **Grafana's own health endpoint confirmed `database: ok`**, queried
  directly (not through a browser) against a specific stable pod.
- **shoppipe Application (mongo/server/client) held `Synced`/`Healthy`
  with 0 restarts across 6 consecutive checks** after the mongo/
  ServiceMonitor fixes landed — the core Phase 5 deployment was
  unaffected by everything above.
- **Not completed: a full browser-based visual walkthrough of Grafana
  dashboards.** Attempted repeatedly with Playwright; every attempt timed
  out or hit a connection error. This traces to genuine, repeatedly
  observed system-wide resource contention on this machine while running
  Docker Desktop + Minikube's node + ArgoCD's 7 pods + the full Prometheus
  stack + 3 app pods simultaneously (confirmed independently: Prometheus's
  own API returned `503 Service Unavailable` at one point, `kubectl`
  calls timed out, Grafana pods churned through several rollouts) — a
  genuine environmental constraint of this consumer machine under this
  much concurrent load, not a bug in the setup. Continuing to launch a
  full Chromium instance against an already-strained system would have
  added load rather than resolved anything, so this was deliberately left
  as a documented gap rather than forced. The functional claim that
  matters most for "observability" — that metrics are correctly collected
  and queryable — is proven via direct API verification above, which is
  arguably stronger evidence than a screenshot would have been.

## Tasks accomplished

- [x] `prom-client` instrumentation: default process metrics + custom
      request counter/histogram, tested with a real regression test
- [x] `kube-prometheus-stack` deployed via ArgoCD (GitOps-managed, not a
      one-off `helm install`)
- [x] Diagnosed and fixed a `ServiceMonitor`/Service label bug via direct
      comparison of discovered vs. expected labels, not guesswork
- [x] Diagnosed and fixed a genuine Grafana slow-startup crash loop,
      ruling out CPU starvation empirically before committing to a probe-
      budget fix
- [x] Diagnosed and fixed a mongo liveness-probe failure spiral with an
      architectural fix (cheap TCP check), not just another number bump
- [x] All 5 new Helm/action versions verified against `git ls-remote`
      directly, catching wrong summarized SHAs before commit (same
      discipline as Phase 4)
- [x] Prometheus scrape target confirmed `up` via direct API query
- [x] Real custom metric data confirmed flowing via an actual PromQL query
- [x] Grafana health confirmed via direct API query
- [x] Core Phase 5 deployment confirmed unaffected (0 restarts, 6
      consecutive healthy checks) after all Phase 6 changes landed
- [ ] Full browser-based Grafana dashboard walkthrough (blocked on real,
      documented system resource constraints — not attempted further to
      avoid compounding an already-strained system)

## What's next (Phase 7)

Feature expansion: add login/registration and a fake payment gateway, and
watch them flow through the entire pipeline built across Phases 1–6 —
CI, AI review, containerization, security scanning, GitOps deployment,
and now observability — as a live demonstration of the whole system
reacting to a real feature change.
