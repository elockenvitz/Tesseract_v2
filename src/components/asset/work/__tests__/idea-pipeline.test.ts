/**
 * Moving an idea forward from the Work surface.
 *
 * ── Why these are source assertions ─────────────────────────────────────
 *
 * `IdeaWorkSurface` needs Supabase, auth and a React Query client to mount,
 * so the rules that matter here are pinned against its source — the same
 * convention as `work-operating-model.test.ts`. The gate's arithmetic is
 * tested for real in `src/lib/ideas/__tests__`; what is untested anywhere
 * else is the *composition*: that this surface asks the gate before writing,
 * that a refused move parks instead of firing, and that stage never moves as
 * a side effect of saving a field.
 *
 * Every assertion below corresponds to a way this could go wrong silently —
 * a chip that writes a doomed move, a save that promotes an idea without
 * saying so, a second source of truth for the stage.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

const SURFACE = strip(read('src/components/asset/work/IdeaWorkSurface.tsx'))

describe('the stage is a track, not a label', () => {
  it('renders every canonical stage rather than only the current one', () => {
    /* A chip per stage is what makes the path visible; rendering just the
       current stage is the read-only label this replaced. */
    expect(SURFACE).toMatch(/IDEA_STAGES\.map\(/)
    expect(SURFACE).toMatch(/data-testid=\{`idea-stage-\$\{s\}`\}/)
  })

  it('takes the stage list from the model instead of restating it', () => {
    /* A literal array here would drift from the pipeline the moment a stage
       is added or renamed. */
    expect(SURFACE).toMatch(/IDEA_STAGES, IDEA_STAGE_CONFIG/)
    expect(SURFACE).not.toMatch(/'exploring'\s*,\s*'researching'/)
  })

  it('normalises a legacy stage value before comparing against it', () => {
    /* `trade_queue_items.stage` still holds pre-migration values on older
       rows; comparing them raw highlights no chip at all. */
    expect(SURFACE).toMatch(/toIdeaStage\(row\?\.stage \?\? idea\.stage\)/)
  })

  it('states the stage once', () => {
    /* The identity row used to carry a `stageColor` chip saying the same
       thing one line above the track. */
    expect(SURFACE).not.toMatch(/stageColor/)
    expect(SURFACE).not.toMatch(/stageLabel/)
  })
})

