# powerapps-eval

Build-vs-buy evaluation of Microsoft Power Apps for a fintech's internal tooling: a research brief, plus a working prototype of the "build" option, a shared internal-tools platform with three apps.

> **Prototype, not a production system.** Login is mocked, all people, customers and SSNs are fictional, and the controls shown are design demonstrations, not a certified compliance implementation. The company scenario is illustrative: the figures are representative and don't describe any specific company.

## The question

A growth-stage fintech with about 60 engineers spends about $250K/yr on Power Apps to run three internal apps: a KYC review queue, a refunds dashboard and a feature-flag admin panel. About 10 more are planned. Should it keep Power Apps or build its own internal-tools platform?

## Docs

- [`docs/research.md`](docs/research.md): what the spend likely covers, Dataverse vs external data, governance, the compliance and audit features a rebuild must replicate, and rebuild effort.
- [`docs/production-plan.md`](docs/production-plan.md): what it takes to go from this prototype to production, with team-only and agent-assisted estimates.

Key findings:
- **The $250K isn't licenses for 60 engineers** (those are about $14K/yr). The line items decide the economics.
- **Power Apps' value is the compliance scaffolding, not the screens:** Dataverse audit history, row/field permissions, masking and approvals. That only applies when data lives in Dataverse with auditing switched on (off by default, 30-day retention).
- **KYC is a template, not an exception.** How many of the planned apps touch PII, money movement or regulatory decisions drives the case for building.

## The prototype

A shared platform with apps as modules:

- **Landing page:** a tile, with live numbers, for each app the person has a role in. Other apps show as locked, and a "Build your own app" placeholder marks where self-service app creation would go.
- **Per-app roles:** one role per person per app, checked by every app's API on each request (`requireApp`), plus one permission function per app shared by the API and UI.
- **Access Admin:** grant, change or revoke roles with a required reason. Every change is audited, admins can't change their own access, and an access-review CSV is available.
- **Audit Center:** one append-only, hash-chained log across all apps, with chain verification and CSV export.
- **Minimal data in lists:** shortened customer names, no date of birth, country or SSN. Every list load is logged.

| App | What it demonstrates | App-specific lines |
|---|---|---|
| KYC Review | Four-eyes approval on high-risk cases, SSN masked with logged reveals, row-level access, executive dashboard with drill-downs | ~1,800 |
| Refunds | Maker-checker, two approvers over $1,000, no over-refunding, idempotent mock processor | ~650 |
| Feature Flags | Critical production changes need a second release manager | ~390 |
| Audit Center, Access Admin | Platform screens | ~310 |
| **Shared platform** | Mock login, app registry, roles, audit, write path, shell | ~1,400 |

Each new app reuses the shell, access checks, audit log and approval patterns, so app-specific code fell from KYC to Refunds to Flags.

**Mocked or out of scope:** Entra ID login, Postgres with row-level security, write-once audit archive and retention, the KYC vendor, Stripe, deployment. See the production plan.

## Run it

Requires Node 22 (`.nvmrc`) and pnpm 9 (`corepack enable`).

```sh
pnpm install
pnpm dev          # API on :3001 (seeds the database on first run), web on :5173
pnpm test         # API tests: permissions, approvals, audit integrity, masking
pnpm seed         # reset the database to the seed data
pnpm --filter @kyc/web test:ui   # layout check: every app view at 1600/1280/900/700px
                                 # (first run: pnpm --filter @kyc/web exec playwright install chromium)
```

Open http://localhost:5173 and switch people from the user menu (top right):

| Person | Access |
|---|---|
| Taylor Brooks | KYC compliance admin, Audit Center, read-only Refunds and Flags |
| Alex Rivera, Bea Okafor | KYC analysts (Alex is also a refunds agent) |
| Sam Chen, Riley Park | KYC senior reviewers (Sam is also a refund approver) |
| Casey Morgan | KYC compliance admin, Audit Center |
| Jordan Lee | Refunds agent only |
| Morgan Diaz | Refunds finance manager |
| Dev Patel, Priya Shah | Flags editor, release manager |
| Avery Kim, Quinn Fox | Access admins (Avery also has Audit Center) |

**Try:** Alex approves a high-risk KYC case → it waits for a second approver → Sam approves it → Casey verifies the audit chain. Or have Avery grant Jordan a role and watch it appear in the Audit Center.

## Layout

```
apps/api/src/platform   auth, roles, access admin, audit log, shared write path
apps/api/src/apps       kyc, refunds, flags: schema, seed, routes, rules
apps/web/src/shell      shared app shell (header, nav, user menu)
apps/web/src/platform   landing page
apps/web/src/apps       kyc, refunds, flags, access, audit screens
apps/web/e2e            responsive layout check (Playwright)
packages/shared         types, app registry, role definitions and permission checks used by API and UI
docs/                   research brief, production plan
```

## How this was built

Built end to end by [Devin](https://devin.ai) in one evening session, steered by one person: research, prototype, tests, UI review and fixes. About 2 hours of wall-clock time and about $11 of usage (observed mid-session, not a final billing figure). The [pull requests](https://github.com/anazeneli/powerapps-eval/pulls?q=is%3Apr+is%3Aclosed) show the sequence, from research brief to the three-app platform.

## License

[MIT](LICENSE)
