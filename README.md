# ShopPipe — AI-Augmented CI/CD Pipeline (Final Year Project)

A MERN-stack e-commerce application used as the vehicle for an end-to-end,
zero-cost DevSecOps pipeline: source control → CI → AI-assisted code review →
containerization → supply chain security → GitOps deployment → observability.

## Project structure

```
client/             React (Vite) storefront: product catalog, product detail, cart, mock checkout
server/             Node/Express + MongoDB API: products, checkout
docs/               One markdown document per project phase
.github/            CI/CD workflow definitions
docker-compose.yml  Local multi-service dev: mongo + server + client
k8s/                Kubernetes manifests + ArgoCD Application (GitOps deployment)
```

## Phases

| # | Phase | Status | Doc |
|---|-------|--------|-----|
| 1 | Foundation (app + basic CI) | Complete | [docs/phase-1.md](docs/phase-1.md) |
| 2 | Code Quality + AI Review (SonarCloud + Gemini API) | Complete — both verified on a live PR | [docs/phase-2.md](docs/phase-2.md) |
| 3 | Containerization (Docker) | Complete — verified locally + in CI | [docs/phase-3.md](docs/phase-3.md) |
| 4 | Supply Chain Security (Trivy, Syft, Cosign) | Complete — images signed and live in GHCR | [docs/phase-4.md](docs/phase-4.md) |
| 5 | GitOps Deployment (Minikube + ArgoCD) | Complete — deployed, self-heal verified | [docs/phase-5.md](docs/phase-5.md) |
| 6 | Observability (Prometheus + Grafana) | Complete — metrics pipeline verified end-to-end | [docs/phase-6.md](docs/phase-6.md) |
| 7 | Feature Expansion + Full Pipeline Demo (auth, fake payment) | Not started | — |
| 8 | Final Report | Not started | — |

## Local development

See [docs/phase-1.md](docs/phase-1.md) for setup and run instructions.
