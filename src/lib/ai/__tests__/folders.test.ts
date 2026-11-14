/**
 * The folder rules, tested where they have no client.
 *
 * Naming, counting, filtering and the move decision are the parts of this
 * feature that can be wrong without anything crashing: a duplicate name that
 * reaches the database comes back as a constraint code, a count taken from
 * the wrong set misreports what a reader can reach, and a no-op move is a
 * write that invalidates three queries to change nothing.
 */
import { describe, it, expect } from 'vitest'
import {
  UNFILED, FOLDER_NAME_MAX,
  validateFolderName, shapeFolders, folderCounts, filterByFolder, moveTarget,
  moveConfirmation, folderDeletionWarning, moveRefusedMessage, MOVE_REFUSED,
  type AIProjectFolderRow, type FiledConversation,
} from '../folders'

const existing = [
  { id: 'f-1', name: 'Earnings season' },
  { id: 'f-2', name: 'Apple investment case' },
]

describe('naming a folder', () => {
  it('accepts a name and normalises its whitespace', () => {
    const verdict = validateFolderName('  Semiconductor   coverage  ', existing)
    expect(verdict).toEqual({ ok: true, name: 'Semiconductor coverage' })
  })

  it('refuses a name that is only whitespace', () => {
    const verdict = validateFolderName('   ', existing)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) expect(verdict.reason).toBe('empty')
  })

  it('refuses a name past the column length', () => {
    const verdict = validateFolderName('x'.repeat(FOLDER_NAME_MAX + 1), existing)
    expect(verdict.ok).toBe(false)
    if (!verdict.ok) {
      expect(verdict.reason).toBe('too-long')
      expect(verdict.message).toContain(String(FOLDER_NAME_MAX))
    }
  })

  it('refuses a duplicate regardless of case or padding', () => {
    /* The unique index is on lower(btrim(name)), so this is the same rule the
       database applies -- stated in a sentence instead of an error code. */
    for (const attempt of ['Earnings season', 'earnings season', '  EARNINGS SEASON ']) {
      const verdict = validateFolderName(attempt, existing)
      expect(verdict.ok, attempt).toBe(false)
      if (!verdict.ok) expect(verdict.reason).toBe('duplicate')
    }
  })

  it('lets a folder keep its own name while being renamed', () => {
    const verdict = validateFolderName('Earnings season', existing, 'f-1')
    expect(verdict).toEqual({ ok: true, name: 'Earnings season' })
  })

  it('still refuses a rename onto another folder of the readers', () => {
    const verdict = validateFolderName('Apple investment case', existing, 'f-1')
    expect(verdict.ok).toBe(false)
  })
})

describe('shaping the rows', () => {
  const rows: AIProjectFolderRow[] = [
    { id: 'f-2', name: 'Risk review', is_archived: false, organization_id: 'org-a', updated_at: '2026-11-01T00:00:00Z' },
    { id: 'f-1', name: '  Ad hoc research ', is_archived: true, organization_id: 'org-a', updated_at: null },
  ]

  it('sorts by name, trims it, and reads the flags', () => {
    const shaped = shapeFolders(rows)
    expect(shaped.map(f => f.name)).toEqual(['Ad hoc research', 'Risk review'])
    expect(shaped[0]).toMatchObject({ id: 'f-1', isArchived: true, organizationId: 'org-a' })
    expect(shaped[1].isArchived).toBe(false)
  })

  it('survives nothing at all', () => {
    expect(shapeFolders(null)).toEqual([])
    expect(shapeFolders(undefined)).toEqual([])
    expect(shapeFolders([])).toEqual([])
  })
})

describe('counting and filtering', () => {
  const conversations: FiledConversation[] = [
    { id: 'c-1', folder_id: 'f-1' },
    { id: 'c-2', folder_id: 'f-1' },
    { id: 'c-3', folder_id: 'f-2' },
    { id: 'c-4', folder_id: null },
    { id: 'c-5' },
  ]

  it('counts each shelf and the unfiled pile', () => {
    const counts = folderCounts(conversations)
    expect(counts.get('f-1')).toBe(2)
    expect(counts.get('f-2')).toBe(1)
    /* A missing `folder_id` and an explicit null are the same thing: unfiled.
       Treating them differently is how a count misses rows selected without
       the column. */
    expect(counts.get(UNFILED)).toBe(2)
  })

  it('returns everything when no folder is selected', () => {
    expect(filterByFolder(conversations, null)).toHaveLength(5)
  })

  it('returns one shelf, or the unfiled pile', () => {
    expect(filterByFolder(conversations, 'f-1').map(c => c.id)).toEqual(['c-1', 'c-2'])
    expect(filterByFolder(conversations, UNFILED).map(c => c.id)).toEqual(['c-4', 'c-5'])
  })

  it('returns nothing for a folder that holds nothing', () => {
    expect(filterByFolder(conversations, 'f-empty')).toEqual([])
  })
})

