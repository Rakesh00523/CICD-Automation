# Phase 4 — Supply Chain Security

## Goal

Nothing gets published without earning it: scan every image for known
vulnerabilities (Trivy), generate a Software Bill of Materials (Syft), and
sign it (Cosign) — and only push to a registry (GitHub Container Registry)
after the scan actually passes. Build → gate → publish, in that order,
enforced by CI, not by convention.

## Scope decisions

- **Two workflows, not one.** `docker-build.yml` (extended from Phase 3)
  runs on every push *and* PR to `main`: build both images, scan with
  Trivy, report everything to GitHub's Security tab, and hard-fail on any
  CRITICAL finding — fast feedback on every change, no registry
  credentials needed. `docker-publish.yml` runs only on push to `main`:
  build → Trivy gate (again, standalone — doesn't assume the other
  workflow's gate already ran, since GitHub Actions doesn't guarantee
  ordering between separate workflow files) → push to GHCR → Syft SBOM →
  Cosign sign. An image only reaches the registry after passing its own
  gate, not because a sibling workflow happened to pass first.
- **Report HIGH, block on CRITICAL.** A hard gate on any HIGH finding would
  make the pipeline hostage to upstream base-image CVEs with no fix
  available yet — common and often out of this project's control. CRITICAL
  blocks the build; HIGH (and CRITICAL) both get uploaded as SARIF to
  GitHub's Security tab for visibility either way, so nothing is silently
  swallowed even when it doesn't block.
- **Keyless Cosign signing (Sigstore/GitHub OIDC), no managed key pair.**
  Cosign supports both a traditional private-key workflow and "keyless"
  signing using the CI runner's short-lived GitHub Actions OIDC identity
  token, recorded in Sigstore's public transparency log (Rekor). No
  `COSIGN_PRIVATE_KEY` secret to generate, store, or rotate — fits the
  project's zero-cost/zero-infrastructure constraint and is the current
  recommended approach for public CI, not a shortcut.
