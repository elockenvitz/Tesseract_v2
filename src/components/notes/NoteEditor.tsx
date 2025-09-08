import React, { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  Plus, Search, Calendar, Share2, MoreHorizontal, Trash2, Copy, ChevronDown, Users,
  Bold, Italic, Underline, Strikethrough, Code, Quote, List, ListOrdered, ListTodo,
  Heading1, Heading2, Heading3, Link as LinkIcon, Image as ImageIcon, Minus,
  Highlighter, Palette, Eraser, Wand2, Bot
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CollaborationManager } from '../ui/CollaborationManager'
import { formatDistanceToNow, format } from 'date-fns'
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

  // Toolbar state
  const [showNoteTypeDropdown, setShowNoteTypeDropdown] = useState(false)
  const [showFontDropdown, setShowFontDropdown] = useState(false)
  const [showSizeDropdown, setShowSizeDropdown] = useState(false)
  const [showColorDropdown, setShowColorDropdown] = useState(false)
  const [showHighlightDropdown, setShowHighlightDropdown] = useState(false)
  const [showMoreDropdown, setShowMoreDropdown] = useState(false)
  const [showHeadingDropdown, setShowHeadingDropdown] = useState(false)
  const [showAIDropdown, setShowAIDropdown] = useState(false)

  const [currentFont, setCurrentFont] = useState('Sans Serif')
  const [currentSize, setCurrentSize] = useState('15')
  const [showCollaborationManager, setShowCollaborationManager] = useState(false)

  const editorRef = useRef<HTMLTextAreaElement>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)

  const noteTypeDropdownRef = useRef<HTMLDivElement>(null)
  const fontDropdownRef = useRef<HTMLDivElement>(null)
  const sizeDropdownRef = useRef<HTMLDivElement>(null)
  const colorDropdownRef = useRef<HTMLDivElement>(null)
  const highlightDropdownRef = useRef<HTMLDivElement>(null)
  const moreDropdownRef = useRef<HTMLDivElement>(null)
  const headingDropdownRef = useRef<HTMLDivElement>(null)
  const aiDropdownRef = useRef<HTMLDivElement>(null)

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

  const highlightOptions = [
    { value: '#fff59e', label: 'Yellow' },
    { value: '#a7f3d0', label: 'Mint' },
    { value: '#bfdbfe', label: 'Light Blue' },
    { value: '#fecaca', label: 'Pink' },
    { value: '#fde68a', label: 'Amber' },
  ]

  // Fetch all notes related to this asset
  const { data: notes, isLoading } = useQuery({
    queryKey: ['asset-notes', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('asset_notes')
        .select('*')
        .eq('asset_id', assetId)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })

      if (error) throw error
      const filteredNotes = (data || []).filter(note => !hiddenNoteIds.has(note.id))
      return filteredNotes
    },
    staleTime: 0,
    refetchOnWindowFocus: true,
  })

  // Try to load user's integrated AI models (soft-fail to a default list)
  const { data: integratedModels } = useQuery({
    queryKey: ['ai-integrations', user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      try {
        const { data, error } = await supabase
          .from('ai_integrations') // adjust to your actual table name
          .select('id, provider, model_name, display_name')
          .eq('user_id', user!.id)

        if (error) throw error
        return (data || []).map((m: any) => ({
          id: m.id,
          label: m.display_name || `${m.provider}/${m.model_name}`,
          provider: m.provider,
          model: m.model_name,
        }))
      } catch {
        return [
          { id: 'gpt-4o', label: 'OpenAI GPT-4o', provider: 'openai', model: 'gpt-4o' },
          { id: 'claude-3-5-sonnet', label: 'Anthropic Claude 3.5 Sonnet', provider: 'anthropic', model: 'claude-3-5-sonnet' },
        ]
      }
    }
  })

  // Lookup user display names for created_by / updated_by
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

  // format "last updated" (remove "about"; switch to absolute after 24h)
  const formatUpdatedAt = (value?: string | null) => {
    if (!value) return ''
    const d = new Date(value)
    if (isNaN(d.getTime())) return ''
    const ONE_DAY = 24 * 60 * 60 * 1000
    const diff = Date.now() - d.getTime()
    if (diff >= ONE_DAY) return format(d, 'MMM d, yyyy h:mm a')
    return formatDistanceToNow(d, { addSuffix: true }).replace(/^about\s+/i, '')
  }

  const selectedNote = notes?.find(note => note.id === selectedNoteId)

  // ---------- Toolbar helpers ----------
  const getTA = () => editorRef.current as HTMLTextAreaElement | null

  const wrapSelection = (before: string, after = '') => {
    const ta = getTA()
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    const selected = editingContent.slice(start, end)
    const next = editingContent.slice(0, start) + before + selected + after + editingContent.slice(end)
    setEditingContent(next)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + before.length, end + before.length)
    }, 0)
  }

  const surroundWithTag = (tag: string, attrs?: Record<string, string>) => {
    const open =
      attrs && Object.keys(attrs).length
        ? `<${tag} ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}>`
        : `<${tag}>`
    const close = `</${tag}>`
    wrapSelection(open, close)
  }

  const prefixSelectedLines = (prefixer: (idx: number) => string) => {
    const ta = getTA()
    if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    const text = editingContent
    const pre = text.slice(0, start)
    const sel = text.slice(start, end)
    const post = text.slice(end)

    const selStartIdx = pre.lastIndexOf('\n') + 1
    const selEndIdx = end + post.indexOf('\n')
    const block = text.slice(selStartIdx, selEndIdx === end - 1 ? end : (selEndIdx >= end ? selEndIdx : end))
    const lines = block.split('\n')

    const newBlock = lines.map((l, i) => `${prefixer(i)}${l.replace(/^\s*(- |\d+\. |\[ \] |- \[ \] )?/, '')}`).join('\n')
    const next = text.slice(0, selStartIdx) + newBlock + text.slice(selStartIdx + block.length)
    setEditingContent(next)

    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(selStartIdx, selStartIdx + newBlock.length)
    }, 0)
  }

  const insertHR = () => {
    const ta = getTA(); if (!ta) return
    const { selectionStart: start } = ta
    const next = editingContent.slice(0, start) + '\n\n---\n\n' + editingContent.slice(start)
    setEditingContent(next)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + 6, start + 6)
    }, 0)
  }

  const clearFormattingSelection = () => {
    const ta = getTA(); if (!ta) return
    const { selectionStart: start, selectionEnd: end } = ta
    const selected = editingContent.slice(start, end)
    const cleaned = selected.replace(/<\/?[^>]+>/g, '')
    const next = editingContent.slice(0, start) + cleaned + editingContent.slice(end)
    setEditingContent(next)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start, start + cleaned.length)
    }, 0)
  }

  const insertAIBlock = (provider: string, model: string) => {
    const block = `\n> 🤖 AI (${provider}/${model}) — describe your request here\n`
    const ta = getTA(); if (!ta) return
    const { selectionStart: start } = ta
    const next = editingContent.slice(0, start) + block + editingContent.slice(start)
    setEditingContent(next)
    setTimeout(() => {
      ta.focus()
      ta.setSelectionRange(start + block.length, start + block.length)
    }, 0)
  }

  // ---------- Close dropdowns on outside click ----------
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const t = event.target as Node
      if (noteTypeDropdownRef.current && !noteTypeDropdownRef.current.contains(t)) setShowNoteTypeDropdown(false)
      if (fontDropdownRef.current && !fontDropdownRef.current.contains(t)) setShowFontDropdown(false)
      if (sizeDropdownRef.current && !sizeDropdownRef.current.contains(t)) setShowSizeDropdown(false)
      if (colorDropdownRef.current && !colorDropdownRef.current.contains(t)) setShowColorDropdown(false)
      if (highlightDropdownRef.current && !highlightDropdownRef.current.contains(t)) setShowHighlightDropdown(false)
      if (moreDropdownRef.current && !moreDropdownRef.current.contains(t)) setShowMoreDropdown(false)
      if (headingDropdownRef.current && !headingDropdownRef.current.contains(t)) setShowHeadingDropdown(false)
      if (aiDropdownRef.current && !aiDropdownRef.current.contains(t)) setShowAIDropdown(false)
    }
    if (showNoteTypeDropdown || showFontDropdown || showSizeDropdown || showColorDropdown || showMoreDropdown || showHeadingDropdown || showAIDropdown || showHighlightDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNoteTypeDropdown, showFontDropdown, showSizeDropdown, showColorDropdown, showMoreDropdown, showHeadingDropdown, showAIDropdown, showHighlightDropdown])

  // Update editing content when selected note changes
  useEffect(() => {
    if (selectedNote) {
      setEditingContent(selectedNote.content || '')
      setEditingTitle(selectedNote.title || '')
    }
  }, [selectedNote])

  // ---------- Mutations / autosave ----------
  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title?: string; content?: string }) => {
      setIsSaving(true)
      const updates: any = { updated_at: new Date().toISOString(), updated_by: user?.id }
      if (title !== undefined) updates.title = title
      if (content !== undefined) updates.content = content
      const { error } = await supabase.from('asset_notes').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      setIsSaving(false)
    },
    onError: () => setIsSaving(false)
  })

  const updateNoteTypeMutation = useMutation({
    mutationFn: async ({ id, noteType }: { id: string; noteType: string }) => {
      const { error } = await supabase
        .from('asset_notes')
        .update({ note_type: noteType, updated_at: new Date().toISOString(), updated_by: user?.id })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      setShowNoteTypeDropdown(false)
    }
  })

  const createNoteMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error('User not authenticated')
      const { data: noteData, error: noteError } = await supabase
        .from('asset_notes')
        .insert([{
          asset_id: assetId,
          title: 'Untitled',
          content: '',
          note_type: 'research',
          created_by: user.id,
          updated_by: user.id
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

  const softDeleteNoteMutation = useMutation({
    mutationFn: async (noteId: string) => {
      if (!user) throw new Error('User not authenticated')
      const { error } = await supabase
        .from('asset_notes')
        .update({ is_deleted: true, updated_by: user.id, updated_at: new Date().toISOString() })
        .eq('id', noteId)
        .eq('created_by', user.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      const hiddenNoteId = deleteConfirmDialog.noteId
      if (selectedNoteId === hiddenNoteId) {
        const remainingNotes = notes?.filter(n => n.id !== selectedNoteId && !hiddenNoteIds.has(n.id)) || []
        onNoteSelect(remainingNotes[0]?.id || '')
      }
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
      setShowNoteMenu(null)
    },
    onError: (error) => {
      console.error('Failed to hide note:', error)
      setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
    }
  })

  useEffect(() => {
    if (!selectedNote || editingContent === selectedNote.content || !editingContent.trim()) return
    const t = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, content: editingContent })
    }, 1000)
    return () => clearTimeout(t)
  }, [editingContent, selectedNote?.id])

  useEffect(() => {
    if (!selectedNote || editingTitle === selectedNote.title || !editingTitle.trim()) return
    const t = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
      setIsTitleEditing(false)
    }, 1000)
    return () => clearTimeout(t)
  }, [editingTitle, selectedNote?.id])

  useEffect(() => {
    return () => {
      if (selectedNote && (editingContent !== selectedNote.content || editingTitle !== selectedNote.title)) {
        const updates: any = {}
        if (editingContent !== selectedNote.content) updates.content = editingContent
        if (editingTitle !== selectedNote.title) updates.title = editingTitle
        if (Object.keys(updates).length > 0) {
          supabase.from('asset_notes').update({ ...updates, updated_at: new Date().toISOString(), updated_by: user?.id }).eq('id', selectedNote.id)
        }
      }
    }
  }, [selectedNote?.id])

  const saveCurrentNote = async () => {
    if (!selectedNote) return
    const updates: any = {}
    if (editingContent !== selectedNote.content) updates.content = editingContent
    if (editingTitle !== selectedNote.title) updates.title = editingTitle
    if (Object.keys(updates).length > 0) {
      try {
        await supabase.from('asset_notes').update({ ...updates, updated_at: new Date().toISOString(), updated_by: user?.id }).eq('id', selectedNote.id)
        queryClient.invalidateQueries({ queryKey: ['asset-notes', assetId] })
      } catch (e) {
        console.error('Failed to save note:', e)
      }
    }
  }

  // Title handlers
  const handleContentChange = (content: string) => setEditingContent(content)
  const handleTitleChange = (title: string) => setEditingTitle(title)
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
      if (editingTitle !== selectedNote?.title) saveNoteMutation.mutate({ id: selectedNote!.id, title: editingTitle })
    } else if (e.key === 'Escape') {
      setEditingTitle(selectedNote?.title || '')
      setIsTitleEditing(false)
    }
  }
  const handleTitleBlur = () => {
    setIsTitleEditing(false)
    if (selectedNote && editingTitle !== selectedNote.title) saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
  }

  // Note list handlers
  const handleNoteClick = async (noteId: string) => {
    if (selectedNote && (editingContent !== selectedNote.content || editingTitle !== selectedNote.title)) await saveCurrentNote()
    onNoteSelect(noteId)
    setIsTitleEditing(false)
  }
  const handleCreateNote = () => createNoteMutation.mutate()
  const handleDeleteNote = (noteId: string, noteTitle: string) => setDeleteConfirmDialog({ isOpen: true, noteId, noteTitle })
  const handleConfirmDelete = () => {
    if (deleteConfirmDialog.noteId) {
      setHiddenNoteIds(prev => new Set([...prev, deleteConfirmDialog.noteId!]))
      softDeleteNoteMutation.mutate(deleteConfirmDialog.noteId)
    }
  }
  const handleCancelDelete = () => setDeleteConfirmDialog({ isOpen: false, noteId: null, noteTitle: '' })
  const handleNoteTypeChange = (noteType: string) => { if (selectedNote) updateNoteTypeMutation.mutate({ id: selectedNote.id, noteType }) }

  // Existing helpers kept for compatibility
  const insertText = (before: string, after: string = '') => wrapSelection(before, after)
  const insertAtLineStart = (prefix: string) => prefixSelectedLines(() => prefix)

  const filteredNotes = notes?.filter(note =>
    (note.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (note.content || '').toLowerCase().includes(searchQuery.toLowerCase())
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
                        {(note.content || '').replace(/^#.*\n/, '').substring(0, 80)}...
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
                        <div className="absolute right-0 top-6 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 min-w-[140px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              navigator.clipboard.writeText(note.content || '')
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
                      <button onClick={() => setShowNoteTypeDropdown(!showNoteTypeDropdown)}>
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

                    {/* TEXT EDITOR TOOLBAR */}
                    <div className="flex items-center space-x-1 ml-6 pl-6 border-l border-gray-300 bg-white rounded-lg shadow-sm border px-2 py-1">

                      {/* Headings */}
                      <div className="relative" ref={headingDropdownRef}>
                        <button
                          onClick={() => setShowHeadingDropdown(!showHeadingDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                          title="Headings"
                        >
                          <Heading2 className="h-4 w-4 mr-1" /> Heading
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showHeadingDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
                            <button className="px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center"
                              onClick={() => { insertAtLineStart('# '); setShowHeadingDropdown(false) }}>
                              <Heading1 className="h-3 w-3 mr-2" /> H1
                            </button>
                            <button className="px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center"
                              onClick={() => { insertAtLineStart('## '); setShowHeadingDropdown(false) }}>
                              <Heading2 className="h-3 w-3 mr-2" /> H2
                            </button>
                            <button className="px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center"
                              onClick={() => { insertAtLineStart('### '); setShowHeadingDropdown(false) }}>
                              <Heading3 className="h-3 w-3 mr-2" /> H3
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Inline styling */}
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Bold" onClick={() => wrapSelection('**', '**')}>
                        <Bold className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Italic" onClick={() => wrapSelection('*', '*')}>
                        <Italic className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Underline" onClick={() => surroundWithTag('u')}>
                        <Underline className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Strikethrough" onClick={() => wrapSelection('~~', '~~')}>
                        <Strikethrough className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Inline code" onClick={() => wrapSelection('`', '`')}>
                        <Code className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Blockquote" onClick={() => insertAtLineStart('> ')}>
                        <Quote className="h-4 w-4" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Lists */}
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Bulleted list"
                        onClick={() => prefixSelectedLines(() => '- ')}>
                        <List className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Numbered list"
                        onClick={() => prefixSelectedLines((i) => `${i + 1}. `)}>
                        <ListOrdered className="h-4 w-4" />
                      </button>
                      <button className="p-1.5 rounded hover:bg-gray-100" title="Checklist"
                        onClick={() => prefixSelectedLines(() => '- [ ] ')}>
                        <ListTodo className="h-4 w-4" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Color & highlight */}
                      <div className="relative" ref={colorDropdownRef}>
                        <button
                          onClick={() => setShowColorDropdown(!showColorDropdown)}
                          className="flex items-center p-1.5 text-gray-700 hover:bg-gray-100 rounded"
                          title="Text color"
                        >
                          <Palette className="h-4 w-4" />
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showColorDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50">
                            <div className="grid grid-cols-7 gap-1">
                              {colorOptions.map((c) => (
                                <button
                                  key={c.value}
                                  onClick={() => { surroundWithTag('span', { style: `color:${c.value}` }); setShowColorDropdown(false) }}
                                  className="w-5 h-5 rounded border border-gray-300"
                                  style={{ backgroundColor: c.value }}
                                  title={c.label}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="relative" ref={highlightDropdownRef}>
                        <button
                          onClick={() => setShowHighlightDropdown(!showHighlightDropdown)}
                          className="flex items-center p-1.5 text-gray-700 hover:bg-gray-100 rounded"
                          title="Highlight"
                        >
                          <Highlighter className="h-4 w-4" />
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showHighlightDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 p-2 z-50">
                            <div className="grid grid-cols-5 gap-1">
                              {highlightOptions.map((c) => (
                                <button
                                  key={c.value}
                                  onClick={() => { surroundWithTag('span', { style: `background-color:${c.value}` }); setShowHighlightDropdown(false) }}
                                  className="w-5 h-5 rounded border border-gray-300"
                                  style={{ backgroundColor: c.value }}
                                  title={c.label}
                                />
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <button className="p-1.5 rounded hover:bg-gray-100" title="Clear formatting" onClick={clearFormattingSelection}>
                        <Eraser className="h-4 w-4" />
                      </button>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Insert menu */}
                      <div className="relative" ref={moreDropdownRef}>
                        <button
                          onClick={() => setShowMoreDropdown(!showMoreDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                        >
                          <div className="w-4 h-4 bg-blue-500 rounded-full mr-2 flex items-center justify-center">
                            <Plus className="h-2.5 w-2.5 text-white" />
                          </div>
                          Insert
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>

                        {showMoreDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[160px]">
                            <button onClick={() => { insertText('![Image](', ')'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center">
                              <ImageIcon className="h-3 w-3 mr-2" /> Image
                            </button>
                            <button onClick={() => { insertText('[Link](', ')'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center">
                              <LinkIcon className="h-3 w-3 mr-2" /> Link
                            </button>
                            <button onClick={() => { insertText('```\n', '\n```'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center">
                              <Code className="h-3 w-3 mr-2" /> Code Block
                            </button>
                            <button onClick={() => { insertText('| Column 1 | Column 2 |\n|----------|----------|\n| Cell 1   | Cell 2   |'); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50">
                              Table
                            </button>
                            <button onClick={() => { insertHR(); setShowMoreDropdown(false) }}
                              className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center">
                              <Minus className="h-3 w-3 mr-2" /> Horizontal rule
                            </button>
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* AI models dropdown */}
                      <div className="relative" ref={aiDropdownRef}>
                        <button
                          onClick={() => setShowAIDropdown(!showAIDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded"
                        >
                          <Wand2 className="h-4 w-4 mr-1" />
                          <span className="hidden sm:inline">AI</span>
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showAIDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w=[220px]">
                            <div className="px-3 py-1.5 text-[10px] uppercase tracking-wide text-gray-500">Insert AI reference</div>
                            {(integratedModels || []).map((m: any) => (
                              <button
                                key={m.id}
                                onClick={() => { insertAIBlock(m.provider, m.model); setShowAIDropdown(false) }}
                                className="w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 flex items-center"
                              >
                                <Bot className="h-3 w-3 mr-2" />
                                {m.label}
                              </button>
                            ))}
                            {(!integratedModels || integratedModels.length === 0) && (
                              <div className="px-3 py-2 text-xs text-gray-500">No models found</div>
                            )}
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300" />

                      {/* Font + Size */}
                      <div className="relative" ref={fontDropdownRef}>
                        <button
                          onClick={() => setShowFontDropdown(!showFontDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded min-w-[80px]"
                        >
                          {currentFont}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showFontDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
                            {fontOptions.map((font) => (
                              <button
                                key={font.value}
                                onClick={() => { setCurrentFont(font.value); setShowFontDropdown(false) }}
                                className={clsx(
                                  'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
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

                      <div className="relative" ref={sizeDropdownRef}>
                        <button
                          onClick={() => setShowSizeDropdown(!showSizeDropdown)}
                          className="flex items-center px-2 py-1 text-sm text-gray-700 hover:bg-gray-100 rounded min-w-[50px]"
                        >
                          {currentSize}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </button>
                        {showSizeDropdown && (
                          <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[60px]">
                            {sizeOptions.map((size) => (
                              <button
                                key={size.value}
                                onClick={() => { setCurrentSize(size.value); setShowSizeDropdown(false) }}
                                className={clsx(
                                  'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50',
                                  currentSize === size.value && 'bg-gray-100'
                                )}
                              >
                                {size.label}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="w-px h-4 bg-gray-300 mx-1" />

                      {/* Undo / Redo */}
                      <button
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
                        title="Undo"
                        onClick={() => document.execCommand('undo')}
                      >
                        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                        </svg>
                      </button>
                      <button
                        className="p-1.5 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded"
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
                {/* (Removed meta line: last updated / created by) */}
              </div>
            </div>

            {/* Editor Content */}
            <div className="flex-1 overflow-y-auto">
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

              <div className="px-6 pb-6">
                <textarea
                  ref={editorRef}
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
        noteOwnerId={selectedNote?.created_by || ''}
        noteOwnerUser={undefined /* name now resolved via usersById */}
      />
    </div>
  )
}
