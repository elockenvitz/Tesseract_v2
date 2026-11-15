/**
 * The save form, as the reader uses it.
 *
 * ── What this replaces, and why it is worth a suite ──────────────────────
 *
 * Keeping an answer was a confirmation: a suggested title the reader could
 * not change, no sight of the text, and nowhere to say what the answer was
 * about. The consequence was not cosmetic -- the only way to find an
 * artifact again was to recognise, in a list, a sentence a model had written
 * and the product had silently adopted as its name.
 *
 * The rules are in `artifact-store`. What only a render can be wrong about is
 * whether the four fields are actually wired: whether the title can be
 * edited, whether a pre-filled subject can be REMOVED, whether an empty
 * project means no project, and whether a rejected save keeps what the
 * reader typed.
 *
 * It writes nothing. The caller owns the write, so the whole form is
 * testable with no auth, no organization and no Supabase client.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useState } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AiArtifactSave, type AiArtifactSaveProps } from '../AiArtifactSave'
import { initialArtifactDraft, type ArtifactDraft } from '../../../lib/ai/artifact-store'

afterEach(cleanup)

const ANSWER = '## The bear case\n\nThree things hold it up: pricing, mix and the **2027** step-down.'

const FOLDERS = [{ id: 'f-1', name: 'Earnings season' }, { id: 'f-2', name: 'IC prep' }]

const SUBJECTS = [
  { type: 'asset', id: 'a-1', label: 'AAPL', detail: 'Apple Inc.' },
  { type: 'theme', id: 't-1', label: 'Power demand', detail: null },
]

/**
 * Renders the form with a live draft, the way the pane does.
 *
 * The draft is state the CALLER owns -- which matters, because a rejected
 * write has to leave it alone -- so the harness holds it rather than letting
 * the component own it.
 */
function form(over: Partial<AiArtifactSaveProps> = {}) {
  const onSave = vi.fn()
  const onCancel = vi.fn()
  const seed: ArtifactDraft = over.draft ?? initialArtifactDraft({ content: ANSWER })
  const live = { draft: seed }

  const Harness = () => {
    const [draft, setDraft] = useState(seed)
    live.draft = draft
    return (
      <AiArtifactSave
        open
        content={ANSWER}
        onCancel={onCancel}
        onSave={onSave}
        {...over}
        /* After the spread, so a caller cannot accidentally replace the live
           draft wiring this harness exists to provide. */
        draft={draft}
        onChange={setDraft}
      />
    )
  }

  render(<Harness />)
  return { onSave, onCancel, get draft() { return live.draft } }
}

describe('what is being kept', () => {
  it('shows the answer, without its markdown punctuation', () => {
    form()
    const preview = screen.getByTestId('ai-artifact-preview')
    expect(preview).toHaveTextContent('The bear case')
    expect(preview).toHaveTextContent('pricing, mix and the 2027 step-down')
    /* The hashes and asterisks would render as literal characters in a
       plain-text block. */
    expect(preview.textContent).not.toContain('##')
    expect(preview.textContent).not.toContain('**')
  })

  it('says so when there is nothing to show', () => {
    render(
      <AiArtifactSave
        open content="" draft={{ title: 'x', subject: null, folderId: null }}
        onChange={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()}
      />,
    )
    expect(screen.getByTestId('ai-artifact-preview'))
      .toHaveTextContent('This answer has no text yet.')
  })
})

describe('the name', () => {
  it('arrives suggested and can be replaced', async () => {
    /* The defect this form exists for: the title was a machine's guess that
       the reader had to accept. */
    const user = userEvent.setup()
    const f = form()
    const field = screen.getByTestId('ai-artifact-title') as HTMLInputElement
    expect(field.value).toBe('The bear case')

    await user.clear(field)
    await user.type(field, 'LRCX 2027 step-down')

    expect(f.draft.title).toBe('LRCX 2027 step-down')
  })

  it('refuses an empty one, in a sentence, and will not save', async () => {
    const user = userEvent.setup()
    const f = form()
    await user.clear(screen.getByTestId('ai-artifact-title'))

    expect(screen.getByTestId('ai-artifact-error'))
      .toHaveTextContent('Give it a name you will recognise later.')
    expect(screen.getByTestId('ai-artifact-save-confirm')).toBeDisabled()

    await user.click(screen.getByTestId('ai-artifact-save-confirm'))
    expect(f.onSave).not.toHaveBeenCalled()
  })
})

