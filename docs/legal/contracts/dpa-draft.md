# Data Processing Addendum — DRAFT, NOT LEGAL REVIEWED

> This is the document enterprise customers will send you their own version of.
> Having a credible one ready shortens diligence considerably; signing theirs
> unread is how you end up with obligations the software cannot meet.
>
> Drafted from `DATA-INVENTORY.md`. Clauses marked **⚠** commit you to something
> the product does not currently do — build it or negotiate it, do not sign it.

Between **[LEGAL ENTITY]** ("Processor") and the customer ("Controller"),
supplementing the Agreement.

---

## 1. Roles

Controller determines the purposes and means of processing Customer Data.
Processor processes it only on Controller's documented instructions, which
include the Agreement and Controller's configuration and use of the Service.

Processor is an independent controller for account data about Controller's
personnel (name, business email, role, authentication and usage records)
strictly for operating and securing the Service.

## 2. Subject matter and duration

Processing continues for the term of the Agreement plus the return/deletion
period in §9.

**Categories of data subjects:** Controller's personnel and authorized users.

**Categories of personal data:** name, business email, organizational role,
authentication records, product usage and audit records, and any personal data
Controller includes in content it uploads.

**Nature and purpose:** hosting, storage, retrieval, search, analysis and
display of investment research and decision records; provision of AI features
where enabled by Controller.

**Special categories:** none intended. Controller should not upload special
category data.

## 3. Confidentiality

Processor ensures personnel authorized to process Customer Data are bound by
confidentiality obligations and receive appropriate training.

## 4. Security

Processor maintains technical and organizational measures appropriate to the
risk, including:

- Logical separation of each Controller's data, enforced at the database layer
- Access control limiting production access to personnel who require it
- Encryption in transit; encryption at rest as provided by the hosting platform
- Time-limited, signed access URLs for stored files rather than public links
- Audit logging of access to and modification of Customer Data

**⚠ Do not add SOC 2, penetration testing, or a formal vulnerability-management
programme here until they exist.** Customers will ask; "not yet, planned for
[DATE]" is a survivable answer and a false attestation is not.

## 5. Subprocessors

Controller authorizes the subprocessors listed at [SUBPROCESSOR LIST URL].

Processor will give Controller **[30] days'** notice before adding a
subprocessor, during which Controller may object on reasonable data-protection
grounds; if the objection cannot be resolved, Controller may terminate the
affected Service without penalty.

Processor imposes data protection obligations on each subprocessor no less
protective than those in this DPA, and remains liable for their performance.

**AI providers:** Controller acknowledges that enabling AI features transmits
the Customer Data described in the documentation to the applicable AI provider.
Where Controller supplies its own provider credentials, that provider is
Controller's subprocessor and Processor is not responsible for its processing.

## 6. Security incidents

Processor will notify Controller **without undue delay and in any event within
72 hours** of becoming aware of a Security Incident affecting Customer Data,
and will provide the information reasonably available to Controller to meet its
own notification obligations.

> This mirrors amended SEC Reg S-P, which requires covered advisers to hold
> service providers to exactly this. It is not negotiable in practice — see
> `INCIDENT-RESPONSE.draft.md`, which is what makes it deliverable.

## 7. Assistance

Processor will provide reasonable assistance with data subject requests, data
protection impact assessments, and consultations with supervisory authorities,
taking into account the nature of processing and the information available.

**Data subject requests.** On Controller's instruction, Processor will erase an
individual's personal data — identity, preferences, saved views, notifications,
AI prompt history and login. Content that individual authored is **retained as
Controller's business record** and re-attributed to a non-identifying label.
Controller acknowledges this split is necessary for Controller's own
recordkeeping obligations, and that a request to delete authored content is a
matter between Controller and its personnel.

**⚠ Processor has no self-service export.** A request for a *copy* of personal
data is fulfilled manually. Do not agree to an automated-export SLA.

## 8. Audits

Processor will make available information reasonably necessary to demonstrate
compliance, and will allow audits by Controller or its auditor **no more than
once per twelve months**, on reasonable notice, during business hours, subject
to confidentiality, at Controller's cost. Processor may satisfy this with a
current third-party report where one exists.

## 9. Return and deletion

Within **[30] days** of termination, Processor will, at Controller's election,
return Customer Data in a machine-readable format or delete it, save where
retention is required by law.

Organization erasure is implemented and operator-run: it removes every row
carrying the organization's identifier and every file stored under it.
**⚠ It is irreversible and has not yet been exercised against a real
organization** — rehearse it on a disposable org before committing to a window.
Export remains manual; `org-exports` provides job infrastructure only.

Controller acknowledges that where Controller is subject to recordkeeping
obligations (including SEC Advisers Act Rule 204-2), Controller is responsible
for retaining its own records independently of the Service.

## 10. International transfers

Processing occurs in the United States. **[IF EU/UK DATA IS IN SCOPE, ATTACH
STANDARD CONTRACTUAL CLAUSES AND THE UK ADDENDUM, AND COMPLETE A TRANSFER
IMPACT ASSESSMENT.]**

## 11. Precedence

In conflict with the Agreement, this DPA governs as to processing of personal
data.

---

**Annex 1 — Subprocessors:** see `SUBPROCESSORS.md`
**Annex 2 — Technical and organizational measures:** §4 above
