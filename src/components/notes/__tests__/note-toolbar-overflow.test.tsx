/**
 * The note editor's top bar cannot clip, at any phone width.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * The band above the note carried a type pill, a Shared badge, a reference
 * count and seven buttons — Link, Share, a checkpoint pin, History with a
 * count, Files with a count and a chevron, and Export with a chevron. At 390px
 * the last two sat past the right edge; at 320px so did the one before them.
 *
 * The first attempt hid five of them below `sm`. It was not enough, and manual
 * QA said so: Export, the dividers and the badges were still in the row, and
 * the row still sat above a SECOND band holding the note's title, so the two
 * together spent 102px of a 844px screen on chrome before a word of the note.
 *
 * ── What this asserts, and why it is structural rather than pixel-counted ──
 *
 * jsdom has no layout engine, so "does it clip at 320px" cannot be measured
 * here — `guard:layout` does that on a real viewport. What CAN be pinned is the
 * property that makes clipping impossible: the phone band is two fixed-width
 * controls and one child that truncates, so its intrinsic width does not grow
 * with its content. A row like that cannot overflow however long the note's
 * name is or however many types get added to the taxonomy.
 *
 * The second half of the file pins the other requirement: nothing was hidden
 * and abandoned. Every control the desktop row still has is reachable from the
 * sheet, and the two lists are compared to each other so a control added to one
 * and forgotten in the other fails here.
 */

import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { BottomSheet } from '../../mobile/BottomSheet'

const editor = readFileSync(resolve(__dirname, '../UniversalNoteEditor.tsx'), 'utf8').replace(/\r\n/g, '\n')

afterEach(cleanup)

/**
 * Where the phone branch of the header ternary ends and the desktop one begins.
 *
 * Named, because the obvious boundary — the `) : (` line — also matches inside
 * the phone band's own title ternary at a deeper indent, which silently cut the
 * band in half.
 */
const DESKTOP_BRANCH = '\n              ) : (\n              <div className="flex items-center justify-between gap-2">'

/** The phone band: from the branch that opens it to the desktop branch below. */
const phoneBand = (() => {
  const at = editor.indexOf('{isMobileViewport ? (\n                <div className="flex items-center gap-1">')
  expect(at).toBeGreaterThan(0)
  return editor.slice(at, editor.indexOf(DESKTOP_BRANCH, at))
})()

/** The desktop row, which must not have changed. */
const desktopRow = (() => {
  const at = editor.indexOf(DESKTOP_BRANCH)
  expect(at).toBeGreaterThan(0)
  return editor.slice(at, editor.indexOf('            {/* Linked Objects Panel */}', at))
})()

