import { describe, expect, it, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import { SignalCardSection } from '../SignalCardSection'
import { ResearchReader } from '../ResearchReader'
import { EvidencePane } from '../../signals/EvidencePane'
import { buildInsightCard } from '../../../lib/signals/builders/legacy-kinds'
import type { EvidenceArrival } from '../../../lib/research/case-state'
import type { SignalCard } from '../../../lib/signals/contract'

/**
 * Reading research, which is not the same act as writing it.
 *
 * ── The bug ───────────────────────────────────────────────────────────────
 *
 * "Read the research" opened `NoteEditor`. Every research destination this app
 * had was a tab, and `DashboardPage` renders the research tab as the authoring
 * surface — so following a button that said READ put a cursor into a rich-text
 * field with a save pipeline behind it. The reader wanted to know what a
 * colleague had written and was handed the tools to overwrite it.
 *
 * These tests hold the two halves apart: the card can only reach the reader,
 * and the editor can only be reached from inside it, deliberately.
 */

// ── The note store, stubbed at the client ────────────────────────────────────
//
// The hook is exercised for real rather than mocked out, because half of what
// is under test here is WHICH row it asks for: routing by asset and guessing
// at the note is the failure mode §21 names, and a mocked hook would answer
// correctly no matter what id it was handed.
const rows: Record<string, Record<string, unknown>> = {}
const queried: { table: string; filters: Record<string, unknown> }[] = []

vi.mock('../../../lib/supabase', () => {
  const build = (table: string) => {
    const filters: Record<string, unknown> = {}
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: (col: string, val: unknown) => { filters[col] = val; return chain },
      maybeSingle: async () => {
        queried.push({ table, filters })
        const id = filters.id as string
        if (table === 'users') {
          return { data: rows[`user:${id}`] ?? null, error: null }
        }
        const row = rows[`${table}:${id}`] ?? null
        // `is_deleted` is a filter, not decoration: a soft-deleted note must
        // read as absent rather than as content.
        if (row && filters.is_deleted === false && (row as any).is_deleted) {
          return { data: null, error: null }
        }
        return { data: row, error: null }
      },
    }
    return chain
  }
  return { supabase: { from: (table: string) => build(table) } }
})

const ME = 'user-me'
const SOMEONE_ELSE = 'user-them'

beforeEach(() => {
  for (const k of Object.keys(rows)) delete rows[k]
  queried.length = 0
  rows['user:user-me'] = { id: ME, email: 'me@x.com', first_name: 'Mo', last_name: 'Reed' }
  rows['user:user-them'] = { id: SOMEONE_ELSE, email: 'them@x.com', first_name: 'Al', last_name: 'Vega' }
})

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

// ── Fixtures ────────────────────────────────────────────────────────────────

const arrival = (over: Partial<EvidenceArrival> = {}): EvidenceArrival => ({
  id: 'note-1',
  at: '2026-08-01T00:00:00.000Z',
  authorId: SOMEONE_ELSE,
  authorName: 'Al Vega',
  title: 'Margins are turning',
  kind: 'note',
  preview: 'Gross margin inflected two quarters early.',
  ...over,
})

/** A `new_evidence` Research card, which is the only card that offers this. */
const newResearch = (evidence: EvidenceArrival[]): SignalCard => {
  const r = buildInsightCard({
    id: 'i1', kind: 'stale_research',
    headline: 'A new research note was added on PLTR',
    body: 'The thesis behind it was last written 200 days ago.',
    prompt: 'What best describes this position?',
    assetId: 'asset-1', symbol: 'PLTR', companyName: 'Palantir',
    portfolioName: 'Core', portfolioId: 'p1', weightPct: 3,
    held: true, portfolioCount: 1, liveIdeas: [], coverageOwners: [],
    evidenceCount: evidence.length,
    issue: {
      framing: 'new_evidence',
      daysSinceReview: 200,
      daysSinceWritten: 200,
      anchoredOn: 'written',
      present: ['thesis'],
      missing: [],
      supporting: [],
      evidence,
    },
    caseWrittenAt: '2026-02-01T00:00:00.000Z',
    researchReviewAt: null,
    reviewAnchor: '2026-02-01T00:00:00.000Z',
    anchoredOn: 'written',
    daysSinceReview: 200,
    daysSinceWritten: 200,
    score: 1,
  })
  if (!r.ok) throw new Error(`suppressed: ${r.reason}`)
  return r.card
}

