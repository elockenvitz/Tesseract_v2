/**
 * The legal document registry — one versioned source per document.
 *
 * ── The single-source rule ───────────────────────────────────────────────
 *
 * Each document exists exactly once, as markdown under `docs/legal/`. This
 * registry points at it. Nothing re-types legal text into a component, and
 * there is no second copy to drift.
 *
 * That rule was adopted because a second copy already existed: the drafts in
 * `docs/legal/*.md` and hand-maintained HTML in `docs/legal/site/*.html` said
 * overlapping things, and a reader had no way to know which governed. The HTML
 * pair is retired by this change and `scripts/publish-legal.mjs` generates
 * what gets served instead.
 *
 * ── How a document reaches a visitor ─────────────────────────────────────
 *
 *   docs/legal/**.md          the source, reviewed in a pull request
 *          │
 *          │  npm run legal:publish   (an explicit, auditable act)
 *          ▼
 *   public/legal/<id>.md      gitignored, so a draft cannot be committed
 *          │                  into the served directory by accident
 *          ▼
 *   GET /legal/<id>.md        fetched at runtime by LegalDocumentPage
 *
 * The copy step is deliberate. Importing the markdown into the bundle would
 * put draft legal text on the CDN the moment the branch deployed, discoverable
 * by anyone who enumerates assets. A copy script that REFUSES to run while any
 * document is still a draft is a gate; a bundler import is not.
 *
 * ── Status is not a label ────────────────────────────────────────────────
 *
 * `status: 'draft'` is load-bearing. A draft cannot be published by the script
 * without `--preview`, and when previewed it renders behind an unmissable
 * banner. **A document does not become approved by being committed.** It
 * becomes approved when counsel has read it and the founder records the date
 * here, which is a separate commit that a reviewer can see.
 */

/** Which agreement a document is, for routing and for the acceptance record. */
export type LegalDocumentId =
  | 'terms-of-use'
  | 'privacy-policy'
  | 'cookie-notice'
  | 'financial-ai-disclosures'
  | 'application-terms'

export type LegalDocumentStatus = 'draft' | 'approved'

export interface LegalDocument {
  id: LegalDocumentId
  /** Title as shown to a reader. */
  title: string
  /** One line for the index page and the footer's title attribute. */
  summary: string
  /** Path to the single source, relative to the repository root. */
  source: string
  /**
   * Semantic version of the document's TEXT.
   *
   * This is what an acceptance record stores, so it must change whenever the
   * substance changes. Patch for a typo, minor for a clarification, major for
   * a change that alters obligations and therefore needs re-acceptance.
   */
  version: string
  status: LegalDocumentStatus
  /**
   * The date the founder recorded counsel's approval. `null` while draft.
   * A non-null date on a `draft` document is a contradiction and the registry
   * test fails on it.
   */
  effectiveDate: string | null
  /**
   * Whether an Authorised User must affirmatively accept this document.
   *
   * Only the two documents that create obligations for an individual user.
   * A privacy policy is a NOTICE: bundling it into a single "I agree"
   * checkbox misrepresents a disclosure as a contract, and conflating it with
   * marketing consent would be worse. It is linked, not accepted.
   */
  requiresAcceptance: boolean
}

export const LEGAL_DOCUMENTS: readonly LegalDocument[] = [
  {
    id: 'terms-of-use',
    title: 'Website Terms of Use',
    summary: 'The terms that govern use of this website.',
    source: 'docs/legal/policies/terms-of-use-draft.md',
    version: '0.1.0-draft',
    status: 'draft',
    effectiveDate: null,
    requiresAcceptance: false,
  },
  {
    id: 'privacy-policy',
    title: 'Privacy Policy',
    summary: 'What personal information is collected, why, and who receives it.',
    source: 'docs/legal/policies/privacy-policy-draft.md',
    version: '0.1.0-draft',
    status: 'draft',
    effectiveDate: null,
    requiresAcceptance: false,
  },
  {
    id: 'cookie-notice',
    title: 'Cookie and Local Storage Notice',
    summary: 'Tesseract sets no cookies. What it does store, and why.',
    source: 'docs/legal/policies/cookie-notice-draft.md',
    version: '0.1.0-draft',
    status: 'draft',
    effectiveDate: null,
    requiresAcceptance: false,
  },
  {
    id: 'financial-ai-disclosures',
    title: 'Investment and AI Disclosures',
    summary:
      'Tesseract is software, not an adviser. What the data is, what the AI is, and what neither is.',
    source: 'docs/legal/policies/financial-ai-disclosures-draft.md',
    version: '0.1.0-draft',
    status: 'draft',
    effectiveDate: null,
    requiresAcceptance: true,
  },
  {
    id: 'application-terms',
    title: 'Application Terms of Service',
    summary: 'The terms that govern use of the Tesseract application.',
    source: 'docs/legal/policies/application-terms-draft.md',
    version: '0.2.0-draft',
    status: 'draft',
    effectiveDate: null,
    requiresAcceptance: true,
  },
] as const

/** Public route for a document. Kept in one function so links cannot drift. */
export function legalPath(id: LegalDocumentId): string {
  return `/legal/${id}`
}

/** Where the published copy is served from, if it has been published. */
export function legalAssetPath(id: LegalDocumentId): string {
  return `/legal/${id}.md`
}

export function getLegalDocument(id: string): LegalDocument | undefined {
  return LEGAL_DOCUMENTS.find(d => d.id === id)
}

/** The documents an Authorised User must affirmatively accept. */
export function documentsRequiringAcceptance(): LegalDocument[] {
  return LEGAL_DOCUMENTS.filter(d => d.requiresAcceptance)
}

/**
 * The identity an acceptance record stores: which document, which text.
 *
 * A record that stored only the id would be unable to answer the only
 * question that matters in a dispute — *which words* did this person accept.
 */
export function acceptanceDocumentKey(d: LegalDocument): string {
  return `${d.id}@${d.version}`
}

/** True when every acceptance-required document has been approved. */
export function allAcceptanceDocumentsApproved(): boolean {
  return documentsRequiringAcceptance().every(d => d.status === 'approved')
}

export function anyDocumentIsDraft(): boolean {
  return LEGAL_DOCUMENTS.some(d => d.status === 'draft')
}
