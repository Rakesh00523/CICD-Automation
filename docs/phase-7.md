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
- `k8s/manifests/server-secret.example.yaml` — template only, real secret
  created imperatively (see Scope decisions).
- Fixed an unrelated, pre-existing stray typo in
  `k8s/manifests/client.yaml` (`ty6apiVersion` → `apiVersion`) found while
  starting this phase — invalid YAML that would have broken any `kubectl
  apply`/ArgoCD sync touching that manifest; unrelated to the feature
  work itself.

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
- Client: `Login.test.jsx` (form renders), `ProtectedRoute.test.jsx`
  (redirects to `/login` when logged out, renders protected content when
  a token is present in `localStorage`) — same
  `@testing-library/react` pattern as the existing `ProductCard.test.jsx`.

## Verification performed

- `npm test` and `npm run lint` green in both `server/` (28 tests, 5
  suites) and `client/` (4 tests, 3 suites); `npm run build` in `client/`
  succeeds.
- Not yet done: building/scanning/signing/publishing the Phase 7 images
  through the existing Phase 4 pipeline, bumping the digests in
  `k8s/manifests/*.yaml`, and re-verifying the live Minikube/ArgoCD
  cluster stays `Synced`/`Healthy` end-to-end against the new feature —
  this is the natural next step once this code is pushed and the pipeline
  runs, matching how Phases 3–6 each landed code first and confirmed live
  deployment in a following commit.

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
      uncommitted), documented via an example manifest
- [x] Fixed an unrelated pre-existing YAML corruption in
      `k8s/manifests/client.yaml` found at the start of this phase
- [x] All new/updated tests green (`server`: 28/28, `client`: 4/4), both
      lints clean, client production build succeeds
- [ ] Phase 7 images built/scanned/signed/published and live cluster
      redeployed + re-verified (pending push)

## What's next (Phase 8)

Final report — write up the project end to end across all seven phases:
architecture, the pipeline itself, the real bugs found and fixed along
the way, and what a from-scratch DevSecOps pipeline looks like at zero
infrastructure cost.
