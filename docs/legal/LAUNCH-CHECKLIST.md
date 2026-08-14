# Launch checklist — what has to be true before this is a product

**Status as of 2026-08-14: pre-release.** No legal entity, no domain, no paying
customers, a handful of friendly testers, no real client holdings.

That last sentence is what sets the priority of everything below, and it is
worth re-reading whenever this document is picked up. Most compliance
obligations attach to a *commercial service handling real customer data*.
Tesseract is not that yet, and the correct amount of work to do today is much
smaller than it will be the week before the first customer signs.

## The correction that produced this file

An earlier pass through the codebase concluded that the absence of a posted
privacy policy was a live violation, and drafted one to be published
immediately. That was calibrated to what the *database* looked like —
27 organizations, real-looking portfolios, uploaded documents — not to what
was actually happening, which is one person testing with synthetic data.

CalOPPA, CCPA, GLBA and Reg S-P all key off a commercial service, real
consumers, or a customer contract. None of those exist here yet. The drafted
documents are preparation, not remediation, and the pages have been
unpublished accordingly: a privacy policy naming a legal entity that does not
exist is worse than no privacy policy, because it is a false statement rather
than a missing one.

**What was genuinely worth doing regardless** — and was done — is the
engineering. A publicly readable storage bucket and a storage policy with no
tenant condition are defects whether the data in them is real or synthetic,
and they would have shipped straight into the first real deployment.

---

## Now — while testing, no real data

- [ ] **Tell testers in writing that this is a test build**, and that they must
      not enter real client holdings, real MNPI, or anything they would mind
      being lost. One paragraph in the invite email is enough. This single
      step is what keeps the risk at approximately zero, and it is worth more
      than every document in this directory put together.
- [ ] Keep it that way. The moment someone loads a real book, the rest of this
      list becomes live.

Nothing else on this page is urgent today.

## Before the first real client data enters — whoever it belongs to

- [ ] **Form the entity.** Without one you are personally liable for a breach:
      no corporate veil, no insurance, and the counterparties are regulated
      firms whose portfolio holdings you would be holding.
- [ ] Get a domain and a `privacy@` address that someone actually reads.
- [ ] Fill in and publish the policy and terms — see *Publishing* below.
- [ ] Confirm in writing that the AI providers do not train on submitted
      content. `DATA-INVENTORY.md` §3 lists who receives what.
- [ ] Decide the retention position. Today nothing is deleted on a timer.

## Before the first paying customer or signed contract

- [ ] DPA ready to sign — `DPA.draft.md`, lawyer-reviewed.
- [ ] Incident response plan adopted and **rehearsed once**
      (`INCIDENT-RESPONSE.draft.md`). The 72-hour Reg S-P notification
      obligation arrives with the first customer contract, not later.
- [ ] Cyber liability insurance.
- [ ] A securities lawyer's view on Advisers Act Rule 204-2 — whether holding
      advisers' research makes this a recordkeeping system, and what retention
      and production duties follow. This one shapes the product, not just the
      paperwork, so ask early.
- [ ] Expect SOC 2 to be asked for. "Not yet, planned for X" is survivable;
      a false attestation is not.

## Publishing the legal pages

The pages live at `docs/legal/site/`. They are not served today.

1. Move them back to `public/legal/`.
2. Restore the two redirect rules — the commented block at the top of
   `public/_redirects` has them, and they must sit **above** the catch-all.
3. Fill in every highlighted placeholder: legal entity, jurisdiction, privacy
   contact email, postal address, governing law and forum, effective date.
   Unfilled ones render in yellow on the live page on purpose.
4. Re-enable the assertions in `src/lib/storage/legal-pages.test.ts`.
5. Have a lawyer read them first. They are accurate to the software; that is
   not the same as being sufficient.

## What is already done and does not need revisiting

- Storage is private and tenant-scoped; proven with a live cross-org test
  (15/15 — another org's rows and files are unreachable, own-org still works).
- User and organization erasure exist and are verified end-to-end (11/11),
  including that a refused erasure changes nothing.
- Deleting a note, model or attachment removes the underlying file.
- Sentry session-replay masking is pinned rather than inherited.
- `DATA-INVENTORY.md` records what is collected and who receives it, and is
  the document to keep current as the product changes.
