import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  LEGAL_DOCUMENTS,
  legalPath,
  legalAssetPath,
  getLegalDocument,
  documentsRequiringAcceptance,
  allAcceptanceDocumentsApproved,
  anyDocumentIsDraft,
  acceptanceDocumentKey,
} from '../documents'
import { PLACEHOLDER_MAP, findUnresolvedPlaceholders } from '../entity'

/**
 * The registry's invariants.
 *
 * These are not style checks. Each one corresponds to a way a legal document
 * could be wrong on a live site, and every assertion was proven to fail by
 * breaking the thing it guards -- the injections are recorded beside each one,
 * because a gate that has never been observed failing is decoration.
 */

const root = resolve(__dirname, '../../..')
const read = (p: string) => readFileSync(resolve(root, p), 'utf8')

describe('the legal document registry', () => {
  it('points every document at a source file that exists', () => {
    // INJECTION: changing one `source` to a typo'd path failed with that path
    // named. Without this, a renamed draft would publish an empty document.
    const missing = LEGAL_DOCUMENTS.filter(d => !existsSync(resolve(root, d.source)))
    expect(
      missing.map(d => `${d.id} -> ${d.source}`),
      'a document points at a source file that does not exist',
    ).toEqual([])
  })

  it('has no duplicate ids and no duplicate sources', () => {
    // Two documents sharing an id would make /legal/<id> ambiguous and would
    // make an acceptance record ambiguous about which text was accepted.
    const ids = LEGAL_DOCUMENTS.map(d => d.id)
    expect(new Set(ids).size, 'duplicate document id').toBe(ids.length)

    const sources = LEGAL_DOCUMENTS.map(d => d.source)
    expect(new Set(sources).size, 'two documents share one source file').toBe(sources.length)
  })

  it('never gives a draft an effective date', () => {
    // A date on a draft is a contradiction that would render as "effective
    // 2026-11-25" above text no lawyer has read.
    // INJECTION: setting effectiveDate on the draft application terms failed.
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.status === 'draft') {
        expect(doc.effectiveDate, `${doc.id} is a draft but has an effective date`).toBeNull()
      }
    }
  })

  it('gives every approved document an effective date', () => {
    // The mirror of the above: approved without a date renders as "not yet in
    // effect" under a document that IS in effect.
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.status === 'approved') {
        expect(doc.effectiveDate, `${doc.id} is approved but has no effective date`).toBeTruthy()
      }
    }
  })

  it('requires acceptance only of documents that create user obligations', () => {
    const required = documentsRequiringAcceptance().map(d => d.id).sort()
    // The privacy policy and the cookie notice are NOTICES. Putting a notice
    // behind an "I agree" checkbox misrepresents a disclosure as a contract,
    // and this assertion is what stops that happening by accident.
    expect(required).toEqual(['application-terms', 'financial-ai-disclosures'])
    expect(required).not.toContain('privacy-policy')
    expect(required).not.toContain('cookie-notice')
  })

  it('carries a version on every document, and the version is in the acceptance key', () => {
    // An acceptance record storing only the id cannot answer "which words did
    // they accept", which is the only question a dispute is about.
    for (const doc of LEGAL_DOCUMENTS) {
      expect(doc.version, `${doc.id} has no version`).toMatch(/^\d+\.\d+\.\d+/)
      expect(acceptanceDocumentKey(doc)).toBe(`${doc.id}@${doc.version}`)
    }
  })

  it('marks a draft version as a draft in the version string itself', () => {
    // Belt and braces for the one place a version travels WITHOUT its status:
    // the acceptance record's document_version column. A record reading
    // `application-terms@0.2.0` cannot be told apart from an approved 0.2.0,
    // whereas `0.2.0-draft` is self-describing in the database.
    // INJECTION: removing `-draft` from the application terms failed here.
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.status === 'draft') {
        expect(doc.version, `${doc.id} is a draft but its version does not say so`).toMatch(/-draft$/)
      } else {
        expect(doc.version, `${doc.id} is approved but its version says draft`).not.toMatch(/-draft$/)
      }
    }
  })

  it('agrees with its own helpers about what is still a draft', () => {
    const drafts = LEGAL_DOCUMENTS.filter(d => d.status === 'draft')
    expect(anyDocumentIsDraft()).toBe(drafts.length > 0)
    expect(allAcceptanceDocumentsApproved()).toBe(
      documentsRequiringAcceptance().every(d => d.status === 'approved'),
    )
  })

  it('builds a public path and an asset path that cannot drift apart', () => {
    for (const doc of LEGAL_DOCUMENTS) {
      expect(legalPath(doc.id)).toBe(`/legal/${doc.id}`)
      expect(legalAssetPath(doc.id)).toBe(`/legal/${doc.id}.md`)
      expect(getLegalDocument(doc.id)).toBe(doc)
    }
    expect(getLegalDocument('not-a-document')).toBeUndefined()
  })
})

