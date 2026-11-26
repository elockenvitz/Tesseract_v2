# Tesseract

**A decision operating system for investment teams.**

---

## The problem

Every investment organization has research, market data, models, notes, chat
and trading systems. Almost none has a durable record of the decision
itself.

The note that justified a position has been edited since. The price target
moved. The portfolio manager's reasoning is in a message thread. The
position has been adjusted three times. Six months later the team cannot
reconstruct why the decision was made, what was considered and rejected, or
whether the original thesis actually played out.

The consequence is not administrative. A team that cannot reconstruct its
own reasoning cannot separate a correct call from a lucky one, cannot tell a
thesis that played out from a thesis that was never tested, and cannot hand
a name from one analyst to the next without starting over.

## The product

Tesseract connects research, investment ideas, recommendations,
portfolio-manager decisions and outcome reviews as linked records in one
workspace.

The record is not a document store. Each stage is a typed entity that points
at the one before it, which is what makes a decision reviewable a year later
rather than merely archived.

## The core workflow

**Research.** The written case lives with the security: thesis, where we
differ, risks to the thesis, with its revisions kept as versions.

**Recommend.** An analyst puts a view forward. The reasoning is frozen at
submission, so what the portfolio manager read is what the record keeps,
even after the analyst revises the thesis.

**Decide.** The PM accepts, rejects or defers. All three are first-class
records with their own rationale. A deferral is a decision, and it is the
one most systems lose because there is nothing to file.

**Review.** Later, the decision is revisited against what happened, and the
review becomes part of the same record.

## What makes it different

Not market data, charting, or an AI chat interface. Every firm can buy the
first two and the third is a commodity.

The differentiator is the connection between research, recommendation,
decision and outcome. A firm's accumulated reasoning is the one asset in
this stack that cannot be purchased, and it compounds: in year one it is a
record, in year three it is the only place that knows how this firm actually
makes decisions.

## Primary users

| Role | What they do in Tesseract |
| --- | --- |
| Research analyst | Builds the case on a name, develops ideas, submits recommendations |
| Portfolio manager | Reviews frozen recommendations, decides, records the rationale |
| Research director / CIO | Sees the pipeline, the decision history, and what the team learned |
| Trader | Sees the decision context behind an instruction |

Designed for small and mid-sized institutional teams, roughly three to
thirty investment professionals, where the reasoning genuinely lives in
people's heads and inboxes rather than in a committee system.

## What exists today

- Asset workspace with instrument identity, price provenance, firm exposure,
  coverage and the written case
- Idea pipeline with lifecycle stages, conviction and staleness
- Recommendation submission with reasoning frozen at submission
- PM decision workflow: accept, reject and defer, each recorded
- Decision versioning and a per-security decision history
- Execution provenance, which distinguishes an assumed execution from a
  confirmed one
- Structured outcome review against the original thesis
- ACT AI: a contextual assistant with retrieval over the firm's own research
  and decision records, answering with citations to those records
- Multi-tenant architecture with row-level security per organization
- Mobile and desktop

## What does not exist yet

Stated plainly, because it is better to hear it here than in a demo.

- **Commercial market-data licensing for external users.** Prices, charts
  and news work technically. The right to redistribute them to a client's
  users is an open dependency.
- **Platform-provisioned AI.** ACT AI currently runs on a provider key the
  firm supplies. Platform-sponsored AI with per-organization budgets is
  designed and not built.
- **Broker or OMS integration.** Executions are recorded, not routed.
- **Production deployment with external users.** This is a pre-release
  platform.
- **A completed external security review.** Internal hardening is extensive
  and ongoing; a third-party review has not been done.

## The design-partner opportunity

We are selecting a small number of investment teams to evaluate Tesseract
and shape its institutional rollout. This is a guided evaluation and a
design partnership, not an offer of unrestricted production access.

**Participants get** early access to a scoped evaluation, direct input into
build priorities, collaboration on modelling their own recommendation and
decision process rather than an approximation of it, and a path to
preferential commercial terms when the commercial release is ready.

**We get** the thing we actually need, which is whether this maps to how a
real desk works and where it does not.

## The next step

A thirty-minute walkthrough of the decision loop on one security, start to
finish, and a conversation about whether it matches your process.

---

*Tesseract is a pre-release platform. Nothing in this document is an offer
of securities, investment advice, or a representation about investment
performance.*
