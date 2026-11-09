# From prototype to production

Planning-grade estimate for taking the prototype (KYC, Refunds, Feature Flags on the shared platform) to production, and for the 10 planned apps after that. These are judgment-based ranges derived from the prototype's known gaps, not measurements. Use them to frame the keep-vs-build comparison against the ~$250K/yr Power Apps spend, then refine with the team that will own it.

## What the prototype already covers

- Shared platform: role-filtered landing page, per-app RBAC, Access Admin (audited grants/revokes, access-review CSV), cross-app Audit Center with hash-chain verification.
- Three apps with their real controls: KYC four-eyes approval and SSN reveal logging, refund maker-checker with a two-approver threshold, critical-flag approval by a second release manager.
- Server-side authorization (`requireApp` per app, one `can()`-style check per app), minimal PII in lists, list-view audit events.
- 47 API tests and an automated responsive check over every app view (`pnpm --filter @kyc/web test:ui`).

## What production still needs

| Workstream | Scope | Eng-weeks (team only) | Eng-weeks (with Devin) | Why it does or doesn't compress |
|---|---|---|---|---|
| Identity | Entra ID SSO (OIDC), Entra group → app role mapping, deprovisioning (SCIM or group sync), service-to-service auth | 2–3 | 1–1.5 | Code compresses well; an Entra admin still has to register the app and set up groups |
| Data | Managed Postgres, migrations, row-level security policies mirroring today's permission checks, backups/PITR, SSN field encryption via KMS | 3–4 | 1.5–2 | Migrations and RLS policies are well specified; existing tests carry over |
| Audit | Immutable external archive (e.g. S3 Object Lock), 5-year BSA retention, SIEM export, hash-chain anchoring | 2–3 | 1–1.5 | Mostly infrastructure-as-code and plumbing; retention rules need compliance sign-off |
| Integrations | Real KYC vendor (webhooks, documents), Stripe refunds with reconciliation, flag admin wired to the real flag system | 4–6 | 2.5–4 | Bound by vendor sandbox access, contracts and edge cases found in testing. Most uncertain line |
| Infra and deploy | CI/CD, dev/staging/prod, infrastructure as code, secrets, monitoring and alerting, on-call runbooks | 2–3 | 1–1.5 | Boilerplate-heavy; a human still owns on-call design |
| Security and compliance | Threat model, external pen test (2–4 weeks calendar), SOX ITGC change-management evidence, quarterly access reviews, risk sign-off | 2–4 | 1.5–3 | Devin drafts the threat model and evidence and fixes findings; the pen test and approvals don't speed up |
| Hardening and UAT | Concurrent edits, pagination at real volume, accessibility, error handling, user testing with KYC, finance and eng teams | 2–3 | 1.5–2.5 | Fixes compress; user testing runs on the business teams' schedule |
| Migration off Power Apps | Move Dataverse data and audit history, run both systems side by side, cut over app by app | 2–3 | 1.5–2.5 | Scripts compress; side-by-side running and cut-over are calendar time |
| **Total: 3 apps in production** | | **19–29** | **12–19** | |
| **Calendar (2–3 engineers)** | | 3–4 months | 2–3 months | Pen test and sign-offs set a floor of about 2 months |
| **Each additional app (×10)** | | 1–3 | 0.5–1.5 | Each new app follows the platform's existing patterns |
| **Ongoing maintenance** | On-call, dependency and security updates, access-review prep | 1–1.5 FTE | ~0.75–1 FTE | Routine updates delegate well; a human owns on-call and accountability |

"With Devin" assumes engineers direct the work, review every PR and own decisions and sign-offs, while Devin writes the code, tests and infrastructure config. Coding-heavy work roughly halves; work bound by vendors, auditors or user testing barely moves. Devin usage (ACUs × the account's per-ACU rate) is a separate cost on top of engineer time.

## Why a 2-hour prototype still needs months

The prototype has the compliance *design*: one audited write path, one permission check per app, approval states in the data model. Production needs the *operational* version of those controls, and evidence that they work:

- **Identity:** login is a user picker. Real SSO and deprovisioning depend on the company's Entra admins.
- **Audit storage:** the log is a local SQLite file; anyone with disk access could rewrite it and recompute the hash chain. Auditors expect write-once storage, retention and backups.
- **Data:** SSNs aren't encrypted at rest, and the KYC vendor and Stripe are simulated.
- **Evidence:** SOX/SOC 2 needs change-approval records, access reviews and a pen test report, not just code.

With Devin, coding is roughly 4–6 of the 12–19 engineer-weeks. The rest of the calendar is set by the pen test, security and compliance sign-off, vendor access, user testing and side-by-side running with Power Apps.

## Faster path: phased rollout

The totals above assume all three apps go live together and migrate history off Power Apps. Shipping one app at a time, lowest risk first, gets the first app to production in weeks. Calendar times assume Devin, 1–2 engineers, and reuse of existing cloud, CI/CD and Entra setup.

| Phase | App | Why this order | Production-specific work | Calendar |
|---|---|---|---|---|
| 1 | Feature Flags | No PII, no money movement | Entra SSO and group mapping, Postgres, deploy pipeline, write-once audit archive, connection to the real flag system, internal security review | ~2–4 weeks |
| 2 | Refunds | Money movement, but no identity data | Stripe integration and reconciliation, finance UAT, SOX change-management evidence | +3–5 weeks |
| 3 | KYC Review | PII, BSA retention, examiner scrutiny | KYC vendor integration, SSN encryption, external pen test, 5-year retention, Dataverse history migration, compliance sign-off | +5–8 weeks |

Phase 1 also builds the shared production platform (identity, data, audit archive, deploy), so phases 2 and 3 are mostly app-specific work. KYC still sets the overall end date: the full cutover lands around 2–3 months, but the first app reaches production in about a month and proves the platform before the high-risk app moves. New apps can start on the platform after phase 1, without waiting for the migration.

## Biggest risks to the estimate

- KYC vendor and Stripe integration edge cases.
- How much Dataverse audit history must be migrated to meet retention requirements.
- How strict auditors are about SOX ITGC evidence for in-house tools.

## Inputs still needed for the keep-vs-build decision

- Line items behind the ~$250K/yr (licenses vs Dataverse capacity vs Power Automate vs partner/staff time).
- Number of non-engineer users, and which of the 10 planned apps they would use or build themselves.
