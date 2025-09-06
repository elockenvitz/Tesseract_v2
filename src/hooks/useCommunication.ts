import { useState, useCallback } from 'react'

interface CitationData {
  content: string
  fieldName?: string
}

export function useCommunication() {
  const [isCommPaneOpen, setIsCommPaneOpen] = useState(false)
  const [isCommPaneFullscreen, setIsCommPaneFullscreen] = useState(false)
  const [currentCitation, setCurrentCitation] = useState<CitationData | null>(null)

  const toggleCommPane = useCallback(() => {
    setIsCommPaneOpen(prev => !prev)
  }, [])

  const openCommPane = useCallback(() => {
    setIsCommPaneOpen(true)
  }, [])

  const closeCommPane = useCallback(() => {
    setIsCommPaneOpen(false)
    setIsCommPaneFullscreen(false) // Reset fullscreen when closing
  }, [])

  const toggleCommPaneFullscreen = useCallback(() => {
    setIsCommPaneFullscreen(prev => !prev)
  }, [])

  const cite = useCallback((content: string, fieldName?: string) => {
    setCurrentCitation({ content, fieldName })
    setIsCommPaneOpen(true)
  }, [])

  const clearCitation = useCallback(() => {
    setCurrentCitation(null)
  }, [])

  return {
    isCommPaneOpen,
    isCommPaneFullscreen,
    currentCitation,
    toggleCommPane,
    toggleCommPaneFullscreen,
    openCommPane,
    closeCommPane,
    cite,
    clearCitation
  }
}