# Legal and compliance documents

**Nothing here has been reviewed by a lawyer. Do not publish or sign any of it
as-is.**

These were written by an engineer from the actual codebase and a live read of
the production database on 2026-08-14, so that counsel can start from what the
software genuinely does rather than reverse-engineering it.

| File | Status | What it is |
|---|---|---|
| `DATA-INVENTORY.md` | **Factual** | What is collected, where it goes, who receives it, what deletion really does. Everything else derives from this. |
| `SUBPROCESSORS.md` | **Factual — publishable** | The third parties that receive data. Customers ask for this in diligence. |
| `PRIVACY-POLICY.draft.md` | Draft | Required in practice: CalOPPA obliges a posted policy for any commercial site collecting personal info from Californians. |
| `TERMS-OF-SERVICE.draft.md` | Draft | Boilerplate except the ★ clauses — not-advice, AI, recordkeeping, liability cap. |
| `DPA.draft.md` | Draft | What enterprise customers will require. ⚠ clauses commit to things not yet built. |
| `INCIDENT-RESPONSE.draft.md` | Draft | The 72-hour Reg S-P commitment and how to actually meet it. |

## The one rule these follow

**They do not promise anything the code does not do.**

Deletion is the worked example. When these were first drafted there was no
erasure path at all, so the privacy policy described suspension. Erasure now
exists — `erase_user_personal_data()` for a person, and the two erase-organization
scripts for a whole customer — so the policy was rewritten to describe erasure.
It still stops short of promising a self-service data export, because that
genuinely does not exist.

That is the intended cycle: build the capability, then widen the promise. Doing
it the other way round creates exactly the liability this exercise avoids.

## Read these first

- `DATA-INVENTORY.md` §4 — deletion reality
- `DATA-INVENTORY.md` §8 — three closed exposures a regulator or customer may
  ask about, including a publicly-readable storage bucket up to 2026-08-14
- `DATA-INVENTORY.md` §9 — the five questions for counsel

## Keeping them true

They are only useful while accurate. Re-check when you:

- add a third-party service that receives data → `SUBPROCESSORS.md`
- add or change a data-deleting path → inventory §4 and the privacy policy
- change what the AI features transmit → inventory §3 and the privacy policy
- change retention → inventory §5

An out-of-date privacy policy is a misrepresentation, not just stale docs.
