/**
 * Supporting Research — the asset's compact, secondary research surface.
 *
 * The data hooks and the note editor have their own suites; here we assert the
 * surface's own behaviour: it frames supporting research as secondary to the
 * Investment Case (with an obvious route back), lists artifacts compactly and
 * opens them in a drawer (NOT an embedded full Notes app), never creates a note
 * just by rendering, keeps the artifact count fresh, and presents governed
 * asset-level documents with honest copy and empty/loading/error states.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

const notesApi = vi.hoisted(() => ({
  ready: true, isLoading: false, error: null as Error | null,
  notes: [{ id: 'n1', title: 'Services deep-dive', contentPreview: 'margins', createdBy: 'u1', createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
  ensureAssetLink: vi.fn(async () => {}),
  createArtifact: vi.fn(async () => 'new-id'),
  isCreating: false,
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

// The artifact editor lives in a drawer and is proven elsewhere; stub it to a
// seam that lets us read the opened note id and trigger onNoteSelect / onClose.
vi.mock('../ResearchArtifactDrawer', () => ({
  ResearchArtifactDrawer: ({ noteId, onNoteSelect, onClose }: any) => (
    <div data-testid="research-drawer" data-note-id={noteId}>
      <button data-testid="drawer-fire-select" onClick={() => onNoteSelect(noteId)}>select</button>
      <button data-testid="drawer-close" onClick={onClose}>close</button>
    </div>
  ),
}))

import { ResearchLibrary } from '../ResearchLibrary'

beforeEach(() => {
  notesApi.ready = true; notesApi.isLoading = false; notesApi.error = null; notesApi.isCreating = false
  notesApi.notes = [{ id: 'n1', title: 'Services deep-dive', contentPreview: 'margins', createdBy: 'u1', createdAt: '2026-01-01', updatedAt: '2026-01-01' }]
  notesApi.ensureAssetLink.mockClear(); notesApi.refetch.mockClear()
  notesApi.createArtifact.mockClear(); notesApi.createArtifact.mockResolvedValue('new-id')
  docsApi.ready = true; docsApi.isLoading = false; docsApi.error = null; docsApi.documents = []; docsApi.isAttaching = false
  docsApi.uploadAndAttach.mockClear(); docsApi.getUrl.mockClear()
  vi.spyOn(window, 'open').mockImplementation(() => null)
})

describe('Supporting Research surface', () => {
  it('frames research as secondary to the Investment Case, with a count and a route back', () => {
    const onBack = vi.fn()
    render(<ResearchLibrary assetId="a1" assetName="AAPL" onBackToInvestmentCase={onBack} />)
    expect(screen.getByText('Supporting research')).toBeInTheDocument()
    expect(screen.getByText(/1 artifact/)).toBeInTheDocument()
    // Distinction from the canonical Investment Case is explicit.
    expect(screen.getByText(/not the case itself/i)).toBeInTheDocument()
    expect(screen.getByText(/no investment idea required/i)).toBeInTheDocument()
    expect(screen.getByTestId('back-to-investment-case')).toBeInTheDocument()
  })

  it('does NOT embed the full Notes application inline and does not create on render', () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    // No inline editor, no drawer until an artifact is opened.
    expect(screen.queryByTestId('universal-note-editor')).not.toBeInTheDocument()
    expect(screen.queryByTestId('research-drawer')).not.toBeInTheDocument()
    // Rendering must never create an artifact.
    expect(notesApi.createArtifact).not.toHaveBeenCalled()
  })

  it('returns to the Investment Case when asked', async () => {
    const onBack = vi.fn()
    render(<ResearchLibrary assetId="a1" assetName="AAPL" onBackToInvestmentCase={onBack} />)
    await userEvent.click(screen.getByTestId('back-to-investment-case'))
    expect(onBack).toHaveBeenCalled()
  })

  it('shows a no-organization state instead of running unscoped', () => {
    notesApi.ready = false
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    expect(screen.getByTestId('research-library-no-org')).toBeInTheDocument()
    expect(screen.queryByTestId('research-artifacts')).not.toBeInTheDocument()
  })
})

describe('Artifact list and drawer', () => {
  it('lists artifacts compactly and opens one in the drawer', async () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    await userEvent.click(screen.getByText('Services deep-dive'))
    const drawer = screen.getByTestId('research-drawer')
    expect(drawer).toHaveAttribute('data-note-id', 'n1')
  })

  it('shows the empty state when there is no supporting research', () => {
    notesApi.notes = []
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    expect(screen.getByTestId('research-artifacts-empty')).toBeInTheDocument()
  })

  it('creates a new artifact on explicit New and opens it in the drawer', async () => {
    notesApi.notes = []
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    await userEvent.click(screen.getByTestId('supporting-research-new'))
    expect(notesApi.createArtifact).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(screen.getByTestId('research-drawer')).toHaveAttribute('data-note-id', 'new-id'))
  })

  it('connects the artifact to the asset when the drawer selects it', async () => {
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    await userEvent.click(screen.getByText('Services deep-dive'))
    await userEvent.click(screen.getByTestId('drawer-fire-select'))
    expect(notesApi.ensureAssetLink).toHaveBeenCalledWith('n1')
  })

  it('refreshes the artifact list when the drawer closes so the count stays fresh', async () => {
    // The editor owns persistence and invalidates only its own query; closing
    // the drawer must refetch or titles / new artifacts go stale.
    render(<ResearchLibrary assetId="a1" assetName="AAPL" />)
    await userEvent.click(screen.getByText('Services deep-dive'))
    expect(notesApi.refetch).not.toHaveBeenCalled()
    await userEvent.click(screen.getByTestId('drawer-close'))
    expect(notesApi.refetch).toHaveBeenCalled()
    expect(screen.queryByTestId('research-drawer')).not.toBeInTheDocument()
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
    await userEvent.click(screen.getByText('Model.xlsx'))
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
