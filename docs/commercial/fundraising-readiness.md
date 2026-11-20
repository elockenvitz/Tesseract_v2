# Fundraising readiness

A founder-facing memo. Not a deck, not investor-facing copy. The purpose is
to be clear with yourself about what is true before saying any of it to
someone else.

**Every claim below is labelled.** **Verified** means measured or read
directly from the system. **Assumption** means a judgement that could be
wrong. There are no invented numbers: no valuation, no customer
commitments, no vendor quotes, no revenue.

---

## 1. The investment thesis

**The claim.** Investment firms compete on judgement, and judgement is the
one asset in their stack with no system of record. Research tools store
documents. Portfolio systems store positions. Order systems store
executions. Nothing stores the decision: what was considered, what was
chosen, why, who disagreed, and what was learned. Tesseract makes that a
structured, queryable record, and the record compounds in a way the data
underneath it never can.

**Why it could be a large business (assumption).** Every investment
organization has the problem. The record is proprietary, so switching costs
grow with use. And a connected decision corpus is the right substrate for AI
to be genuinely useful in this industry, as opposed to a chat window over
public filings.

**Why it might not be (and this is the honest risk).** The problem is
chronic rather than acute. Nobody's quarter is ruined by not remembering why
they bought something in March. A chronic problem with no deadline is the
hardest thing in software to sell, and it is usually solved by a
spreadsheet that is good enough. The entire commercial question is whether
enough firms feel it acutely enough to change behaviour, and **changing
analyst behaviour is the real product risk, not building features.**

---

## 2. What is built

**Verified.** A working, multi-tenant application with the decision
lifecycle implemented end to end.

- Asset workspace: instrument identity, price provenance, firm exposure,
  coverage, the written case
- Idea pipeline with lifecycle stages, conviction, staleness
- Recommendation submission with reasoning frozen at submission, stored as
  immutable versions
- PM decision workflow with accept, reject and defer, each a first-class
  record with rationale
- Decision versioning and a per-security decision history
- Execution provenance distinguishing assumed from confirmed
- Structured outcome review against the original thesis
- ACT AI with retrieval over the firm's own corpus and citations to records
- Charting
- Row-level security per organization, extensively applied
- Mobile and desktop
- Substantial automated test coverage: roughly 12,900 unit tests across
  roughly 740 files, plus typecheck, copy, tenant-isolation and
  layout gates in CI

**The strongest technical signal is not the feature list.** It is that the
system distinguishes absence from value: a missing previous close produces
no day change rather than a fabricated zero; a quote with no delivery term
says "delivery unstated" rather than implying it is live; an unmappable
security type renders nothing rather than "Equity". That discipline is
unusual and it is exactly what an institutional buyer's diligence looks for.

**Verified scale of real use.** One organization in genuine use, by one
person: you. 29 AI requests lifetime. **There are no users and no
customers.**

---

## 3. What remains before commercial deployment

**Verified, in order of difficulty.**

| | Blocker | Nature |
| --- | --- | --- |
| 1 | Market-data licensing for external users | Contract, with a vendor lead time |
| 2 | No legal entity | Administrative, blocks DPAs and insurance |
| 3 | No production backup or PITR | Configuration, fails a security review |
| 4 | Platform AI provisioning | Engineering, plus the cost controls |
| 5 | Decision-integrity fixes unmerged | Engineering, PRs already open |
| 6 | Role separation untested with real accounts | One human in the test org |
| 7 | Global search broken for assets | Bug, found 2026-11-19 |
| 8 | No third-party security review, no SOC 2 | Time and money |

**Nothing on this list is a research problem.** That is genuinely good news:
every item is a known amount of work or a known contract. It also means
nothing on the list is a moat.

---

## 4. Why market data and AI infrastructure matter

