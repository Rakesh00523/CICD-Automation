# Phase 7 — Feature Expansion: Auth + Fake Payment Gateway

## Goal

Add a real feature — login/registration and a fake payment gateway — to
the app the rest of the pipeline (Phases 1–6) already builds, scans,
signs, and deploys, and use it as a live demonstration of the whole
system reacting to a genuine change: new dependencies through the
existing Trivy/SBOM gate, a new manifest + secret through GitOps, a
protected route and a decline path with real tests behind them, not just
another CRUD field.

## Scope decisions

- **JWT in `localStorage`**, not an httpOnly cookie. Consistent with the
  existing `CartContext` localStorage pattern, and avoids `credentials:
  true` CORS/SameSite/secure-flag complexity on a cluster with no TLS
  ingress in front of it. Standard, acknowledged tradeoff for a demo app:
  vulnerable to XSS token theft in a way a cookie wouldn't be.
- **Checkout requires login.** It's a protected route now
  (`ProtectedRoute` redirects to `/login`, preserving the intended
  destination). Every order is tied to a `user`. This is the point of the
  phase: auth actually gates something, not just a form bolted on the
  side.
- **Fake payment gateway with deterministic test-card rules**
  (`server/src/services/paymentGateway.js`), reusing Stripe's published
  test-card numbers rather than inventing arbitrary ones: `4242 4242 4242
  4242` always approves, `4000 0000 0000 0002` / `...0069` always decline
  (insufficient funds / expired card) with a simulated latency and card
  shape validation ahead of the decline check. Reproducible and
  recognizable, not a coin flip — the decline path is exercised by a real
  test, not just eyeballed once in the browser.
- **Charge before touching stock**, in `checkoutController.js`. A decline
  must leave stock and the order collection exactly as they were — tested
  directly (`checkout.test.js`: declining card leaves stock untouched, 0
  orders created).
- **`bcryptjs` over `bcrypt`.** Pure JS, no native build step to carry
  through the Docker image / CI cache, at the cost of being somewhat
  slower — an acceptable trade for a demo app's load.
- **`JWT_SECRET` via a Kubernetes `Secret`, created imperatively, not
  committed.** Everything else in `k8s/manifests` is a plain env value
  today (even `MONGODB_URI`), but a signing secret is different in kind —
  committing it would let anyone who can read the repo forge tokens.
  `k8s/manifests/server-secret.example.yaml` documents the shape and the
  exact `kubectl create secret` command; the real secret is never in git,
  same reasoning already applied elsewhere in this project to real
  credentials.

## What was built

**Server**
- `src/models/User.js` — email + bcrypt password hash.
- `src/models/Order.js` — added `user` (ref) and `payment` (transaction
  id + last 4) fields.
- `src/services/paymentGateway.js` — the fake gateway, unit-tested in
  isolation.
- `src/middleware/auth.js` — `requireAuth`, verifies a bearer JWT.
- `src/controllers/authController.js` + `src/routes/auth.js` —
  `POST /api/auth/register`, `POST /api/auth/login`.
- `src/controllers/orderController.js` + `src/routes/orders.js` —
  `GET /api/orders/me`, so a logged-in user can see their own order
  history — completes the demo loop (register → login → shop → pay → see
  your order).
- `src/controllers/checkoutController.js` — now behind `requireAuth`,
  charges through the fake gateway before decrementing stock, links the
  created order to `req.user`.

**Client**
- `src/context/AuthContext.jsx` — localStorage-backed auth state, mirrors
  `CartContext`'s existing pattern.
- `src/api.js` — a request interceptor attaches the bearer token to every
  call; added `registerUser`, `loginUser`, `fetchMyOrders`.
- `src/pages/Login.jsx`, `src/pages/Register.jsx`,
  `src/components/ProtectedRoute.jsx`, `src/pages/OrderHistory.jsx`.
- `src/pages/Checkout.jsx` — card number/expiry/CVC fields added to the
  existing review-and-place-order flow; the notice line now documents the
  test cards instead of "no real payment is processed"; a 402 decline
  surfaces the gateway's reason.
- `src/components/Navbar.jsx` — login/register when logged out; email,
  an Orders link, and logout when logged in.

**Kubernetes**
- `k8s/manifests/server.yaml` — `JWT_SECRET` sourced from a
  `secretKeyRef` (`shoppipe-secrets` / `jwt-secret`).
- `k8s/server-secret.example.yaml` — template only, real secret created
  imperatively (see Scope decisions and the bug below for exactly why it
  lives here and not under `k8s/manifests/`).
- Fixed an unrelated, pre-existing stray typo in
  `k8s/manifests/client.yaml` (`ty6apiVersion` → `apiVersion`) found while
  starting this phase — invalid YAML that would have broken any `kubectl
  apply`/ArgoCD sync touching that manifest; unrelated to the feature
  work itself.

## A real bug found during live redeployment — the example Secret got applied for real

The first version of the secret template lived at
`k8s/manifests/server-secret.example.yaml`, commented "NOT applied
automatically and NOT read by ArgoCD." That comment was wrong. The
`shoppipe` ArgoCD `Application`'s source is `path: k8s/manifests` with no
include/exclude filter — it applies *everything* in that directory, no
exceptions for filenames that say "example." Confirmed live: after
`minikube start` brought the cluster back and ArgoCD's controller
resynced, `kubectl get secret shoppipe-secrets -n shoppipe -o yaml` showed
a real Secret object, tracked by ArgoCD, whose `jwt-secret` value was the
literal placeholder string committed in the file — a real signing key,
publicly readable in the git history, sitting live in the cluster.

