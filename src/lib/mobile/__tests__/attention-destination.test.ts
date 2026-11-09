import { describe, it, expect } from 'vitest'
import { attentionDestination, attentionToExplore } from '../explore-adapters'
import { exploreOpen } from '../../desktop-ideas/explore-open'
import type { ExploreItem } from '../explore-item'

/**
 * Every tile that names a surface now opens it.
 *
 * ── What was measured ─────────────────────────────────────────────────────
 *
 * On the live desktop Explore field, 151 tiles, 13 opened nothing. They are
 * deliberately inert -- `IdeasExploreBrowse` sets `inert` when `exploreOpen`
 * answers `none`, so the tile is not even a button -- which is the honest
 * rendering of "there is nothing behind this". The fault was how many rows
 * reached that answer while naming a surface this app already has.
 *
 * Ten of the thirteen were Workflow: project rows, deliverable rows and PM
 * decision requests. Every one carries an id -- `context.project_id`,
 * `context.portfolio_id`, or the trade-queue item's own `source_id` -- and the
 * adapter threw all of them away, sending the row to `{ kind: 'filter' }`
 * because `context.asset_id` was null. A non-aggregate filter resolves to
 * `focus`, focus finds no card in the pool, and the tile goes inert.
 *
 * ── The rule these cases pin ──────────────────────────────────────────────
 *
 * A tile is inert ONLY when the row names nothing. `task` has no context at
 * all, and a `notification` about something other than an asset has a null
 * asset and no other id; both stay inert, and the counter-cases below prove
 * the ladder did not become a fall-through that always finds something.
 */

const row = (over: Record<string, unknown> = {}) => ({
  attention_id: 'a1',
  source_type: 'project_deliverable',
  source_id: 'd-1',
  title: 'Draft the earnings model',
  subtitle: 'Annual earnings by index',
  created_at: '2026-10-01T00:00:00.000Z',
  due_at: '2026-11-20T00:00:00.000Z',
  context: { project_id: 'p-1' },
  ...over,
})

describe('an assetless attention row still names a surface', () => {
  it('sends an asset-scoped row to the asset, unchanged', () => {
    const d = attentionDestination(row({ context: { asset_id: 'a-aapl', symbol: 'AAPL' } }), false)
    expect(d).toEqual({ kind: 'action', action: 'open_asset', assetId: 'a-aapl', symbol: 'AAPL' })
  })

  it('opens a deliverable in the project it belongs to, named after the project', () => {
    const d = attentionDestination(row(), false)
    expect(d).toMatchObject({
      kind: 'tab',
      target: {
        type: 'project',
        // The PROJECT's title, not the deliverable's. A tab named "Draft the
        // earnings model" would be named after the task that raised it.
        title: 'Annual earnings by index',
        data: { id: 'p-1' },
      },
    })
  })

  it('names a project row after itself, since it has no parent title', () => {
    const d = attentionDestination(
      row({ source_type: 'project', title: 'Q4 sector review', subtitle: '3 contributors' }),
      false,
    )
    expect(d).toMatchObject({ kind: 'tab', target: { type: 'project', title: 'Q4 sector review' } })
  })

  it('carries only the id and the title, because the tab re-fetches', () => {
    // `ProjectDetailTab` merges its own `projects` fetch over the prop, so a
    // two-field stand-in is honest. Inventing a status or a priority here
    // would be presentation posing as a record.
    const d = attentionDestination(row(), false) as Extract<ExploreItem['destination'], { kind: 'tab' }>
    expect(Object.keys(d.target.data).sort()).toEqual(['id', 'title'])
  })

  it('sends a PM decision request to the queue, with its own row selected', () => {
    const d = attentionDestination(
      row({ source_type: 'trade_queue_item', source_id: 'tq-9', context: { asset_id: null, portfolio_id: 'pf-1' } }),
      true,
    )
    expect(d).toEqual({
      kind: 'tab',
      target: {
        id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue',
        data: { selectedTradeId: 'tq-9' },
      },
    })
  })

  it('opens a portfolio-scoped row that is NOT a trade in the portfolio', () => {
    const d = attentionDestination(
      row({ source_type: 'awaiting_review', subtitle: 'Core Equity', context: { asset_id: null, portfolio_id: 'pf-2' } }),
      false,
    )
    expect(d).toMatchObject({ kind: 'tab', target: { type: 'portfolio', data: { id: 'pf-2' } } })
  })

  it('prefers the asset over every id below it', () => {
    // The ladder's order is the point: an asset-scoped deliverable opens the
    // asset, which is the behaviour that already worked and must not move.
    const d = attentionDestination(
      row({ context: { asset_id: 'a-msft', symbol: 'MSFT', project_id: 'p-1', portfolio_id: 'pf-1' } }),
      false,
    )
    expect(d).toMatchObject({ action: 'open_asset', assetId: 'a-msft' })
  })
})