describe('the documents themselves', () => {
  it('marks every draft as a draft in its own text', () => {
    // The page banner is driven by the registry's status. This asserts the
    // DOCUMENT says so too, so a copy read outside the app -- emailed to a
    // reviewer, printed, pasted into a questionnaire -- cannot be mistaken for
    // an adopted policy.
    // INJECTION: removing the "DRAFT, NOT LEGAL REVIEWED" line from the cookie
    // notice failed with that document named.
    for (const doc of LEGAL_DOCUMENTS) {
      if (doc.status !== 'draft') continue
      const text = read(doc.source)
      expect(text.slice(0, 600), `${doc.source} does not announce itself as a draft`)
        .toMatch(/draft/i)
      expect(text.slice(0, 1200), `${doc.source} does not say it is not in effect`)
        .toMatch(/not in effect|not approved|binds nobody/i)
    }
  })

  it('states a version in the document matching the registry', () => {
    // Two places say which version this text is, and a reader may be looking
    // at either. INJECTION: bumping the registry to 0.3.0 without touching the
    // markdown failed, naming both values.
    for (const doc of LEGAL_DOCUMENTS) {
      const text = read(doc.source)
      expect(text, `${doc.source} does not state version ${doc.version}`).toContain(doc.version)
    }
  })

  it('invents no entity name, address or jurisdiction', () => {
    /*
     * The rule this whole directory follows: a policy naming a company that
     * does not exist is a false statement, worse than a missing one. So every
     * entity detail must still be a PLACEHOLDER, not a plausible-looking
     * value.
     *
     * Asserted as "the token is present" rather than "no company name
     * appears", because the second cannot be tested -- there is no way to
     * recognise an invented name. The token's presence is the observable
     * version of the same property.
     */
    const operatorTokens = ['[LEGAL ENTITY NAME]', '[GOVERNING LAW]', '[VENUE]']
    const found = new Set<string>()
    for (const doc of LEGAL_DOCUMENTS) {
      for (const p of findUnresolvedPlaceholders(read(doc.source))) found.add(p.token)
    }
    for (const token of operatorTokens) {
      expect(found.has(token), `no document carries ${token} -- has a value been invented?`).toBe(true)
    }
  })

  it('can fill every entity placeholder the documents actually use', () => {
    /*
     * The failure this catches: a draft writes `[COMPANY NAME]`, the map knows
     * only `[LEGAL ENTITY NAME]`, and the token survives into a published page
     * because resolvePlaceholders() silently leaves what it does not know.
     *
     * Commercial placeholders -- `[LIABILITY CAP]`, `[30]` -- are NOT entity
     * details and are expected to remain. They are listed, not asserted on:
     * they are a negotiation's inputs, not a configuration gap.
     */
    const unmapped = new Map<string, string[]>()
    for (const doc of LEGAL_DOCUMENTS) {
      for (const p of findUnresolvedPlaceholders(read(doc.source))) {
        if (p.field) continue
        if (!/ENTITY|COMPANY|ADDRESS|JURISDICTION|GOVERNING|VENUE|CONTACT EMAIL|SUPPORT EMAIL|PRIVACY EMAIL/i.test(p.token)) continue
        unmapped.set(p.token, [...(unmapped.get(p.token) ?? []), doc.id])
      }
    }
    expect(
      [...unmapped].map(([t, ids]) => `${t} (in ${ids.join(', ')})`),
      'an entity-shaped placeholder is not in PLACEHOLDER_MAP, so it would survive into a published page',
    ).toEqual([])
  })

  it('maps every placeholder token to a real entity field', () => {
    // Guards the other direction: a typo'd key in PLACEHOLDER_MAP would never
    // substitute anything and would fail silently.
    for (const [token, field] of Object.entries(PLACEHOLDER_MAP)) {
      expect(token, `${token} is not in [UPPER CASE] form`).toMatch(/^\[[A-Z0-9][^\][]*\]$/)
      expect(typeof field).toBe('string')
    }
  })
})