Caught before any real exposure: `server.yaml`'s `JWT_SECRET` env var
(pointing at this Secret) hadn't been pushed yet, so nothing had actually
signed a token with it. Fixed properly, not just re-worded: moved the
template to `k8s/server-secret.example.yaml` — one directory up, outside
the `shoppipe` Application's synced path entirely — deleted the bad live
Secret, and created the real one imperatively with a fresh
cryptographically random value. The general lesson, worth stating plainly
since it'll recur: **in a directory-sourced ArgoCD Application, every file
in that directory is live infrastructure, regardless of what its name or
a comment claims** — filtering has to be structural (a different
directory, an explicit include/exclude on the source), not a comment.

## Tests

- `server/tests/auth.test.js` — register validation (bad email, short
  password, duplicate email), login (wrong password, unknown email,
  success returns a token that actually authenticates a protected route).
- `server/tests/paymentGateway.test.js` — approves the success test card;
  declines both decline test cards with the right reason; rejects
  malformed card number/expiry/CVC before any decline logic runs.
- `server/tests/checkout.test.js` — updated every existing case to
  register/login and send a valid `payment` block; added: 401 with no
  token, 400 with no payment block, 402 on a decline card with stock and
  order count unchanged, and a new assertion that the confirmed order's
  `user` and `payment.cardLast4` are populated correctly.
- Client: `Login.test.jsx`, `Register.test.jsx` (success redirects,
  server error surfaced), `OrderHistory.test.jsx` (empty/populated/error
  states), `Navbar.test.jsx` (logged-out vs logged-in rendering, logout
  clears storage), `Checkout.test.jsx` (empty cart, successful payment +
  confirmation, 402 decline surfaced), `ProtectedRoute.test.jsx`
  (redirects when logged out, renders through when a token is present),
  `api.test.js` (every wrapper function, plus the auth interceptor's
  token-attach/absent/corrupt-storage branches, by spying on the axios
  instance directly) — same `@testing-library/react` pattern as the
  existing `ProductCard.test.jsx`.

## Verification performed

- `npm test` and `npm run lint` green in both `server/` (28 tests, 5
  suites) and `client/` (27 tests, 8 suites); `npm run build` in
  `client/` succeeds.
- **Pipeline, end to end on real pushes**: CI, Docker Build, Docker
  Publish, and SonarCloud all green on the final commit. Two genuine
  issues turned up and were fixed with substance, not suppressed:
  - SonarCloud's quality gate failed for real reasons on the first pass:
    `Math.random()` building the fake gateway's `transactionId`, flagged
    as an insecure PRNG for a security-sensitive value
    (`javascript:S2245`) — fixed with `crypto.randomUUID()`. And
    `new_coverage` at 72.5% against an 80% gate, because several new
    client files (`api.js`, `AuthContext.jsx`, the new pages, `Navbar.jsx`,
    `ProtectedRoute.jsx`) had no test at all touching them — not partial
    coverage, absent from the lcov report entirely. Closed with the real
    tests listed above, not filler: client coverage went from 51.89% to
    90.16% statements, and the gate's `new_coverage` metric hit 95.0%.
  - A SonarCloud scanner run failed with an `Error 500` from SonarCloud's
    own API mid-scan — transient, resolved by re-running the job; not a
    code issue.
- **Live redeploy against the Minikube/ArgoCD cluster from Phases 5/6**,
  after cosign-verifying both new digests against GHCR:
  `shoppipe` Application reached `Synced`/`Healthy` on both server and
  client pods running the new images. A real bug turned up during this
  step — see below — caught and fixed before it mattered.
  End-to-end against the live cluster (not mocked, not local): register
  → login → unauthenticated checkout (401) → checkout with the decline
  test card (402, stock/orders untouched) → checkout with the success
  test card (201, stock genuinely decremented — confirmed via
  `GET /api/products/:id`) → `GET /api/orders/me` returns the confirmed
  order. All five checks passed.

## Tasks accomplished

- [x] User model, bcrypt password hashing, JWT issuing/verification
- [x] Register/login endpoints with input validation and duplicate-email
      handling
- [x] Fake payment gateway with deterministic Stripe-style test cards,
      unit-tested independently of the checkout flow
- [x] Checkout protected by auth, charges before touching stock, declines
      leave stock/orders untouched (tested directly)
- [x] Order history endpoint and page
- [x] Client auth context, protected routes, login/register/checkout/
      order-history pages, updated navbar
- [x] `JWT_SECRET` wired through a Kubernetes Secret (imperative,
      uncommitted), documented via an example manifest kept outside the
      ArgoCD-synced directory
- [x] Fixed an unrelated pre-existing YAML corruption in
      `k8s/manifests/client.yaml` found at the start of this phase
- [x] All new/updated tests green (`server`: 28/28, `client`: 27/27), both
      lints clean, client production build succeeds
- [x] Fixed a real SonarCloud-flagged insecure-PRNG issue and closed a
      genuine client test-coverage gap; quality gate green
- [x] Phase 7 images built, Trivy-scanned, Cosign-signed, and published
      via the existing pipeline; digests re-verified locally with
      `cosign verify` before bumping the manifests
- [x] Found and fixed a real bug during live redeploy: an "example"
      secret template got applied for real by ArgoCD; relocated
      structurally, bad live Secret replaced with a proper random one
- [x] Live cluster redeployed and re-verified end to end: register,
      login, unauthenticated-checkout rejection, decline-card rejection,
      success-card checkout with a genuine stock decrement, and order
      history — all confirmed directly against the running cluster

## What's next (Phase 8)

Final report — write up the project end to end across all seven phases:
architecture, the pipeline itself, the real bugs found and fixed along
the way, and what a from-scratch DevSecOps pipeline looks like at zero
infrastructure cost.