- **GHCR, not Docker Hub.** No extra account/credentials needed — the
  workflow's own `GITHUB_TOKEN` (already scoped via `permissions:
  packages: write`) is sufficient to push, unlike Docker Hub which would
  need a separate account and access token secret.

## Every action SHA verified against `git ls-remote`, not trusted from a summary

While pinning the five new actions this phase needed
(`aquasecurity/trivy-action`, `github/codeql-action/upload-sarif`,
`anchore/sbom-action`, `sigstore/cosign-installer`, `docker/login-action`),
cross-checked each `WebFetch`-reported commit SHA against
`git ls-remote --tags <repo> refs/tags/<version>` before using it — and
**3 of the 5 SHAs `WebFetch`'s summarizer reported were simply wrong**
(fabricated-looking, unrelated commits), only `cosign-installer` and
`docker/login-action` matched. Also retroactively verified the three SHAs
already committed in Phase 2/3 (`sonarqube-scan-action`,
`build-push-action`, `setup-buildx-action`) the same way — all three
checked out correctly, so no retroactive fix was needed there, but it
confirms this verification step is load-bearing, not paranoia: without it,
this phase would have shipped three broken/wrong action pins straight into
a security-scanning workflow. Every SHA below is the `git ls-remote`
-verified value, not the first thing a search tool reported.

## A CRITICAL vulnerability found by actually scanning the built image

Ran Trivy locally against the already-built `server` image before ever
pushing the new CI workflows, specifically to avoid discovering a failing
gate only after pushing (the same "verify before you claim it works"
discipline as every prior phase). It found a real CRITICAL:
`CVE-2026-59873` (`node-tar`, denial of service via a crafted gzip bomb,
installed version 6.2.1 vs. fixed 7.5.19) plus several more HIGH findings
in `tar`, `glob`, `minimatch`, `cross-spawn`, `pacote`, and `sigstore`.

**Root cause, confirmed rather than assumed:** `docker run --rm
cicdautomation-server:latest sh -c "ls /usr/local/lib/node_modules/npm/node_modules"`
showed every one of those package names living inside npm's *own* bundled
dependency tree — not `server/package.json` (already independently
verified at 0 vulnerabilities via `npm audit` back in Phase 2). The
container's `CMD` is `node src/index.js`; it never invokes `npm` at
runtime. The entire global npm installation the base image bundles for
build-time use was shipping in the *production* image as pure attack
surface with zero functional benefit.

**Fix:** `rm -rf` npm, npx, and corepack's global install from the final
stage (`server/Dockerfile`) — before `USER app` switches away from root,
since removing files under `/usr/local` needs root. Rebuilt and rescanned:
**CRITICAL: 0.**

## Two more findings, fixed the same session

- **4 remaining HIGH findings** after the npm fix — Alpine's own
  `libcrypto3`/`libssl3` (OpenSSL) OS packages, with fixed versions
  already published upstream (`3.5.7-r0`/`3.5.8-r0`) but not yet baked
  into the `node:20-alpine`/`nginx:1.27-alpine` tags in use. Rather than
  settle for "passes the gate" with known-fixed CVEs still present, added
  `RUN apk update && apk upgrade --no-cache` to both Dockerfiles' final
  stages. Rescanned: **0 CRITICAL, 0 HIGH, on both images** — a genuinely
  clean scan, not just a passing one.
- **nginx running as root** — SonarLint flagged this live while editing
  (`docker:S6471`). Standard `nginx:alpine` runs as root by default;
  hand-patching directory permissions to make it work as non-root is
  fiddly and easy to get subtly wrong. Switched to
  `nginxinc/nginx-unprivileged:1.27-alpine` instead — a purpose-built
  variant that already runs as the `nginx` user and listens on an
  unprivileged port (8080, not 80) correctly out of the box. Updated
  `nginx.conf`'s `listen` directive and `docker-compose.yml`'s port
  mapping (`5173:8080`) to match, then verified: `docker compose exec
  client whoami` → `nginx`, not `root`.
- **`--ignore-scripts` extended to both Dockerfiles' `npm ci` calls** —
  same CI-hardening finding from Phase 2's `sonar.yml`/`ci.yml`, now
  applied here too. Safe in both cases for reasons specific to each:
  the server's Dockerfile install is `--omit=dev` (production-only), so
  `mongodb-memory-server` — the one package that actually needs its
  install script — isn't even present; the client's install already had
  `--ignore-scripts` proven safe in Phase 2 (modern esbuild ships
  prebuilt platform binaries via `optionalDependencies`, not a postinstall
  script).

## Verification performed

- Full rebuild (`docker compose build --no-cache`) of both images with
  every fix applied together — clean.
- Full stack restarted (`docker compose up -d`) — all three services
  (`mongo`, `server`, `client`) came up **healthy**, including the new
  `5173:8080` port mapping.
- Confirmed non-root at runtime for both: `docker compose exec server
  whoami` → `app`, `docker compose exec client whoami` → `nginx`.
- **Full Playwright golden-path walkthrough re-run** against the hardened
  stack (product list → detail → cart → checkout → order confirmation) —
  zero console errors, same as every prior verification pass. Hardening
  the images didn't change app behavior.
- Trivy rescan of both images, `--severity CRITICAL,HIGH`: **0 findings on
  both** — confirmed via the actual report table, not just an exit code.
- The exact CI gate command (`--severity CRITICAL --exit-code 1`) run
  locally against `cicdautomation-server:latest`: **exit code 0** — the
  gate would pass.

## Tasks accomplished

- [x] `docker-build.yml` extended with Trivy scanning (SARIF report +
      CRITICAL-severity blocking gate) on every push/PR
- [x] `docker-publish.yml` added: build → Trivy gate → GHCR push → Syft
      SBOM → keyless Cosign sign, on push to `main` only
- [x] All 5 new action SHAs verified against `git ls-remote` directly —
      caught 3 wrong SHAs from a summarizer tool before they were ever
      committed
- [x] Found and fixed a real CRITICAL CVE (npm's own bundled deps shipping
      unnecessarily in the production image) via local scan-before-push
- [x] Found and fixed 4 HIGH OpenSSL findings (`apk upgrade` in both
      Dockerfiles) — clean scan, not just a passing one
- [x] Fixed nginx running as root (switched to `nginx-unprivileged`,
      updated port mapping) — caught live by SonarLint while editing
- [x] Extended `--ignore-scripts` to both Dockerfiles' `npm ci` calls
- [x] Full local re-verification after every fix: rebuild, healthy stack,
      non-root confirmed, full golden-path walkthrough, Trivy rescan
- [ ] `docker-build.yml` and `docker-publish.yml` confirmed green on
      GitHub Actions (pushed, not yet observed)
- [ ] Image actually visible in GHCR, signed, with an attached SBOM
      (depends on the above)

## What's next (Phase 5)

GitOps deployment: Minikube + ArgoCD, pulling the signed images this phase
publishes.