**Market data.** A buy-side user expects a price next to a security. Today
the prices come from a single-seat EODHD subscription and two Yahoo
endpoints that are not a licensed product. **An API that answers is not a
licence.** Showing those prices to a client's users is redistribution, and
`price_history_cache` being shared across organizations makes that concrete
rather than theoretical. This is the one blocker with an external
dependency and an unknown price, so it has to start now.

**It is also the thing most likely to be mispriced in a plan.** End-user
display rights cost materially more than a seat. The number is **unknown**
and must come from a quote.

**One real mitigation, worth testing with prospects.** The decision record
does not depend on prices. A pilot where the firm keeps its terminal and
uses Tesseract only for reasoning removes the blocker entirely. If three
prospects say that is acceptable, the licensing item moves from blocker to
scheduled work, which materially changes what needs funding.

**AI.** The long-term thesis is that a connected decision corpus makes AI
useful here in a way generic chat is not. That requires platform-provided
AI, because asking a firm for its own Anthropic key during an evaluation is
a conversation that ends evaluations. The cost is small. See
[pilot-economics.md](pilot-economics.md): $18 to $35 per month for five
users (derived). **The work is controls, not spend**: the current limits are
not concurrency-safe, usage logging is fire-and-forget, and limits are
per-user rather than per-organization.

---

## 5. What design-partner validation would prove

The question investors will ask is not whether it works. It is whether
anyone will use it. These are the things only a design partner can
establish:

1. **That analysts write things down in it when nobody is watching.** The
   single highest-risk assumption in the business.
2. **That a PM records a rejection.** If PMs only record approvals, the
   corpus is half-built and the learning argument collapses.
3. **That someone reads a record they did not write.** This is the
   continuity claim, and it is the first place compounding value becomes
   observable.
4. **That a decision gets revisited.** Without this, Tesseract is a filing
   system with good hygiene.
5. **That a firm would object to it being switched off.** The only
   willingness-to-pay signal worth anything pre-revenue.

---

## 6. Metrics to gather

Durable artifacts, not engagement. Logins measure politeness.

| Metric | Why |
| --- | --- |
| Recommendations submitted with frozen reasoning, per user per month | The core act |
| Share of recommendations receiving a recorded decision | Does the PM participate |
| Share of decisions that are rejections or deferrals | Is the full record being built, or only the happy path |
| Reviews recorded per decision | Is the loop closing |
| Records read by someone other than the author | The continuity claim |
| Decisions revisited after 30 days | The compounding claim |
| Week-4 unprompted usage | Habit, not novelty |
| Time from recommendation to decision | A process improvement you can actually quantify |

**Target to aim at before raising (assumption):** three design partners,
each with at least one complete loop including a recorded review, and at
least one firm that says it would pay. That is a thin but real story.
Zero users with a good product is not a story.

---

## 7. What financing would fund

**Illustrative and milestone-based.** No target amount is proposed, because
an amount should follow from a priced plan with vendor quotes in it, and
those quotes do not exist yet.

**Milestone A: make a pilot legally and operationally possible.**
Legal entity, insurance, counsel for a DPA and a pilot agreement, production
backups and PITR, Supabase Pro, the decision-integrity merges, the search
fix, and a second test account for role verification. Small, mostly
administrative, and it unblocks everything.

**Milestone B: make a pilot commercially possible.**
Market-data licensing at end-user display tier, the single largest and least
known cost. Platform AI provisioning with the reservation layer. A
third-party security review or a credible questionnaire response.

**Milestone C: prove demand.**
Three to five design partners run to completion, with the metrics above.
Mostly founder time, plus the running costs from A and B.

**Milestone D: make it a company.**
First engineering hire, because the bus factor is one, and that will come up
in diligence. Then sales capacity only after a repeatable pilot.

**Sequencing judgement (assumption).** A and C can be done on very little. B
is where real money starts, and B should be deferred until C has produced
evidence, unless a prospect's requirements force it earlier. Raising before
C means raising on a product story with no demand evidence, which prices
badly. Raising after C, with three partners and one willingness-to-pay
signal, is a different conversation.

