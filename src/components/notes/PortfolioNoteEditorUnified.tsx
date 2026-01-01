import React from 'react'
import { UniversalNoteEditor } from './UniversalNoteEditor'

interface PortfolioNoteEditorProps {
  portfolioId: string
  portfolioName: string
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void
  onClose?: () => void
}

export function PortfolioNoteEditor({
  portfolioId,
  portfolioName,
  selectedNoteId,
  onNoteSelect,
  onClose
}: PortfolioNoteEditorProps) {
  return (
    <UniversalNoteEditor
      entityType="portfolio"
      entityId={portfolioId}
      entityName={portfolioName}
      selectedNoteId={selectedNoteId}
      onNoteSelect={onNoteSelect}
      onClose={onClose}
    />
  )
}