const noop = () => {}

function renderCard(card: SignalCard) {
  const onOpenResearch = vi.fn()
  const onFeedAction = vi.fn()
  const onPrimary = vi.fn()
  render(
    <SignalCardSection
      card={card}
      onOpenAsset={noop} onCapture={noop} onSnooze={noop} onDismiss={noop} onWhy={noop}
      onPrimary={onPrimary}
      onFeedAction={onFeedAction}
      onOpenResearch={onOpenResearch}
    />,
  )
  return { onOpenResearch, onFeedAction, onPrimary }
}

// ── §31/§32: the card reaches the reader, and only the reader ───────────────

describe('a single arrival opens the reader, not the editor', () => {
  it('hands the reader that exact note', () => {
    const { onOpenResearch } = renderCard(newResearch([arrival()]))
    fireEvent.click(screen.getByText('Read the research'))

    expect(onOpenResearch).toHaveBeenCalledTimes(1)
    expect(onOpenResearch.mock.calls[0][0]).toEqual({
      id: 'note-1', kind: 'note', title: 'Margins are turning',
    })
    // The symbol travels too, so the reader's eyebrow says whose research it is.
    expect(onOpenResearch.mock.calls[0][1]).toBe('PLTR')
  })

  it('never reaches the tab router, which is where the editor lives', () => {
    /**
     * The regression test for the exact bug.
     *
     * `onFeedAction` opens a tab, and the research tab IS `NoteEditor`. If
     * this action can still get down that path — by the resolver regaining a
     * case, or by the interception being reordered — "Read the research"
     * reopens the editor and nothing else in the suite would notice.
     */
    const { onFeedAction, onPrimary } = renderCard(newResearch([arrival()]))
    fireEvent.click(screen.getByText('Read the research'))
    expect(onFeedAction).not.toHaveBeenCalled()
    // And it does not fall through to the card's generic handler either — a
    // tap must do exactly one thing.
    expect(onPrimary).not.toHaveBeenCalled()
  })

  it('opens a quick thought in the reader rather than leaving for the asset', () => {
    // A thought has no detail tab, so this used to land on the asset page —
    // which answers a question the reader did not ask. It has an author, a
    // date and words; that is the whole of what the reader shows.
    const { onOpenResearch, onFeedAction } = renderCard(
      newResearch([arrival({ id: 'th-1', kind: 'thought', title: null })]),
    )
    fireEvent.click(screen.getByText('Read the research'))
    expect(onOpenResearch.mock.calls[0][0]).toEqual({
      id: 'th-1', kind: 'thought', title: null,
    })
    expect(onFeedAction).not.toHaveBeenCalled()
  })
})

// ── §11/§33: the referenced list is the signal's arrivals, and nothing else ─

describe('several arrivals go to the list, and each row to its own item', () => {
  const items = [
    arrival({ id: 'n-old', at: '2026-03-02T00:00:00.000Z', title: 'First look' }),
    arrival({ id: 'n-new', at: '2026-08-01T00:00:00.000Z', title: 'Margins are turning' }),
  ]

  it('lists exactly the arrivals it was given, newest first', () => {
    /**
     * §33. The pane is "the research this signal is about", not "the research
     * on this asset" — the rule hands it only the items that landed strictly
     * after the review anchor, and the pane must not widen that to the
     * archive. Asserted on what renders, because a pane that fetched more
     * would still be given the right list.
     */
    const { container } = render(
      <EvidencePane items={items} reviewAnchor="2026-02-01T00:00:00.000Z" onOpen={noop} />,
    )
    const titles = [...container.querySelectorAll('[data-slot="evidence-item"]')]
      .map(el => el.querySelector('p')?.textContent)
    expect(titles).toEqual(['Margins are turning', 'First look'])
  })

  it('opens the row that was tapped, not the newest one', () => {
    // The reason the multi-arrival card sends the reader here instead of
    // opening something: with more than one, choosing is theirs.
    const onOpen = vi.fn()
    const { container } = render(
      <EvidencePane items={items} reviewAnchor="2026-02-01T00:00:00.000Z" onOpen={onOpen} />,
    )
    const rows = container.querySelectorAll('[data-slot="evidence-item"]')
    fireEvent.click(rows[1])
    expect(onOpen.mock.calls[0][0].id).toBe('n-old')
  })
})

