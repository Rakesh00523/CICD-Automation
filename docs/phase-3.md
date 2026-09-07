# Phase 3 — Containerization

## Goal

Package `client/` and `server/` as Docker images, wire them together with
`docker-compose.yml` for local multi-service development, and add a CI job
that builds both images on every push/PR — proving the Dockerfiles actually
work, not just that they parse.

## Scope decisions

- **Build-only in CI for now, no registry push.** `docker-build.yml` builds
  both images to catch a broken Dockerfile early, but doesn't push anywhere.
  Pushing to a registry belongs with Phase 4 (Trivy scan → Syft SBOM →
  Cosign sign → push), so an image is only published once it's been
  scanned and signed — not before.
- **Alpine base images.** `node:20-alpine` for both the server runtime and
  the client's build stage, `nginx:1.27-alpine` to serve the client's
  static build. None of the app's dependencies need native compilation, so
  there's no reason to carry a full Debian base's extra surface area/size.
- **Multi-stage builds, non-root runtime.** Server: a `deps` stage installs
  only production dependencies (`npm ci --omit=dev`), copied into a final
  stage that runs as a created non-root user. Client: a `build` stage runs
  Vite, and only the resulting `dist/` output — not `node_modules` or
  source — ships in the final `nginx:alpine` image.
- **Vite env vars as a build ARG, not a compose `environment:` entry.**
  Vite bakes `VITE_*` variables into the bundle at build time; they don't
  exist at container runtime the way a server's env vars do. `VITE_API_BASE_URL`
  is passed via `docker-compose.yml`'s `build.args`, and defaults to
  `http://localhost:5000/api` — the browser (not the container) is what
  actually calls this URL, so it must be something the *host machine* can
  reach, not the Docker-internal service name `server`.
- **nginx SPA fallback.** `client/nginx.conf` routes every unmatched path to
  `index.html` (`try_files $uri $uri/ /index.html`) — without this, a
  direct browser load of e.g. `/products/64f...` (a React Router client-side
  route, not a real file) would 404 instead of rendering the app shell.

## What was built

- `server/Dockerfile`, `server/.dockerignore`
- `client/Dockerfile`, `client/.dockerignore`, `client/nginx.conf`
- `docker-compose.yml` — `mongo` (official image, named volume for
  persistence, healthcheck via `mongosh ping`), `server` (waits for
  Mongo's healthcheck before starting), `client` (nginx on port 5173→80)
- `.github/workflows/docker-build.yml` — matrix build of both images on
  push/PR to `main`, using GitHub Actions' layer cache
  (`cache-from`/`cache-to: type=gha`) so rebuilds are fast
- Both new workflow actions (`docker/setup-buildx-action`,
  `docker/build-push-action`) pinned to a full commit SHA from the start,
  applying the lesson from Phase 2's SonarCloud action — checked their
  actual latest tags first (v4.3.0 / v7.3.0) rather than guessing a
  version and risking the same stale-major-tag mistake twice.

## Verification performed

- All new/changed YAML (`docker-build.yml`, `docker-compose.yml`)
  syntax-validated with `js-yaml`.
- `docker/build-push-action@v7.3.0`'s input interface (`context`, `push`,
  `tags`, `cache-from`, `cache-to`) confirmed unchanged from v6 directly
  against the action's `action.yml`, since it was a major-version jump.
- **Not yet verified**: actually building or running any of these images.
  Docker Desktop isn't installed on this machine yet (needs WSL2, which
  needs a reboot to install) — this is the honest state, matching how
  Phase 1 was written before Node.js existed on the machine. Once Docker
  is available: build both images, run `docker compose up`, and repeat
  the Playwright golden-path walkthrough from Phase 2 against the
  containerized app instead of the local dev servers.

## Tasks accomplished

- [x] Server Dockerfile (multi-stage, non-root, healthcheck)
- [x] Client Dockerfile (multi-stage, nginx, SPA routing, build-time env)
- [x] `docker-compose.yml` for local 3-service development
- [x] CI job to build both images on push/PR
- [x] New CI actions pinned to a checked (not guessed) current commit SHA
- [ ] Docker Desktop installed on the dev machine (blocked on a WSL2
      install + reboot the user needs to do manually)
- [ ] Images actually built and run locally
- [ ] Full app walkthrough verified against the containerized version
- [ ] `docker-build.yml` confirmed green on GitHub Actions

## What's next (Phase 4)

Supply chain security: Trivy vulnerability scanning, Syft SBOM generation,
and Cosign image signing — then, only after all three pass, push the
images to a registry (GitHub Container Registry).
