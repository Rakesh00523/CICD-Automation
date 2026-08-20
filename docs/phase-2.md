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
- Result: **0 vulnerabilities** (`npm audit`), confirmed working end-to-end.
- One remaining non-fatal warning: `@vitejs/plugin-react@4.7.0`'s declared
  peer range doesn't yet officially list vite 8; everything tested clean
  regardless. Worth revisiting when `@vitejs/plugin-react` cuts a release
  that explicitly supports vite 8.

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

## Manual setup required (cannot be done by an agent)

Two external accounts/secrets need to be configured by the repo owner:

1. **SonarCloud**
   - Sign in at [sonarcloud.io](https://sonarcloud.io) with the GitHub
     account, import `Rakesh00523/CICD-Automation` as a new project.
   - Confirm the generated **Organization Key** and **Project Key** match
     `sonar.organization` / `sonar.projectKey` in `sonar-project.properties`
     — SonarCloud sometimes appends a suffix; adjust the file if so.
   - Generate a token (My Account → Security) and add it as a GitHub Actions
     secret named `SONAR_TOKEN` (repo Settings → Secrets and variables →
     Actions).
2. **Anthropic API key**
   - Create an API key at [console.anthropic.com](https://console.anthropic.com).
   - Add it as a GitHub Actions secret named `ANTHROPIC_API_KEY`.

Once both secrets exist, open any PR against `main` — both workflows will
run automatically, and their results (SonarCloud check + AI review comment)
should be visible directly on the PR.

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
- [ ] Real SonarCloud scan on a live PR (blocked on manual account setup)
- [ ] Real Claude-generated review comment on a live PR (blocked on manual
      secret setup)

## What's next (Phase 3)

Containerize `client/` and `server/` with Docker, add a `docker-compose.yml`
for local multi-service development, and extend CI to build (and eventually
push) images.