// ── §10/§18/§21: what the reader shows ─────────────────────────────────────

describe('the reader shows the item, and shows it as content', () => {
  it('fetches the exact object it was given', async () => {
    rows['asset_notes:note-1'] = {
      id: 'note-1', title: 'Margins are turning', content: '<p>Gross margin inflected.</p>',
      created_at: '2026-08-01T00:00:00.000Z', created_by: SOMEONE_ELSE,
      asset_id: 'asset-1', note_type: 'earnings_review',
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    await screen.findByText('Margins are turning')
    // By id, from the signal — never by asset with a guess at which note.
    expect(queried.find(q => q.table === 'asset_notes')?.filters)
      .toMatchObject({ id: 'note-1', is_deleted: false })
  })

  it('renders note markup through the sanitizer, not as raw tags', async () => {
    rows['asset_notes:note-1'] = {
      id: 'note-1', title: 'Margins are turning',
      content: '<p>Gross margin <strong>inflected</strong>.</p><script>alert(1)</script>',
      created_at: '2026-08-01T00:00:00.000Z', created_by: SOMEONE_ELSE,
      asset_id: 'asset-1', note_type: null,
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    const body = await waitFor(() => {
      const el = document.querySelector('[data-slot="reader-body"]')
      if (!el) throw new Error('no body yet')
      return el
    })
    expect(body.getAttribute('data-body-format')).toBe('html')
    expect(body.querySelector('strong')?.textContent).toBe('inflected')
    // The same sanitizer `NoteVersionHistory` uses for this markup. A reader
    // that dumped stored HTML would be an injection sink pointed at whatever
    // any colleague happened to paste.
    expect(body.querySelector('script')).toBeNull()
    // And the tags are rendered, not printed.
    expect(body.textContent).not.toContain('<strong>')
  })

  it('keeps a quick thought as the plain text it was typed as', async () => {
    rows['quick_thoughts:th-1'] = {
      id: 'th-1', content: 'Two lines.\nSecond one **not** bold.',
      created_at: '2026-08-01T00:00:00.000Z', created_by: SOMEONE_ELSE,
      asset_id: 'asset-1', idea_type: 'observation', source_title: null, source_url: null,
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'th-1', kind: 'thought', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    const body = await waitFor(() => {
      const el = document.querySelector('[data-slot="reader-body"]')
      if (!el) throw new Error('no body yet')
      return el
    })
    // Line breaks preserved; markdown NOT invented. A thought is typed into a
    // textarea, so anything that merely looks like markup is literal.
    expect(body.getAttribute('data-body-format')).toBe('text')
    expect(body.textContent).toContain('**not**')
  })

  it('says who wrote it and when, resolved rather than left as an id', async () => {
    rows['asset_notes:note-1'] = {
      id: 'note-1', title: 'Margins are turning', content: '<p>x</p>',
      created_at: '2026-08-01T00:00:00.000Z', created_by: SOMEONE_ELSE,
      asset_id: 'asset-1', note_type: null,
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    await waitFor(() => {
      expect(document.querySelector('[data-slot="reader-byline"]')?.textContent)
        .toContain('Al Vega')
    })
  })

  it('shows no authoring furniture at all', async () => {
    rows['asset_notes:note-1'] = {
      id: 'note-1', title: 'Margins are turning', content: '<p>x</p>',
      created_at: '2026-08-01T00:00:00.000Z', created_by: SOMEONE_ELSE,
      asset_id: 'asset-1', note_type: null,
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    await screen.findByText('Margins are turning')
    // No fields, no commit controls, and nothing focusable that takes typing.
    expect(document.querySelector('[data-slot="research-reader"] textarea')).toBeNull()
    expect(document.querySelector('[data-slot="research-reader"] input')).toBeNull()
    expect(document.querySelector('[contenteditable="true"]')).toBeNull()
    expect(screen.queryByText('Save')).toBeNull()
    expect(screen.queryByText('Cancel')).toBeNull()
  })
})

// ── §13/§15/§16: Edit is secondary, and gated ──────────────────────────────

describe('editing is downstream of reading, and only for the author', () => {
  const note = (author: string) => ({
    id: 'note-1', title: 'Margins are turning', content: '<p>x</p>',
    created_at: '2026-08-01T00:00:00.000Z', created_by: author,
    asset_id: 'asset-1', note_type: null,
  })

  it('offers Edit to the author, and hands off the note the reader was on', async () => {
    rows['asset_notes:note-1'] = note(ME)
    const onEdit = vi.fn()
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME} onEdit={onEdit}
      />,
    )
    const edit = await screen.findByText('Edit note')
    // Not the primary control: the surface exists to be read.
    expect(document.querySelector('[data-slot="reader-edit"]')).toBeTruthy()

    fireEvent.click(edit)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0]).toMatchObject({ id: 'note-1', kind: 'note' })
    // The asset travels with it: the note tab resolves its editor from the
    // asset and renders "Note data not available" without one.
    expect(onEdit.mock.calls[0][1]).toBe('asset-1')
  })

  it('shows no Edit to somebody who did not write it', async () => {
    /**
     * §15. Ownership is the rule this app already applies to a research
     * object's edit control (`MasonryGrid`), reused rather than reinvented.
     *
     * It is a display rule, not the database's answer — the migrations define
     * SELECT policies on `asset_notes` and no UPDATE policy, so what the
     * server permits is not knowable here until a write is attempted. This is
     * the conservative side of that: it can hide the control from somebody who
     * could edit, and cannot offer it to somebody who will be refused.
     */
    rows['asset_notes:note-1'] = note(SOMEONE_ELSE)
    withQuery(
      <ResearchReader
        open target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME} onEdit={vi.fn()}
      />,
    )
    await screen.findByText('Margins are turning')
    expect(document.querySelector('[data-slot="reader-edit"]')).toBeNull()
    // Reading it is unaffected — a reader without write access still gets the
    // whole item and a way back.
    expect(document.querySelector('[data-slot="reader-body"]')).toBeTruthy()
    expect(document.querySelector('[data-slot="reader-back"]')).toBeTruthy()
  })

  it('offers no Edit on a quick thought, because no mobile editor exists', async () => {
    // Not a permission judgment: there is nothing to hand off to, and a
    // control that leads nowhere is the failure this whole pass is about.
    rows['quick_thoughts:th-1'] = {
      id: 'th-1', content: 'Mine, and still not editable here.',
      created_at: '2026-08-01T00:00:00.000Z', created_by: ME,
      asset_id: 'asset-1', idea_type: null, source_title: null, source_url: null,
    }
    withQuery(
      <ResearchReader
        open target={{ id: 'th-1', kind: 'thought', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME} onEdit={vi.fn()}
      />,
    )
    await screen.findByText(/still not editable/)
    expect(document.querySelector('[data-slot="reader-edit"]')).toBeNull()
  })
})

// ── §36: nothing loads until somebody asks for it ──────────────────────────

describe('the reader costs nothing until it is opened', () => {
  it('makes no request while closed', () => {
    withQuery(
      <ResearchReader
        open={false} target={{ id: 'note-1', kind: 'note', title: null }}
        symbol="PLTR" onClose={noop} currentUserId={ME}
      />,
    )
    // The candidate scan deliberately never selects `content` — production
    // holds a 2 MB note body. The full text is fetched for the one item
    // somebody chose to open, and not before.
    expect(queried).toHaveLength(0)
  })
})