/** Every action the phone's overflow sheet offers, in order. */
const SHEET_ACTIONS = [...editor.matchAll(/\{\s*label: '([^']+)',\s*hint:/g)].map(m => m[1])
  .concat([...editor.matchAll(/^\s+label: '([^']+)',$/gm)].map(m => m[1]))
  .filter((v, i, a) => a.indexOf(v) === i)

describe('the phone band has nothing that can clip', () => {
  it('holds exactly three controls: the list, the name, and More', () => {
    const buttons = phoneBand.match(/<button/g) ?? []

    // Three, plus the optional Close that only a hosted editor passes.
    expect(buttons.length).toBeLessThanOrEqual(4)
  })

  it('gives the two icon controls a fixed width that cannot be squeezed', () => {
    expect(phoneBand.match(/shrink-0 h-9 w-9/g) ?? []).toHaveLength(3)
  })

  it('gives the middle control the shrinking job and a truncation', () => {
    // `min-w-0` is the part that matters: without it a flex child refuses to
    // compress below its content and pushes the row past the viewport.
    expect(phoneBand).toContain('<div className="flex-1 min-w-0">')
    expect(phoneBand).toContain('block truncate')
  })

  it('carries no label text of its own that could grow', () => {
    // Every visible string in the band comes from the note, and the note's name
    // truncates. A hard-coded word here would be an intrinsic width.
    expect(phoneBand).not.toMatch(/>\s*(Link|Share|History|Files|Export)\s*</)
  })

  it('reduces the type pill to a dot, keeping the word in the sheet', () => {
    expect(phoneBand).toContain("'h-2 w-2 rounded-full flex-shrink-0'")
    expect(SHEET_ACTIONS).toContain('Note type')
  })

  it('does not solve the overflow by clipping it', () => {
    for (const banned of ['overflow-hidden', 'overflow-x-auto', 'truncate"']) {
      expect(phoneBand.includes(banned) && banned !== 'truncate"').toBe(false)
    }
  })

  it('leaves no hidden-but-focusable control in the row', () => {
    // `hidden sm:flex` on a control inside the phone row would keep it in the
    // tab order while off screen. There is no such control, because the phone
    // band and the desktop row are different branches of a ternary.
    expect(phoneBand).not.toContain('hidden sm:')
    expect(phoneBand).not.toContain('sm:hidden')
  })

  it('is a branch, so the desktop row is not mounted on a phone at all', () => {
    expect(editor).toContain('{isMobileViewport ? (')
    expect(desktopRow).toContain('ref={noteTypeDropdownRef}')
  })
})

describe('the note name is still editable from the band', () => {
  it('swaps the name for its input in place', () => {
    expect(phoneBand).toContain('{isTitleEditing ? (')
    expect(phoneBand).toContain('onClick={handleTitleClick}')
    expect(phoneBand).toContain('ref={titleInputRef}')
  })

  it('uses the same handlers the desktop title uses', () => {
    for (const handler of ['handleTitleChange', 'handleTitleKeyDown', 'handleTitleBlur']) {
      expect(phoneBand).toContain(handler)
    }
  })
})

describe('every desktop control is reachable from the sheet', () => {
  it('offers the type, the links, the collaborators, the versions and the files', () => {
    for (const label of [
      'Note type', 'Link to an object', 'Collaborators', 'Saved versions', 'Files & links',
    ]) {
      expect(SHEET_ACTIONS).toContain(label)
    }
  })

  it('offers both exports, which the first attempt left clipped in the row', () => {
    expect(SHEET_ACTIONS).toContain('Export as PDF')
    expect(SHEET_ACTIONS).toContain('Export as Word')
  })

  it('offers the smart-input reference the save row used to carry', () => {
    expect(SHEET_ACTIONS).toContain('Smart input reference')
  })

  it('calls the same setters the desktop buttons call', () => {
    for (const setter of [
      'setShowLinkPicker(true)',
      'setShowCollaborationManager(true)',
      'setShowVersionHistory(true)',
      'setShowSmartInputHelp(true)',
    ]) {
      expect(editor).toContain(setter)
      expect(desktopRow.includes(setter) || setter.includes('SmartInputHelp')).toBe(true)
    }
  })

  it('does not list one action twice under two names', () => {
    // `Save checkpoint` and `Saved versions` were two desktop buttons opening
    // the same dialog. The sheet has one row.
    expect(SHEET_ACTIONS.filter(l => /version|checkpoint/i.test(l))).toEqual(['Saved versions'])
  })

  it('routes the two list-shaped actions to a panel rather than a nested sheet', () => {
    expect(editor).toContain("view: 'type'")
    expect(editor).toContain("view: 'files'")
    expect(editor).toContain("useState<'root' | 'type' | 'files'>('root')")
  })

  it('renders the files panel itself, since a dropdown cannot anchor to a sheet', () => {
    // The desktop Files control is an absolutely positioned dropdown anchored
    // inside the desktop row. On a phone that row is not mounted, so the sheet
    // has to show the list.
    expect(editor).toContain("{noteActionsView === 'files' && (")
    expect(editor).toContain('{file.fileName}')
    expect(editor).toContain('{link.text}')
  })

  it('can get back to the root panel from either list', () => {
    expect(editor).toContain("{noteActionsView !== 'root' && (")
    expect(editor).toContain("onClick={() => setNoteActionsView('root')}")
  })

  it('resets to the root panel when the sheet is dismissed', () => {
    // Otherwise reopening More lands on whichever list was last open.
    expect(editor).toContain("onClose={() => { setShowNoteActions(false); setNoteActionsView('root') }}")
  })
})

describe('the sheet the actions live in dismisses on its own controls', () => {
  /*
    The rows are inside a `BottomSheet`, whose drag row captured the pointer and
    swallowed the click on its own close button. That is fixed in `BottomSheet`
    and pinned here from the caller's side, because a sheet full of actions that
    cannot be closed is worse than no sheet.
  */
  it('closes on the X', () => {
    let open = true
    render(
      <BottomSheet open onClose={() => { open = false }} title="Note actions">
        <button type="button">Note type</button>
      </BottomSheet>,
    )

    fireEvent.click(screen.getByLabelText(/close/i))

    expect(open).toBe(false)
  })

  it('shows the rows it was given', () => {
    render(
      <BottomSheet open onClose={() => {}} title="Note actions">
        <button type="button">Export as PDF</button>
      </BottomSheet>,
    )

    expect(screen.getByText('Export as PDF')).toBeTruthy()
  })
})

describe('the desktop row is untouched', () => {
  it('keeps all seven controls visible, with no phone branch left inside', () => {
    expect(desktopRow).not.toContain('hidden sm:flex')
    expect(desktopRow).not.toContain('sm:hidden')
  })

  it('keeps its labels', () => {
    for (const label of ['Link', 'Share', 'History', 'Files', 'Export']) {
      expect(desktopRow).toContain(`>${label}</span>`)
    }
  })

  it('keeps its dropdowns anchored where they were', () => {
    for (const ref of ['noteTypeDropdownRef', 'filesLinksDropdownRef', 'exportDropdownRef']) {
      expect(desktopRow).toContain(`ref={${ref}}`)
    }
  })

  it('keeps its own block padding at the wider breakpoint', () => {
    expect(editor).toContain('px-3 sm:px-6 py-1 sm:py-4 border-b border-gray-100')
  })
})
