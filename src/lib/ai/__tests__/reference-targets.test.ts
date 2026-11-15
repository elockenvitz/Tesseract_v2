/**
 * Where a typed reference goes, and why none of it is invented.
 *
 * ── The defect these pin ──────────────────────────────────────────────────
 *
 * A conversation can carry four kinds of reference and only the asset one
 * went anywhere. The other three rendered as plain text -- honest, but three
 * quarters of the feature stopped at "we remember what this is about".
 *
 * ── What is actually at risk ──────────────────────────────────────────────
 *
 * Each descriptor here has to be the one the application's own surfaces send,
 * because the shell renders by `type` and reads specific keys out of `data`.
 * A near-miss does not fail loudly: it opens a tab that says "Note data not
 * available", or a second tab for every note on the same name. So the
 * assertions below are about exact shape, and each cites the surface it was
 * taken from.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  referenceTabFor, openReference, referenceKey, isReferenceType,
  referenceUnavailableTitle, NOTE_SOURCES,
  type ResolvedReference,
} from '../reference-targets'

const ASSET: ResolvedReference = {
  type: 'asset', id: 'a-aapl', label: 'AAPL', symbol: 'AAPL', companyName: 'Apple Inc.',
}
const PORTFOLIO: ResolvedReference = {
  type: 'portfolio', id: 'p-core', label: 'Core Equity',
  row: { id: 'p-core', name: 'Core Equity', benchmark: 'SPY' },
}
const THEME: ResolvedReference = {
  type: 'theme', id: 't-ai', label: 'AI infrastructure',
  row: { id: 't-ai', name: 'AI infrastructure', color: '#8b5cf6' },
}
const ASSET_NOTE: ResolvedReference = {
  type: 'note', id: 'n-1', label: 'Channel checks',
  entityType: 'asset', entityId: 'a-aapl', entityName: 'AAPL',
  entityRow: { id: 'a-aapl', symbol: 'AAPL', company_name: 'Apple Inc.' },
}

describe('the four the tag table accepts', () => {
  it('recognises exactly those four', () => {
    for (const t of ['asset', 'portfolio', 'theme', 'note']) expect(isReferenceType(t)).toBe(true)
    for (const t of ['trade_idea', 'workflow', 'list', '', null, undefined, 7]) {
      expect(isReferenceType(t)).toBe(false)
    }
  })

  it('keys a reference the way the chips and the filter do', () => {
    expect(referenceKey({ type: 'note', id: 'n-1' })).toBe('note:n-1')
  })

  it('covers the three note tables the shell has an editor for', () => {
    expect(NOTE_SOURCES.map(s => s.entityType)).toEqual(['asset', 'portfolio', 'theme'])
    /* `custom_notebook_notes` is deliberately absent: the shell's note tab
       renders asset, portfolio and theme notes, so a notebook note has no
       destination and must not be given an invented one. */
    expect(NOTE_SOURCES.map(s => s.table)).not.toContain('custom_notebook_notes')
  })
})

describe('a portfolio', () => {
  const tab = referenceTabFor(PORTFOLIO)!

  it('opens the portfolio tab, as PortfolioCommandCenter sends it', () => {
    expect(tab.type).toBe('portfolio')
    expect(tab.id).toBe('p-core')
    expect(tab.title).toBe('Core Equity')
  })

  it('carries id and name explicitly, because the shell MERGES data', () => {
    /* A key left out persists from whatever opened this tab last, so both
       are written even though the row already holds them. */
    expect(tab.data).toMatchObject({ id: 'p-core', name: 'Core Equity' })
  })

  it('passes the row through, so the tab need not re-fetch what we have', () => {
    expect((tab.data as Record<string, unknown>).benchmark).toBe('SPY')
  })
})

describe('a theme', () => {
  const tab = referenceTabFor(THEME)!

  it('opens the theme tab with the row ThemeTab takes', () => {
    expect(tab.type).toBe('theme')
    expect(tab.id).toBe('t-ai')
    expect(tab.data).toMatchObject({ id: 't-ai', name: 'AI infrastructure', color: '#8b5cf6' })
  })
})

