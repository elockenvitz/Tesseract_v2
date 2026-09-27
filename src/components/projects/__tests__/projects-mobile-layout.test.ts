/**
 * Source assertions for the Projects phone layout.
 *
 * These are source-level rather than rendered because what they guard is
 * layout, and jsdom has no layout engine: it will not tell you that five
 * columns divided across 390px are 58px each, because it never computes a
 * width. What it can do is hold the specific class decisions that make the
 * difference, so that removing one is a failing test rather than a silent
 * regression discovered on a phone.
 *
 * Every assertion strips comments from the source first. A regex that a
 * comment could satisfy is not an assertion — a previous pass in this lane
 * shipped a test that matched its own explanatory comment, so the stripping is
 * the point, not a detail.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = path.resolve(__dirname, '../../../..')

function sourceOf(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), 'utf8')
}

/** Strip `//`, `/* *​/` and JSX `{/* *​/}` comments so none can satisfy a match. */
function stripComments(source: string): string {
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

describe('kanban board columns', () => {
  const source = stripComments(sourceOf('src/components/projects/EnhancedKanbanColumn.tsx'))

  it('gives a column a phone-sized width so the board scrolls instead of compressing', () => {
    // `flex-1 min-w-0` is what let five columns divide 390px into 58px each,
    // and it is also why the parent's `overflow-x-auto` never engaged. 84vw
    // leaves a deliberate peek of the next column.
    expect(source).toMatch(/w-\[84vw\]/)
    expect(source).toMatch(/shrink-0/)
  })

  it('restores the five-way split from the sm breakpoint up, leaving desktop unchanged', () => {
    expect(source).toMatch(/sm:flex-1/)
    expect(source).toMatch(/sm:w-auto/)
    expect(source).toMatch(/sm:min-w-0/)
  })

  it('no longer sizes the column with an unprefixed flex-1 that applies at every width', () => {
    // The class run must not contain bare `flex-1` outside an `sm:` prefix.
    const unprefixed = /(?<!sm:)(?<![\w:-])flex-1(?![\w-])/
    const columnClasses = source.match(/'[^']*bg-white dark:bg-gray-800 rounded-lg[^']*'/)
    expect(columnClasses).not.toBeNull()
    expect(unprefixed.test(columnClasses![0])).toBe(false)
  })
})

describe('kanban board horizontal scroll', () => {
  const source = stripComments(sourceOf('src/components/projects/EnhancedKanbanBoard.tsx'))

  it('keeps the column row scrollable sideways, which is what the column width relies on', () => {
    expect(source).toMatch(/className="flex gap-2 sm:gap-4 flex-1 overflow-x-auto pb-2 sm:pb-4"/)
  })

  it('does not scroll-snap the container dnd-kit auto-scrolls during a drag', () => {
    expect(source).not.toMatch(/snap-x|snap-mandatory/)
  })
})

describe('kanban card touch gestures', () => {
  const css = sourceOf('src/index.css')

  it('hands vertical gestures back to the column scroller on a coarse pointer', () => {
    // `touch-none` on the card — required so a drag is never stolen — also
    // stops the card being swiped to scroll the column it sits in.
    // There are two such blocks; take the top-level one, which is the only
    // one that starts at column 0.
    const coarseBlock = css.match(
      /^@media \(max-width: 767px\) and \(pointer: coarse\) \{[\s\S]*?^\}/m
    )
    expect(coarseBlock).not.toBeNull()
    expect(coarseBlock![0]).toMatch(/\.kanban-card\.touch-none\s*\{[^}]*touch-action:\s*pan-y/)
  })

  it('leaves the card carrying touch-none, so the rule above has something to override', () => {
    const card = stripComments(sourceOf('src/components/projects/EnhancedKanbanCard.tsx'))
    expect(card).toMatch(/'kanban-card touch-none/)
  })
})

describe('create project form', () => {
  const source = stripComments(sourceOf('src/components/projects/CreateProjectModal.tsx'))

  it('stacks status, priority and due date on a phone', () => {
    expect(source).toMatch(/className="grid grid-cols-1 gap-3 sm:grid-cols-3"/)
  })

  it('has no unprefixed multi-column grid left in the form', () => {
    const unprefixed = source.match(/className="[^"]*(?<!sm:)(?<!md:)(?<!lg:)grid-cols-[2-9][^"]*"/g)
    expect(unprefixed ?? []).toEqual([])
  })

  it('keeps the dialog inside a phone viewport', () => {
    expect(source).toMatch(/max-w-2xl w-full/)
  })
})

describe('activity feed filters', () => {
  const source = stripComments(sourceOf('src/components/projects/ProjectActivityFeed.tsx'))

  it('keeps the two filter selects two-up rather than stacked', () => {
    // They were stacked for a pass. That cost a whole row of a phone for two
    // controls that each need about half the width, and Activity's value is
    // the event list underneath — so they went back to two-up, with the
    // select padding tightened instead.
    expect(source).toMatch(/grid-cols-2/)
    expect(source).not.toMatch(/grid-cols-1[^"']*sm:grid-cols-2/)
  })

  it('tightens the selects rather than letting them keep desktop padding', () => {
    expect(source).toMatch(/\[&_select\]:!px-2/)
  })
})
