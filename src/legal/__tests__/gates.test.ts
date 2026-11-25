import { describe, it, expect, vi, afterEach } from 'vitest'

/**
 * The publication and acceptance gates.
 *
 * ── Why these tests are written as a truth table ─────────────────────────
 *
 * A gate that has only ever been observed returning false is indistinguishable
 * from a function that returns false unconditionally. Every case below sets
 * the inputs that WOULD open the gate and asserts it opens, as well as the
 * cases that must keep it shut. That is the only way to show the gate is
 * reading its inputs rather than hard-coded.
 *
 * The documents' statuses are not environment variables, so the registry is
 * mocked per case. `vi.resetModules()` between cases matters: the gate modules
 * read `import.meta.env` at call time but import the registry at module load,
 * so a stale module would carry the previous case's statuses.
 */

const APPROVED_PAIR = [
  { id: 'financial-ai-disclosures', status: 'approved', requiresAcceptance: true, version: '1.0.0' },
  { id: 'application-terms', status: 'approved', requiresAcceptance: true, version: '1.0.0' },
]
const DRAFT_PAIR = [
  { id: 'financial-ai-disclosures', status: 'draft', requiresAcceptance: true, version: '0.1.0-draft' },
  { id: 'application-terms', status: 'draft', requiresAcceptance: true, version: '0.2.0-draft' },
]

/** Load the gate module with a given registry and a given entity state. */
async function loadGates(opts: {
  docs: typeof APPROVED_PAIR
  entityConfigured?: boolean
}) {
  vi.resetModules()
  vi.doMock('../documents', () => ({
    LEGAL_DOCUMENTS: opts.docs,
    documentsRequiringAcceptance: () => opts.docs.filter(d => d.requiresAcceptance),
    allAcceptanceDocumentsApproved: () =>
      opts.docs.filter(d => d.requiresAcceptance).every(d => d.status === 'approved'),
    anyDocumentIsDraft: () => opts.docs.some(d => d.status === 'draft'),
  }))
  vi.doMock('../entity', () => ({
    isEntityConfigured: () => opts.entityConfigured ?? true,
  }))
  return import('../publication')
}

/**
 * Load the gate module with the REAL registry and the REAL entity module.
 *
 * The two cases that assert the shipped configuration have to go through this
 * rather than the mocked loader, otherwise they would be asserting that a
 * fixture is closed, which proves nothing about what ships.
 */
async function loadReal() {
  vi.resetModules()
  vi.doUnmock('../documents')
  vi.doUnmock('../entity')
  return import('../publication')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.doUnmock('../documents')
  vi.doUnmock('../entity')
  vi.resetModules()
})

describe('the publication gate', () => {
  it('is CLOSED with the variable unset — the real state today', async () => {
    // Nothing stubbed and nothing mocked: this is the shipped configuration,
    // read through the real registry and the real entity module.
    const { isLegalPublicationEnabled } = await loadReal()
    expect(isLegalPublicationEnabled()).toBe(false)
  })

  it('OPENS when the variable is exactly "true"', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'true')
    const { isLegalPublicationEnabled } = await loadGates({ docs: APPROVED_PAIR })
    // This is the assertion that proves the gate is not hard-coded false.
    expect(isLegalPublicationEnabled()).toBe(true)
  })

  it('stays CLOSED for every truthy-looking value that is not "true"', async () => {
    /*
     * The bug this prevents: Vite inlines every VITE_* value as a STRING, so
     * `Boolean(import.meta.env.VITE_LEGAL_PUBLISHED)` is true for the string
     * "false". A gate written that way is open whenever someone sets it to
     * false to turn it off, which is the worst possible direction for the
     * failure to run in.
     */
    for (const value of ['false', 'FALSE', '0', 'yes', 'True', '1', ' true', 'true ']) {
      vi.stubEnv('VITE_LEGAL_PUBLISHED', value)
      const { isLegalPublicationEnabled } = await loadGates({ docs: APPROVED_PAIR })
      expect(isLegalPublicationEnabled(), `"${value}" must not open the gate`).toBe(false)
    }
  })

  it('stays CLOSED when the variable is empty', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHED', '')
    const { isLegalPublicationEnabled } = await loadGates({ docs: APPROVED_PAIR })
    expect(isLegalPublicationEnabled()).toBe(false)
  })
})