describe('a note', () => {
  it('shares one tab per entity, as NotesListPage does', () => {
    /*
     * The synthetic id is not decoration. All notes on one name share a tab;
     * using the note's own uuid as the tab id makes a new tab for every note
     * on the same name, and the renderer explicitly refuses a `note-` prefix
     * as a note id for exactly this reason.
     */
    const tab = referenceTabFor(ASSET_NOTE)!
    expect(tab.id).toBe('note-asset-a-aapl')
    expect(tab.type).toBe('note')
    expect(tab.title).toBe('Note - AAPL')
  })

  it('names the note to open inside that tab', () => {
    const data = referenceTabFor(ASSET_NOTE)!.data as Record<string, unknown>
    expect(data.id).toBe('n-1')
    expect(data.entityType).toBe('asset')
    expect(data.entityId).toBe('a-aapl')
  })

  it('gives the asset editor the keys it reads', () => {
    const data = referenceTabFor(ASSET_NOTE)!.data as Record<string, unknown>
    expect(data.assetId).toBe('a-aapl')
    expect(data.assetSymbol).toBe('AAPL')
    expect(data.assets).toMatchObject({ symbol: 'AAPL' })
  })

  it('gives the portfolio editor its own keys, not the asset ones', () => {
    const data = referenceTabFor({
      type: 'note', id: 'n-2', label: 'Rebalance rationale',
      entityType: 'portfolio', entityId: 'p-core', entityName: 'Core Equity',
      entityRow: { id: 'p-core', name: 'Core Equity' },
    })!.data as Record<string, unknown>
    expect(data.portfolioId).toBe('p-core')
    expect(data.portfolioName).toBe('Core Equity')
    expect(data.assetId).toBeUndefined()
  })

  it('gives the theme editor its own keys', () => {
    const data = referenceTabFor({
      type: 'note', id: 'n-3', label: 'Supply chain',
      entityType: 'theme', entityId: 't-ai', entityName: 'AI infrastructure',
      entityRow: null,
    })!.data as Record<string, unknown>
    expect(data.themeId).toBe('t-ai')
    expect(data.themeName).toBe('AI infrastructure')
    /* No row was resolved, so no row is claimed. */
    expect(data.themes).toBeUndefined()
  })
})

describe('an asset does not get a hand-built descriptor', () => {
  it('returns null, because `openAsset` is the one contract', () => {
    expect(referenceTabFor(ASSET)).toBeNull()
  })
})

describe('dispatching', () => {
  let events: { type: string; detail: unknown }[] = []
  const record = (e: Event) => events.push({ type: e.type, detail: (e as CustomEvent).detail })

  beforeEach(() => {
    events = []
    window.addEventListener('decision-engine-action', record)
    window.addEventListener('open-asset', record)
  })
  afterEach(() => {
    window.removeEventListener('decision-engine-action', record)
    window.removeEventListener('open-asset', record)
  })

  it('sends a portfolio on the shell channel', () => {
    expect(openReference(PORTFOLIO)).toBe(true)
    const tab = events.find(e => e.type === 'decision-engine-action')?.detail as Record<string, unknown>
    expect(tab.type).toBe('portfolio')
    expect(tab.id).toBe('p-core')
  })

  it('sends a theme on the shell channel', () => {
    expect(openReference(THEME)).toBe(true)
    expect((events[0]!.detail as Record<string, unknown>).type).toBe('theme')
  })

  it('sends a note on the shell channel', () => {
    expect(openReference(ASSET_NOTE)).toBe(true)
    expect((events[0]!.detail as Record<string, unknown>).id).toBe('note-asset-a-aapl')
  })

  it('delegates an asset, so the tab descriptor is the canonical one', () => {
    expect(openReference(ASSET)).toBe(true)
    const tab = events.find(e => e.type === 'decision-engine-action')?.detail as Record<string, unknown>
    expect(tab.type).toBe('asset')
    expect(tab.id).toBe('a-aapl')
    /* `openAsset` stamps this; a hand-built asset descriptor would not, and
       the arrival would replay on every remount. */
    expect((tab.data as Record<string, unknown>).focusRequestId).toBeTruthy()
  })

  it('sends a chip press as "show me this", not "go to a section of it"', () => {
    openReference(ASSET)
    const tab = events.find(e => e.type === 'decision-engine-action')?.detail as Record<string, unknown>
    expect((tab.data as Record<string, unknown>).focus).toBe('overview')
  })

  it('dispatches nothing for a reference that did not resolve', () => {
    expect(openReference(null)).toBe(false)
    expect(openReference(undefined)).toBe(false)
    expect(events).toEqual([])
  })
})

describe('what a reader is told about a reference they cannot follow', () => {
  it('distinguishes still-checking from gone', () => {
    expect(referenceUnavailableTitle('Core Equity', true))
      .toBe('Checking whether Core Equity is still available')
    expect(referenceUnavailableTitle('Core Equity', false))
      .toContain('no longer available to you')
  })

  it('says the conversation was about it, rather than pretending it never was', () => {
    expect(referenceUnavailableTitle('Core Equity', false))
      .toContain('It was part of this conversation.')
  })
})