describe('the gate is asked before the write, not after', () => {
  it('routes every chip through one request function', () => {
    expect(SURFACE).toMatch(/onClick=\{\(\) => requestStageMove\(s\)\}/)
  })

  it('only moves when nothing is missing', () => {
    const at = SURFACE.indexOf('const requestStageMove')
    expect(at).toBeGreaterThan(-1)
    const body = SURFACE.slice(at, at + 700)
    expect(body).toMatch(/const missing = missingForStage\(gateSubject, stage\)/)
    expect(body).toMatch(/if \(missing\.length === 0\)[\s\S]{0,160}moveTrade\(/)
  })

  it('parks a refused move and opens the field it needs', () => {
    const at = SURFACE.indexOf('const requestStageMove')
    const body = SURFACE.slice(at, at + 700)
    expect(body).toMatch(/setBlocked\(\{ stage, missing \}\)/)
    expect(body).toMatch(/startRationale\(\)/)
    expect(body).toMatch(/startThesis\(\)/)
  })

  it('never calls moveTrade straight from a chip', () => {
    /* The whole point of `requestStageMove`: a chip that called `moveTrade`
       directly would send a write the service gate throws on, and the reader
       would learn why from a toast. */
    expect(SURFACE).not.toMatch(/onClick=\{\(\) => moveTrade\(/)
  })

  it('does not re-implement the gate', () => {
    /* A local "needs a thesis" check would be a second rule to keep in step
       with `trade-idea-service.ts`. */
    expect(SURFACE).not.toMatch(/Trade thesis'\s*\]/)
    expect((SURFACE.match(/missingForStage\(/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })
})

describe('a parked move completes on the save that unblocks it', () => {
  it('re-asks the gate against the saved text', () => {
    /* Assuming the save satisfied the gate promotes an idea whose field was
       saved as whitespace. */
    const at = SURFACE.indexOf('const saveGated')
    expect(at).toBeGreaterThan(-1)
    const body = SURFACE.slice(at, at + 1200)
    expect(body).toMatch(/const text = value\.trim\(\)/)
    expect(body).toMatch(/const stillMissing = missingForStage\(/)
    expect(body).toMatch(/rationale: field === 'rationale' \? text : row\?\.rationale/)
  })

  it('waits when something else is still outstanding', () => {
    const at = SURFACE.indexOf('const saveGated')
    const body = SURFACE.slice(at, at + 1400)
    expect(body).toMatch(/if \(stillMissing\.length > 0\)[\s\S]{0,220}return/)
  })

  it('awaits the field write before moving', () => {
    /* Firing both at once races: the move can reach the service before the
       field it needs is committed, and the service gate rejects it. */
    expect(SURFACE).toMatch(/await updateTradeAsync\(\{/)
  })

  it('says the save will also move the idea, before it is pressed', () => {
    expect(SURFACE).toMatch(/Save & move to \$\{IDEA_STAGE_CONFIG\[blocked!\.stage\]\.label\}/)
    expect(SURFACE).toMatch(/const isLastBlocker = /)
  })

  it('offers a way to abandon a parked move', () => {
    expect(SURFACE).toMatch(/data-testid="idea-stage-blocked-cancel"/)
  })
})

describe('stage never moves as a side effect', () => {
  it('keeps stage out of every field save', () => {
    /* `save()` is the content path. A `stage` key reaching it would mean
       editing a sentence could promote an idea. */
    const at = SURFACE.indexOf('const save = (')
    expect(at).toBeGreaterThan(-1)
    /* The function body only — bounded at its closing brace, so the
       declarations that follow it cannot satisfy or break this. */
    const end = SURFACE.indexOf('\n  }', at)
    expect(end).toBeGreaterThan(at)
    const body = SURFACE.slice(at, end)
    expect(body).toMatch(/updateTrade\(\{/)
    expect(body).not.toMatch(/stage|outcome|status/)
  })

  it('still writes content only through the audited mutation', () => {
    expect(SURFACE).not.toMatch(/supabase[\s\S]{0,40}\.update\(/)
  })
})

describe('a pair trade is handed off, not half-moved', () => {
  it('disables the track for a pair rather than hiding it', () => {
    /* Hiding it would leave a pair's reader unable to see where the idea is;
       enabling it would move one leg and desynchronise the other. */
    expect(SURFACE).toMatch(/disabled=\{!canEdit \|\| here \|\| isPair \|\| isMoving\}/)
  })
})

describe('the fields the modal had and this did not', () => {
  it('writes priority through the service, as the urgency column it is', () => {
    expect(SURFACE).toMatch(/data-testid=\{`idea-urgency-\$\{level\}`\}/)
    expect(SURFACE).toMatch(/save\(\{ urgency: level \}\)/)
  })

  it('writes visibility through the service', () => {
    expect(SURFACE).toMatch(/save\(\{ sharingVisibility: v \}\)/)
  })

  it('reads the visibility column it writes', () => {
    /* Writing `sharingVisibility` while reading a column that was never
       selected renders every idea as private. */
    expect(SURFACE).toMatch(/sharing_visibility, /)
    expect(SURFACE).toMatch(/visibility === v/)
  })

  it('treats a missing visibility as private, not as team', () => {
    expect(SURFACE).toMatch(/const visibility = row\.sharing_visibility \?\? 'private'/)
  })

  it('states a visibility the picker does not offer instead of showing none', () => {
    /* Production holds `public` and `portfolio` too. With only two chips and
       no third branch, such a row renders with nothing selected — which a
       reader takes to mean private, the opposite of the truth. */
    expect(SURFACE).toMatch(/visibility !== 'private' && visibility !== 'team' && \(/)
    expect(SURFACE).toMatch(/data-testid="idea-visibility-other"/)
  })
})
