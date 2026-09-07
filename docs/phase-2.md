# Phase 2 — Code Quality + AI Review

## Goal

Attach two independent review layers to every pull request against `main`,
on top of the Phase 1 CI (lint/test/build): static analysis via SonarCloud,
and an AI-generated review comment from the Claude API that specifically
targets logic errors, security issues, and anti-patterns a linter/SonarQube
rule set wouldn't catch.

## Scope decisions

- **SonarCloud, not self-hosted SonarQube.** Self-hosting SonarQube requires
  a running server (Docker), which doesn't exist yet at this point in the
  project (Docker arrives in Phase 3). SonarCloud is SonarSource's free
  hosted offering for public repos, uses the same rule engine and PR
  decoration, and needs no infrastructure — consistent with the project's
  zero-cost constraint. Fits the abstract's intent ("SonarQube") in
  substance; self-hosted SonarQube can be swapped in later without changing
  the app code, only the CI job.
- **Custom script over a pre-built "AI review" GitHub Action.** A hand-written
  script (`scripts/ai-review.mjs`) calling the Anthropic API directly, using
  only Node's built-in `fetch` (no dependencies), rather than a third-party
  marketplace action. For a project whose point is explaining *how* AI
  review works, an opaque marketplace action is a worse fit than ~130 lines
  of readable, fully-owned code.
- **Update-in-place PR comments.** The script looks for a previous AI-review
  comment (marked with an HTML comment) and PATCHes it instead of posting a
  new one on every push to a PR branch — otherwise a PR with several commits
  accumulates a growing stack of stale reviews.

## What was built

**AI review (`scripts/ai-review.mjs` + `.github/workflows/ai-review.yml`)**
- Triggers on `pull_request` (`opened`, `synchronize`, `reopened`).
- Fetches the PR's unified diff from the GitHub REST API, truncates to
  60,000 characters if needed (guards against runaway token cost on huge
  diffs).
- Sends the diff to Claude (`claude-sonnet-5` by default, overridable via
  `CLAUDE_MODEL`) with a prompt scoped specifically to logic errors,
  security vulnerabilities, and anti-patterns — explicitly told to ignore
  style issues, since lint already covers those.
- Posts the review as a PR comment, or updates its own previous comment if
  one already exists on that PR.
- Fails loudly (non-zero exit) if `ANTHROPIC_API_KEY` is missing, rather than
  silently skipping — a misconfigured secret should be visible in the
  Actions run, not swallowed.

**SonarCloud (`sonar-project.properties` + `.github/workflows/sonar.yml`)**
- Runs both test suites with coverage (`test:coverage` in both `server/`
  and `client/`) and feeds the resulting `lcov.info` files to the scanner,
  so SonarCloud reports real coverage percentages, not just static-analysis
  findings.
- Triggers on push/PR to `main`, same as the existing CI workflow, as a
  separate job so a SonarCloud outage/misconfiguration can't block the
  build/test/lint pipeline.

**Coverage tooling added to support the above**
- `server/jest.config.js`: `collectCoverageFrom`, `lcov` + `text` reporters.
- `client/vite.config.js`: Vitest `coverage` block (`@vitest/coverage-v8`
  provider), `lcov` + `text` reporters.
- `test:coverage` npm script added in both packages.

## A dependency vulnerability found and fixed along the way

Installing `@vitest/coverage-v8` surfaced 8 existing vulnerabilities in the
client's dependency tree via `npm audit` (5 moderate, 1 high, 2 critical) —
an esbuild/vite/vitest chain (`GHSA-67mh-4wv8-2f99`, dev-server-only) and a
react-router-dom advisory pair. This is exactly the kind of finding Phase 4
(Trivy) is meant to catch systematically, but since it surfaced here, it was
fixed here rather than left for later:

- A same-major patch bump (vite `5.3.4` → `5.4.21`) turned out to be a no-op
  — the installed version was already `5.4.x`-equivalent via the existing
  lockfile, and the vulnerable code path persists through the entire
  5.x/6.x/7.x line. The actual fix required vite `8.2.2` / vitest `4.1.11`
  / react-router-dom `7.18.2` — all major-version bumps (`npm audit fix
  --force`).
- Verified the major bump didn't break anything before accepting it:
  `npm run lint`, `npm run test:coverage` (still 1/1 passing, coverage
  report generated), and `npm run build` (production bundle built clean)
  all passed. Beyond that, launched both dev servers and drove the actual
  app through Playwright in a real headless Chromium — product list →
  product detail → add to cart → cart → checkout → order confirmation —
  with zero browser console errors, specifically to catch any router
  behavior change between react-router v6 and v7 that a unit test wouldn't
  surface. Screenshots confirmed real product data rendering and a correct
  order confirmation (`Total: $34.25`, cart reset to 0 after purchase).