describe('deciding a move', () => {
  it('writes the folder when it is a different one', () => {
    expect(moveTarget({ id: 'c-1', folder_id: null }, 'f-1')).toEqual({ change: true, folderId: 'f-1' })
    expect(moveTarget({ id: 'c-1', folder_id: 'f-1' }, 'f-2')).toEqual({ change: true, folderId: 'f-2' })
  })

  it('writes null when the thread is taken off a shelf', () => {
    expect(moveTarget({ id: 'c-1', folder_id: 'f-1' }, UNFILED)).toEqual({ change: true, folderId: null })
  })

  it('refuses a move that changes nothing', () => {
    /* The menu lists the folder a thread is already in, with a tick. Accepting
       that click would write the same value and invalidate three queries. */
    expect(moveTarget({ id: 'c-1', folder_id: 'f-1' }, 'f-1')).toEqual({ change: false })
    expect(moveTarget({ id: 'c-1', folder_id: null }, UNFILED)).toEqual({ change: false })
    expect(moveTarget({ id: 'c-1' }, UNFILED)).toEqual({ change: false })
    expect(moveTarget(null, 'f-1')).toEqual({ change: false })
  })
})

describe('what the reader is told', () => {
  it('names the destination, and says the thread is untouched when unfiled', () => {
    expect(moveConfirmation('Earnings season')).toBe('Moved to Earnings season.')
    expect(moveConfirmation(null)).toMatch(/conversation is unchanged/)
  })

  /**
   * "Delete folder" must not read as "delete these conversations".
   *
   * The column is ON DELETE SET NULL, so the threads survive. The warning
   * states the count and their fate, because a destructive-sounding word
   * beside a list of someone's research is exactly where a reader stops
   * trusting the product.
   */
  it('says how many conversations survive a folder deletion', () => {
    expect(folderDeletionWarning('Risk review', 0)).toMatch(/holds no conversations/)

    const one = folderDeletionWarning('Risk review', 1)
    expect(one).toMatch(/Its 1 conversation is kept/)
    expect(one).toMatch(/becomes unfiled/)
    expect(one).toMatch(/Nothing is deleted with it/)

    const many = folderDeletionWarning('Risk review', 4)
    expect(many).toMatch(/Its 4 conversations are kept/)
    expect(many).toMatch(/become unfiled/)
  })
})

/*
 * ── A refused move says so, and says the same thing twice ────────────────
 *
 * Two defects, one of them mine to report accurately.
 *
 * The first: the move was dispatched into a discarded promise
 * (`void moveConversationToFolder(...)`), so a refusal closed the menu, left
 * the thread where it was, and said nothing. The database really does refuse
 * -- `ai_conversations_folder_own` raises 42501 for a folder the
 * conversation's owner does not own, and it has been in production since
 * 20261112120000. The 2.4 report said that check did not exist, which was
 * wrong; what did not exist was any way for the reader to find out it had
 * fired.
 *
 * The second, and the reason this is a function rather than a string
 * literal at the call site: the two refusals must be indistinguishable. The
 * trigger's check is one existence-AND-ownership read, so "somebody else's
 * folder" and "no such folder" raise the same error on purpose -- otherwise
 * the control is an oracle for whether an arbitrary uuid is a real folder.
 * A message that improved on that would undo the property.
 */
describe('a refused move, in the reader\'s words', () => {
  it('says the same thing for a stranger\'s folder and for no folder at all', () => {
    /* Both arrive as 42501 from the trigger, which is the whole point. The
       assertion is identity, not similarity: two messages that merely read
       alike would still differ, and the difference is the leak. */
    const notYours = moveRefusedMessage({ code: '42501', message: 'must reference a folder owned by the conversation owner' })
    const notThere = moveRefusedMessage({ code: '42501', message: 'must reference a folder owned by the conversation owner' })
    expect(notYours).toBe(notThere)
    expect(notYours).toBe(MOVE_REFUSED)
  })

  it('never repeats the server\'s own words back', () => {
    /*
     * The raise text names the column and the constraint. Echoing it would
     * leak the shape of the guard and read as a crash; it would also,
     * eventually, differ between the two refusals as soon as somebody
     * changed one raise and not the other.
     */
    const msg = moveRefusedMessage({
      code: '42501',
      message: 'ai_conversations.folder_id must reference a folder owned by the conversation owner',
    })
    expect(msg).not.toMatch(/folder_id|ai_conversations|42501/)
    expect(msg).toMatch(/your own projects/)
  })

  it('distinguishes a fault from a refusal, because the reader acts differently', () => {
    /* "You cannot file it there" tells the reader to pick another project.
       A transport failure tells them to try again. Collapsing the two would
       blame the reader for an outage. */
    expect(moveRefusedMessage({ code: '08006', message: 'connection failure' }))
      .toMatch(/Try again in a moment/)
    expect(moveRefusedMessage(new Error('boom'))).toMatch(/Try again in a moment/)
    expect(moveRefusedMessage(null)).toMatch(/Try again in a moment/)
    expect(moveRefusedMessage(undefined)).toMatch(/Try again in a moment/)
  })
})
