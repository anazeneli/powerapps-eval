# powerapps-eval

Build-vs-buy evaluation of Microsoft Power Apps for a fintech's internal tooling. The repo has the research and a working prototype of the "build" option.

## Problem scope

A Series C fintech's VP of Engineering is deciding whether to **keep Microsoft Power Apps** for internal tools or **build an in-house internal-tools platform**.

- **Spend:** about **$250K/yr** on Power Apps. It's unclear how much is licenses vs. capacity, add-ons or people/partner time.
- **Team:** about **60 engineers**. The number of non-engineer users (ops, compliance, support, finance) is unknown.
- **Apps today (3):** a **KYC review queue**, a **refunds dashboard**, and a **feature-flag admin panel**.
- **Plan:** about **10 more** internal apps.

Questions the evaluation answers:

1. Why does a fintech at this stage use Power Apps, and what does it give technical and non-technical stakeholders?
2. What's inside the $250K, and what are the hidden costs?
3. For each of the 3 apps, what value does Power Apps provide, and what compliance and audit features would a rebuild have to replicate?
4. How hard is a rebuild, and what would it look like?

## Initial hypothesis

> At about $250K/yr, Power Apps may cost more than it's worth for a 60-engineer team running 3 internal apps. With 10 more apps coming, an in-house platform might be cheaper and easier for the team to maintain, *if* the compliance and audit controls Power Apps provides can be rebuilt at reasonable cost.

What the research changed or sharpened (details in [`docs/research.md`](docs/research.md)):

- **The $250K isn't licenses for the 60 engineers.** Those cost about $14K a year. The rest is likely non-engineer seats, Dataverse storage and add-ons, Power Automate, or partner/staff time. The line items decide the economics.
- **The real value is the compliance scaffolding, not the screens.** Power Apps' database (Dataverse) provides field-level audit history, row- and field-level permissions, SSN masking and approvals. These only apply if the apps store data in Dataverse **with auditing switched on**, which is off by default with 30-day retention.
- **If the apps sit on Postgres or Stripe without Dataverse auditing**, leaving Power Apps loses little, and the current setup likely has an audit gap to fix either way.
- **The KYC queue is a template, not an exception.** AML alerts, sanctions review, disputes, money-movement approvals and PII lookup carry similar compliance weight. How many of the 10 planned apps are like this decides the case for building.

## Key decisions so far

| # | Decision | Why |
|---|---|---|
| 1 | **Research before choosing a stack** | The right stack depends on cost structure, data architecture and compliance needs |
| 2 | **Don't treat the $250K as licensing-only** | 60 Premium seats are about $14K a year; get the line items before comparing costs |
| 3 | **Login, MFA and access policies are not rebuilt** | They come from Microsoft Entra ID (licensed with M365, not Power Apps); a custom app plugs into it like Power Apps does |
| 4 | **Compliance hooks from day one, hardening later** | Adding audit later costs roughly 1.5–2x and leaves a history gap you can't backfill. The hooks (one write path that records the actor and a reason in the same transaction, one `can()` permission check, approval states in the data model) cost days. Entra, Postgres row-level security, write-once archive and retention come later without touching every screen |
| 5 | **Stack: TypeScript throughout**: React + Vite frontend, a separate Fastify API, Postgres, Entra ID | Matches Power Apps code apps (React + Vite + TS), so the UI could also be published there. A separate API keeps audit and permission logic on the server. TypeScript is common on fintech teams; if their backend is Python or Go, swap only the API layer |
| 6 | **First app: the KYC review queue**; refunds (Stripe test mode) second | The hardest, most compliance-heavy app is the decisive test of "build" |
| 7 | **MVP scope: about a 2-hour build on SQLite with mocked login** | Shows the end-to-end flow and the compliance hooks without infrastructure |
| 8 | **UI on Microsoft Fluent UI 2, laid out like a Power Apps model-driven app** | Fluent is the design system Power Apps, Dynamics and M365 use, so the build option looks like what staff use today and can be compared side by side. Clean enough for executives (dashboard), dense enough for analysts (grid, form, timeline) |

Rough rebuild estimates (judgment, not benchmarks; see research §6):

| | Traditional team | With a coding agent |
|---|---|---|
| Shared compliance layer + KYC queue | about 2 engineers, 3–4 months | about 1–2 engineers, 2–3 months |

Security review, compliance or sponsor-bank sign-off, and running both systems side by side don't get faster with an agent.

## The prototype: KYC review queue MVP

**What it shows:**
- A Power Apps-style shell: app header with mock sign-in, left navigation of saved views, command bars.
- An **executive dashboard**: open cases, SLA breaches, time to decision, approval rate, four-eyes approvals, SSN reveals, plus charts. Numbers come from a read-only `/api/stats` endpoint, scoped to the cases the caller can see, with no customer data.
- A sortable grid of identity-verification exceptions with SLA progress bars.
- A case form with a stage bar (New → In review → 2nd approval → Closed), a timeline of the audit trail, and SSN **masked by default**. Revealing it requires a justification and is logged.
- Claim, request info, escalate, approve or reject with a **required reason code**.
- **Second-approver rule for high-risk cases**: the first approver can't give the second approval. The API and a database `CHECK` constraint both enforce it.
- **Role- and row-level access** through one shared `can()` check. Analysts only see unassigned new cases or cases assigned to them (handing a case on, by escalating or giving the first approval, ends their access); the compliance admin is read-only.
- **Append-only audit log**: every change and every case view is written in the same transaction as the change. SQLite triggers block `UPDATE`/`DELETE`, and a SHA-256 hash chain plus a forward-only chain head make edits, deletions and a truncated tail detectable. There's a per-case history, a global log for the compliance admin, and a full CSV export (spreadsheet formulas neutralised).

**Mocked or out of scope:** real Entra login (a user switcher stands in), Postgres and row-level security, write-once archive, retention policy, the KYC vendor (seeded fake results), refunds/Stripe, deployment.

### Layout

```
apps/api         Fastify + better-sqlite3: schema, seed, audit, permissions, KYC actions, tests
apps/web         React + Vite + TanStack Query + Fluent UI 2 (shell, dashboard, case grid, case form, audit log)
packages/shared  Types, roles, reason codes and the can() permission check (used by API and UI)
docs/            Research brief
```

### Run it

Requires Node 22 (`.nvmrc`) and pnpm 9 (`corepack enable`).

```sh
pnpm install
pnpm dev          # API on :3001 (seeds data/kyc.sqlite on first run), web on :5173
pnpm test         # API tests: permissions, second approver, audit integrity, SSN masking
pnpm seed         # reset the database to the seed data (run once after pulling schema changes)
```

Open http://localhost:5173 and use the user switcher. Demo users:

| User | Role | Can |
|---|---|---|
| Alex Rivera, Bea Okafor | Analyst | Claim new cases, work their own, give the first approval on high-risk cases (which hands the case on) |
| Sam Chen, Riley Park | Senior reviewer | Everything an analyst can, plus escalated cases and the second approval |
| Casey Morgan | Compliance admin | Read-only on cases; full audit log, chain verification, CSV export |

**Demo path:**
1. Alex approves a high-risk case; it goes to *Awaiting 2nd approval*.
2. Alex tries again and is blocked.
3. Sam approves it.
4. Casey reviews the trail and verifies the hash chain.