- Result: **0 vulnerabilities** (`npm audit`).
- **This wasn't actually done yet — CI caught what local testing missed.**
  `npm audit fix --force` used `--force`, which silently accepted a peer
  dependency conflict: `@vitejs/plugin-react@4.7.0` doesn't support vite 8.
  `npm install` tolerates that (with a warning); `npm ci` — what the CI
  workflow actually runs — does not, and fails hard on it. Local testing
  used `npm install`, so this passed locally and only surfaced when GitHub
  Actions ran `npm ci` and the client job failed. Fixed by bumping
  `@vitejs/plugin-react` to `^6.1.0`, the first major version whose
  `peerDependencies` explicitly declare `vite: ^8.0.0`. Re-verified with a
  from-scratch `npm ci` locally (matching CI exactly), plus lint, coverage
  tests, build, and a second full Playwright walkthrough — all clean, and
  the earlier esbuild-deprecation warnings from the mismatched plugin are
  gone too.
- **Lesson applied going forward:** verify dependency changes with `npm ci`
  (not `npm install`) before treating them as done, since that's what CI
  actually runs and the two can silently disagree.

## Verification performed

- `server/npm run test:coverage`: 7/7 tests passing, `coverage/lcov.info`
  generated.
- `client/npm run test:coverage`: 1/1 passing, coverage report generated,
  100% on the one covered component.
- `client/npm run lint`, `npm run build`: clean.
- `scripts/ai-review.mjs`: syntax-checked (`node --check`), and its control
  flow verified against a stubbed `fetch` (no real API calls, since no
  `ANTHROPIC_API_KEY`/PR exists yet to test against for real) — confirmed
  it (a) fetches the diff, (b) calls the Claude API with it, (c) posts a
  new comment when none exists, and (d) PATCHes its existing comment
  instead of duplicating one on a second run for the same PR.
- **Not yet verified end-to-end**: an actual SonarCloud scan, and an actual
  Claude-generated review comment on a real PR. Both require account-level
  setup only the repo owner can do (see below) — this is the honest state,
  not a completed one, until that setup happens and a real PR is opened.

## SonarCloud went live — what it actually found

The repo owner completed the SonarCloud signup, imported the project
(`Rakesh00523_CICD-Automation` under org `rakesh00523`, both matching the
guessed defaults in `sonar-project.properties`), and added `SONAR_TOKEN`.
The very first real analysis surfaced genuine, actionable findings rather
than noise:

**A BLOCKER-severity SQL/NoSQL injection (fixed).**
`server/src/controllers/productController.js` built a Mongoose filter
directly from `req.query.category`:
`const filter = category ? { category } : {};`. Express's default query
parser (`qs`) turns `?category[$ne]=null` into
`{ category: { $ne: null } }` — an object, not a string — which Mongoose
then executes as a real MongoDB query operator instead of a literal value
match. Fixed by requiring `category` to actually be a string before using
it:
```js
const filter = {};
if (typeof category === 'string' && category.trim()) {
  filter.category = category;
}
```
Added a regression test (`server/tests/products.test.js`) that seeds two
products in different categories and requests
`?category[$ne]=Visible`: on the vulnerable code this returns only the
"Hidden" product (the `$ne` operator actually executes), on the fixed code
it returns both (the operator object is rejected and the filter is
dropped). **Verified the test has real teeth** — temporarily reverted the
fix and confirmed the test fails with exactly the predicted vulnerable
behavior, then restored the fix and confirmed it passes again.

**CI hardening findings — fixed where safe, deliberately not where unsafe.**
Sonar flagged four `npm ci` steps (in `ci.yml` and `sonar.yml`, one per
client/server pair) for omitting `--ignore-scripts` (lets install-time
lifecycle scripts run arbitrary code) and one action reference
(`SonarSource/sonarqube-scan-action@v4`) for not being pinned to a full
commit SHA.
- **Action pinned to a full SHA** — and in the process discovered `@v4` was
  several major versions stale (current is v8); this was almost certainly
  the actual cause of the SonarCloud Scan CI *step* reporting failure even
  though the *analysis itself* successfully reached the SonarCloud
  dashboard (its own "Quality Gate not computed" check reported `neutral`,
  not `failure` — the two disagreeing was the tell). Upgraded to
  `@22918119ff8e1ca75a623e15c8296b6ea4fbe28f # v8.2.1`, verified the
  env-var-based `SONAR_TOKEN`/`GITHUB_TOKEN` interface is unchanged in v8.
