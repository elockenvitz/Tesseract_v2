import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  Plus, Search, Calendar, Share2, MoreHorizontal, Trash2, Copy, ChevronDown, Users,
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, CheckSquare, Quote,
  Highlighter, Type as TypeIcon, Minus, Eraser, Code as CodeIcon, Link as LinkIcon
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CollaborationManager } from '../ui/CollaborationManager'
import { formatDistanceToNow, format } from 'date-fns'
import { clsx } from 'clsx'

export type EntityType = 'asset' | 'portfolio' | 'theme'

export interface UniversalNoteEditorProps {
  // Entity configuration
  entityType: EntityType
  entityId: string
  entityName: string

  // Note selection
  selectedNoteId?: string
  onNoteSelect: (noteId: string) => void

  // Optional callbacks
  onClose?: () => void

  // Feature flags
  features?: {
    advancedAI?: boolean
    richTextFormatting?: boolean
    colorPicker?: boolean
    highlightOptions?: boolean
  }
}

interface EntityConfig {
  tableName: string
  foreignKey: string
  queryKey: string
  noteType: string
  defaultFeatures: {
    advancedAI: boolean
    richTextFormatting: boolean
    colorPicker: boolean
    highlightOptions: boolean
  }
}

// Configuration for different entity types
const ENTITY_CONFIGS: Record<EntityType, EntityConfig> = {
  asset: {
    tableName: 'asset_notes',
    foreignKey: 'asset_id',
    queryKey: 'asset-notes',
    noteType: 'asset',
    defaultFeatures: {
      advancedAI: true,
      richTextFormatting: true,
      colorPicker: true,
      highlightOptions: true
    }
  },
  portfolio: {
    tableName: 'portfolio_notes',
    foreignKey: 'portfolio_id',
    queryKey: 'portfolio-notes',
    noteType: 'portfolio',
    defaultFeatures: {
      advancedAI: false,
      richTextFormatting: true,
      colorPicker: false,
      highlightOptions: false
    }
  },
  theme: {
    tableName: 'theme_notes',
    foreignKey: 'theme_id',
    queryKey: 'theme-notes',
    noteType: 'theme',
    defaultFeatures: {
      advancedAI: false,
      richTextFormatting: true,
      colorPicker: false,
      highlightOptions: false
    }
  }
}

