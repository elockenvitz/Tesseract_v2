/**
 * The list and portfolio surfaces, as places where work starts.
 *
 * Both were accurate and inert: the list surface stated "membership only"
 * and offered nothing but leaving or removing; the portfolio surface showed
 * a position and a flat list of idea names. A watchlist exists so names on
 * it become ideas, and a book is where an idea for that book is written, so
 * each now carries the one action that moves the name forward.
 *
 * Pinned against source for the same reason as the rest of this directory:
 * both components need the asset workspace, Supabase and auth to mount.
 * What is worth pinning is not that a button exists but that it reaches the
 * audited create path, that the preselection is right, and that neither
 * surface started inventing state the schema does not hold.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const LIST = strip(read('src/components/asset/work/ListWorkSurface.tsx'))
const PORTFOLIO = strip(read('src/components/asset/work/PortfolioWorkSurface.tsx'))
const TAB = strip(read('src/components/tabs/AssetTab.tsx'))
const OVERVIEW = strip(read('src/components/asset/work/AssetWorkOverview.tsx'))

describe('a list is somewhere a name can become an idea', () => {
  it('offers the action', () => {
    expect(LIST).toMatch(/data-testid="list-start-idea"/)
    expect(LIST).toMatch(/onStartIdea/)
  })

  it('still invents no per-asset state on the membership', () => {
    /* The reason the surface was inert in the first place was correct:
       `asset_list_items` stores no status, note or commentary, and a
       heading for one would imply work nobody did. Adding an action must
       not have smuggled a field in. */
    expect(LIST).toMatch(/Membership only\./)
    expect(LIST).not.toMatch(/list_item_status|itemNotes|listCommentary/)
  })

  it('does not write the idea onto the list', () => {
    /* The list is the idea's origin, not its owner. A surface that stored
       the new idea's id on the membership row would create a second,
       divergent record of which ideas exist. */
    expect(LIST).not.toMatch(/supabase/)
  })
})

describe('a book shows how far its ideas have got', () => {
  it('draws the position in the pipeline, not just its name', () => {
    expect(PORTFOLIO).toMatch(/data-testid=\{`portfolio-idea-track-\$\{i\.id\}`\}/)
    expect(PORTFOLIO).toMatch(/IDEA_STAGES\.map\(/)
    expect(PORTFOLIO).toMatch(/n <= reached/)
  })

  it('normalises a legacy stage before placing it', () => {
    /* Production holds `deep_research`, `thesis_forming`, `aware`,
       `investigate` and `ready_for_decision`. Indexed raw, `stageIndex`
       finds nothing and every pip reads as not-yet-reached, so a late-stage
       idea is drawn as if no work had been done on it. */
    expect(PORTFOLIO).toMatch(/toIdeaStage\(i\.stage\)/)
    expect(PORTFOLIO).toMatch(/const reached = at \? stageIndex\(at\) : -1/)
  })

  it('offers to start an idea in the book being read', () => {
    expect(PORTFOLIO).toMatch(/data-testid="portfolio-start-idea"/)
  })

  it('still computes no exposure of its own', () => {
    /* The 190.91% weight that started this lane came from a second site
       deriving an exposure its own way. This surface renders what
       `buildBook` handed it and must never do arithmetic on a holding. */
    expect(PORTFOLIO).not.toMatch(/marketValue\s*\/|shares\s*\*|\/ bookValue/)
  })
})

describe('one create path, several doors to it', () => {
  it('mounts exactly one AddTradeIdeaModal', () => {
    expect((TAB.match(/<AddTradeIdeaModal/g) ?? []).length).toBe(1)
  })

  it('preselects this asset', () => {
    expect(TAB).toMatch(/preselectedAssetId=\{asset\.id\}/)
  })

  it('preselects the book from a portfolio and no book from a list', () => {
    expect(TAB).toMatch(/onStartIdea=\{\(\) => setStartIdeaIn\(contextual\.id\)\}/)
    expect(TAB).toMatch(/onStartIdea=\{\(\) => setStartIdeaIn\(''\)\}/)
  })

  it("does not pass a list's empty string as a portfolio id", () => {
    /* `preselectedPortfolioId=""` is not "no portfolio": it is a portfolio
       whose id is the empty string, which selects nothing and silently
       suppresses the modal's own prompt to choose one. */
    expect(TAB).toMatch(/preselectedPortfolioId=\{startIdeaIn \|\| undefined\}/)
  })

  it('distinguishes closed from "open with no book"', () => {
    /* `null` is closed and `''` is open-without-a-book. A truthiness check
       here would make the list's button open nothing at all. */
    expect(TAB).toMatch(/isOpen=\{startIdeaIn !== null\}/)
  })

  it('refreshes the asset reads the new idea invalidates', () => {
    expect(TAB).toMatch(/invalidateQueries\(\{ queryKey: \['asset-trade-ideas', asset\.id\] \}\)/)
  })
})

describe('the investment case is read in Research, not listed in Work', () => {
  it('no longer renders a row per case field on the overview', () => {
    expect(OVERVIEW).not.toMatch(/overview-case-/)
    expect(OVERVIEW).not.toMatch(/research\.sections/)
  })

  it('drops the data path that fed them rather than leaving it unread', () => {
    /* A `sections` array still built and passed but never rendered is a
       query nobody can see the cost of. */
    expect(OVERVIEW).not.toMatch(/sections: ReadonlyArray/)
    expect(TAB).not.toMatch(/sections: \(workspaceForResearch\.data\?\.sections/)
  })

  it('keeps the notes and the way through to Research', () => {
    expect(OVERVIEW).toMatch(/data-testid="work-overview-open-research"/)
    expect(OVERVIEW).toMatch(/research\.notes\.slice\(0, 4\)/)
  })

  it('states the empty case in terms of notes alone', () => {
    /* The old copy said "No case section or research note…", which on a
       name with a written case was simply false. */
    expect(OVERVIEW).not.toMatch(/No case section or research note/)
    expect(OVERVIEW).toMatch(/No research note written on/)
  })
})