describe('what it is about', () => {
  it('is pre-filled from where the reader already is', () => {
    form({
      draft: initialArtifactDraft({
        content: ANSWER,
        subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
      }),
    })
    expect(screen.getByTestId('ai-artifact-subject')).toHaveTextContent('AAPL')
  })

  it('can be removed, because an answer read on AAPL can be about the sector', async () => {
    const user = userEvent.setup()
    const f = form({
      draft: initialArtifactDraft({
        content: ANSWER,
        subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
      }),
    })

    await user.click(screen.getByTestId('ai-artifact-subject-clear'))

    expect(f.draft.subject).toBeNull()
    expect(screen.getByTestId('ai-artifact-subject-search')).toBeInTheDocument()
  })

  it('can be searched for and chosen, carrying the canonical id', async () => {
    const user = userEvent.setup()
    const f = form({ subjectResults: SUBJECTS })

    await user.type(screen.getByTestId('ai-artifact-subject-search'), 'power')
    await user.click(screen.getByTestId('ai-artifact-subject-theme-t-1'))

    expect(f.draft.subject).toEqual({ type: 'theme', id: 't-1', label: 'Power demand' })
  })

  it('mirrors its query up, separately from the sidebar search', async () => {
    const onSubjectQueryChange = vi.fn()
    const user = userEvent.setup()
    form({ onSubjectQueryChange })
    await user.type(screen.getByTestId('ai-artifact-subject-search'), 'po')
    expect(onSubjectQueryChange).toHaveBeenLastCalledWith('po')
  })

  it('is optional, and saving without one is allowed', async () => {
    const user = userEvent.setup()
    const f = form()
    expect(screen.queryByTestId('ai-artifact-subject')).not.toBeInTheDocument()

    await user.click(screen.getByTestId('ai-artifact-save-confirm'))

    expect(f.onSave).toHaveBeenCalled()
    expect(f.draft.subject).toBeNull()
  })

  it('ignores a result of a type an artifact cannot be about', async () => {
    /*
     * `useEntitySearch` can return notes, users and workflows. The table's
     * CHECK accepts asset, portfolio and theme, so offering anything else
     * would be a row the database refuses -- and the one place that could
     * leak in is this picker.
     */
    const user = userEvent.setup()
    const f = form({ subjectResults: [{ type: 'note', id: 'n-1', label: 'A note' }] })
    await user.type(screen.getByTestId('ai-artifact-subject-search'), 'note')

    await user.click(screen.getByTestId('ai-artifact-subject-note-n-1'))

    expect(f.draft.subject).toBeNull()
  })
})

describe('the project', () => {
  it('is offered when the reader has any, and defaults to none', () => {
    form({ folders: FOLDERS })
    const select = screen.getByTestId('ai-artifact-folder') as HTMLSelectElement
    expect(select.value).toBe('')
    expect(screen.getByRole('option', { name: 'No project' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Earnings season' })).toBeInTheDocument()
  })

  it('is absent entirely when there are no projects', () => {
    form({ folders: [] })
    expect(screen.queryByTestId('ai-artifact-folder')).not.toBeInTheDocument()
  })

  it('defaults to the one the conversation is filed in', () => {
    form({
      folders: FOLDERS,
      draft: initialArtifactDraft({ content: ANSWER, folderId: 'f-2' }),
    })
    expect((screen.getByTestId('ai-artifact-folder') as HTMLSelectElement).value).toBe('f-2')
  })

  it('records a choice, and records clearing it as nothing', async () => {
    const user = userEvent.setup()
    const f = form({ folders: FOLDERS })

    await user.selectOptions(screen.getByTestId('ai-artifact-folder'), 'f-1')
    expect(f.draft.folderId).toBe('f-1')

    await user.selectOptions(screen.getByTestId('ai-artifact-folder'), '')
    /* Null, not the empty string: `''` is not a uuid and the column would
       reject it rather than read it as unfiled. */
    expect(f.draft.folderId).toBeNull()
  })
})

describe('what the reader is told will happen', () => {
  it('names the destinations rather than describing them generically', () => {
    form({
      folders: FOLDERS,
      draft: {
        title: 'Bear case',
        subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
        folderId: 'f-1',
      },
    })
    const effect = screen.getByTestId('ai-artifact-effect')
    expect(effect).toHaveTextContent('about AAPL')
    expect(effect).toHaveTextContent('in Earnings season')
  })

  it('always says what an artifact is NOT', () => {
    /* The thing a reader has to understand. Nothing downstream says it. */
    form()
    const effect = screen.getByTestId('ai-artifact-effect')
    expect(effect).toHaveTextContent('not filed as research')
    expect(effect).toHaveTextContent('not a decision')
    expect(effect).toHaveTextContent('deleting this conversation removes it')
  })
})

describe('a rejected save', () => {
  it('shows the reason and keeps what the reader typed', () => {
    /*
     * The form stays open on failure, which is why the draft is the
     * caller's state. Closing it would discard a title and a subject the
     * reader chose and say nothing about why.
     */
    form({
      error: 'That did not save.',
      draft: {
        title: 'LRCX 2027 step-down',
        subject: { type: 'asset', id: 'a-1', label: 'AAPL' },
        folderId: null,
      },
    })
    expect(screen.getByTestId('ai-artifact-error')).toHaveTextContent('That did not save.')
    expect((screen.getByTestId('ai-artifact-title') as HTMLInputElement).value)
      .toBe('LRCX 2027 step-down')
    expect(screen.getByTestId('ai-artifact-subject')).toHaveTextContent('AAPL')
  })
})

describe('the form itself', () => {
  it('renders nothing when it is not open', () => {
    render(
      <AiArtifactSave
        open={false} content={ANSWER}
        draft={{ title: 'x', subject: null, folderId: null }}
        onChange={vi.fn()} onCancel={vi.fn()} onSave={vi.fn()}
      />,
    )
    expect(screen.queryByTestId('ai-artifact-save')).not.toBeInTheDocument()
  })

  it('can be abandoned', async () => {
    const user = userEvent.setup()
    const f = form()
    await user.click(screen.getByTestId('ai-artifact-cancel'))
    expect(f.onCancel).toHaveBeenCalled()
    expect(f.onSave).not.toHaveBeenCalled()
  })
})