- **`--ignore-scripts` added to both client `npm ci` steps** — verified
  safe first: ran `npm ci --ignore-scripts` + full build + test in an
  isolated copy, all clean (modern esbuild ships prebuilt platform
  binaries via `optionalDependencies`, not a postinstall script).
- **`--ignore-scripts` deliberately NOT added to either server `npm ci`
  step** — tested it the same way first, and it broke every test:
  `mongodb-memory-server`'s install script is what fetches the MongoDB
  binary the test suite connects to; skipping it makes every test time out
  trying to reach a database that was never downloaded. Left as plain
  `npm ci` with a comment explaining why, rather than silently ignoring the
  finding or blindly applying it and breaking CI.

**A vulnerability found, investigated, and consciously deferred.**
`npm audit` on `server/` found 3 moderate vulnerabilities in `qs` (via
`body-parser`/`express`) — a DoS and an array-limit bypass. Unlike the
client-side vite/vitest case in Phase 2's earlier work, `npm audit fix`
(no `--force`) was a genuine no-op here: `qs@6.15.3` is already the newest
version `express@4.x`'s `body-parser` will accept: the real fix needs
Express 5, a major version with real breaking-change surface (async error
handling, route-matching behavior). Given the severity is moderate (not
blocker/critical) and an unreviewed Express major-version migration is
exactly the kind of large, risky change that shouldn't happen as a side
effect of chasing a CI lint finding, this was **not** applied now. Tracked
here to be picked up deliberately, likely alongside Phase 4's Trivy work.

**Coverage wasn't reaching SonarCloud — root cause found and fixed.**
The dashboard showed "a few extra steps are needed" despite `sonar.yml`
running both `test:coverage` scripts and `sonar-project.properties`
pointing at both `lcov.info` paths. Inspected the actual generated files:
Jest/Vitest write `SF:` (source file) entries relative to each package
(e.g. `SF:src/app.js`, since that's the cwd they ran from), but
`sonar.sources` is repo-root-relative (`server/src`, `client/src`) — the
paths never matched, so SonarCloud silently had zero coverage to attach to
any file. Fixed with a `sed` step in `sonar.yml` that prefixes each
package's `lcov.info` (`SF:` → `SF:server/` / `SF:client/`) right after the
coverage tests run, so the paths line up with `sonar.sources` before the
scan step reads them.

## Manual setup required (cannot be done by an agent)

One external secret is still outstanding:

1. ~~SonarCloud~~ — **done.** Project imported, `SONAR_TOKEN` added, real
   analysis running (see above).
2. **Anthropic API key** — still needed:
   - Create an API key at [console.anthropic.com](https://console.anthropic.com).
   - Add it as a GitHub Actions secret named `ANTHROPIC_API_KEY` (repo
     Settings → Secrets and variables → Actions).

Once that's added, open any PR against `main` to see the AI review comment
appear.

## Tasks accomplished

- [x] SonarCloud config (`sonar-project.properties`) and CI job
- [x] Coverage reporting wired up in both `server/` and `client/` test suites
- [x] Custom Claude API PR-review script + CI job
- [x] Update-in-place comment logic (no duplicate reviews per PR)
- [x] Found and fixed 8 dependency vulnerabilities (0 remaining) surfaced
      while adding the coverage tooling
- [x] Verified the major dependency bump didn't break the app — real
      browser walkthrough of the full golden path, zero console errors
- [x] Control-flow of the AI review script verified against a stubbed API
- [x] SonarCloud project imported, token configured, real analysis running
- [x] Fixed a real BLOCKER-severity NoSQL injection SonarCloud found, with
      a regression test verified against both the vulnerable and fixed code
- [x] Fixed 2 of 5 CI-hardening findings (`--ignore-scripts` on client
      installs); the other 3 (server installs, and the vite/vitest peer
      warning noted earlier) deliberately left with documented rationale
- [x] Pinned the SonarCloud scan action to a full commit SHA and updated
      it off a 4-major-version-stale tag
- [x] Investigated a 3-vulnerability `qs`/Express finding; consciously
      deferred (needs an Express 5 migration) rather than force a risky
      unreviewed major bump
- [x] Diagnosed and fixed coverage data not reaching SonarCloud (lcov
      `SF:` paths were package-relative, `sonar.sources` is repo-root-
      relative — rewritten with `sed` before the scan step)
- [ ] Real Claude-generated review comment on a live PR (blocked on
      `ANTHROPIC_API_KEY` secret)

## What's next (Phase 3)

Containerize `client/` and `server/` with Docker, add a `docker-compose.yml`
for local multi-service development, and extend CI to build (and eventually
push) images.