describe('the acceptance gate', () => {
  it('OPENS only when all three conditions hold', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'true')
    vi.stubEnv('VITE_LEGAL_ACCEPTANCE_ENABLED', 'true')
    const { isTermsAcceptanceEnabled, acceptanceBlockers } = await loadGates({
      docs: APPROVED_PAIR,
    })
    // Proves the gate CAN open. Without this case the three negatives below
    // would pass against a function that returns false unconditionally.
    expect(isTermsAcceptanceEnabled()).toBe(true)
    expect(acceptanceBlockers()).toEqual([])
  })

  it('stays CLOSED while any acceptance document is a draft, even with both flags on', async () => {
    /*
     * The most important case in this file. This is the state the repository is
     * actually in, and the failure it prevents is a database record saying 28
     * users accepted a document no lawyer has read. A record of consent to a
     * draft is worse than no record, because it looks like consent.
     */
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'true')
    vi.stubEnv('VITE_LEGAL_ACCEPTANCE_ENABLED', 'true')
    const { isTermsAcceptanceEnabled, acceptanceBlockers } = await loadGates({ docs: DRAFT_PAIR })
    expect(isTermsAcceptanceEnabled()).toBe(false)
    expect(acceptanceBlockers()).toContain('a document requiring acceptance is still status: draft')
  })

  it('stays CLOSED when one of two documents is still a draft', async () => {
    // Partial approval must not open it: the user would be asked to accept
    // both and would be recorded as accepting a draft for one of them.
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'true')
    vi.stubEnv('VITE_LEGAL_ACCEPTANCE_ENABLED', 'true')
    const { isTermsAcceptanceEnabled } = await loadGates({
      docs: [APPROVED_PAIR[0], DRAFT_PAIR[1]],
    })
    expect(isTermsAcceptanceEnabled()).toBe(false)
  })

  it('stays CLOSED while publication is off, even with everything approved', async () => {
    /*
     * "Tick to accept terms you cannot open." Unfair, and in most
     * jurisdictions unenforceable, which makes it worse than useless: it is
     * friction that buys no protection. Enforced here rather than left to a
     * release checklist.
     */
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'false')
    vi.stubEnv('VITE_LEGAL_ACCEPTANCE_ENABLED', 'true')
    const { isTermsAcceptanceEnabled, acceptanceBlockers } = await loadGates({
      docs: APPROVED_PAIR,
    })
    expect(isTermsAcceptanceEnabled()).toBe(false)
    expect(acceptanceBlockers()).toContain(
      'publication is disabled, so the documents cannot be read',
    )
  })

  it('stays CLOSED when only publication is on', async () => {
    vi.stubEnv('VITE_LEGAL_PUBLISHED', 'true')
    const { isTermsAcceptanceEnabled } = await loadGates({ docs: APPROVED_PAIR })
    expect(isTermsAcceptanceEnabled()).toBe(false)
  })

  it('is CLOSED in the shipped configuration, with nothing stubbed', async () => {
    const { isTermsAcceptanceEnabled, acceptanceBlockers } = await loadReal()
    expect(isTermsAcceptanceEnabled()).toBe(false)
    // All three blockers, which is the honest description of today.
    expect(acceptanceBlockers().length).toBe(3)
  })
})

describe('the draft warning', () => {
  it('warns while any document is a draft', async () => {
    const { shouldShowDraftWarning } = await loadGates({ docs: DRAFT_PAIR })
    expect(shouldShowDraftWarning()).toBe(true)
  })

  it('warns when documents are approved but the entity is still unconfigured', async () => {
    /*
     * The case a status field cannot catch on its own: an "approved" document
     * still containing [LEGAL ENTITY NAME] is not a document anyone should
     * rely on. Two independent conditions, so approving the text does not
     * silence a warning about the entity.
     */
    const { shouldShowDraftWarning } = await loadGates({
      docs: APPROVED_PAIR,
      entityConfigured: false,
    })
    expect(shouldShowDraftWarning()).toBe(true)
  })

  it('is silent only when both are true', async () => {
    const { shouldShowDraftWarning } = await loadGates({
      docs: APPROVED_PAIR,
      entityConfigured: true,
    })
    expect(shouldShowDraftWarning()).toBe(false)
  })
})
