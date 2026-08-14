# Privacy Policy — DRAFT, NOT LEGAL REVIEWED

> **Do not publish this as-is.** It was drafted from `DATA-INVENTORY.md` by an
> engineer, not a lawyer. Every bracketed `[…]` is a fact only you can supply.
> The notes in blockquotes are for your counsel and should be deleted before
> publication.
>
> One drafting rule was followed throughout: **it does not promise anything the
> code does not do.** The deletion section describes erasure because erasure
> now exists; it stops short of promising a self-service data export because
> that does not. If you shorten this document, do not shorten it by making the
> promises broader.

**Effective date:** [DATE]
**Last updated:** [DATE]

---

## Who we are

Tesseract is research and decision software for investment teams, operated by
[LEGAL ENTITY NAME], [JURISDICTION]. You can reach us at [PRIVACY CONTACT
EMAIL].

## Two different roles

Most of what Tesseract stores is information your firm puts into it — research
notes, investment theses, portfolio holdings, trade decisions. For that
information **your firm decides what is collected and why, and we act on your
firm's instructions.** In data-protection terms, your firm is the controller
and we are the processor. If you are an employee of a customer firm and want
that information changed or removed, ask your firm first; we act on their
instruction.

For the information we hold about you as a user of the service — your name,
email, how you use the product — **we decide, and this policy governs.**

## What we collect

**Account information.** Your name, email address, which organization you
belong to, and your role within it.

**Usage information.** Records of what you do in the product: what you viewed
and edited, when, and from which organization. This drives audit history,
notifications and activity feeds. Some of it exists specifically so your firm
can reconstruct who made which investment decision and when.

**Content you create.** Research notes, theses, price targets, ratings, trade
ideas, simulations, portfolio and holdings data, workflow state, and any files
you upload.

**Technical information.** Browser and device information, and error diagnostics
when something goes wrong — see *Error monitoring* below.

We do not use cookies for advertising, and we do not sell personal information.

## Error monitoring and session recording

When the application encounters an error, we send diagnostic information to
**Sentry**, our error-monitoring provider. For sessions that hit an error, this
includes a **replay of the session** — a reconstruction of what was on screen —
so we can see what went wrong. Sessions that do not error are never recorded.

Replays are captured with text, form inputs and media masked, so the content of
your research should not be legible in them. [CONFIRM WITH COUNSEL WHETHER YOU
WANT TO STATE THIS AS A GUARANTEE.] We do not attach IP addresses or cookies to
these reports.

> Note for counsel: this is disclosed prominently because session replay is the
> item most often challenged in customer security reviews. Under-disclosing it
> is the bigger risk.

## Artificial intelligence

Tesseract includes AI features. **When you use them, the relevant content is
sent to a third-party AI provider to generate a response.** Depending on what
your organization has configured, that content can include asset information,
investment theses, note content, outcomes, and portfolio and holdings data.

Our current providers are **Anthropic** (default), **OpenAI**, **Google**, and
**Perplexity**. Perplexity's models are search-augmented, meaning your query may
be used to retrieve information from the public web.

We do not use your content to train our own models. [WE HAVE AGREEMENTS WITH
THESE PROVIDERS THAT THEY DO NOT TRAIN ON YOUR CONTENT — **confirm in writing
per provider before stating this**.]

If your organization supplies its own AI provider key, the content goes to that
provider under **your organization's** agreement with them, not ours.

AI output can be wrong. It supports your judgement; it does not replace it, and
it is not investment advice.

## Who else we share information with

We share information only with providers that help us run the service:

| Provider | Purpose |
|---|---|
| Supabase | Database and file storage (United States) |
| Netlify | Application hosting |
| Anthropic, OpenAI, Google, Perplexity | AI features, when used |
| Sentry | Error monitoring and session replay |
| Alpha Vantage, Yahoo, Polygon, Finnhub | Market data. They receive ticker symbols, not your research |

A current list is maintained at [SUBPROCESSOR LIST URL].

We also disclose information where the law requires it, and to a successor
entity in the event of a merger or acquisition.

## Where information is held

In the United States. [IF YOU HAVE EU/UK USERS, ADD A TRANSFER MECHANISM —
STANDARD CONTRACTUAL CLAUSES — AND SAY SO.]

## How long we keep it

We keep your firm's content for as long as your firm's account is active,
because it is their business record and in many cases something they are
required to retain.

Audit logs are retained for a period your organization's administrators
configure.

> Note for counsel: this is the honest position. There is no *scheduled*
> deletion of notes, research, holdings history or uploaded files — deletion
> happens on request, not on a timer. Do not add a retention period here that
> nothing enforces.

## Your choices

You can view and correct your account information in the product.

**Access, correction and deletion.** For content your firm controls, contact
your firm's administrator. For your account information, contact us at [PRIVACY
CONTACT EMAIL].

**On deleting your personal information.** On request from you or your firm's
administrator, we will erase your personal information: your name and email
address, your preferences, saved views and layouts, your notifications, your AI
prompt history, and your calendar connections. Your login is removed and your
access ends.

**The work you authored stays.** Research notes, theses, ratings and investment
decisions remain, attributed to "Former user" rather than to you. We keep them
because they are your firm's business records — your firm, not us and not you
individually, decides what happens to them — and because a regulated firm is
required by law to retain them. If you want them removed, that is a request to
make of your firm.

If your firm's account ends, we delete its data and files in full on request.

> Note for counsel: this now matches the software. `erase_user_personal_data()`
> performs the erasure; `scripts/erase-organization.mjs` and its SQL companion
> do the organization. The retention-of-authored-content split is a deliberate
> position — see `DATA-INVENTORY.md` §4 — and is the part most worth your
> review, because it is where an individual's erasure right meets the firm's
> recordkeeping obligation.
>
> Still not built: a self-service data export. A DSAR asking for a *copy* of
> personal data is a manual job today.

**California residents.** [ADD CCPA/CPRA RIGHTS IF THRESHOLDS ARE MET. NOTE
CCPA COVERS B2B CONTACTS.]

**EU/UK residents.** [ADD GDPR RIGHTS AND LEGAL BASES IF IN SCOPE.]

## Security

Customer data is separated by organization and access is enforced at the
database level. Access to production systems is limited to personnel who need
it. [DESCRIBE ENCRYPTION AT REST AND IN TRANSIT ONCE CONFIRMED.]

If we become aware of unauthorized access to your information, we will notify
the affected organization without undue delay and in any event within the
timeframes required by our customer agreements and applicable law. See our
incident response commitments in your customer agreement.

## Children

Tesseract is business software and is not directed to anyone under 18.

## Changes

We will post any change here and update the date above. For material changes we
will notify organization administrators.

## Contact

[PRIVACY CONTACT EMAIL]
[POSTAL ADDRESS]
