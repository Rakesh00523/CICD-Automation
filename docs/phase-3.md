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
- `docker-build.yml` confirmed **green on GitHub Actions** — both images
  build successfully on GitHub's runners (which have Docker preinstalled),
  even before Docker existed on the dev machine.

## Docker Desktop installed — full local verification

Once Docker Desktop (with the WSL2 backend) was installed and running:

- `docker compose build`: both images built clean.
- `docker compose up -d`: all three services (`mongo`, `server`, `client`)
  came up and reported **`healthy`** on their Docker healthchecks —
  including `server` correctly waiting on Mongo's healthcheck via
  `depends_on: condition: service_healthy` before starting.
- Seeded the containerized database (`docker compose exec server node
  src/seed/seedProducts.js`), then hit `GET /health` and
  `GET /api/products` over HTTP against the containerized server — real
  data, correct responses.
- **Full Playwright golden-path walkthrough repeated against the
  containerized stack** (not the local dev servers): product list →
  product detail → add to cart → cart → checkout → order confirmation,
  against `http://localhost:5173` (nginx serving the Vite production
  build) talking to the containerized server and MongoDB. Zero browser
  console errors. Screenshots confirmed real product data and a correct
  order confirmation (`Total: $34.25`). This specifically exercised the
  nginx SPA-fallback config (`try_files ... /index.html`) — client-side
  route navigation worked, proving that config is actually correct and
  not just plausible-looking.
- Confirmed the server container actually runs as the non-root `app`
  user (`docker compose exec server whoami` → `app`), not root.
- Image sizes: `cicdautomation-client` 73.9MB, `cicdautomation-server`
  217MB — both Alpine-based as intended.
- Reseeded the database back to a clean state after the smoke-test
  purchase decremented stock.

## Tasks accomplished

- [x] Server Dockerfile (multi-stage, non-root, healthcheck)
- [x] Client Dockerfile (multi-stage, nginx, SPA routing, build-time env)
- [x] `docker-compose.yml` for local 3-service development
- [x] CI job to build both images on push/PR
- [x] New CI actions pinned to a checked (not guessed) current commit SHA
- [x] `docker-build.yml` confirmed green on GitHub Actions
- [x] Docker Desktop installed on the dev machine (WSL2 backend)
- [x] Both images built and the full stack run locally via
      `docker compose up` — all three services healthy
- [x] Full Playwright walkthrough verified against the containerized app,
      zero console errors, including the nginx SPA-routing fallback
- [x] Non-root server user confirmed at runtime, not just in the Dockerfile

## How to run with Docker

Alternative to the manual `npm install` setup in
[docs/phase-1.md](phase-1.md) — no local Node.js or MongoDB install needed,
just Docker Desktop.

```powershell
docker compose up -d --build      # builds (first run) and starts all 3 services
docker compose exec server node src/seed/seedProducts.js   # populate sample products
```

- App: http://localhost:5173
- API: http://localhost:5000/api/products
- MongoDB: exposed on `localhost:27017` if you want to connect with Compass

```powershell
docker compose ps                 # check status/health of all services
docker compose logs -f server     # tail a service's logs
docker compose down               # stop everything (add -v to also wipe the mongo volume)
```

## What's next (Phase 4)

Supply chain security: Trivy vulnerability scanning, Syft SBOM generation,
and Cosign image signing — then, only after all three pass, push the
images to a registry (GitHub Container Registry).
