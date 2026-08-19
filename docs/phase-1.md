# Phase 1 — Foundation

## Goal

Stand up the application that the rest of the pipeline will operate on, plus
the minimal CI skeleton that proves commits are automatically built and
tested. Everything after this phase (code quality, containers, security
scanning, GitOps, observability) attaches to this foundation without
changing its shape.

## Scope decisions

- **Stack:** MERN (MongoDB, Express, React via Vite, Node.js). Chosen for
  fast iteration, a single language (JavaScript) across the stack, and clean
  containerization in Phase 3.
- **App scope (minimal but real):** product catalog, product detail page,
  client-side cart, and a *mock* checkout that validates stock/price
  server-side and creates a real order record — but does not process an
  actual payment.
- **Deferred on purpose:** user accounts (login/registration) and a fake
  payment gateway are intentionally left out of Phase 1. They're added in
  Phase 7, once the full pipeline (CI, AI review, containers, security
  scanning, GitOps, monitoring) already exists — so that adding them becomes
  a live demonstration of the pipeline reacting to a real feature change,
  not just something built before the pipeline existed.

## What was built

**Backend (`server/`)**
- Express app (`src/app.js`) separated from the process entrypoint
  (`src/index.js`) so it can be imported directly in tests without binding a
  port.
- `Product` and `Order` Mongoose models.
- REST endpoints:
  - `GET /api/products` — list products, optional `?category=` filter
  - `GET /api/products/:id` — single product
  - `POST /api/checkout` — validates cart items against live stock/price,
    decrements stock, creates an `Order`, returns a confirmation
  - `GET /health` — liveness check (used later by container/K8s health probes)
- Seed script (`src/seed/seedProducts.js`) to populate sample products.
- Unit/integration tests (`tests/`) using Jest + Supertest against an
  in-memory MongoDB (`mongodb-memory-server`) — no external database needed
  to run the test suite, including in CI.

**Frontend (`client/`)**
- React app scaffolded for Vite (not generated via `npm create vite`, since
  Node wasn't yet installed on the build machine when this was written —
  hand-written to the same structure Vite's React template produces).
- Pages: product list, product detail, cart, checkout/order confirmation.
- Cart state lives in React context, persisted to `localStorage`.
- One component test (`ProductCard.test.jsx`) using Vitest + Testing
  Library, as a template for expanding frontend test coverage later.

**CI (`.github/workflows/ci.yml`)**
- Two parallel jobs, `server` and `client`, triggered on push/PR to `main`.
- Each job: install deps (`npm ci`), lint, test, and (client only) build the
  production bundle.
- This is intentionally the *whole* CI skeleton for Phase 1 — SonarQube and
  the AI review layer attach to this same workflow in Phase 2 rather than
  replacing it.

## Environment setup performed on this machine

Node.js and Git were not present on the development machine. Installed via
`winget`:
- `OpenJS.NodeJS.LTS`
- `Git.Git`

## How to run locally

Prerequisites: Node.js LTS, Git, and a MongoDB instance (local install or a
free Atlas cluster) reachable via a connection string.

```powershell
# Backend
cd server
copy .env.example .env      # edit MONGODB_URI if needed
npm install
npm run seed                # populates sample products
npm run dev                 # http://localhost:5000

# Frontend (separate terminal)
cd client
copy .env.example .env
npm install
npm run dev                 # http://localhost:5173
```

## How to run tests

```powershell
cd server
npm test        # Jest + Supertest, in-memory MongoDB — no setup needed

cd client
npm test        # Vitest + Testing Library
```

## Verification performed

Every claim above was actually run on the dev machine, not just written:

- `npm install` succeeded in both `server/` and `client/`.
- `npm test` in `server/`: **7/7 passing** (Jest + Supertest against an
  in-memory MongoDB). Initial run hit the default 5s Jest hook timeout
  because `mongodb-memory-server` downloads a MongoDB binary on first use —
  fixed via `server/jest.config.js` (`testTimeout: 30000`).
- `npm run lint` clean in both `server/` and `client/`.
- `npm test` in `client/`: **1/1 passing** (Vitest + Testing Library).
- `npm run build` in `client/` produced a production bundle
  (`dist/`, ~217 KB JS / ~73 KB gzipped).
- Ran the real dev server against the real local MongoDB service (not the
  in-memory test DB): seeded 5 products, hit `GET /health` and
  `GET /api/products` over HTTP, then `POST /api/checkout` for 2× a $34.25
  item — got back a confirmed order with `total: 68.5`, and confirmed the
  product's `stock` dropped from 30 to 28 via a follow-up `GET`. Data was
  reseeded to a clean state afterward.

## Tasks accomplished

- [x] Repository structure (`client/`, `server/`, `docs/`, `.github/`)
- [x] Product catalog + product detail API and UI
- [x] Client-side cart
- [x] Mock checkout (server-validated, no real payment)
- [x] Backend test suite (in-memory Mongo, no external dependency) — verified passing
- [x] Frontend component test — verified passing
- [x] Basic CI workflow: install → lint → test → build, on every push/PR
- [x] Node.js, Git, and MongoDB Community Server installed on the dev machine
- [x] Local git repository initialized with the first commit
- [ ] Pushed to a GitHub remote (pending: no remote configured yet — needed
      before the CI workflow can actually run on GitHub Actions)

## What's next (Phase 2)

Integrate SonarQube static analysis and a Claude-API-powered AI review step
into this same CI workflow, so every PR gets both a code-quality report and
an AI-generated review comment.
