import { describe, it, expect } from 'vitest'
import {
  THEME_MODES, THEME_MODE_LABEL, THEME_READ_MODES, LEGACY_SECTION_MODE,
  themeModeOf, themeReadModeOf, isThemeMode, isThemeReadMode,
  type ThemeMode,
} from '../modes'

/**
 * The Theme page's modes, and the migration off its six old tabs.
 *
 * The migration is the part worth testing: it only ever runs for a reader
 * returning to a tab saved by an older build, which is the one path nobody
 * exercises by hand, and getting it wrong lands them on a blank page.
 */

describe('the modes themselves', () => {
  it('is three modes, orient then read then do', () => {
    expect(THEME_MODES).toEqual(['overview', 'research', 'work'])
  })

  it('labels every mode, and nothing it does not have', () => {
    expect(Object.keys(THEME_MODE_LABEL).sort()).toEqual([...THEME_MODES].sort())
    for (const mode of THEME_MODES) {
      expect(THEME_MODE_LABEL[mode], `no label for ${mode}`).toBeTruthy()
    }
  })

  it('has no History, because a theme has no decisions to put in one', () => {
    expect(THEME_MODES).not.toContain('history')
    /* The change log is a read mode of Research instead, beside the thing it
       is a log of. If History ever arrives here it should be because themes
       gained decisions, not because the nav wanted a fourth tab. */
    expect(THEME_READ_MODES).toContain('changes')
  })

  it('reads the case, its changes and its notes', () => {
    expect(THEME_READ_MODES).toEqual(['thesis', 'changes', 'notes'])
  })
})

describe('every section the page used to persist has somewhere to land', () => {
  /** The six tabs, plus the older value the page was already migrating. */
  const LEGACY = [
    'thesis', 'chart', 'related-assets', 'notes', 'discussion', 'processes',
    'outcomes',
  ]

  it('maps all seven, and maps nothing else', () => {
    expect(Object.keys(LEGACY_SECTION_MODE).sort()).toEqual([...LEGACY].sort())
  })

  it.each([
    ['thesis', 'research'],
    ['notes', 'research'],
    ['outcomes', 'research'],
    ['chart', 'overview'],
    ['related-assets', 'overview'],
    ['discussion', 'overview'],
    ['processes', 'work'],
  ] as [string, ThemeMode][])('%s lands in %s', (saved, mode) => {
    expect(themeModeOf(saved)).toBe(mode)
  })

  it('lands every legacy value on a mode that actually exists', () => {
    for (const saved of LEGACY) {
      expect(THEME_MODES, `${saved} maps outside the nav`).toContain(themeModeOf(saved))
    }
  })

  it('falls back to Overview rather than rendering nothing', () => {
    // A build older than any of these, or state written by a feature since
    // removed, or no saved state at all.
    for (const junk of [null, undefined, '', 'nonsense', 'history', 'snapshot']) {
      expect(themeModeOf(junk)).toBe('overview')
    }
  })

  it('does not answer yes to an inherited property', () => {
    /* `in` would resolve 'toString' on every object literal, and a persisted
       'toString' would index to undefined and hand the caller a mode that is
       not a mode. Own properties only, same as the Asset page's guard. */
    expect(themeModeOf('toString')).toBe('overview')
    expect(themeModeOf('constructor')).toBe('overview')
    expect(themeModeOf('hasOwnProperty')).toBe('overview')
  })
})

describe('a section that was its own tab keeps its destination', () => {
  it('arrives in Research already reading the notes', () => {
    /* Notes was a tab. A reader who left the page there has to land on the
       notes, not on the thesis -- otherwise the restructure silently loses
       the destination they saved. */
    expect(themeModeOf('notes')).toBe('research')
    expect(themeReadModeOf('notes')).toBe('notes')
  })

  it('says nothing about the read mode for sections that do not care', () => {
    /* Null rather than 'thesis', so a caller can tell "this section wants a
       particular read mode" from "this section has no opinion" and leave a
       read mode the reader has since chosen alone. */
    for (const saved of ['thesis', 'chart', 'related-assets', 'discussion', 'processes', 'outcomes']) {
      expect(themeReadModeOf(saved), `${saved} should not force a read mode`).toBeNull()
    }
    expect(themeReadModeOf(null)).toBeNull()
    expect(themeReadModeOf(undefined)).toBeNull()
  })

  it('only ever returns a read mode the Research pane has', () => {
    for (const saved of [...Object.keys(LEGACY_SECTION_MODE), null, 'junk']) {
      const read = themeReadModeOf(saved)
      if (read !== null) expect(THEME_READ_MODES).toContain(read)
    }
  })
})

describe('the type guards', () => {
  it('accepts exactly the modes', () => {
    for (const mode of THEME_MODES) expect(isThemeMode(mode)).toBe(true)
    for (const no of ['history', 'thesis', '', null, undefined, 0, {}]) {
      expect(isThemeMode(no), `${String(no)} is not a mode`).toBe(false)
    }
  })

  it('accepts exactly the read modes', () => {
    for (const read of THEME_READ_MODES) expect(isThemeReadMode(read)).toBe(true)
    for (const no of ['references', 'all', 'summary', '', null, undefined, 0, {}]) {
      expect(isThemeReadMode(no), `${String(no)} is not a read mode`).toBe(false)
    }
  })

  it('does not confuse a mode for a read mode', () => {
    /* They are different axes -- WHICH surface against HOW to read it -- and
       'research' being both a mode and a plausible-looking read mode is how
       one would be passed where the other was wanted. */
    expect(isThemeReadMode('research')).toBe(false)
    expect(isThemeMode('changes')).toBe(false)
  })
})
