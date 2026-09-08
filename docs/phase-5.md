# Phase 5 — GitOps Deployment

## Goal

Deploy the app to a real Kubernetes cluster (Minikube) and hand control of
*what's running* over to Git: ArgoCD watches this repo and continuously
reconciles the live cluster to match whatever's committed under
`k8s/manifests/`, rather than anyone running `kubectl apply` by hand.

## Scope decisions

- **Minikube + ArgoCD**, per the original abstract — not Docker Desktop's
  built-in Kubernetes, even though it was already available and simpler to
  reach for. Staying with the tool the project plan actually names.
- **Portable binaries, not installers.** `minikube.exe` and `argocd.exe`
  are single Go binaries with no installer — downloaded directly from
  GitHub Releases into a user `bin` directory added to `PATH`, sidestepping
  the UAC/elevation problems that hit every *actual* installer earlier in
  this project (Node, Git, Docker Desktop). `kubectl` was already present,
  bundled with Docker Desktop.
- **Pin by digest, not `:latest`.** Both Deployments reference the exact
  image digests Phase 4 scanned, signed, and published
  (`server@sha256:03525d5...`, `client@sha256:f591024...`) — this cluster
  is provably running the artifact that passed the Trivy gate and carries
  a verified Cosign signature, not whatever `:latest` happens to resolve
  to at deploy time. The tradeoff: bumping to a new image means committing
  a new digest by hand for now — a natural candidate for Phase 4's
  `docker-publish.yml` to do automatically in a later pass, not solved here.
- **`k8s/manifests/` as the GitOps source of truth, `k8s/argocd-application.yaml`
  as a one-time bootstrap.** ArgoCD needs to exist and be told what to
  watch before GitOps can take over, so that one file is applied manually
  once; everything under `manifests/` is then continuously reconciled.
- **`kubectl port-forward` over NodePort/Ingress for local access.** Both
  images were already built (Phase 3/4) with `VITE_API_BASE_URL=http://localhost:5000/api`
  baked in at build time. NodePort can't reproduce that exact port (K8s'
  NodePort range starts at 30000), so `port-forward svc/server 5000:5000`
  and `port-forward svc/client 5173:8080` reproduce the same
  `localhost:5000`/`localhost:5173` contract the docker-compose setup
  used — same images, same assumption, just fronted by K8s Services now.

## What was built

- `k8s/manifests/namespace.yaml` — dedicated `shoppipe` namespace
- `k8s/manifests/mongo.yaml` — `PersistentVolumeClaim` (1Gi) + `Deployment`
  (`Recreate` strategy, since a `ReadWriteOnce` volume can't be mounted by
  two pods at once) + `Service`
- `k8s/manifests/server.yaml`, `k8s/manifests/client.yaml` — `Deployment`
  (pinned digest, readiness/liveness probes against each image's existing
  `/health` endpoint) + `Service`
- `k8s/argocd-application.yaml` — the bootstrap `Application` resource,
  `syncPolicy.automated` with `prune: true` and `selfHeal: true`

## Real incidents hit while standing this up (and how each was actually diagnosed)

**A too-large CRD broke the first ArgoCD install.** `kubectl apply -f
<install.yaml>` failed on `applicationsets.argoproj.io`:
`metadata.annotations: Too long: may not be more than 262144 bytes` — a
known limitation of client-side apply's `last-applied-configuration`
annotation against ArgoCD's large CRD schemas. Fixed with
`kubectl apply --server-side --force-conflicts`, which doesn't need that
annotation at all.

**Docker Desktop's engine became genuinely unresponsive mid-deployment.**
While the first `mongo`/`server` pods were starting, `kubectl` calls began
timing out (`TLS handshake timeout`), then `minikube status` failed
outright, then `docker ps` itself hung. This traced back to running too
much at once: Minikube's node container, ArgoCD's 7 pods, the 3 app pods,
*and* the still-running Phase 3 `docker-compose` stack (a second Mongo,
server, and client) — all competing for a 5GB container memory limit.
Recovery: restarted Docker Desktop, stopped the now-redundant
`docker-compose` stack (`docker compose down` — it had already served its
purpose in Phase 3/4 and didn't need to keep running), and started
Minikube with explicit `--cpus=4 --memory=3800` instead of leaving it to
guess.

**The Docker Desktop restart left Minikube's own container in a broken
state.** `minikube start` after the restart failed with `unable to apply
cgroup configuration: ... device or resource busy` — a stale container
reference from Docker Desktop's restart interrupting Minikube mid-flight,
not a resource problem. Fixed with `minikube delete` (clean teardown) then
a fresh `minikube start`, rather than trying to coax the broken container
back to life.

**A genuine crash loop, root-caused from pod events rather than guessed.**
With a clean cluster, `mongo` and `server` still wouldn't stabilize —
`server` in `CrashLoopBackOff`, `mongo` restarting repeatedly. It would
have been easy to blame this on the resource pressure above and just
retry, but `kubectl describe pod -l app=mongo` gave the actual reason
directly: `Liveness probe failed: command timed out: "mongosh --quiet
--eval db.adminCommand('ping')" timed out after 1s`. `mongosh` is a
Node.js-based CLI with real process-startup overhead; Kubernetes' default
exec-probe `timeoutSeconds` is 1 — the probe command itself couldn't
finish in time, so Kubernetes kept killing an otherwise-healthy `mongod`.
`server`'s crash loop was a downstream symptom: it kept trying to connect
to a Mongo that never stayed up long enough to be reachable. Fixed by
adding explicit `timeoutSeconds: 10` to both of `mongo`'s probes (and more
startup grace via `initialDelaySeconds`) — pushed to `main`, and ArgoCD's
`automated` sync picked it up without any manual `kubectl apply`.

