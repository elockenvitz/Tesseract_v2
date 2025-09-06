import React, { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Plus, Search, Calendar, User, Share2, MoreHorizontal, Trash2, Copy, ChevronDown, Type, Palette, MoreVertical, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CollaborationManager } from '../ui/CollaborationManager'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface PortfolioNoteEditorProps {
  portfolioId: string
  portfolioName: string
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void
  onClose: () => void
}

export function PortfolioNoteEditor({ portfolioId, portfolioName, selectedNoteId, onNoteSelect, onClose }: PortfolioNoteEditorProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [editingContent, setEditingContent] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [showNoteMenu, setShowNoteMenu] = useState<string | null>(null)
  const [deleteConfirmDialog, setDeleteConfirmDialog] = useState<{
    isOpen: boolean
    noteId: string | null
    noteTitle: string
  }>({
    isOpen: false,
    noteId: null,
    noteTitle: ''
  })
  const [hiddenNoteIds, setHiddenNoteIds] = useState<Set<string>>(new Set())
  const [showNoteTypeDropdown, setShowNoteTypeDropdown] = useState(false)
  const [showCollaborationManager, setShowCollaborationManager] = useState(false)
  const [currentFont, setCurrentFont] = useState('Sans Serif')
  const [currentSize, setCurrentSize] = useState('15')
  const editorRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const noteTypeDropdownRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()
  const { user } = useAuth()

  const noteTypeOptions = [
    { value: 'general', label: 'General', color: 'default' },
    { value: 'research', label: 'Research', color: 'warning' },
    { value: 'analysis', label: 'Analysis', color: 'primary' },
    { value: 'idea', label: 'Idea', color: 'error' },
    { value: 'meeting', label: 'Meeting', color: 'success' },
    { value: 'call', label: 'Call', color: 'purple' }
  ]

  // Fetch all notes related to this portfolio
  const { data: notes, isLoading } = useQuery({
    queryKey: ['portfolio-notes', portfolioId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('portfolio_notes')
        .select('*')
        .eq('portfolio_id', portfolioId)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      
      if (error) throw error
      // Filter out locally hidden notes from the UI
      return (data || []).filter(note => !hiddenNoteIds.has(note.id))
    },
  })

  // Get the currently selected note
  const selectedNote = notes?.find(note => note.id === selectedNoteId)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      
      if (noteTypeDropdownRef.current && !noteTypeDropdownRef.current.contains(target)) {
        setShowNoteTypeDropdown(false)
      }
    }

    if (showNoteTypeDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNoteTypeDropdown])

  // Update editing content when selected note changes
  useEffect(() => {
    if (selectedNote) {
      setEditingContent(selectedNote.content || '')
      setEditingTitle(selectedNote.title || '')
    }
  }, [selectedNote])

  // Auto-save functionality
  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title?: string; content?: string }) => {
      setIsSaving(true)
      const updates: any = { updated_at: new Date().toISOString() }
      if (title !== undefined) updates.title = title
      if (content !== undefined) updates.content = content

      const { error } = await supabase
        .from('portfolio_notes')
        .update(updates)
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolioId] })
      setIsSaving(false)
    },
    onError: () => {
      setIsSaving(false)
    }
  })

  // Update note type
  const updateNoteTypeMutation = useMutation({
    mutationFn: async ({ id, noteType }: { id: string; noteType: string }) => {
      const { error } = await supabase
        .from('portfolio_notes')
        .update({ note_type: noteType, updated_at: new Date().toISOString() })
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolioId] })
      setShowNoteTypeDropdown(false)
    }
  })

  // Create new note
  const createNoteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not authenticated')
      
      // Create the note directly in portfolio_notes
      const { data: noteData, error: noteError } = await supabase
        .from('portfolio_notes')
        .insert([{
          portfolio_id: portfolioId,
          title: 'Untitled',
          content: '',
          note_type: 'research',
          created_by: user.id
        }])
        .select()
        .single()
      
      if (noteError) throw noteError
      return noteData
    },
    onSuccess: (newNote) => {
      queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolioId] })
      onNoteSelect(newNote.id)
    }
  })

  // Delete note
  const softDeleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!user) throw new Error('User not authenticated')
      
      // Mark the note as deleted in the database
      const { error } = await supabase
        .from('portfolio_notes')
        .update({ is_deleted: true })
        .eq('id', noteId)
        .eq('created_by', user.id) // Ensure user owns the note
      
      if (error) throw error
    },
    onSuccess: () => {
      // Refresh the notes list to reflect the hidden note
      queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolioId] })
      
      // If we hid the selected note, select another note or clear selection
      const hiddenNoteId = deleteConfirmDialog.noteId
      if (selectedNoteId === hiddenNoteId) {
        const remainingNotes = notes?.filter(n => n.id !== selectedNoteId && !hiddenNoteIds.has(n.id)) || []
        if (remainingNotes.length > 0) {
          onNoteSelect(remainingNotes[0].id)
        } else {
          onNoteSelect('')
        }
      }
      
      // Close the dialog
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
      setShowNoteMenu(null)
    },
    onError: (error) => {
      console.error('Failed to hide note:', error)
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
    }
  })

  // Auto-save when content changes
  useEffect(() => {
    if (!selectedNote || editingContent === selectedNote.content || !editingContent.trim()) return

    const timeoutId = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, content: editingContent })
    }, 1000) // Auto-save after 1 second of inactivity

    return () => clearTimeout(timeoutId)
  }, [editingContent, selectedNote?.id])

  // Auto-save when title changes
  useEffect(() => {
    if (!selectedNote || editingTitle === selectedNote.title || !editingTitle.trim()) return

    const timeoutId = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
      setIsTitleEditing(false)
    }, 1000) // Auto-save after 1 second of inactivity

    return () => clearTimeout(timeoutId)
  }, [editingTitle, selectedNote?.id])

  const handleContentChange = (content: string) => {
    setEditingContent(content)
  }

  const handleTitleChange = (title: string) => {
    setEditingTitle(title)
  }

  const handleTitleClick = (e: React.MouseEvent<HTMLHeadingElement>) => {
    const currentTarget = e.currentTarget
    const clientX = e.clientX
    
    setIsTitleEditing(true)
    setTimeout(() => {
      if (titleInputRef.current) {
        titleInputRef.current.focus()
        const rect = currentTarget.getBoundingClientRect()
        const clickX = clientX - rect.left
        const textWidth = rect.width
        const textLength = editingTitle.length
        const approximatePosition = Math.round((clickX / textWidth) * textLength)
        const cursorPosition = Math.max(0, Math.min(approximatePosition, textLength))
        titleInputRef.current.setSelectionRange(cursorPosition, cursorPosition)
      }
    }, 0)
  }

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      setIsTitleEditing(false)
      if (editingTitle !== selectedNote?.title) {
        saveNoteMutation.mutate({ id: selectedNote!.id, title: editingTitle })
      }
    } else if (e.key === 'Escape') {
      setEditingTitle(selectedNote?.title || '')
      setIsTitleEditing(false)
    }
  }

  const handleTitleBlur = () => {
    setIsTitleEditing(false)
    if (selectedNote && editingTitle !== selectedNote.title) {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
    }
  }

  const handleNoteClick = async (noteId: string) => {
    if (selectedNote && (editingContent !== selectedNote.content || editingTitle !== selectedNote.title)) {
      const updates: any = {}
      if (editingContent !== selectedNote.content) updates.content = editingContent
      if (editingTitle !== selectedNote.title) updates.title = editingTitle
      if (Object.keys(updates).length > 0) {
        try {
          await supabase
            .from('portfolio_notes')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', selectedNote.id)
          queryClient.invalidateQueries({ queryKey: ['portfolio-notes', portfolioId] })
        } catch (error) {
          console.error('Failed to save note:', error)
        }
      }
    }
    onNoteSelect(noteId)
    setIsTitleEditing(false)
  }

  const handleCreateNote = () => {
    createNoteMutation.mutate()
  }

  const handleDeleteNote = (noteId: string, noteTitle: string) => {
    setDeleteConfirmDialog({
      isOpen: true,
      noteId,
      noteTitle
    })
  }

  const handleConfirmDelete = () => {
    if (deleteConfirmDialog.noteId) {
      setHiddenNoteIds(prev => new Set([...prev, deleteConfirmDialog.noteId!]))
      softDeleteNoteMutation.mutate(deleteConfirmDialog.noteId)
    }
  }

  const handleCancelDelete = () => {
    setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
  }

  const handleNoteTypeChange = (noteType: string) => {
    if (selectedNote) {
      updateNoteTypeMutation.mutate({ id: selectedNote.id, noteType })
    }
  }

  const filteredNotes = notes?.filter(note => 
    note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    note.content.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  const getNoteTypeColor = (type: string | null) => {
    switch (type) {
      case 'meeting': return 'success'
      case 'call': return 'purple'
      case 'research': return 'warning'
      case 'idea': return 'error'
      case 'analysis': return 'primary'
      case 'general': return 'default'
      default: return 'default'
    }
  }

  return (
    <div className="flex h-[calc(100vh-200px)] bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Left Sidebar - Notes List */}
      <div className="w-1/4 border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900">Notes for {portfolioName}</h3>
            <Button size="sm" onClick={handleCreateNote} disabled={createNoteMutation.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : filteredNotes.length > 0 ? (
            <div className="space-y-1 p-2">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className={clsx(
                    'p-3 rounded-lg cursor-pointer transition-colors group relative',
                    selectedNoteId === note.id
                      ? 'bg-primary-50 border border-primary-200'
                      : 'hover:bg-gray-50'
                  )}
                  onClick={() => handleNoteClick(note.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2 mb-1">
                        <h4 className="font-medium text-gray-900 truncate text-sm">
                          {note.title}
                        </h4>
                        {note.note_type && (
                          <Badge variant={getNoteTypeColor(note.note_type)} size="sm">
                            {note.note_type}
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-gray-600 line-clamp-2 mb-2">
                        {note.content.replace(/^#.*\n/, '').substring(0, 80)}...
                      </p>
                      <div className="flex items-center space-x-3 text-xs text-gray-500">
                        <div className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                        </div>
                        {note.is_shared && (
                          <div className="flex items-center">
                            <Share2 className="h-3 w-3 mr-1" />
                            Shared
                          </div>
                        )}
                      </div>
                    </div>
                    
                    {/* Note Menu */}
                    <div className="relative">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowNoteMenu(showNoteMenu === note.id ? null : note.id)
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-gray-200 rounded transition-opacity"
                      >
                        <MoreHorizontal className="h-3 w-3" />
                      </button>
                      
                      {showNoteMenu === note.id && (
                        <div className="absolute right-0 top-6 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[120px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(note.content)
                              setShowNoteMenu(null)
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs text-gray-600 hover:bg-gray-50 flex items-center"
                          >
                            <Copy className="h-3 w-3 mr-2" />
                            Copy content
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteNote(note.id, note.title)
                            }}
                            className="w-full px-3 py-1.5 text-left text-xs text-error-600 hover:bg-error-50 flex items-center border-t border-gray-100"
                            disabled={softDeleteNoteMutation.isPending}
                          >
                            <Trash2 className="h-3 w-3 mr-2" />
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 text-center text-gray-500">
              <p className="text-sm">No notes found</p>
              <Button size="sm" className="mt-2" onClick={handleCreateNote}>
                Create first note
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Note Editor */}
      <div className="flex-1 flex flex-col">
        {selectedNote ? (
          <>
            {/* Editor Header */}
            <div className="p-4 border-b border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1">
                  <div className="flex items-center space-x-2" ref={noteTypeDropdownRef}>
                    <div className="relative">
                      <button
                        onClick={() => setShowNoteTypeDropdown(!showNoteTypeDropdown)}
                      >
                        <Badge variant={getNoteTypeColor(selectedNote.note_type)} size="sm">
                          {selectedNote.note_type || 'general'}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </Badge>
                      </button>
                      
                      {showNoteTypeDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
                          {noteTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => handleNoteTypeChange(option.value)}
                              className={clsx(
                                'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors flex items-center justify-between',
                                selectedNote.note_type === option.value && 'bg-gray-100'
                              )}
                              disabled={updateNoteTypeMutation.isPending}
                            >
                              <span>{option.label}</span>
                              <Badge variant={option.color as any} size="sm">
                                {option.value}
                              </Badge>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedNote.is_shared && (
                      <Badge variant="primary" size="sm">
                        <Share2 className="h-3 w-3 mr-1" />
                        Shared
                      </Badge>
                    )}
                    
                    {/* Collaboration Button */}
                    <button
                      onClick={() => setShowCollaborationManager(true)}
                      className="flex items-center space-x-1 px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                      title="Manage collaborators"
                    >
                      <Users className="h-3 w-3" />
                      <span>Share</span>
                    </button>
                  </div>
                </div>
                <div className="flex items-center space-x-2 text-xs text-gray-500">
                  <Calendar className="h-3 w-3" />
                  Last updated {formatDistanceToNow(new Date(selectedNote.updated_at || 0), { addSuffix: true })}
                  {updateNoteTypeMutation.isPending && (
                    <div className="flex items-center ml-2">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500 mr-1" />
                      <span className="text-xs">Updating...</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Editor Content */}
            <div className="flex-1 overflow-y-auto">
              {/* Note Title as Editable Heading */}
              <div className="p-6 pb-0">
                {isTitleEditing ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    onBlur={handleTitleBlur}
                    className="w-full text-2xl font-bold text-gray-900 mb-6 border-b border-gray-200 pb-4 bg-transparent border-0 border-b-2 focus:outline-none focus:border-primary-500"
                    placeholder="Untitled"
                  />
                ) : (
                  <h1 
                    className="text-2xl font-bold text-gray-900 mb-6 border-b border-gray-200 pb-4 cursor-text hover:bg-gray-50 rounded px-2 py-1 -mx-2 -my-1 transition-colors"
                    onClick={handleTitleClick}
                  >
                    {editingTitle || selectedNote.title || 'Untitled'}
                  </h1>
                )}
              </div>
              
              {/* Note Content */}
              <div className="px-6 pb-6">
                <textarea
                  ref={editorRef as React.RefObject<HTMLTextAreaElement>}
                  value={editingContent}
                  onChange={(e) => handleContentChange(e.target.value)}
                  placeholder="Start typing..."
                  className="w-full resize-none border-none outline-none text-gray-900 placeholder-gray-400 leading-relaxed"
                  style={{
                    minHeight: '400px',
                    fontFamily: currentFont,
                    fontSize: `${currentSize}px`
                  }}
                />
              </div>
            </div>

            {/* Status Bar */}
            <div className="px-6 py-2 border-t border-gray-200 bg-gray-50">
              <div className="flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center space-x-4">
                  <span>{editingContent.split(' ').filter(word => word.length > 0).length} words</span>
                  <span>{editingContent.length} characters</span>
                </div>
                <div className="flex items-center space-x-2">
                  {isSaving && (
                    <div className="flex items-center">
                      <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary-500 mr-1" />
                      Saving...
                    </div>
                  )}
                  {!isSaving && !saveNoteMutation.isPending && (
                    <span className="text-success-600">Auto-saved</span>
                  )}
                  {saveNoteMutation.isError && (
                    <span className="text-error-600">Save failed</span>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-500">
            <div className="text-center">
              <h3 className="text-lg font-medium text-gray-900 mb-2">Select a note to edit</h3>
              <p className="text-sm">Choose a note from the sidebar or create a new one</p>
              <Button size="sm" className="mt-4" onClick={handleCreateNote}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Note
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        isOpen={deleteConfirmDialog.isOpen}
        onClose={handleCancelDelete}
        onConfirm={handleConfirmDelete}
        title="Delete Note"
        message={`Are you sure you want to delete "${deleteConfirmDialog.noteTitle}"? This note will be removed from your view but can be recovered if needed.`}
        confirmText="Delete Note"
        cancelText="Keep Note"
        variant="danger"
        isLoading={softDeleteNoteMutation.isPending}
      />

      {/* Collaboration Manager */}
      <CollaborationManager
        noteId={selectedNoteId || ''}
        noteType="portfolio"
        noteTitle={selectedNote?.title || ''}
        isOpen={showCollaborationManager}
        onClose={() => setShowCollaborationManager(false)}
      />
    </div>
  )
}