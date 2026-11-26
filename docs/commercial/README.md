# Commercial launch package

Everything needed to start design-partner conversations, in the order you
would actually use it.

| Document | Use it when |
| --- | --- |
| [product-overview.md](product-overview.md) | You need one page to send a PM or CIO before a call. |
| [outreach-templates.md](outreach-templates.md) | You are writing the first email. |
| [discovery-questions.md](discovery-questions.md) | You are on the call and want to test demand, not collect compliments. |
| [demo-script-90s.md](demo-script-90s.md) | You are recording the short intro video. |
| [demo-walkthrough.md](demo-walkthrough.md) | You are running or recording the full demonstration. |
| [demo-checklist.md](demo-checklist.md) | You are about to demo or record, and want it not to break. |
| [design-partner-framework.md](design-partner-framework.md) | A firm has said yes and you need to describe what happens next. |
| [loi-outline.md](loi-outline.md) | A firm wants to put intent in writing. |
| [fundraising-readiness.md](fundraising-readiness.md) | You are deciding what to raise and what it funds. |
| [pilot-economics.md](pilot-economics.md) | You need to know what a first external pilot actually costs and requires. |

## Read this part first

These documents are written to be accurate rather than flattering, because
the alternative fails on contact with a portfolio manager. Three facts shape
all of them, and they are stated in every document that touches them:

1. **There is no commercial market-data licence.** Prices, charts and news
   work technically. Nothing establishes the right to redistribute them to
   an external pilot user. See [pilot-economics.md](pilot-economics.md).

2. **Platform-provisioned AI does not exist.** `platform_ai_enabled` is
   `false` in production. ACT AI runs on a key the firm supplies. The
   per-user limits that exist are not concurrency-safe and are not
   per-organization.

3. **Several decision-integrity fixes are not merged.** Outcome attribution,
   execution direction, review timestamps and the deferred-shown-as-rejected
   defect all have open PRs. Until they land, the Outcomes surface shows
   numbers we know are wrong, and the demo must not go there. See
   [demo-checklist.md](demo-checklist.md).

Nothing in this package asserts a customer, a revenue figure, a valuation,
a vendor quote or a performance result. Where a number is an assumption it
says so in the same sentence.
