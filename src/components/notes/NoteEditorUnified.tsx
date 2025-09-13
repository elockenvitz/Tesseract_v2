import React from 'react'
import { UniversalNoteEditor } from './UniversalNoteEditor'

interface NoteEditorProps {
  assetId: string
  assetSymbol: string
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void
}

export function NoteEditor({
  assetId,
  assetSymbol,
  selectedNoteId,
  onNoteSelect
}: NoteEditorProps) {
  return (
    <UniversalNoteEditor
      entityType="asset"
      entityId={assetId}
      entityName={assetSymbol}
      selectedNoteId={selectedNoteId}
      onNoteSelect={onNoteSelect}
      // Asset editor doesn't have onClose in the original
    />
  )
}