describe('what deliberately still opens nothing', () => {
  /* `attentionDestination` declares the fields it reads, so these literals
     carry only those. `attention_id` and `source_url` exist on the real row
     and are deliberately absent here: the ladder never reads either, and
     passing them would make the excess-property check the thing under test. */
  it('leaves a task inert, because it names no surface', () => {
    const d = attentionDestination(
      { source_type: 'task', source_id: 't-1', title: 'Call the broker' },
      false,
    )
    expect(d).toEqual({ kind: 'filter', category: 'workflow' })
  })

  it('leaves a notification about a non-asset inert', () => {
    const d = attentionDestination(
      { source_type: 'notification', source_id: 'n-1', title: 'Mentioned you', context: { asset_id: null, symbol: null } },
      false,
    )
    expect(d).toEqual({ kind: 'filter', category: 'workflow' })
  })

  it('still reaches `none` end to end for those rows', () => {
    // The counter-case for the whole change: if the ladder had become a
    // fall-through, this would now open something and the `inert` rendering
    // would never be exercised again.
    const [item] = attentionToExplore([
      { attention_id: 't1', source_type: 'task', source_id: 't-1', title: 'Call the broker' },
    ])
    expect(exploreOpen(item, []).do).toBe('none')
  })
})

describe('end to end, through the resolver the desktop field uses', () => {
  it('a deliverable tile now navigates instead of going inert', () => {
    const [item] = attentionToExplore([row()])
    const open = exploreOpen(item, [])
    expect(open).toMatchObject({ do: 'navigate', target: { type: 'project', data: { id: 'p-1' } } })
  })

  it('a decision request now navigates to the queue', () => {
    const [item] = attentionToExplore([
      row({ source_type: 'trade_queue_item', source_id: 'tq-9', context: { asset_id: null, portfolio_id: 'pf-1' } }),
    ])
    expect(exploreOpen(item, [])).toMatchObject({
      do: 'navigate', target: { type: 'trade-queue', data: { selectedTradeId: 'tq-9' } },
    })
  })

  it('the adapter actually calls the ladder, rather than keeping its own copy', () => {
    // The first version of this change added the helper and left the inline
    // ternary in place, so every case above passed and the live field did not
    // move. The destination is read off the produced item, not the helper.
    const [item] = attentionToExplore([row()])
    expect(item.destination.kind).toBe('tab')
  })
})

describe('a trade idea the attention pool does not hold', () => {
  const tradeIdea = (over: Partial<ExploreItem> = {}): ExploreItem => ({
    id: 'idea-tq-7',
    dedupeKey: 'post:tq-7',
    objectId: 'tq-7',
    postKind: 'trade_idea',
    signalType: 'trade_idea',
    category: 'ideas',
    subtype: 'idea',
    title: 'Add MCD',
    symbol: 'MCD',
    assetId: 'a-mcd',
    destination: { kind: 'action', action: 'open_asset', assetId: 'a-mcd', symbol: 'MCD' },
    ...over,
  }) as ExploreItem

  it('opens the queue with its own row selected, not the company page', () => {
    const open = exploreOpen(tradeIdea(), [])
    expect(open).toEqual({
      do: 'navigate',
      target: {
        id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue',
        data: { selectedTradeId: 'tq-7' },
      },
    })
  })

  it('selects on the objectId, which is the trade-queue item id', () => {
    // `targetFor` binds `objectId: 'tq-1'` for a trade idea, and
    // `TradeQueuePage` reads `selectedTradeId`. If this ever carried the
    // preview's own id instead, the queue would scroll to nothing.
    const open = exploreOpen(tradeIdea({ id: 'idea-tq-7', objectId: 'tq-7' }), [])
    expect(open).toMatchObject({ target: { data: { selectedTradeId: 'tq-7' } } })
    expect(JSON.stringify(open)).not.toContain('idea-tq-7')
  })

  it('does not take over the thought and prompt branch above it', () => {
    // Those two open their own detail surfaces, which fetch by id. A trade
    // idea reaching this branch must not have changed where they go.
    const thought = exploreOpen(tradeIdea({ postKind: 'thought', objectId: 'qt-1' }), [])
    expect(thought).toMatchObject({ do: 'work', selection: { postType: 'thought', objectId: 'qt-1' } })
  })

  it('leaves a post of some other kind honestly inert', () => {
    const other = exploreOpen(tradeIdea({ postKind: undefined, objectId: 'x-1' }), [])
    expect(other.do).toBe('none')
  })
})
