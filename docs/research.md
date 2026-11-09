# Power Apps: keep or build? Research brief

**Context.** This brief uses an illustrative scenario: a growth-stage fintech (figures are representative, not any specific company's). The VP of Engineering's team pays about **$250K/yr** for Power Apps. The company has 60 engineers; the number of non-engineer users is unknown. Three internal apps run on Power Apps today:

- a KYC review queue
- a refunds dashboard
- a feature-flag admin panel

They plan to build about 10 more. Research date: November 2026. Prices are USD list prices, billed annually, per user per month unless noted. Verify prices against the company's actual Microsoft agreement (EA/CSP discounts are common).

---

## 0. Summary

1. **The $250K is almost certainly not just licenses for the 60 engineers.** 60 Premium licenses cost about $14.4K/yr at $20, or $15.8K/yr at the 2027 price of $22. Covering $250K with licenses alone would take about **1,040 Premium users**. So the spend is one of three things, or a mix: a large non-engineer user base (KYC analysts, support, finance), capacity and add-ons, or people/partner costs bundled into the number. **The first step is getting the line items** (see §3.4).
2. **The real value Power Apps provides is the compliance scaffolding, not the UI.** Dataverse gives these out of the box:
   - field-level audit trail (who, what, old and new values)
   - row- and column-level security
   - server-side masking of PII
   - approvals
   - SSO, MFA and Conditional Access through Entra ID
   - environment-based change management
   - a platform covered by SOC 1/2, ISO 27001, PCI DSS, GLBA, FFIEC and NYDFS 23 NYCRR 500 attestations

   **A rebuild has to replicate these controls, not just the screens.**
3. **Caveat:** those controls only apply if the apps actually store data in **Dataverse** with auditing turned on. If the apps are canvas apps sitting on top of Postgres or Stripe through connectors, most of the audit value is missing today. Dataverse auditing is also **off by default**, and its default retention is 30 days.
4. **Fit by app:**
   - **KYC queue:** strong fit, and the most expensive to rebuild correctly.
   - **Refunds:** good fit, but needs premium connectors, so every user needs a Premium license.
   - **Feature-flag panel:** weakest fit. It's a developer-workflow tool, and dedicated flag platforms or a small internal service handle it better.
5. **Pricing pressure is rising:**
   - Premium goes from $20 to $22 on 2027-01-01 (2,000+ seat tier: $12 to $14).
   - In Feb 2027, Microsoft starts enforcing premium licensing in scenarios it has been lenient about until now.
   - Unmanaged developer environments must be converted to managed by 2026-12-15.

---

## 1. Why a growth-stage fintech would use Power Apps

### Why it's chosen at this stage
- **They're already a Microsoft shop.** Entra ID, Teams and Outlook are in place. Power Apps inherits SSO, MFA, Conditional Access and the existing joiner/mover/leaver process at no extra integration cost.
- **Engineering capacity goes to the product.** Ops and compliance teams need queues and dashboards *now*. Power Apps lets a small group, or a partner, ship them without taking product engineers off the roadmap.
- **Inherited compliance.** Power Platform is covered by Microsoft's compliance offerings: SOC 1/2/3, ISO 27001/27017/27018/27701, PCI DSS, GLBA, FFIEC, NYDFS 23 NYCRR 500, SEC 17a-4 and others. When a sponsor bank, auditor or regulator asks "how is this tool secured and audited?", the company can point to Microsoft's reports on the Service Trust Portal plus its own Dataverse configuration. Compliance is still a **shared responsibility**: the platform attestations don't make the company's apps compliant by themselves.
- **Governance is included.** Managed Environments come with Premium licenses. They include data-loss-prevention (DLP) policies that restrict which connectors can be used, sharing limits, IP firewall, customer-managed keys (CMK), Customer Lockbox, VNet support, masking rules, pipelines and solution checker.

### Benefits by stakeholder
| Non-technical (ops, compliance, support, finance) | Technical (engineering, security, IT) |
|---|---|
| Queues, forms and views they can adjust themselves, within limits | No auth, RBAC, hosting or audit-log plumbing to build |
| Approvals arrive in Teams/Outlook; mobile access | 1,500+ connectors, plus custom connectors to internal APIs |
| Built-in Excel export and Power BI | Escape hatches: code components (PCF), Dataverse plug-ins, and **code apps** (React/TS hosted on the platform) |
| Audit history visible on each record | Environments (dev/test/prod), pipelines, Git integration for solutions |
| Changes ship in days, not sprints | Entra Conditional Access and Purview audit integration |

### Typical setups (worth checking which one each of their 3 apps uses)
| Pattern | How it works | Audit/compliance quality |
|---|---|---|
| **A. Dataverse-native** | Data lives in Dataverse tables. A model-driven app (queues, forms) or canvas app sits on top, with Power Automate for integrations | **Best.** Full Dataverse audit, row/column security and masking |
| **B. Canvas app on the production DB** | Canvas app → PostgreSQL / SQL Server / Azure SQL connector, usually through an **on-prem data gateway** or VNet. The PostgreSQL connector is Premium and gateway-based | **Weak.** Dataverse audit doesn't cover external data. The only trail is Purview connector/app activity logs plus whatever the database logs |
| **C. Hybrid** | Dataverse holds workflow state (case, decision, approver, reason). Source-of-truth data comes from Postgres or vendor APIs (Stripe, KYC vendor) through custom connectors or virtual tables | **Good for decisions**, as long as every decision is written to Dataverse |
| D. SharePoint lists | Lists as the database | Not appropriate for KYC/refunds: 5,000-item view threshold, weak relational model |

---

## 2. The three apps: value, fintech fit, and what a rebuild must replicate

### 2.1 KYC review queue
**Fintech fit.** An identity-verification vendor (e.g. Persona, Alloy, Onfido, Jumio) runs the automated checks. Exceptions and enhanced-due-diligence (EDD) cases land in a human queue. Analysts review documents and vendor signals, then approve, reject or escalate. A senior analyst or the BSA officer signs off on high-risk cases. Regulatory drivers:
- **BSA/AML Customer Identification Program (CIP)** rules require keeping identity information, the documents relied on, the verification methods and results, and how discrepancies were resolved. Identity records must be kept **5 years after the account closes**; most other BSA records, 5 years.
- Sponsor-bank oversight and exams.
- Suspected-activity escalations need strict need-to-know access.

**What Power Apps provides (if built on Dataverse):**
- Queue/case model with assignment and views, plus business process flows for stage gates.
- Security roles, business units and teams for analyst vs. senior vs. BSA-officer visibility.
- Column security plus **server-side masking rules**, e.g. show only the last 4 digits of an SSN. Unmasked values can be read only one record at a time, and access to masked columns is still audited.
- Field-level **change audit** with old and new values. **User access logging** and read/export **activity logging** go to Purview (production environments only).
- Configurable retention up to "forever".
- Approvals for four-eyes sign-off.

**What a rebuild must replicate:**
- Case model and state machine (new → in review → escalated → approved/rejected) with reason codes.
- Assignment, queues and SLA timers.
- RBAC plus **row-level** rules (who can see which cases) and **column-level** PII protection with masked display and **logged "reveal"** actions.
- **Append-only audit trail**: actor, timestamp, before/after values, reason, and source IP/session. Reads and exports logged too.
- Maker-checker: the approver can't be the preparer, enforced server-side.
- Secure document storage: encrypted, access-logged, with retention and legal-hold policies.
- Retention of **≥5 years after account closure**, a deletion process, and examiner-ready exports.
- SSO/MFA through Entra (OIDC/SAML), and session timeouts.

**Assessment:** the highest compliance value and the highest rebuild cost. Rebuilding it is feasible, but the control layer is most of the work.

### 2.2 Refunds dashboard
**Fintech fit.** Support or finance looks up transactions and issues refunds through the payment processor's API. Refunds above a threshold need approval. Drivers:
- financial controls: segregation of duties, approval limits, reconciliation
- SOX IT general controls (ITGCs) if the company is preparing for an IPO or already public
- possibly Reg E error-resolution timelines for consumer products
- PCI scope: never display full card numbers

**What Power Apps provides:**
- The Stripe connector (and others), which are **Premium**, so every user of this app needs Premium.
- Power Automate approvals: sequential, everyone-must-approve, or first-to-respond.
- An audit trail on Dataverse-recorded refund requests.
- DLP policies to restrict which connectors the app can call.
- Teams notifications.

**What a rebuild must replicate:**
- Refund request → approval → execution flow with **amount-based approval tiers**, requester ≠ approver, and a reason code.
- **Idempotent** calls to the processor (no double refunds), with retries and a dead-letter queue.
- Processor API keys stored in a secrets manager, with least-privilege keys.
- An audit record for each refund: who requested, who approved, amount, before/after state, processor reference.
- Daily reconciliation against processor reports; rate/velocity limits and anomaly alerts.

**Assessment:** moderate compliance value. The logic is well understood and easy to build. Most of the license cost comes from Premium seats for every support/finance user.

### 2.3 Feature-flag admin panel
**Fintech fit.** Most likely a UI that lets non-engineers flip kill switches or product availability (e.g. pause a product in a state, toggle a payment rail). If a flag changes financially relevant behavior (pricing, fees, money movement, reporting), auditors can treat a **flag change as a production change** under SOX ITGC change management. That requires: request, independent approval, who changed it and when, before/after value, and justification.

**What Power Apps provides:** a quick UI with approvals and a Dataverse audit trail for the flag *record*. It does **not** provide flag evaluation, SDKs, targeting, percentage rollouts, or a low-latency, highly available serving path. Power Apps must never sit in the runtime path.

**What a rebuild or replacement must replicate:**
- Change request and approval for flags in scope, with an append-only change log (before/after, actor, timestamp, reason).
- Environment separation and RBAC by flag/project.
- An export path for auditors.

Dedicated flag platforms (LaunchDarkly, Unleash, Flagsmith, etc.) generally include audit logs and approval workflows. Check which tier includes them. There is no official LaunchDarkly connector for Power Platform; an independent-publisher connector was still an open PR as of March 2026.

**Assessment:** the weakest fit for Power Apps. It's the easiest app to move off, and the lowest-risk first migration candidate.

---

## 3. Hidden costs

### 3.1 License-driven
| Cost | Detail |
|---|---|
| **Premium for every app user** | Any premium connector (PostgreSQL, SQL Server, Stripe, HTTP), custom connector, on-prem gateway or Dataverse use makes an app Premium. Every analyst, support agent and finance user then needs Premium ($20 → $22), pay-as-you-go (~$10 per active user per app), or an App Pass. **Code apps also require Premium.** |
| Feb 2027 enforcement | Microsoft will start requiring proper premium licenses in scenarios it was lenient about, e.g. managed environments and model-driven apps. Unlicensed users get blocked. This can **increase the seat count**. |
| Per-app plan phase-out | The $5 per-app plan was removed from the Jan 2026 licensing guide (later restored for the CSP channel only). Pay-as-you-go is about double that price for users active every month. |
| Power Automate | Flows that run *in the context of* an app are included. Standalone or automated flows, e.g. a KYC-vendor webhook, need Power Automate Premium ($15/user) or **Process** ($150/flow/month, 250K actions/day). |
| Request capacity | 40K requests/user/day (Premium), 6K for M365/pay-as-you-go users, and the limit can't be pooled. Add-on: $50/month per +10K/day. |

### 3.2 Capacity-driven
| Cost | Detail |
|---|---|
| Dataverse database | $40/GB/month beyond the pool. The pool is a 5 GB tenant base plus 250 MB per Premium license. |
| Dataverse file | $2/GB/month. KYC documents add up quickly. |
| **Dataverse log** | $10/GB/month. **Audit logs consume log capacity**, and 5+ year retention for KYC means this only grows. |
| Purview audit retention | Activity logs are kept 180 days by default. Keeping them 1 year requires **E5** (or the E5 Compliance / eDiscovery & Audit add-on) for each user who generates the logs. 10 years requires the **10-Year Audit Log Retention add-on**. |
| Gateway infrastructure | VMs (ideally a high-availability cluster) for the on-prem data gateway if apps reach Postgres in their VPC. Patching and monitoring are on them. |

### 3.3 People-driven (often the biggest hidden cost)
- **Power Platform specialists**: makers, Power Fx developers, admins. It's a separate skill set from the main engineering org, and hard to hire for. Product engineers are often reluctant to work in it.
- **Partners/consultants**: time-and-materials engagements commonly run around $10–30K per month for a dedicated consultant; single-app fixed-price builds run around $15–80K. These are regional market figures, not quotes.
- **Governance and admin time.** Microsoft's Center of Excellence (CoE) Starter Kit is no longer maintained, and its functions moved into the Power Platform admin center. Someone still has to run DLP policies, environments, licensing, access reviews and audit configuration.
- **Engineering glue.** Custom connectors, Azure Functions or plug-ins for logic Power Fx can't express, and gateway troubleshooting.
- **Quality and risk costs:**
  - Delegation limits mean non-delegable queries silently process only the first 500 rows by default, so results can be wrong without any error. That's a material risk in KYC and refund lookups.
  - Weaker automated testing and code review than in normal code.
  - Lock-in: Power Fx and solutions aren't portable.

### 3.4 What's probably inside the $250K: questions to answer
Pull these four sources:
- **Microsoft 365 admin center → Billing → Licenses**, for SKUs and counts.
- **Power Platform admin center → Licensing / Capacity**, for Dataverse database/file/log usage and add-ons.
- The **Azure invoice**, for pay-as-you-go meters and gateway VMs.
- Any **partner SOWs/retainers**.

Then split the total into three buckets:
1. Licenses (Power Apps Premium / pay-as-you-go / App Pass, Power Automate Premium/Process, any Dynamics 365)
2. Capacity add-ons and Azure
3. People (internal FTEs, partners)

Illustrative only, to show the shape. These are not their numbers:

| Scenario | Rough composition |
|---|---|
| License-heavy | ~900–1,000 Premium seats (mostly non-engineers) ≈ $215–240K, plus ~$10–35K capacity/Process licenses |
| Mixed | ~300 Premium seats ≈ $72K, + 10 Process flows ≈ $18K, + 50 GB DB / 50 GB log ≈ $30K, + partner retainer ≈ $130K |
| People-heavy | ~100 Premium seats ≈ $24K, + capacity ≈ $10K, + 1–2 partner/FTE Power Platform devs ≈ $215K |

Also confirm whether the 60 engineers *use* the apps at all, or whether the users are mainly ops, compliance and finance staff. That changes the build-vs-buy math: a build has no per-seat cost, so a large non-engineer user base favors building.

---

## 4. Compliance and audit features: what's built in vs. what a rebuild needs

| Control | Power Apps / Dataverse out of the box | Caveats | Rebuild equivalent needed |
|---|---|---|---|
| Identity | Entra ID SSO, MFA, Conditional Access (per app with Managed Environments) | Requires Entra | OIDC/SAML with Entra, session management |
| Authorization | Security roles, business units, teams, record ownership/sharing, **column security** | Complex to model; access adds up across roles | RBAC + row-level + column-level policy layer |
| PII masking | **Server-side regex masking rules**; one-record-at-a-time unmasking | Dataverse only | Masking in the API layer + logged reveal endpoint |
| Change audit | Create/update/delete with **old/new values**, sharing changes, role changes, audit-setting changes, deletion of audit logs | **Off by default; default retention 30 days**; values truncated at 5 KB; no UI export (API only); **external data not covered** | Append-only audit table/stream covering every write path |
| Access/read audit | User access logging; read/export activity logging to **Purview** | Production environments only; Purview retention 180 days by default, longer requires E5 or add-ons | Read/export logging to a SIEM |
| Audit tamper resistance | Audit table is read-only; deletions are themselves audited | **Admins with the privilege can delete audit history** (per record, bulk, or oldest logs). Not write-once (WORM) storage | Write-once storage (e.g. object-lock storage), separate admin domain |
| Approvals / four-eyes | Power Automate approvals (sequential, all-must-approve), Approvals Kit, business process flows | Requester ≠ approver must be designed in | Workflow engine with server-side separation-of-duties checks |
| Change management | Environments, solutions, pipelines, Git integration (Azure DevOps), solution checker | **Code apps don't support Power Platform Git integration**; reviewing diffs of low-code artifacts is hard | Git + PR review + CI/CD (already exists for the engineers) |
| Data protection | Encryption at rest, **CMK**, **Customer Lockbox**, IP firewall, VNet, DLP connector policies | Most require Managed Environments (included with Premium) | KMS/CMK, network isolation, secrets manager |
| Monitoring | Admin center inventory/usage/monitor; Microsoft Sentinel solution for Power Platform | — | SIEM integration, alerting |
| Platform attestations | Microsoft SOC 1/2/3, ISO 27001, PCI DSS, GLBA, FFIEC, NYDFS 500, SEC 17a-4 (shared responsibility) | Covers Microsoft's platform, not the company's app logic | Their own cloud provider's attestations + their own SOC 2 scope expands to cover the new apps |

**Bottom line for a rebuild:** to match today's posture, build a shared internal-tools platform once (auth, policy, audit, approvals, masking, document storage), then build the apps on top of it. If each app implements those controls separately, the company will fail audits on whichever app falls behind.

---

## 5. Current-state audit: what to check before deciding

Whether a move off Power Apps is easy depends less on Power Apps and more on how the 3 apps are wired today. Ask for these directly. Each answer changes the size of the rebuild.

### 5.1 Data and audit configuration (per app)

| Check | How to verify | If the answer is "yes" | If the answer is "no" |
|---|---|---|---|
| Does the app store its records in **Dataverse**? | Power Apps maker portal → app → Data sources; or the solution's table list | The Dataverse controls (§4) are in play; a rebuild must replace them | The app is a UI over Postgres/Stripe; little compliance value is lost by leaving |
| Is **Dataverse auditing** on for the environment, and for the relevant tables and columns? | Power Platform admin center → environment → Settings → Audit and logs; table properties → "Audit changes" | There is an audit history worth preserving (see 5.3) | **Possible gap today:** no record of who changed a case or refund and what changed |
| What is the **audit retention** setting? | Same screen as above | Check it covers the BSA period (5 years after account closure for CIP records) | Default is 30 days; older history may already be gone |
| Is **activity logging** (reads/exports) sent to Purview? | Power Platform admin center → environment settings; Purview audit search for Dataverse activities | Read/export history exists, retained 180 days (Audit Standard) or longer with E5/add-on | No record of who *viewed* PII or exported data |
| For apps on **Postgres**: does the connection use a **shared login** or each user's own identity? | Check the connection in the app (shared/implicit connection vs. per-user); check what user Postgres logs show | Per-user DB identity is rare in practice; confirm it | **Likely:** every change shows as one service account, so the database can't say which analyst acted |
| Are **masking rules** or **column security** set on SSN, account and card fields? | Dataverse → Security → column security profiles; masking rules in Managed Environments | Rebuild must replicate masking and reveal-logging | PII is visible to every app user today |
| Are the environments **Managed Environments** with DLP policies? | Power Platform admin center → Environments | Governance controls exist and must be replicated or accepted as lost | Less to replicate; also a governance gap today |
| Do refunds go through **approval** (Power Automate approvals or in-app)? | Look for approval flows; check Power Automate run history (retained ~28 days) | Approval records may exist only in flow history; confirm where they're kept long-term | Requester and approver may be the same person: a separation-of-duties gap |
| Can staff also refund directly in the **Stripe Dashboard**? | Stripe → Team settings → roles with refund permission | The Power Apps approval is bypassable; rebuild or not, reconcile these | Approval path is enforced |

### 5.2 The one question that summarizes it

> "If an examiner asked who cleared customer X, what evidence they looked at, and who approved refund Y, where would you get the answer, and how far back can you go?"

- **Answer is "Dataverse audit history, years back":** Power Apps is providing real compliance value. A rebuild must replicate it and migrate the history.
- **Answer is "we'd have to dig through logs / we're not sure":** the current setup has a gap. A rebuild must *create* the audit trail rather than port it, and leaving Power Apps loses little.

### 5.3 Migration implications if auditing is on

- Dataverse audit history must be **exported and archived** before leaving (via the Dataverse Web API / audit table), because KYC records must be retained 5 years after account closure. The archive must stay searchable for examiners.
- Audit history deleted by an admin can't be recovered, so export before changing retention or decommissioning environments.
- Purview activity logs age out on their own schedule (180 days on Audit Standard); export what's needed.

## 6. Rebuild effort estimates

These are **rough judgment estimates, not benchmarks**. They assume an experienced team, existing CI/CD, Entra ID for login, and the KYC vendor already integrated.

### 6.1 Login and access policies are not rebuilt

SSO, MFA and Conditional Access come from **Microsoft Entra ID**, which is licensed with Microsoft 365, not Power Apps. A custom app registers in Entra (OIDC/SAML) and gets the same policies, plus group/app-role claims for coarse roles and Entra sign-in logs. Conditional Access needs Entra ID P1 (in M365 E3/E5/Business Premium); access reviews need Entra ID P2 or Entra ID Governance. What the app builds itself is everything *inside* the app: row/field permissions, masking, data audit, approvals.

### 6.2 Effort

| Piece | Traditional team | With a coding agent (engineers directing and reviewing) |
|---|---|---|
| **Shared compliance foundation** (built once): Entra login and role mapping, row/field permissions, append-only audit log with write-once archive, masking with logged reveals, generic approval workflow with second-reviewer and requester-isn't-approver rules, encrypted document storage with retention | ~9–12 engineer-weeks | ~4–6 engineer-weeks |
| **KYC queue**: case state machine and reason codes, queues/assignment/SLA, vendor result ingestion, reviewer UI, escalation, examiner export | ~6–10 engineer-weeks | ~2–4 engineer-weeks |
| **Migration and validation**: data move, audit-history archive, security review/pen test, compliance sign-off, 2–4 week side-by-side run | ~4–6 weeks elapsed | ~4–6 weeks elapsed (doesn't compress) |
| **Total for KYC** | ~2 engineers, 3–4 months | ~1–2 engineers, 2–3 months |
| **Upkeep** | ~10–20% of one engineer | similar; less if agents handle routine changes |

Notes:

- **The audit trail itself is the smaller part:** ~2–4 engineer-weeks on Postgres, plus ~1–2 for Stripe (traditional). Most of the foundation cost is permissions, masking and approvals.
- **With an agent, human review becomes the bottleneck.** Audit, permission and money-movement code should get careful review from an engineer who understands the controls.
- **The biggest schedule risk isn't code.** It's compliance or sponsor-bank acceptance of the new audit trail. Involve them at design time.

### 6.3 Audit trail design on Postgres and Stripe (for reference)

- **Application event log (primary):** every action writes an audit row in the same transaction: actor (real employee), action, old/new values, reason, request ID.
- **Database triggers (backstop):** catch changes made outside the app. The app sets the employee ID per transaction (e.g. `SET LOCAL app.user_id`) so triggers can record it. pgAudit can add statement-level logging.
- **Tamper protection:** no UPDATE/DELETE rights on the audit table for anyone; stream rows to write-once storage (e.g. S3 Object Lock, compliance mode). Stronger than Dataverse, where admins can delete audit history.
- **Read logging:** triggers don't fire on reads, so "who viewed this SSN/document" is logged by the app.
- **Stripe:** Stripe only sees the API key, not the employee. Keep approvals in your log; put the internal refund-request ID in refund `metadata` and use it as the idempotency key. Store refund webhooks (`charge.refunded`, `refund.updated`) because the Events API only goes back about 30 days, and reconcile daily. Use a restricted API key, and restrict or reconcile Dashboard refunds.
- **Gotchas:** propagate real identity, not the service account; the audit log contains PII and needs the same protection; partition by month for 5-year retention; make "full history for case X" a single query.

## 7. Open questions that affect the larger build (the 10 planned apps)

The KYC queue is a template, not an exception. A fintech at this stage typically has several internal tools with similar compliance weight:

- AML transaction-monitoring alerts and suspicious-activity report (SAR) decisions (SAR confidentiality: strict need-to-know)
- Sanctions/OFAC screening match review
- Fraud, disputes and chargebacks (Reg E / Reg Z resolution deadlines)
- Account actions: freezes, limit changes, closures
- Manual balance adjustments, payouts, money-movement approvals (separation of duties, SOX)
- Customer PII lookup and data-subject requests (GLBA, CCPA)
- Complaints management (sponsor bank / CFPB expectations)
- Credit-decision overrides and adverse-action notices, if they lend

### 7.1 Questions for the VP of Engineering

**Scope of the 10 planned apps**
1. **How many of the 10 touch customer PII, money movement, or regulatory decisions?** This is the single biggest driver. Several compliance-heavy apps favor building a shared foundation once; mostly simple dashboards favor staying on Power Apps.
2. What kinds of apps are they (queues, dashboards, admin tools, workflows)? Expected users per app, and are those users engineers or ops/compliance/support/finance?
3. Who is expected to build them: engineers, or non-engineers building their own? If the latter, Power Apps' main remaining advantage is self-service, and a custom platform would need an equivalent (or accept that engineers build everything).
4. What's the timeline? A shared foundation front-loads ~1–3 months before the first new app ships.

**Cost**
5. What's in the $250K (§3.4)? How many Premium/pay-as-you-go seats, and who holds them?
6. Which seats exist *only* because an app uses a premium connector (Postgres, Stripe, HTTP)? Those costs grow with every new app that needs one.
7. Is there a partner/consultancy retainer or dedicated Power Platform staff, and is it in the $250K?
8. Is the company on Microsoft 365 E3 or E5 / Entra ID P1 or P2? This decides whether Conditional Access, Purview retention and access reviews are already paid for either way.

**Compliance and audit**
9. What do auditors, regulators or sponsor banks actually ask for? Has any of these apps been sampled in a SOC 2 / SOX / bank audit, and what evidence was produced?
10. Is there a company-wide audit-log or SIEM standard (retention, tamper-evidence, where logs go) that a rebuild must meet?
11. Who signs off a new system of record for KYC or refunds (compliance officer, sponsor bank, external auditor), and how long does that take?
12. Which flags does the feature-flag panel control, and does any affect money movement, pricing or financial reporting?

**Architecture**
13. Where should the system of record live: the core product's Postgres, a separate internal-tools database, or Dataverse? Mixing them is where audit gaps usually appear.
14. Do engineers have direct write access to production databases today? If so, the audit trail needs database-level capture (triggers/CDC), not just app-level logging.
15. Is there an existing internal service/API layer for money movement and customer actions, or would internal tools call Stripe and the database directly? An existing API layer makes each new app much cheaper and safer to build.
16. Is there a team that would own an internal-tools platform long term? Without an owner, a homegrown platform decays; that's an ongoing cost Power Apps currently absorbs.

---

## Sources
- Pricing/licensing: [Power Apps pricing](https://www.microsoft.com/en-us/power-platform/products/power-apps/pricing) · [2027 price update](https://www.microsoft.com/en-us/licensing/news/power-apps-premium-price-update) · [Licensing FAQ](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-flow-licensing-faq) · [Power Apps licensing FAQ (Feb 2027 enforcement)](https://learn.microsoft.com/en-us/power-platform/admin/powerapps-licensing-faq) · [License designation](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/license-designation) · [Per-app end of sale](https://licensing.guide/power-apps-per-app-plan-end-of-sale/) · [Power Automate pricing](https://www.microsoft.com/en-us/power-platform/products/power-automate/pricing) · [Request limits](https://learn.microsoft.com/en-us/power-platform/admin/api-request-limits-allocations) · [Dataverse capacity pricing](https://o365hq.com/blog/dataverse-capacity-and-pricing-explained-database-file-log-add-ons)
- Audit/security: [Manage Dataverse auditing](https://learn.microsoft.com/en-us/power-platform/admin/manage-dataverse-auditing) · [Audit configuration (default 30-day retention)](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/auditing/configure) · [Delete audit data](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/auditing/delete-audit-data) · [Purview activity logging](https://learn.microsoft.com/en-us/power-platform/admin/activity-logging-auditing/activity-logs-overview) · [Purview audit retention](https://learn.microsoft.com/en-us/purview/audit-log-retention-policies) · [Masking rules](https://learn.microsoft.com/en-us/power-platform/admin/create-manage-masking-rules) · [Dataverse security model](https://learn.microsoft.com/en-us/power-platform/admin/wp-security-cds) · [Managed Environments](https://learn.microsoft.com/en-us/power-platform/admin/managed-environment-overview) · [Managed security](https://learn.microsoft.com/en-us/power-platform/admin/security/managed-security) · [Customer Lockbox](https://learn.microsoft.com/en-us/power-platform/admin/about-lockbox) · [Microsoft compliance offerings](https://learn.microsoft.com/en-US/compliance/regulatory/offering-home)
- Platform: [Delegation](https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/delegation-overview) · [Code apps](https://learn.microsoft.com/en-us/power-apps/developer/code-apps/overview) · [PostgreSQL connector](https://learn.microsoft.com/en-us/connectors/postgresql/) · [Stripe connector](https://learn.microsoft.com/en-us/connectors/stripe/) · [Approvals](https://learn.microsoft.com/en-us/power-automate/get-started-approvals) · [ALM with Git + pipelines](https://learn.microsoft.com/en-us/power-platform/architecture/reference-architectures/enterprise-power-platform-alm) · [CoE Starter Kit status](https://learn.microsoft.com/en-us/power-platform/guidance/coe/starter-kit)
- Fintech/regulatory: [31 CFR 1020.220 (CIP)](https://www.ecfr.gov/current/title-31/subtitle-B/chapter-X/part-1020/subpart-B/section-1020.220) · [FFIEC BSA record retention](https://bsaaml.ffiec.gov/manual/Appendices/17) · [Feature flags and SOX ITGC](https://deployopen.com/use-cases/digital-experience/open-source-ab-testing/sox-itgc-change-management) · [Partner rate ranges (AU)](https://sparrofox.com/blog/power-platform-consultant-australia.html)
- Rebuild references: [Entra Conditional Access overview and licensing](https://learn.microsoft.com/en-us/entra/identity/conditional-access/overview) · [Entra access reviews](https://learn.microsoft.com/en-us/entra/id-governance/access-reviews-overview) · [pgAudit](https://github.com/pgaudit/pgaudit) · [S3 Object Lock](https://docs.aws.amazon.com/AmazonS3/latest/userguide/object-lock.html) · [Stripe Events API (30-day window)](https://docs.stripe.com/api/events/list) · [Stripe idempotent requests](https://docs.stripe.com/api/idempotent_requests) · [Stripe restricted keys](https://docs.stripe.com/keys#limit-access)