export function UniversalNoteEditor({
  entityType,
  entityId,
  entityName,
  selectedNoteId,
  onNoteSelect,
  onClose,
  features: customFeatures
}: UniversalNoteEditorProps) {
  console.log('🎨 UniversalNoteEditor mounted/updated:', { entityType, entityId, selectedNoteId })

  const config = ENTITY_CONFIGS[entityType]
  const features = { ...config.defaultFeatures, ...customFeatures }

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
  const [showAIDropdown, setShowAIDropdown] = useState(false)
  const [showHeadingDropdown, setShowHeadingDropdown] = useState(false)
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
  const aiDropdownRef = useRef<HTMLDivElement>(null)
  const headingDropdownRef = useRef<HTMLDivElement>(null)
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

  // AI model options - could be configured per entity type
  const aiModelOptions = [
    { id: 'gpt-4o', label: 'GPT-4o' },
    { id: 'claude-3-5-sonnet', label: 'Claude 3.5 Sonnet' },
    { id: 'local-llm', label: 'Local LLM' }
  ]

  // ---------- Queries ----------
  const { data: notes, isLoading } = useQuery({
    queryKey: [config.queryKey, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.tableName)
        .select('*')
        .eq(config.foreignKey, entityId)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return (data || []).filter(n => !hiddenNoteIds.has(n.id))
    },
    staleTime: 0,
    refetchOnWindowFocus: true
  })

  // Lookup user display names (created_by / updated_by)
  const { data: usersById } = useQuery({
    queryKey: ['users-by-id', (notes ?? []).map(n => n.created_by), (notes ?? []).map(n => n.updated_by)],
    enabled: !!notes && notes.length > 0,
    queryFn: async () => {
      const ids = Array.from(
        new Set(
          (notes ?? [])
            .flatMap(n => [n.created_by, n.updated_by])
            .filter(Boolean) as string[]
        )
      )
      if (ids.length === 0) return {} as Record<string, any>

      const { data, error } = await supabase
        .from('users')
        .select('id, first_name, last_name, email')
        .in('id', ids)

      if (error) throw error

      const map: Record<string, any> = {}
      for (const u of data || []) map[u.id] = u
      return map
    }
  })

  const nameFor = (id?: string | null) => {
    if (!id) return 'Unknown'
    const u = usersById?.[id]
    if (!u) return 'Unknown'
    if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
    return u.email?.split('@')[0] || 'Unknown'
  }

  // Format "Last updated": remove "about"; switch to absolute after 24h
  const formatUpdatedAt = (value?: string | null) => {
    if (!value) return ''
    const d = new Date(value)
    if (isNaN(d.getTime())) return ''
    const ONE_DAY = 24 * 60 * 60 * 1000
    const diff = Date.now() - d.getTime()
    if (diff >= ONE_DAY) return format(d, 'MMM d, yyyy h:mm a')
    return formatDistanceToNow(d, { addSuffix: true }).replace(/^about\s+/i, '')
  }

  // Selected note
  const selectedNote = notes?.find(n => n.id === selectedNoteId)

  // ---------- Dropdown outside-click handling ----------
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (noteTypeDropdownRef.current && !noteTypeDropdownRef.current.contains(target)) setShowNoteTypeDropdown(false)
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(target)) setShowFontDropdown(false)
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(target)) setShowSizeDropdown(false)
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(target)) setShowColorDropdown(false)
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(target)) setShowMoreDropdown(false)
      if (aiDropdownRef.current && !aiDropdownRef.current.contains(target)) setShowAIDropdown(false)
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(target)) setShowHeadingDropdown(false)
    }
    if (
      showNoteTypeDropdown || showFontDropdown || showSizeDropdown || showColorDropdown ||
      showMoreDropdown || showAIDropdown || showHeadingDropdown
    ) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [
    showNoteTypeDropdown, showFontDropdown, showSizeDropdown, showColorDropdown,
    showMoreDropdown, showAIDropdown, showHeadingDropdown
  ])

  // Update editing content when selected note changes
  useEffect(() => {
    if (selectedNote) {
      setEditingContent(selectedNote.content || '')
      setEditingTitle(selectedNote.title || '')
    } else if (selectedNoteId) {
      // Clear editing state when a note is selected but not yet loaded
      setEditingContent('')
      setEditingTitle('')
    }
  }, [selectedNote, selectedNoteId])

  // Track if we've already auto-created a note
  const [hasAutoCreated, setHasAutoCreated] = useState(false)

  // Auto-create a note when editor is opened without a selected note
  useEffect(() => {
    console.log('🔍 Auto-create check:', {
      selectedNoteId,
      notesLength: notes?.length,
      isLoading,
      isPending: createNoteMutation.isPending,
      hasAutoCreated,
      hasUser: !!user
    })

    if (!selectedNoteId && notes?.length === 0 && !createNoteMutation.isPending && !isLoading && !hasAutoCreated && user) {
      console.log('✅ Auto-creating note...')
      setHasAutoCreated(true)
      createNoteMutation.mutate()
    }
  }, [selectedNoteId, notes?.length, isLoading, hasAutoCreated, user])

  // Reset auto-created flag when a note is selected
  useEffect(() => {
    if (selectedNoteId) {
      setHasAutoCreated(false)
    }
  }, [selectedNoteId])

  // ---------- Mutations ----------
  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title?: string; content?: string }) => {
      setIsSaving(true)
      const updates: any = { updated_at: new Date().toISOString(), updated_by: user?.id }
      if (title !== undefined) updates.title = title
      if (content !== undefined) updates.content = content
      const { error } = await supabase.from(config.tableName).update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
      queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
      setIsSaving(false)
    },
    onError: () => setIsSaving(false)
  })

  const updateNoteTypeMutation = useMutation({
    mutationFn: async ({ id, noteType }: { id: string; noteType: string }) => {
      const { error } = await supabase
        .from(config.tableName)
        .update({ note_type: noteType, updated_at: new Date().toISOString(), updated_by: user?.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
      setShowNoteTypeDropdown(false)
    }
  })

  const createNoteMutation = useMutation({
    mutationFn: async () => {
      console.log('💾 createNoteMutation: Starting note creation...')
      if (!user) throw new Error('User not authenticated')
      const noteData = {
        [config.foreignKey]: entityId,
        title: 'Untitled',
        content: '',
        note_type: 'research',
        created_by: user.id,
        updated_by: user.id
      }
      console.log('💾 createNoteMutation: Inserting note data:', noteData)
      const { data, error } = await supabase
        .from(config.tableName)
        .insert([noteData])
        .select()
        .single()
      if (error) {
        console.error('❌ createNoteMutation: Error inserting note:', error)
        throw error
      }
      console.log('✅ createNoteMutation: Note created successfully:', data)
      return data
    },
    onSuccess: (newNote) => {
      console.log('🎉 createNoteMutation onSuccess: Note created, calling onNoteSelect with:', newNote.id)
      queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
      queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
      onNoteSelect(newNote.id)
      // Immediately set editing state for the new note to avoid delay
      setEditingContent(newNote.content || '')
      setEditingTitle(newNote.title || 'Untitled')
      setIsTitleEditing(false)
    },
    onError: (error) => {
      console.error('❌ createNoteMutation onError:', error)
    }
  })

  const softDeleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!user) throw new Error('User not authenticated')
      console.log('🗑️ Deleting note:', noteId)
      const { error } = await supabase
        .from(config.tableName)
        .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('created_by', user.id)
      if (error) {
        console.error('❌ Error deleting note:', error)
        throw error
      }
      console.log('✅ Note marked as deleted')
    },
    onSuccess: () => {
      console.log('🗑️ Delete success, invalidating queries')
      // Invalidate all note-related queries
      queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
      queryClient.invalidateQueries({ queryKey: ['recent-notes'] })
      // Also remove from cache immediately to ensure UI updates
      queryClient.removeQueries({ queryKey: ['recent-notes'] })
      const hiddenNoteId = deleteConfirmDialog.noteId

      // Add to hidden notes set immediately
      if (hiddenNoteId) {
        setHiddenNoteIds(prev => new Set([...prev, hiddenNoteId]))
      }

      // If we're currently viewing the deleted note, switch to another note or close
      if (selectedNoteId === hiddenNoteId) {
        const remainingNotes = notes?.filter(n => n.id !== selectedNoteId && !hiddenNoteIds.has(n.id)) || []
        if (remainingNotes.length > 0) {
          console.log('🗑️ Switching to remaining note:', remainingNotes[0].id)
          onNoteSelect(remainingNotes[0].id)
        } else {
          console.log('🗑️ No remaining notes, closing editor')
          // Close the editor completely by calling onClose if available
          if (onClose) {
            onClose()
          } else {
            onNoteSelect('')
          }
        }
      }
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
      setShowNoteMenu(null)
    },
    onError: (err) => {
      console.error('❌ Failed to delete note:', err)
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
    }
  })

  // ---------- Markdown helpers ----------
  const getTextarea = () => document.querySelector('textarea') as HTMLTextAreaElement | null

  const wrapSelection = (before: string, after = before) => {
    const textarea = getTextarea()
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = editingContent.substring(start, end)
    const newText = editingContent.substring(0, start) + before + selected + after + editingContent.substring(end)
    setEditingContent(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + before.length, end + before.length)
    }, 0)
  }

  const toggleLinePrefix = (prefix: string) => {
    const textarea = getTextarea()
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const before = editingContent.substring(0, start)
    const selection = editingContent.substring(start, end)
    const after = editingContent.substring(end)
    const lines = selection.split('\n').map(line => {
      if (line.startsWith(prefix)) return line.replace(new RegExp(`^${prefix}`), '')
      return prefix + line
    })
    const replaced = before + lines.join('\n') + after
    setEditingContent(replaced)
    setTimeout(() => textarea.focus(), 0)
  }

  const insertText = (before: string, after: string = '') => wrapSelection(before, after)
  const insertAtLineStart = (prefix: string) => toggleLinePrefix(prefix)

  const makeHeading = (level: 1 | 2 | 3 | 4 | 5 | 6) => {
    const hashes = '#'.repeat(level) + ' '
    toggleLinePrefix(hashes)
  }

  const insertHorizontalRule = () => {
    const textarea = getTextarea()
    if (!textarea) return
    const start = textarea.selectionStart
    const newText = editingContent.slice(0, start) + '\n\n---\n\n' + editingContent.slice(start)
    setEditingContent(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start + 6, start + 6)
    }, 0)
  }

  const clearFormatting = () => {
    const textarea = getTextarea()
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selected = editingContent.substring(start, end)
    // very simple pass to strip common markdown wrappers
    const stripped = selected
      .replace(/\*\*(.*?)\*\*/g, '$1')
      .replace(/\*(.*?)\*/g, '$1')
      .replace(/__(.*?)__/g, '$1')
      .replace(/~~(.*?)~~/g, '$1')
      .replace(/`(.*?)`/g, '$1')
      .replace(/==(.*?)==/g, '$1')
      .replace(/<u>(.*?)<\/u>/g, '$1')
      .replace(/^> /gm, '')
      .replace(/^[-*] \[ \] /gm, '')
      .replace(/^[-*] /gm, '')
      .replace(/^\d+\. /gm, '')
    const newText = editingContent.substring(0, start) + stripped + editingContent.substring(end)
    setEditingContent(newText)
    setTimeout(() => {
      textarea.focus()
      textarea.setSelectionRange(start, start + stripped.length)
    }, 0)
  }

  // ---------- Autosave ----------
  useEffect(() => {
    if (!selectedNote || editingContent === selectedNote.content || !editingContent.trim()) return
    const timeoutId = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, content: editingContent })
    }, 1000)
    return () => clearTimeout(timeoutId)
  }, [editingContent, selectedNote?.id])

  useEffect(() => {
    if (!selectedNote || editingTitle === selectedNote.title || !editingTitle.trim()) return
    const timeoutId = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
      setIsTitleEditing(false)
    }, 1000)
    return () => clearTimeout(timeoutId)
  }, [editingTitle, selectedNote?.id])

  const saveCurrentNote = async () => {
    if (!selectedNote) return
    const updates: any = {}
    if (editingContent !== selectedNote.content) updates.content = editingContent
    if (editingTitle !== selectedNote.title) updates.title = editingTitle
    if (Object.keys(updates).length > 0) {
      try {
        await supabase
          .from(config.tableName)
          .update({ ...updates, updated_at: new Date().toISOString(), updated_by: user?.id })
          .eq('id', selectedNote.id)
        queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
      } catch (e) {
        console.error('Failed to save note:', e)
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
            <h3 className="font-semibold text-gray-900">Notes for {entityName}</h3>
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

                      {/* Meta row with names */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                        <div className="flex items-center">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatUpdatedAt(note.updated_at)}
                        </div>
                        {note.updated_by && <span>• Edited by {nameFor(note.updated_by)}</span>}
                        {note.created_by && <span>• Created by {nameFor(note.created_by)}</span>}
                        {note.is_shared && (
                          <div className="flex items-center">
                            <span>•</span>
                            <Share2 className="h-3 w-3 mx-1" />
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

                    {/* Toolbar */}
                    <div className="flex items-center space-x-1 ml-6 pl-6 border-l border-gray-300 bg-white rounded-lg shadow-sm border px-2 py-1">

                      {/* Inline styles */}
                      <button title="Bold" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('**', '**')}>
                        <Bold className="h-3.5 w-3.5" />
                      </button>
                      <button title="Italic" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('*', '*')}>
                        <Italic className="h-3.5 w-3.5" />
                      </button>
                      <button title="Underline" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('<u>', '</u>')}>
                        <Underline className="h-3.5 w-3.5" />
                      </button>
                      <button title="Strikethrough" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('~~', '~~')}>
                        <Strikethrough className="h-3.5 w-3.5" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Headings */}
                      {features.richTextFormatting && (
                        <div className="relative" ref={headingDropdownRef}>
                          <button
                            onClick={() => setShowHeadingDropdown(!showHeadingDropdown)}
                            className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                            title="Headings"
                          >
                            <TypeIcon className="h-3.5 w-3.5 mr-1" />
                            Headings
                            <ChevronDown className="ml-1 h-3 w-3" />
                          </button>
                          {showHeadingDropdown && (
                            <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[120px]">
                              {[1,2,3,4,5,6].map((lvl) => (
                                <button
                                  key={lvl}
                                  onClick={() => { makeHeading(lvl as 1|2|3|4|5|6); setShowHeadingDropdown(false) }}
                                  className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                                >
                                  H{lvl}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Lists & Quote */}
                      <button title="Bulleted list" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => insertAtLineStart('- ')}>
                        <List className="h-3.5 w-3.5" />
                      </button>
                      <button title="Numbered list" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => insertAtLineStart('1. ')}>
                        <ListOrdered className="h-3.5 w-3.5" />
                      </button>
                      <button title="Checklist" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => insertAtLineStart('- [ ] ')}>
                        <CheckSquare className="h-3.5 w-3.5" />
                      </button>
                      <button title="Quote" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => insertAtLineStart('> ')}>
                        <Quote className="h-3.5 w-3.5" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Highlight & Code & HR & Clear */}
                      <button title="Highlight" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('==', '==')}>
                        <Highlighter className="h-3.5 w-3.5" />
                      </button>
                      <button title="Inline code" className="p-1.5 hover:bg-gray-100 rounded" onClick={() => wrapSelection('`', '`')}>
                        <CodeIcon className="h-3.5 w-3.5" />
                      </button>
                      <button title="Horizontal rule" className="p-1.5 hover:bg-gray-100 rounded" onClick={insertHorizontalRule}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <button title="Clear formatting" className="p-1.5 hover:bg-gray-100 rounded" onClick={clearFormatting}>
                        <Eraser className="h-3.5 w-3.5" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Insert menu */}
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
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]">
                            <button
                              onClick={() => { insertText('![Image](', ')'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Image
                            </button>
                            <button
                              onClick={() => { insertText('[Link](', ')'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              <span className="inline-flex items-center"><LinkIcon className="h-3 w-3 mr-2" />Link</span>
                            </button>
                            <button
                              onClick={() => { insertText('```\n', '\n```'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Code Block
                            </button>
                            <button
                              onClick={() => { insertText('| Column 1 | Column 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors"
                            >
                              Table
                            </button>
                          </div>
                        )}
                      </div>

                      {/* AI menu (if advanced AI is enabled) */}
                      {features.advancedAI && (
                        <>
                          <div className="w-px h-4 bg-gray-300" />
                          <div className="relative" ref={aiDropdownRef}>
                            <button
                              onClick={() => setShowAIDropdown(!showAIDropdown)}
                              className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded transition-colors"
                              title="AI"
                            >
                              <div className="w-4 h-4 bg-gradient-to-r from-blue-500 to-purple-500 rounded mr-2 flex items-center justify-center">
                                <span className="text-white text-[10px] font-bold">AI</span>
                              </div>
                              AI
                              <ChevronDown className="ml-1 h-3 w-3" />
                            </button>
                            {showAIDropdown && (
                              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[180px]">
                                {aiModelOptions.map(m => (
                                  <button
                                    key={m.id}
                                    onClick={() => {
                                      insertText(`\n<!-- ai:model:${m.id} -->\n`, '\n<!-- /ai -->\n')
                                      setShowAIDropdown(false)
                                    }}
                                    className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                                  >
                                    Use {m.label}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Font */}
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
                            {fontOptions.map(font => (
                              <button
                                key={font.value}
                                onClick={() => { setCurrentFont(font.value); setShowFontDropdown(false) }}
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

                      {/* Size */}
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
                            {sizeOptions.map(size => (
                              <button
                                key={size.value}
                                onClick={() => { setCurrentSize(size.value); setShowSizeDropdown(false) }}
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

                      {/* Color palette (if color picker is enabled) */}
                      {features.colorPicker && (
                        <>
                          <div className="w-px h-4 bg-gray-300" />
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
                              <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                                <div className="grid grid-cols-4 gap-1 p-1">
                                  {colorOptions.map(color => (
                                    <button
                                      key={color.value}
                                      onClick={() => { setShowColorDropdown(false) }}
                                      className="w-6 h-6 rounded border border-gray-300 hover:scale-110 transition-transform"
                                      style={{ backgroundColor: color.value }}
                                      title={color.label}
                                    />
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </>
                      )}

                      <div className="w-px h-4 bg-gray-300 mx-1" />

                      {/* Undo / Redo */}
                      <button
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                        title="Undo"
                        onClick={() => document.execCommand('undo')}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                      <button
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
                        title="Redo"
                        onClick={() => document.execCommand('redo')}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10H11a8 8 0 00-8 8v2m18-10l-6-6m6 6l-6 6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Close button if onClose is provided */}
                {onClose && (
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    Close
                  </Button>
                )}
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
        noteType={config.noteType}
        noteTitle={selectedNote?.title || ''}
        isOpen={showCollaborationManager}
        onClose={() => setShowCollaborationManager(false)}
        noteOwnerId={selectedNote?.created_by || ''}
      />
    </div>
  )
}