---

## 8. Key investor objections

Expect all of these. Short, honest answers below; none of them is fully
satisfying yet, which is itself the finding.

**"Why hasn't an incumbent built this?"**
Research-management incumbents sell document management and are structurally
oriented toward compliance archiving rather than decision quality.
Portfolio systems own positions and treat reasoning as a text field. The
honest answer is that it is not technically hard and nobody has made it a
priority, which is both the opportunity and the risk.

**"What stops a client doing this in a spreadsheet, or Notion?"**
Nothing stops them starting. What a spreadsheet cannot do is make a
recommendation immutable at submission, link four record types so a decision
is reviewable, or enforce that a deferral is captured. The real answer is
that many firms will use a spreadsheet, and the market is the subset who
have tried and found it does not hold.

**"This depends on analysts changing behaviour. Why will they?"**
The weakest point in the thesis, and it should be conceded as such. The
design is that the record accumulates as a side effect of work people
already do, rather than as a separate reporting step. Whether that is
sufficient is exactly what a design partner would establish, and it is
unproven.

**"You have no customers."**
Correct. There are none. The product was built first; demand validation
starts now. That is the right order for a workflow product in a domain the
founder knows, and it is a real risk.

**"You're not technical."**
The product exists, is substantially tested, and has a documented
engineering discipline around correctness. The mitigation is a first
engineering hire in milestone D, and the bus factor should be stated rather
than minimised.

**"Market data is a structural cost disadvantage."**
A fair challenge. The mitigation is that the product's value does not
require being the data provider: a firm can keep its terminal. If that
holds with prospects, market data becomes a feature rather than a
dependency.

**"Is this a feature of something bigger?"**
Possibly. The defence is the corpus: once a firm's decision history lives
here, that history is the product and it is not portable. That defence
requires time to be true and is not true yet.

---

## 9. The strongest evidence we have today

**Verified.**

1. **A complete, working decision lifecycle.** Not a prototype. All four
   decision outcomes exist as records in a live tenant, with frozen
   reasoning behind them.
2. **Unusual correctness discipline, documented.** Fabricated returns,
   phantom day changes and mislabelled execution directions were found by
   the team's own auditing and are being fixed rather than shipped. For an
   institutional buyer that is a stronger signal than any feature.
3. **Real engineering infrastructure.** ~12,900 tests, typecheck and
   tenant-isolation gates in CI, gates demonstrated to fail when they
   should.
4. **A founder with the domain problem.** The product reflects how the work
   actually happens, which is visible in the data model and is hard to fake.
5. **A credible AI thesis with a substrate behind it.** The corpus is typed
   and linked, which is the precondition for AI being useful here. Most
   competitors would have to build that first.

---

## 10. Evidence still missing

**This is the list that decides whether to raise now or in three months.**

1. **Any user other than the founder.** The largest gap, and everything else
   is downstream of it.
2. **Any evidence an analyst will maintain the record voluntarily.**
3. **Any evidence a PM will record a rejection.**
4. **Any willingness-to-pay signal.** No price has been tested with anyone.
5. **A reference price.** Question 10 in
   [discovery-questions.md](discovery-questions.md), asked of five firms.
6. **A market-data quote.** The largest unknown cost in the plan.
7. **A completed security review**, or a credible answer to one.
8. **Evidence of time-to-value.** How long from access to first complete
   loop. Unmeasured, and a core sales input.
9. **Retention of any kind.** Nothing has run long enough.

**The read.** The product is further along than the business by a wide
margin. The binding constraint is not engineering, and more features will
not relieve it. The highest-value next action is not in this repository: it
is five discovery conversations, which cost nothing, answer items 1, 3, 4
and 5, and would change what this memo says.

---

*Nothing in this memo is an offer of securities. No valuation, customer
commitment, revenue figure or vendor quote appears in it, and none should be
added without a source.*
