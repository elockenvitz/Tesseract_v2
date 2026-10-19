/**
 * Research Library — the asset's first-class research workspace.
 *
 * The data hooks and the note editor have their own suites; here we assert the
 * surface's own behaviour: it frames a research workspace (not an attachment
 * list), connects each artifact to the asset on open, presents governed
 * asset-level documents with honest copy, and handles empty/loading/error/
 * no-org states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const notesApi = vi.hoisted(() => ({
  ready: true, isLoading: false, error: null as Error | null,
  notes: [{ id: 'n1', title: 'Services deep-dive', contentPreview: null, createdBy: 'u1', createdAt: '', updatedAt: '' }],
  ensureAssetLink: vi.fn(async () => {}),
  refetch: vi.fn(),
}))
const docsApi = vi.hoisted(() => ({
  ready: true, isLoading: false, error: null as Error | null,
  documents: [] as any[],
  uploadAndAttach: vi.fn(async () => ({ id: 'f1' })),
  getUrl: vi.fn(async () => 'https://signed.example/doc'),
  isAttaching: false,
}))

vi.mock('../../../hooks/useAssetResearchNotes', () => ({
  useAssetResearchNotes: () => notesApi,
  useAssetResearchDocuments: () => docsApi,
}))

// The canonical note workspace is proven elsewhere; stub it to a seam that lets
// us trigger onNoteSelect (which fires on create + open).
vi.mock('../../notes/UniversalNoteEditor', () => ({
  UniversalNoteEditor: ({ entityType, entityId, onNoteSelect }: any) => (
    <div data-testid="universal-note-editor" data-entity-type={entityType} data-entity-id={entityId}>
      <button data-testid="editor-open-note" onClick={() => onNoteSelect('n1')}>open/create note</button>
    </div>
  ),
}))

import { ResearchLibrary } from '../ResearchLibrary'

beforeEach(() => {
  notesApi.ready = true; notesApi.isLoading = false; notesApi.error = null
  notesApi.notes = [{ id: 'n1', title: 'Services deep-dive', contentPreview: null, createdBy: 'u1', createdAt: '', updatedAt: '' }]
  notesApi.ensureAssetLink.mockClear()
  docsApi.ready = true; docsApi.isLoading = false; docsApi.error = null; docsApi.documents = []; docsApi.isAttaching = false
  docsApi.uploadAndAttach.mockClear(); docsApi.getUrl.mockClear()
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

describe('Research Library surface', () => {
  it('frames a research workspace with a count and asset-scoped editor', () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    expect(screen.getByText('Research')).toBeInTheDocument()
    expect(screen.getByText(/1 artifact/)).toBeInTheDocument()
    expect(screen.getByText(/no\s+investment idea required/i)).toBeInTheDocument()
    const editor = screen.getByTestId('universal-note-editor')
    expect(editor).toHaveAttribute('data-entity-type', 'asset')
    expect(editor).toHaveAttribute('data-entity-id', 'a1')
  })

  it('connects an artifact to the asset when it is opened or created', async () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    await userEvent.click(screen.getByTestId('editor-open-note'))
    expect(notesApi.ensureAssetLink).toHaveBeenCalledWith('n1')
  })

  it('shows a no-organization state instead of running unscoped', () => {
    notesApi.ready = false
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    expect(screen.getByTestId('research-library-no-org')).toBeInTheDocument()
    expect(screen.queryByTestId('universal-note-editor')).not.toBeInTheDocument()
  })
})

describe('Governed source documents', () => {
  it('labels documents as linked to the asset, not the note, and shows the empty state', () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    const docs = screen.getByTestId('research-documents')
    expect(within(docs).getByText(/linked to this asset$/i)).toBeInTheDocument()
    expect(within(docs).getByText(/Attach document/)).toBeInTheDocument()
    expect(screen.getByTestId('research-documents-empty')).toBeInTheDocument()
    // never implies per-note attachment
    expect(within(docs).queryByText(/attached to (this|the) note/i)).not.toBeInTheDocument()
  })

  it('lists linked documents and opens one via a signed URL', async () => {
    docsApi.documents = [{ linkId: 'fl1', linkedAt: '', file: { id: 'f1', original_name: 'Model.xlsx', name: 'model', storage_bucket: 'assets', storage_path: 'o/f1' } }]
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    const row = screen.getByText('Model.xlsx')
    await userEvent.click(row)
    await waitFor(() => expect(docsApi.getUrl).toHaveBeenCalled())
    expect(window.open).toHaveBeenCalledWith('https://signed.example/doc', '_blank', 'noopener,noreferrer')
  })

  it('attaches a picked file through the governed upload path', async () => {
    const { container } = render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['x'], 'Note.pdf', { type: 'application/pdf' })
    await userEvent.upload(input, file)
    await waitFor(() => expect(docsApi.uploadAndAttach).toHaveBeenCalledWith(file))
  })

  it('surfaces a documents load error', () => {
    docsApi.error = new Error('boom')
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    expect(screen.getByText(/Could not load documents: boom/)).toBeInTheDocument()
  })
})
