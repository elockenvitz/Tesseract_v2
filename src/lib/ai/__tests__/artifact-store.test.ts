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
  ARTIFACT_SUBJECT_TYPES, isArtifactSubjectType, initialArtifactDraft,
  artifactPreview, artifactDraftError, artifactAssociation, describeArtifactSave,
  type ArtifactDraft,
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

/* ─── The draft the save form holds ────────────────────────────────────────
 *
 * The rules live here rather than in the component so that a test can read
 * them without a DOM, and so the component is not the only thing that knows
 * what a valid save looks like.
 *
 * Two of these mirror constraints in the (unapplied) migration, and that is
 * the reason they are worth asserting: a mismatch between this file and the
 * table is a row the database refuses, which the reader would see as a save
 * that silently failed.
 */

const draft = (over: Partial<ArtifactDraft> = {}): ArtifactDraft => ({
  title: 'Bear case', subject: null, folderId: null, ...over,
})

describe('what an artifact can be about', () => {
  it('is the three the database guard can actually check', () => {
    /*
     * Not the four the sidebar's object search offers. A note lives in one
     * of four separate tables; an asset, a portfolio and a theme are each
     * one table the trigger can verify containment against -- which is why
     * the CHECK and this list have to agree.
     */
    expect([...ARTIFACT_SUBJECT_TYPES]).toEqual(['asset', 'portfolio', 'theme'])
  })

  it('rejects the types the search can return but the column cannot hold', () => {
    expect(isArtifactSubjectType('asset')).toBe(true)
    expect(isArtifactSubjectType('note')).toBe(false)
    expect(isArtifactSubjectType('user')).toBe(false)
    expect(isArtifactSubjectType('')).toBe(false)
  })
})

describe('what the form opens with', () => {
  it('suggests the name and pre-fills from where the reader is', () => {
    const d = initialArtifactDraft({
      content: '## The bear case\n\nThree things hold it up.',
      subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
      folderId: 'f-1',
    })
    expect(d.title).toBe('The bear case')
    expect(d.subject).toEqual({ type: 'asset', id: 'a-1', label: 'AAPL' })
    expect(d.folderId).toBe('f-1')
  })

  it('drops a pane subject an artifact cannot be about, rather than carrying it', () => {
    /*
     * The pane's subject can be a note or a workflow. Carrying one here
     * would reach the column's CHECK and be refused at the database, which
     * the reader would see as a save that did nothing.
     */
    const d = initialArtifactDraft({
      content: 'Text',
      subject: { type: 'note', id: 'n-1', label: 'A note' },
    })
    expect(d.subject).toBeNull()
  })

  it('drops a subject with no id, which names nothing', () => {
    const d = initialArtifactDraft({
      content: 'Text',
      subject: { type: 'asset', id: null, label: 'AAPL' },
    })
    expect(d.subject).toBeNull()
  })

  it('falls back to the id when the label is missing, so the chip is never blank', () => {
    const d = initialArtifactDraft({
      content: 'Text',
      subject: { type: 'theme', id: 't-1', label: '  ' },
    })
    expect(d.subject).toEqual({ type: 'theme', id: 't-1', label: 't-1' })
  })

  it('opens unfiled and unassociated when the pane knows nothing', () => {
    const d = initialArtifactDraft({ content: 'Text' })
    expect(d.subject).toBeNull()
    expect(d.folderId).toBeNull()
  })
})

describe('the preview', () => {
  it('shows the answer without the markdown that would read as punctuation', () => {
    const text = artifactPreview('## Heading\n\nIt holds up on **pricing** and `mix`.')
    expect(text).toBe('Heading It holds up on pricing and mix.')
  })

  it('is a reminder of which answer, not a second copy to read', () => {
    const text = artifactPreview('word '.repeat(200))
    expect(text.length).toBeLessThanOrEqual(280)
    expect(text.endsWith('…')).toBe(true)
  })

  it('cuts on a word when one is near the end, and mid-token when none is', () => {
    expect(artifactPreview('alpha beta gamma delta', 12)).toBe('alpha beta…')
    /* No space in the budget's last 40%: cutting on the only early space
       would throw away most of what the preview is for. */
    expect(artifactPreview('a bbbbbbbbbbbbbbbbbbbb', 12)).toBe('a bbbbbbbbb…')
  })

  it('is empty, never the string "undefined", for an answer with no text', () => {
    expect(artifactPreview(null)).toBe('')
    expect(artifactPreview(undefined)).toBe('')
  })
})

describe('whether a draft can be saved', () => {
  it('needs a name, and says so in a sentence', () => {
    expect(artifactDraftError(draft({ title: '  ' }))).toMatch(/name you will recognise/i)
  })

  it('accepts a named draft with nothing else chosen', () => {
    /*
     * Deliberate. The association makes an artifact findable; it does not
     * make it valid, and refusing to keep an answer for want of a shelf
     * would be the wrong trade.
     */
    expect(artifactDraftError(draft())).toBeNull()
  })

  it('refuses a subject of a type the column cannot hold', () => {
    const bad = { title: 'x', subject: { type: 'note', id: 'n-1', label: 'A note' }, folderId: null }
    expect(artifactDraftError(bad as unknown as ArtifactDraft))
      .toMatch(/asset, a portfolio or a theme/i)
  })

  it('refuses a subject with no id', () => {
    expect(artifactDraftError(draft({
      subject: { type: 'asset', id: '', label: 'AAPL' },
    }))).toMatch(/could not be identified/i)
  })
})

describe('the columns a write sends', () => {
  it('produces the subject pair together, or two nulls', () => {
    /*
     * The table's CHECK is `(subject_type IS NULL) = (subject_id IS NULL)`.
     * One written without the other is a rejected row, which is why the pair
     * is produced in one place rather than assembled at each call site.
     */
    expect(artifactAssociation(draft())).toEqual({
      subject_type: null, subject_id: null, folder_id: null,
    })
    expect(artifactAssociation(draft({
      subject: { type: 'portfolio', id: 'p-1', label: 'Core' },
    }))).toMatchObject({ subject_type: 'portfolio', subject_id: 'p-1' })
  })

  it('sends no folder for an empty choice, rather than an empty string', () => {
    /* The select's "No project" option has a value of `''`, and `''` is not
       a uuid -- the column would reject it rather than read it as unfiled. */
    expect(artifactAssociation(draft({ folderId: '' })).folder_id).toBeNull()
  })
})

describe('what the reader is told will happen', () => {
  it('names the destinations rather than describing them generically', () => {
    const text = describeArtifactSave(
      draft({ subject: { type: 'asset', id: 'a-1', label: 'AAPL' }, folderId: 'f-1' }),
      'Earnings season',
    )
    expect(text).toContain('about AAPL')
    expect(text).toContain('in Earnings season')
  })

  it('omits a project it cannot name, rather than printing an id', () => {
    const text = describeArtifactSave(draft({ folderId: 'f-1' }), null)
    expect(text).not.toContain('f-1')
    expect(text).toMatch(/outside this thread/i)
  })

  it('always says it is private to the reader', () => {
    /*
     * The one thing a reader could reasonably get wrong. `ai_conversations`
     * is strictly `user_id = auth.uid()`, so a kept answer is not visible to
     * a colleague however it is filed -- and a project that looks shared
     * invites the opposite assumption.
     */
    for (const d of [draft(), draft({ folderId: 'f-1' })]) {
      expect(describeArtifactSave(d, 'Earnings season')).toMatch(/private to you/i)
    }
  })
})
