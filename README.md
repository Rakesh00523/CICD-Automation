# ShopPipe — AI-Augmented CI/CD Pipeline (Final Year Project)

A MERN-stack e-commerce application used as the vehicle for an end-to-end,
zero-cost DevSecOps pipeline: source control → CI → AI-assisted code review →
containerization → supply chain security → GitOps deployment → observability.

## Project structure

```
client/   React (Vite) storefront: product catalog, product detail, cart, mock checkout
server/   Node/Express + MongoDB API: products, checkout
docs/     One markdown document per project phase
.github/  CI/CD workflow definitions
```

## Phases

| # | Phase | Status | Doc |
|---|-------|--------|-----|
| 1 | Foundation (app + basic CI) | In progress | [docs/phase-1.md](docs/phase-1.md) |
| 2 | Code Quality + AI Review (SonarQube + Claude API) | Not started | — |
| 3 | Containerization (Docker) | Not started | — |
| 4 | Supply Chain Security (Trivy, Syft, Cosign) | Not started | — |
| 5 | GitOps Deployment (Minikube + ArgoCD) | Not started | — |
| 6 | Observability (Prometheus + Grafana) | Not started | — |
| 7 | Feature Expansion + Full Pipeline Demo (auth, fake payment) | Not started | — |
| 8 | Final Report | Not started | — |

## Local development

See [docs/phase-1.md](docs/phase-1.md) for setup and run instructions.
