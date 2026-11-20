# Design partner framework

A proposed structure for taking an interested firm from a first conversation
to a possible commercial relationship. Four stages, with an explicit
decision point between each.

**This is a working framework, not a contract.** Nothing here is binding on
either side. See [loi-outline.md](loi-outline.md) for the discussion
framework when a firm wants to put intent in writing, and note that it too
is a discussion aid rather than an agreement.

**The distinction that matters throughout:** nonbinding interest is a firm
saying this is worth their time. Commercial commitment is a firm agreeing to
pay. They are different things and should never be recorded as the same
thing. A pipeline that conflates them is a pipeline that tells a founder
nothing.

---

## Stage 1. Guided demonstration

**Duration.** One call, 30 to 45 minutes.

**What happens.** The walkthrough in
[demo-walkthrough.md](demo-walkthrough.md), then the questions in
[discovery-questions.md](discovery-questions.md). Us driving; nothing for
them to install.

**What we are deciding.** Whether their process resembles the one this is
built for. Specifically: is there a recommendation artifact, and is a
rejected recommendation something they would want to keep?

**What they are deciding.** Whether this is worth another hour.

**Exit criteria.** They can describe the product to a colleague without our
words. If they cannot, run stage 1 again rather than advancing.

**Reasons to stop here.** They treat documented disagreement as friction.
They have no concept of names in flight. Nobody on the team writes anything
down today. None of these are fixable by product.

---

## Stage 2. Structured evaluation

**Duration.** Two to three weeks.

**Users.** Two or three named people. One must be a decision-maker, because
an evaluation done entirely by analysts cannot test the half of the product
that matters most.

**Data.** Their own securities, no real position data required. Ideas and
recommendations they would genuinely write. Not a sandbox with fake names:
the product's value is indistinguishable from a document store when the
content is fake.

**What we do.** Set up the organization, configure their workflow, train the
named users, and stay available.

**What we measure.** Durable artifacts, not logins:

| Signal | Why this one |
| --- | --- |
| Recommendations submitted with frozen reasoning | The core act. Without this nothing else happens. |
| Decisions recorded, including rejections and deferrals | Tests whether the PM actually participates. |
| A second analyst reading a first analyst's case | Tests the continuity argument. |
| A decision revisited after the fact | The only signal that the record is being used as a record. |
| Unprompted logins in week three | Week one is politeness. Week three is interest. |

**Exit criteria.** At least one complete loop: research, recommendation,
decision, and a review. One real loop is worth more than fifty logins.

**Commercial prerequisites at this stage.** None. No payment, no agreement
beyond a confidentiality understanding if their counsel wants one.

**What they must be told in writing before starting.** The three
dependencies, verbatim: market-data licensing for external users is not in
place, platform-provisioned AI does not exist and the assistant requires
their own provider key, and this is a pre-release platform. See
[outreach-templates.md](outreach-templates.md), template 4.

---

## Stage 3. Limited pilot

**Only after stage 2 produced a complete loop and the firm asked to
continue.**

**Duration.** Six to eight weeks.

**Users.** Up to five named users, one team or one sector. Not the whole
firm. A pilot that expands before the workflow is proven produces a broad,
shallow failure.

**Scope.** One real workflow in production use for a defined slice of their
coverage.

**Success criteria, agreed in writing before it starts.** Our proposal:

1. Every recommendation in the pilot slice goes through Tesseract rather
   than email, for the duration.
2. Every one receives a recorded decision, including rejections.
3. At least three decisions are revisited with a recorded review.
4. The named PM says they would object to it being switched off.

Criterion 4 is the real one. The first three are necessary and
insufficient.

**Commercial prerequisites that must be resolved before this stage.** These
are hard gates, not preferences:

| Prerequisite | Current state |
| --- | --- |
| Market-data rights for their users | **Open.** See [pilot-economics.md](pilot-economics.md). Options: a licence we hold that permits redistribution, their own entitlement, or running the pilot with no market data at all. |
| AI provisioning | **Open.** Either they supply a provider key, or platform-sponsored AI is built with per-organization budgets, which does not exist. |
| Security review | Their process. Expect an information-security questionnaire and allow weeks for it. |
| Data processing terms | Needed before their data enters the system in production use. |
| A legal entity and insurance | **Open.** There is no legal entity today. |
| Production backup and recovery | **Open.** Backups and point-in-time recovery are not currently enabled. This will fail a serious review and should be fixed before any pilot. |

**Pricing at this stage.** Our recommendation is that the limited pilot is
not charged. A design partner is giving us the thing we cannot buy. Charging
for a pre-release pilot converts a collaborator into a customer with
grievances.

---

## Stage 4. Commercial conversation

**Only after a pilot that met its criteria.**

**What changes.** They become a customer with expectations: availability,
support response, a roadmap commitment, and a contract.

**Indicative subscription structure**, to be tested rather than announced:

- **Per named user, per month, annual term.** Simple, predictable, and
  matches how investment teams already buy research tools.
- **A floor**, because a three-user deployment costs nearly as much to
  support as a ten-user one.
- **Market data passed through at cost, or excluded**, depending on how the
  licensing dependency resolves. Do not bundle a cost that is not yet known.
- **AI either metered or included up to an allowance**, with overage, once
  the controls in [pilot-economics.md](pilot-economics.md) exist.

**No price is proposed here.** A reference price should come from question
10 in [discovery-questions.md](discovery-questions.md), asked of several
firms, not from a founder's estimate. Anchoring on a guessed number before
five of those conversations is how early pricing gets permanently wrong.

**Support expectations to set explicitly.** Business-hours response, a named
contact (the founder), and no availability guarantee until there is an
entity able to stand behind one.

---

## What to record, per firm

Keep this somewhere durable, one row per firm:

| Field | Note |
| --- | --- |
| Stage | 1 to 4 |
| Named users | Who, and their role |
| Exit criteria met | Which specific ones, with dates |
| Artifacts produced | Counts of recommendations, decisions, reviews |
| Objections raised | Verbatim |
| Budget answer | Verbatim, including hesitation |
| Blockers we own | Which of the prerequisites above |
| Interest classification | Nonbinding interest, or commercial commitment. Never both. |

The last row is the one that keeps a founder honest.