## Verification performed

- All three pods `1/1 Running`, **zero restarts**, ArgoCD reporting
  `Synced` / `Healthy` — confirmed directly via `kubectl get pods -n
  shoppipe` and `kubectl get application shoppipe -n argocd`, not just
  "the sync didn't error."
- `kubectl port-forward` to both Services, then `GET /health` (server) and
  a raw request to the client — both responded correctly.
- Seeded the database via `kubectl exec ... node src/seed/seedProducts.js`
  directly into the running server pod.
- **Full Playwright golden-path walkthrough re-run a third time**, this
  time against the actual Kubernetes deployment (not docker-compose, not
  local dev servers): product list → detail → add to cart → cart →
  checkout → order confirmation. Zero console errors. Screenshots
  confirmed real product data and a correct order confirmation
  (`Total: $34.25`).
- **ArgoCD self-heal proven, not just configured.** Manually drifted the
  cluster (`kubectl scale deployment server --replicas=0`) and watched
  ArgoCD revert it. The event log shows the exact sequence, one second
  apart:
  ```
  ScalingReplicaSet   Scaled down replica set server-... from 1 to 0   (manual drift)
  ScalingReplicaSet   Scaled up   replica set server-... from 0 to 1   (ArgoCD self-heal)
  ```
  `Application` status returned to `Synced`/`Healthy` within seconds, with
  no manual intervention.
- Reseeded the database to a clean state after the golden-path smoke test.

## A small hardening pass, and one operational gotcha it surfaced

While reviewing the manifests, applied the same pattern as Phase 4's
`--ignore-scripts`/nginx-non-root pass: two SonarLint-flagged findings
across all three workloads — `automountServiceAccountToken: false` (none
of these pods talk to the Kubernetes API, so they don't need a token for
it) and explicit `ephemeral-storage` requests/limits. Applied directly to
the live cluster (`kubectl apply -f k8s/manifests/`) before pushing, to
confirm the rollout itself was clean: all three workloads rolled to new
pods, stabilized at `1/1 Running` with 0 restarts, no repeat of the mongo
probe issue.

That rollout surfaced a real limitation of the `kubectl port-forward`
access method: it forwards to whichever pod was backing the Service *at
the moment it started*, not the Service in general — when the rollout
replaced the old server pod, the existing port-forward died with
`Connection refused` and had to be restarted manually. Not a bug, just a
property of `port-forward` worth knowing; a real deployment would front
these Services with an Ingress instead, which doesn't have this issue.

## How to access the deployed app locally

```powershell
kubectl port-forward -n shoppipe svc/server 5000:5000
kubectl port-forward -n shoppipe svc/client 5173:8080   # separate terminal
```
- App: http://localhost:5173
- API: http://localhost:5000/api/products

Re-run these two commands any time a rollout replaces the pods they were
forwarding to (see above).

```powershell
kubectl get pods -n shoppipe                 # status/health of all 3 workloads
kubectl get application shoppipe -n argocd   # ArgoCD's sync/health status
kubectl logs -n shoppipe deployment/server   # tail a workload's logs
```

## Tasks accomplished

- [x] Minikube and ArgoCD CLI installed via direct binary download (no
      installer/UAC risk)
- [x] Minikube cluster running, ArgoCD installed (server-side apply to
      work around the large-CRD limitation)
- [x] `k8s/manifests/` (namespace, mongo, server, client) + bootstrap
      `Application` resource, all pinned to Phase 4's exact signed digests
- [x] Diagnosed and recovered from a genuine Docker Desktop resource
      exhaustion incident (not just retried blindly)
- [x] Diagnosed and fixed a stale-container Minikube failure after a
      Docker Desktop restart
- [x] Diagnosed and fixed a real mongo liveness-probe crash loop from
      actual pod events, not assumption
- [x] All pods stable at `1/1 Running`, 0 restarts, ArgoCD `Synced`/`Healthy`
- [x] Full app walkthrough verified against the live Kubernetes deployment
- [x] ArgoCD self-heal demonstrated with real, timestamped event evidence
- [x] Hardening pass (`automountServiceAccountToken: false`,
      `ephemeral-storage` requests/limits) across all three workloads,
      verified against the live cluster before pushing

## What's next (Phase 6)

Observability: Prometheus + Grafana, monitoring the same cluster this
phase stood up.
