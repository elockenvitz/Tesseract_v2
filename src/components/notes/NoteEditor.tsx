import React, { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import { Plus, Search, Calendar, Share2, MoreHorizontal, Trash2, Copy, ChevronDown, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CollaborationManager } from '../ui/CollaborationManager'
import { formatDistanceToNow } from 'date-fns'
import { clsx } from 'clsx'

interface NoteEditorProps {
  assetId: string
  assetSymbol: string
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void
}

export function NoteEditor({ assetId, assetSymbol, selectedNoteId, onNoteSelect }: NoteEditorProps) {
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
  const [showFontDropdown, setShowFontDropdown] = useState(false)
  const [showSizeDropdown, setShowSizeDropdown] = useState(false)
  const [showColorDropdown, setShowColorDropdown] = useState(false)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)
  const [showCollaborationManager, setShowCollaborationManager] = useState(false)
  const [currentFont, setCurrentFont] = useState('Sans Serif')
  const [currentSize, setCurrentSize] = useState('15')
  const editorRef = useRef<HTMLDivElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const noteTypeDropdownRef = useRef<HTMLDivElement>(null)
  const fontDropdownRef = useRef<HTMLDivElement>(null)
  const sizeDropdownRef = useRef<HTMLDivElement>(null)
  const colorDropdownRef = useRef<HTMLDivElement>(null)
  const moreDropdownRef = useRef<HTMLDivElement>(null)
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

  const fontOptions = [
    { value: 'Sans Serif', label: 'Sans Serif' },
    { value: 'Serif', label: 'Serif' },
    { value: 'Monospace', label: 'Monospace' },
    { value: 'Arial', label: 'Arial' },
    { value: 'Times New Roman', label: 'Times New Roman' },
    { value: 'Courier New', label: 'Courier New' }
  ]

  const sizeOptions = [
    { value: '12', label: '12' },
    { value: '14', label: '14' },
    { value: '15', label: '15' },
    { value: '16', label: '16' },
    { value: '18', label: '18' },
    { value: '20', label: '20' },
    { value: '24', label: '24' }
  ]

  const colorOptions = [
    { value: '#000000', label: 'Black' },
    { value: '#dc2626', label: 'Red' },
    { value: '#2563eb', label: 'Blue' },
    { value: '#16a34a', label: 'Green' },
    { value: '#d97706', label: 'Orange' },
    { value: '#9333ea', label: 'Purple' },
    { value: '#6b7280', label: 'Gray' }
  ]

  // Fetch all notes related to this asset
  const { data: notes, isLoading } = useQuery({
    queryKey: ['asset-notes', assetId],
    queryFn: async () => {
      console.log('🔍 Fetching notes for asset:', assetId)
      const { data, error } = await supabase
        .from('asset_notes')
        .select('*')
        .eq('asset_id', assetId)
        .order('updated_at', { ascending: false })
      
      if (error) {
        console.error('❌ Failed to fetch asset notes:', error)
        throw error
      }
      
      console.log('✅ Asset notes fetched:', data?.length || 0, 'notes')
      console.log('📋 Notes data:', data)
      
      // Filter out locally hidden notes from the UI
      const filteredNotes = (data || []).filter(note => !hiddenNoteIds.has(note.id))
      console.log('🔍 After filtering hidden notes:', filteredNotes.length, 'notes')
      return filteredNotes
    },
    staleTime: 0, // Always fetch fresh data
    refetchOnWindowFocus: true, // Refetch when window regains focus
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
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(target)) {
        setShowFontDropdown(false)
      }
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(target)) {
        setShowSizeDropdown(false)
      }
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(target)) {
        setShowColorDropdown(false)
      }
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(target)) {
        setShowMoreDropdown(false)
      }
    }

    if (showNoteTypeDropdown || showFontDropdown || showSizeDropdown || showColorDropdown || showMoreDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNoteTypeDropdown, showFontDropdown, showSizeDropdown, showColorDropdown, showMoreDropdown])

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
        .from('asset_notes')
        .update(updates)
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
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
        .from('asset_notes')
        .update({ note_type: noteType, updated_at: new Date().toISOString() })
        .eq('id', id)
      
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      setShowNoteTypeDropdown(false)
    }
  })

  // Create new note
  const createNoteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not authenticated')
      
      // Create the note directly in asset_notes
      const { data: noteData, error: noteError } = await supabase
        .from('asset_notes')
        .insert([{
          asset_id: assetId,
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
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      onNoteSelect(newNote.id)
    }
  })

  // Delete note
  const softDeleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!user) throw new Error('User not authenticated')
      
      // Mark the note as deleted in the database
      const { error } = await supabase
        .from('asset_notes')
        .update({ is_deleted: true })
        .eq('id', noteId)
        .eq('created_by', user.id) // Ensure user owns the note
      
      if (error) throw error
    },
    onSuccess: () => {
      // Refresh the notes list to reflect the hidden note
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      
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

  // Save when switching notes or component unmounts
  useEffect(() => {
    return () => {
      if (selectedNote && (editingContent !== selectedNote.content || editingTitle !== selectedNote.title)) {
        const updates: any = {}
        if (editingContent !== selectedNote.content) updates.content = editingContent
        if (editingTitle !== selectedNote.title) updates.title = editingTitle
        if (Object.keys(updates).length > 0) {
          supabase
            .from('asset_notes')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', selectedNote.id)
        }
      }
    }
  }, [selectedNote?.id])

  // Save when switching notes
  const saveCurrentNote = async () => {
    if (selectedNote) {
      const updates: any = {}
      if (editingContent !== selectedNote.content) updates.content = editingContent
      if (editingTitle !== selectedNote.title) updates.title = editingTitle
      if (Object.keys(updates).length > 0) {
        try {
          await supabase
            .from('asset_notes')
            .update({ ...updates, updated_at: new Date().toISOString() })
            .eq('id', selectedNote.id)
          queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
        } catch (error) {
          console.error('Failed to save note:', error)
        }
      }
    }
  }

  const handleContentChange = (content: string) => {
    setEditingContent(content)
  }

  const handleTitleChange = (title: string) => {
    setEditingTitle(title)
  }

  const handleTitleClick = (e: React.MouseEvent<HTMLHeadingElement>) => {
    // Capture event properties before the async callback
    const currentTarget = e.currentTarget
    const clientX = e.clientX
    
    setIsTitleEditing(true)
    // Focus the input after it's rendered
    setTimeout(() => {
      if (titleInputRef.current) {
        titleInputRef.current.focus()
        // Calculate cursor position based on click position
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
    // Save on blur if content changed
    if (selectedNote && editingTitle !== selectedNote.title) {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
    }
  }

  const handleNoteClick = async (noteId: string) => {
    // Save current note before switching if there are changes
    if (selectedNote && (editingContent !== selectedNote.content || editingTitle !== selectedNote.title)) {
      await saveCurrentNote()
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
      // Add the note ID to hidden notes set
      setHiddenNoteIds(prev => new Set([...prev, deleteConfirmDialog.noteId!]))
      // Trigger the mutation to update the UI
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

  const insertText = (before: string, after: string = '') => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    if (textarea) {
      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selectedText = editingContent.substring(start, end)
      const newText = editingContent.substring(0, start) + before + selectedText + after + editingContent.substring(end)
      setEditingContent(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + before.length, end + before.length)
      }, 0)
    }
  }

  const insertAtLineStart = (prefix: string) => {
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement
    if (textarea) {
      const start = textarea.selectionStart
      const lines = editingContent.split('\n')
      let currentPos = 0
      let lineIndex = 0
      
      for (let i = 0; i < lines.length; i++) {
        if (currentPos + lines[i].length >= start) {
          lineIndex = i
          break
        }
        currentPos += lines[i].length + 1
      }
      
      lines[lineIndex] = prefix + lines[lineIndex]
      const newText = lines.join('\n')
      setEditingContent(newText)
      setTimeout(() => {
        textarea.focus()
        textarea.setSelectionRange(start + prefix.length, start + prefix.length)
      }, 0)
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
            <h3 className="font-semibold text-gray-900">Notes for {assetSymbol}</h3>
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
              {console.log('🎨 Rendering notes list:', filteredNotes.length, 'notes')}
              {filteredNotes.map((note) => {
                return (
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
                )
              })}
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
                    
                    {/* Text Editor Toolbar */}
                    <div className="flex items-center space-x-1 ml-6 pl-6 border-l border-gray-300 bg-white rounded-lg shadow-sm border px-2 py-1">
                      {/* Insert Button */}
                      <div className="relative" ref={moreDropdownRef}>
                        <button 
                          onClick={() => setShowMoreDropdown(!showMoreDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <div className="w-4 h-4 bg-blue-500 rounded-full mr-2 flex items-center justify-center">
                            <Plus className="h-2.5 w-2.5 text-white" />
                          </div>
                          Insert
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        
                        {showMoreDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
                            <button
                              onClick={() => {
                                insertText('![Image](', ')')
                                setShowMoreDropdown(false)
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Image
                            </button>
                            <button
                              onClick={() => {
                                insertText('[Link](', ')')
                                setShowMoreDropdown(false)
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Link
                            </button>
                            <button
                              onClick={() => {
                                insertText('```\n', '\n```')
                                setShowMoreDropdown(false)
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Code Block
                            </button>
                            <button
                              onClick={() => {
                                insertText('| Column 1 | Column 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |')
                                setShowMoreDropdown(false)
                              }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Table
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* AI Button */}
                      <button className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors">
                        <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded mr-2 flex items-center justify-center">
                          <span className="text-white text-xs font-bold">AI</span>
                        </div>
                        AI
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Font Family */}
                      <div className="relative" ref={fontDropdownRef}>
                        <button 
                          onClick={() => setShowFontDropdown(!showFontDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors min-w-[80px]"
                        >
                          {currentFont}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        
                        {showFontDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
                            {fontOptions.map((font) => (
                              <button
                                key={font.value}
                                onClick={() => {
                                  setCurrentFont(font.value)
                                  setShowFontDropdown(false)
                                }}
                                className={clsx(
                                  'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors',
                                  currentFont === font.value && 'bg-gray-100'
                                )}
                                style={{ fontFamily: font.value }}
                              >
                                {font.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Font Size */}
                      <div className="relative" ref={sizeDropdownRef}>
                        <button 
                          onClick={() => setShowSizeDropdown(!showSizeDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors min-w-[50px]"
                        >
                          {currentSize}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        
                        {showSizeDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[60px]">
                            {sizeOptions.map((size) => (
                              <button
                                key={size.value}
                                onClick={() => {
                                  setCurrentSize(size.value)
                                  setShowSizeDropdown(false)
                                }}
                                className={clsx(
                                  'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors',
                                  currentSize === size.value && 'bg-gray-100'
                                )}
                              >
                                {size.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Text Color */}
                      <div className="relative" ref={colorDropdownRef}>
                        <button 
                          onClick={() => setShowColorDropdown(!showColorDropdown)}
                          className="flex items-center p-1.5 text-gray-700 hover:bg-gray-100 rounded transition-colors"
                          title="Text Color"
                        >
                          <div className="w-4 h-4 rounded border border-gray-300 bg-black"></div>
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        
                        {showColorDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50">
                            <div className="grid grid-cols-4 gap-1">
                              {colorOptions.map((color) => (
                                <button
                                  key={color.value}
                                  onClick={() => {
                                    setShowColorDropdown(false)
                                  }}
                                  className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                                  style={{ backgroundColor: color.value }}
                                  title={color.label}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Undo/Redo */}
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" 
                        title="Undo"
                        onClick={() => {
                          // Basic undo functionality - in a real app you'd implement proper undo/redo
                          document.execCommand('undo')
                        }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" 
                        title="Redo"
                        onClick={() => {
                          document.execCommand('redo')
                        }}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6-6m6 6l-6 6" />
                        </svg>
                      </button>

                      <div className="w-px h-4 bg-gray-300 mx-1" />

                      {/* Text Formatting */}
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors font-bold text-sm" 
                        onClick={() => insertText('**', '**')}
                        title="Bold"
                      >
                        B
                      </button>
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors italic text-sm" 
                        onClick={() => insertText('*', '*')}
                        title="Italic"
                      >
                        I
                      </button>

                      <div className="w-px h-4 bg-gray-300 mx-1" />

                      {/* Lists */}
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" 
                        onClick={() => insertAtLineStart('- ')}
                        title="Bullet List"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
                        </svg>
                      </button>
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" 
                        onClick={() => insertAtLineStart('1. ')}
                        title="Numbered List"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v6a2 2 0 002 2h6a2 2 0 002-2V7a2 2 0 00-2-2H9z" />
                        </svg>
                      </button>
                      <button 
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors" 
                        onClick={() => insertAtLineStart('> ')}
                        title="Quote"
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                        </svg>
                      </button>

                      <div className="w-px h-4 bg-gray-300 mx-1" />

                      {/* More Options */}
                      <button className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors">
                        More
                        <ChevronDown className="ml-1 h-3 w-3" />
                      </button>
                    </div>
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
                ref={editorRef as unknown as React.RefObject<HTMLTextAreaElement>}
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
        noteType="asset"
        noteTitle={selectedNote?.title || ''}
        isOpen={showCollaborationManager}
        onClose={() => setShowCollaborationManager(false)}
      />
    </div>
  )
}