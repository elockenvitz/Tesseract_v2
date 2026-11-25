# Conditional letter of intent: discussion outline

**What this is.** A checklist of what to agree before anything is written
down, so that a conversation about intent covers the right ground.

**What this is not.** A legal agreement, a template to sign, or a document
to send without counsel. It creates no obligation on either party. Anything
actually signed must be drafted or reviewed by a lawyer, and there is
currently no legal entity to sign on Tesseract's behalf.

**Why bother with a conditional LOI at all.** Not to create obligation. To
force both sides to be specific. A firm that will not name an executive
sponsor or specific users is not as interested as the conversation
suggested, and discovering that in a document is cheaper than discovering it
in month three of a pilot.

---

## 1. The institution

- Legal entity name, and whether the signing entity is the same one whose
  users would use the product.
- Regulatory status and jurisdiction, because it drives the data and
  retention requirements.
- Approximate size of the investment team, which sets the eventual scope.

## 2. Executive sponsor

- Named individual, with authority to commit budget or a documented path to
  someone who has.
- **Test:** will this person attend the review sessions themselves? A
  sponsor who delegates every session is not a sponsor.

## 3. Named pilot users

- Specific people, by name and role, not a headcount.
- **At least one must be a decision-maker.** An evaluation run entirely by
  analysts cannot test the decision half of the product.
- Who sets up their access, and how identity is handled.

## 4. Intended use cases

- Which part of their process the pilot covers, as a slice: one sector, one
  strategy, one team.
- Which specific workflow they will move into Tesseract rather than
  duplicating. Duplication guarantees abandonment.
- What explicitly stays where it is.

## 5. Functional requirements

- What must exist for the pilot to be useful to them, separated into:
  - **Already built**, which they have seen.
  - **Required and not built**, with our estimate and no commitment implied.
  - **Nice to have**, which is recorded and not promised.
- Anything in the second category is a dependency on us and should be named
  as one.

## 6. Commercial data rights

**The item most likely to stop a pilot. Do not leave it to the end.**

- Which market data their users need to see: prices, historical series,
  news, fundamentals, corporate actions.
- Whether the firm already holds an entitlement that could cover their own
  users.
- Whether they would accept a pilot with **no** market data, using their
  existing terminal alongside Tesseract. This is a genuinely viable option
  and worth asking directly, because the decision record does not depend on
  prices.
- Who holds the licence, and who is liable for a breach of its terms.
- See [pilot-economics.md](pilot-economics.md) for the current state.

## 7. AI provisioning

- Whether ACT AI is in scope for the pilot at all.
- If yes: whose provider key. Today it must be theirs.
- Where their prompts and data go, which provider, under what terms, and
  whether that provider trains on it.
- Their policy on sending investment research to a third-party model
  provider. Some firms prohibit it outright, and finding that out early
  changes the pilot's shape.
- Any budget or usage ceiling they want applied.

## 8. Security review

- Their process, and realistically how long it takes. Assume weeks.
- Expect to be asked for: an information-security questionnaire, a
  penetration test report, SOC 2 status, data residency, encryption at rest
  and in transit, backup and recovery, breach notification, subprocessor
  list, and business continuity.
- **Be straight about what does not exist.** There is no SOC 2, no
  third-party penetration test, and production backups are not currently
  enabled. A firm that discovers these in a questionnaire after being told
  the platform was secure will end the conversation.

## 9. Evaluation period

- Start and end dates.
- The review cadence, with a mid-point checkpoint.
- What happens to their data at the end, in both outcomes.
- An exit on either side, with notice, for any reason.

## 10. Indicative pricing

- **Structure** rather than a number: per named user, annual term, with a
  floor.
- What is in and what is passed through, particularly market data and AI.
- Explicitly: pricing is indicative, is not an offer, and is subject to
  change.
- Any preferential terms discussed for a founding partner, recorded as
  intent rather than a commitment.

**Do not state a price before several discovery conversations have produced
a reference point.** A number in a document becomes the anchor whether it
was meant to or not.

## 11. Potential commercial rollout

- What would have to be true for them to go from pilot to paid.
- Who else would need to approve it.
- Their budget cycle, which often sets the real timeline regardless of
  product readiness.

## 12. Nonbinding conditions

State plainly, in the document:

- Nothing in it obliges either party to enter a commercial agreement.
- It does not commit the firm to any payment.
- It does not commit Tesseract to deliver any specific functionality by any
  date.
- Either party may stop at any time, for any reason.
- It is not a purchase order, a reseller arrangement, or an exclusivity
  grant.
- Any confidentiality obligation is governed by a separate agreement, not by
  this one.

## 13. Legal review

- **Both sides get counsel before anything is signed.**
- There is no Tesseract legal entity today. One is a prerequisite for any
  signed document, and for any data processing agreement.
- A data processing agreement is likely required before their data enters
  the system in production use, depending on jurisdiction.
- Do not sign a firm's standard vendor agreement without review. Those
  documents routinely contain availability guarantees, liability caps and
  indemnities that a pre-revenue company cannot carry.

---

## Record of outcome

Whatever is agreed, record it against the firm's row in
[design-partner-framework.md](design-partner-framework.md) under the
interest classification. A signed conditional LOI is **nonbinding
interest**. It is not revenue, it is not a customer, and it must never be
presented to an investor as either.
