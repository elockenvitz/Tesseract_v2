/**
 * Keeping an answer: the title, and the switch that keeps the feature off.
 *
 * Two things are load-bearing and each has its own block.
 *
 * `isMissingTable` decides whether the whole feature appears. It must say
 * yes for an absent table and NO for a denial -- "forbidden" and "absent"
 * are different findings, and collapsing them would hide a real RLS failure
 * behind a feature that merely looks switched off. That is the case nobody
 * would notice going wrong, so it is asserted from both directions.
 *
 * `clampTitle` has to respect a CHECK constraint it cannot see. A title of
 * exactly 201 characters is refused by the database, and the ellipsis counts
 * toward the budget -- a clamp that forgets that fails for one reader with
 * one long heading and for nobody else.
 */

import { describe, it, expect } from 'vitest'
import {
  isMissingTable, suggestArtifactTitle, clampTitle, artifactTitleError,
  ARTIFACT_TITLE_MAX, ARTIFACT_KEEP_OPTION,
} from '../artifact-store'

describe('whether the feature can be on at all', () => {
  it('recognises every shape a missing table arrives in', () => {
    expect(isMissingTable({ code: '42P01' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST205' })).toBe(true)
    expect(isMissingTable({ code: 'PGRST106' })).toBe(true)
    /* What an unmigrated Supabase project actually returns. */
    expect(isMissingTable({
      code: 'PGRST205',
      message: "Could not find the table 'public.ai_artifacts' in the schema cache",
    })).toBe(true)
    expect(isMissingTable({
      message: 'relation "public.ai_artifacts" does not exist',
    })).toBe(true)
  })

  it('does NOT treat a denial as an absence', () => {
    /*
     * THE case. A policy refusing a read means the table is there and the
     * caller may not see it -- a finding worth reporting. Swallowing it as
     * "feature off" would make an RLS fault indistinguishable from an
     * unapplied migration, and nobody would look.
     */
    expect(isMissingTable({ code: '42501', message: 'permission denied for table ai_artifacts' }))
      .toBe(false)
    expect(isMissingTable({ code: 'PGRST301', message: 'JWT expired' })).toBe(false)
    expect(isMissingTable({ code: '23505', message: 'duplicate key value' })).toBe(false)
  })

  it('says no to nothing at all', () => {
    expect(isMissingTable(null)).toBe(false)
    expect(isMissingTable(undefined)).toBe(false)
    expect(isMissingTable('boom')).toBe(false)
    expect(isMissingTable({})).toBe(false)
  })
})

describe('the suggested title', () => {
  it('prefers the heading the answer gave itself', () => {
    const content = '## Bear case for LRCX\n\nWafer fab equipment spending is...'
    expect(suggestArtifactTitle(content)).toBe('Bear case for LRCX')
  })

  it('falls back to the first sentence of prose', () => {
    const content = 'Lam Research faces a WFE spending trough. Second sentence here.'
    expect(suggestArtifactTitle(content)).toBe('Lam Research faces a WFE spending trough')
  })

  it('skips a code fence, a table row and a quote', () => {
    /* Each of the three makes a confusing name: it reads as the answer. */
    const content = '```\nselect 1\n```\n| a | b |\n> quoted\nThe real first line.'
    expect(suggestArtifactTitle(content)).toBe('The real first line')
  })

  it('strips the list marker but keeps the item', () => {
    expect(suggestArtifactTitle('- Margin compression is the risk')).toBe('Margin compression is the risk')
    expect(suggestArtifactTitle('1. Margin compression')).toBe('Margin compression')
  })

  it('strips emphasis so the name is not markdown', () => {
    expect(suggestArtifactTitle('## **Bear** case for `LRCX`')).toBe('Bear case for LRCX')
  })

  it('uses the thread name when the answer offers nothing', () => {
    expect(suggestArtifactTitle('', 'LRCX research')).toBe('LRCX research')
    expect(suggestArtifactTitle(null, 'LRCX research')).toBe('LRCX research')
  })

  it('is never empty, because the column refuses empty', () => {
    /* A blank default would fail at the database with nothing on screen
       saying why. */
    expect(suggestArtifactTitle('')).toBe('Kept answer')
    expect(suggestArtifactTitle('   \n\n  ', '  ')).toBe('Kept answer')
    expect(suggestArtifactTitle(undefined, null)).toBe('Kept answer')
  })
})

describe('the length the column accepts', () => {
  const long = `${'word '.repeat(80)}end`

  it('fits inside the CHECK, ellipsis included', () => {
    const clamped = clampTitle(long)
    expect(clamped.length).toBeLessThanOrEqual(ARTIFACT_TITLE_MAX)
    expect(clamped.endsWith('…')).toBe(true)
  })

  it('leaves a title that already fits exactly alone', () => {
    const exact = 'x'.repeat(ARTIFACT_TITLE_MAX)
    expect(clampTitle(exact)).toBe(exact)
    expect(clampTitle(exact).length).toBe(ARTIFACT_TITLE_MAX)
  })

  it('cuts on a word when there is one to cut on', () => {
    expect(clampTitle(long)).not.toMatch(/wo…$/)
  })

  it('still fits when there is no space to cut on', () => {
    /* One 400-character token: the word-boundary path cannot help, and the
       budget still has to hold. */
    const clamped = clampTitle('x'.repeat(400))
    expect(clamped.length).toBe(ARTIFACT_TITLE_MAX)
  })

  it('clamps whatever the suggestion produced, too', () => {
    const suggested = suggestArtifactTitle(`# ${long}`)
    expect(suggested.length).toBeLessThanOrEqual(ARTIFACT_TITLE_MAX)
  })
})

describe('what the reader is told before it is written', () => {
  it('refuses a blank name with a sentence, not a code', () => {
    expect(artifactTitleError('')).toMatch(/name/i)
    expect(artifactTitleError('   ')).toMatch(/name/i)
  })

  it('accepts anything the column would', () => {
    expect(artifactTitleError('Bear case')).toBeNull()
    expect(artifactTitleError('x'.repeat(ARTIFACT_TITLE_MAX))).toBeNull()
  })

  it('refuses what the column would refuse, before the round trip', () => {
    expect(artifactTitleError('x'.repeat(ARTIFACT_TITLE_MAX + 1))).toMatch(/200/)
  })
})

describe('the menu row', () => {
  it('claims nothing about the answer', () => {
    /*
     * Named in the brief: an artifact must not read as firm-approved
     * research. The other three Keep options file it as a record in the
     * reader's own name, so the difference has to be in the words.
     */
    const text = `${ARTIFACT_KEEP_OPTION.label} ${ARTIFACT_KEEP_OPTION.hint}`
    expect(text).toMatch(/not filed as research/i)
    expect(text).not.toMatch(/approved|verified|official|firm view/i)
  })
})
