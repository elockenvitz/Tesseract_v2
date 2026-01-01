import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  Plus, Search, Share2, MoreHorizontal, Trash2, Copy, ChevronDown, Users, History,
  Save, Check, AlertCircle, ArrowUpDown, X, FileText, HelpCircle, AtSign, DollarSign, Hash, FileCode, BarChart3, Sparkles,
  WifiOff, CloudOff, RefreshCw, Download, FileDown, Loader2, Paperclip, Link2, ExternalLink, FileSpreadsheet, Image, FileVideo, File
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { CollaborationManager } from '../ui/CollaborationManager'
import { RichTextEditor, type RichTextEditorRef, type MentionItem, type AssetItem, type HashtagItem } from '../rich-text-editor'
import { NoteVersionHistory } from './NoteVersionHistory'
import { useNoteVersions } from '../../hooks/useNoteVersions'
import { useOfflineNotes } from '../../hooks/useOfflineNotes'
import { useTemplates } from '../../hooks/useTemplates'
import { formatDistanceToNow, format } from 'date-fns'
import { clsx } from 'clsx'
import { stripHtml } from '../../utils/stripHtml'

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
  const [noteTypeFilter, setNoteTypeFilter] = useState<string | null>(null)
  const [sortBy, setSortBy] = useState<'updated' | 'created' | 'title'>('updated')
  const [showSortDropdown, setShowSortDropdown] = useState(false)
  const sortDropdownRef = useRef<HTMLDivElement>(null)
  const [editingContent, setEditingContent] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [isTitleEditing, setIsTitleEditing] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
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
  const [showVersionHistory, setShowVersionHistory] = useState(false)
  const [showSmartInputHelp, setShowSmartInputHelp] = useState(false)
  const [showExportDropdown, setShowExportDropdown] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [showFilesLinksDropdown, setShowFilesLinksDropdown] = useState(false)

  const editorRef = useRef<HTMLDivElement>(null)
  const richTextEditorRef = useRef<RichTextEditorRef>(null)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const noteTypeDropdownRef = useRef<HTMLDivElement>(null)
  const exportDropdownRef = useRef<HTMLDivElement>(null)
  const filesLinksDropdownRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  // Use ref for immediate content access without re-renders
  const editingContentRef = useRef('')
  const contentUpdateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { user } = useAuth()
  const { isOnline, pendingCount, isSyncing, saveOffline, syncPendingNotes, hasPendingChanges } = useOfflineNotes()

  // Get templates with shortcuts for .template commands
  const { templatesWithShortcuts } = useTemplates()

  const noteTypeOptions = [
    { value: 'general', label: 'General', color: 'default' },
    { value: 'research', label: 'Research', color: 'warning' },
    { value: 'analysis', label: 'Analysis', color: 'primary' },
    { value: 'idea', label: 'Idea', color: 'error' },
    { value: 'meeting', label: 'Meeting', color: 'success' },
    { value: 'call', label: 'Call', color: 'purple' }
  ]

  // ---------- Queries ----------
  // Fetch notes list with preview (no full content for faster loading)
  const { data: notes, isLoading } = useQuery({
    queryKey: [config.queryKey, entityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from(config.tableName)
        .select('id, title, note_type, is_shared, created_by, updated_by, created_at, updated_at, content_preview')
        .eq(config.foreignKey, entityId)
        .eq('is_deleted', false)
        .order('updated_at', { ascending: false })

      if (error) throw error
      return (data || []).filter(n => !hiddenNoteIds.has(n.id))
    },
    staleTime: 0,
    refetchOnWindowFocus: true
  })

  // Fetch full content only for the selected note (lazy loading)
  const { data: selectedNoteContent, isLoading: isLoadingContent } = useQuery({
    queryKey: [config.queryKey, 'content', selectedNoteId],
    queryFn: async () => {
      if (!selectedNoteId) return null
      const { data, error } = await supabase
        .from(config.tableName)
        .select('id, content')
        .eq('id', selectedNoteId)
        .single()

      if (error) throw error
      return data
    },
    enabled: !!selectedNoteId,
    staleTime: 30000 // Cache content for 30 seconds
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

  // Selected note - merge metadata with lazy-loaded content
  const selectedNoteMetadata = notes?.find(n => n.id === selectedNoteId)
  const selectedNote = selectedNoteMetadata ? {
    ...selectedNoteMetadata,
    content: selectedNoteContent?.content || ''
  } : undefined

  // Note version hook for history and restore
  const {
    versions,
    createVersionAsync,
    isCreating: isCreatingVersion
  } = useNoteVersions(selectedNoteId, entityType)

  // Track last versioned content for auto-versioning
  const lastVersionedContent = useRef('')
  const lastVersionTime = useRef(Date.now())
  const versionInitialized = useRef(false)

  // Initialize version tracking when note content loads
  useEffect(() => {
    if (selectedNote?.content && !versionInitialized.current) {
      lastVersionedContent.current = selectedNote.content
      lastVersionTime.current = Date.now()
      versionInitialized.current = true
    }
  }, [selectedNote?.content])

  // Reset version tracking when switching notes
  useEffect(() => {
    versionInitialized.current = false
    lastVersionedContent.current = ''
    lastVersionTime.current = Date.now()
  }, [selectedNote?.id])

  // Auto-version on significant changes (every 30 minutes with major changes)
  useEffect(() => {
    if (!selectedNote || !versionInitialized.current) return

    const checkAndCreateVersion = async () => {
      const currentContent = editingContentRef.current
      if (!currentContent || !lastVersionedContent.current) return

      const now = Date.now()
      const timeSinceLastVersion = now - lastVersionTime.current
      const contentChanged = currentContent !== lastVersionedContent.current

      // Only create version if:
      // 1. Content changed by 500+ characters (significant edit)
      // 2. AND at least 30 minutes have passed
      const charDiff = Math.abs(currentContent.length - lastVersionedContent.current.length)
      const significantChange = contentChanged && charDiff > 500

      if (significantChange && timeSinceLastVersion > 30 * 60 * 1000) {
        try {
          await createVersionAsync({
            noteId: selectedNote.id,
            noteType: entityType,
            title: editingTitle || selectedNote.title,
            content: currentContent,
            noteTypeCategory: selectedNote.note_type,
            reason: 'auto'
          })
          lastVersionedContent.current = currentContent
          lastVersionTime.current = now
        } catch (error) {
          console.error('Failed to create auto-version:', error)
        }
      }
    }

    // Check every 10 minutes
    const interval = setInterval(checkAndCreateVersion, 10 * 60 * 1000)
    return () => clearInterval(interval)
  }, [selectedNote?.id, entityType, createVersionAsync, editingTitle])

  // ---------- Dropdown outside-click handling ----------
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (noteTypeDropdownRef.current && !noteTypeDropdownRef.current.contains(target)) setShowNoteTypeDropdown(false)
      if (sortDropdownRef.current && !sortDropdownRef.current.contains(target)) setShowSortDropdown(false)
      if (exportDropdownRef.current && !exportDropdownRef.current.contains(target)) setShowExportDropdown(false)
      if (filesLinksDropdownRef.current && !filesLinksDropdownRef.current.contains(target)) setShowFilesLinksDropdown(false)
    }
    if (showNoteTypeDropdown || showSortDropdown || showExportDropdown || showFilesLinksDropdown) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showNoteTypeDropdown, showSortDropdown, showExportDropdown, showFilesLinksDropdown])

  // Close help modal on Escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && showSmartInputHelp) {
        setShowSmartInputHelp(false)
      }
    }
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [showSmartInputHelp])

  // Track the note ID we've initialized for
  const initializedNoteIdRef = useRef<string | null>(null)
  const contentInitializedRef = useRef<boolean>(false)

  // Update editing content when switching notes or when content finishes loading
  useEffect(() => {
    if (selectedNote && selectedNoteContent) {
      // Check if this is a new note or content just loaded
      const isNewNote = selectedNote.id !== initializedNoteIdRef.current
      const contentJustLoaded = !contentInitializedRef.current && selectedNoteContent.content !== undefined

      if (isNewNote || contentJustLoaded) {
        // Initialize content from the loaded data
        const content = selectedNoteContent.content || ''
        setEditingContent(content)
        editingContentRef.current = content
        setEditingTitle(selectedNote.title || '')
        initializedNoteIdRef.current = selectedNote.id
        contentInitializedRef.current = true
      }
    } else if (!selectedNoteId) {
      // No note selected - clear state
      setEditingContent('')
      editingContentRef.current = ''
      setEditingTitle('')
      initializedNoteIdRef.current = null
      contentInitializedRef.current = false
    }
  }, [selectedNote?.id, selectedNoteId, selectedNoteContent])

  // Reset content initialized flag when note changes
  useEffect(() => {
    contentInitializedRef.current = false
  }, [selectedNoteId])

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

  // Helper to compute content preview (first 150 chars of plain text)
  const computeContentPreview = (html: string): string => {
    if (!html) return ''
    const plainText = stripHtml(html)
    return plainText.length > 150 ? plainText.substring(0, 150) : plainText
  }

  // ---------- Mutations ----------
  const saveNoteMutation = useMutation({
    mutationFn: async ({ id, title, content }: { id: string; title?: string; content?: string }) => {
      setIsSaving(true)

      // Compute content preview if content is being updated
      const contentPreview = content !== undefined ? computeContentPreview(content) : undefined

      // If offline, save locally
      if (!isOnline) {
        saveOffline({
          id,
          entityType,
          entityId,
          tableName: config.tableName,
          title: title ?? editingTitle,
          content: content ?? editingContent,
          userId: user?.id || ''
        })
        return { offline: true, id, title, content, content_preview: contentPreview }
      }

      // Online - save to Supabase
      const updates: any = { updated_at: new Date().toISOString(), updated_by: user?.id }
      if (title !== undefined) updates.title = title
      if (content !== undefined) {
        updates.content = content
        updates.content_preview = contentPreview
      }
      const { error } = await supabase.from(config.tableName).update(updates).eq('id', id)
      if (error) throw error
      return { offline: false, id, title, content, content_preview: contentPreview, updated_at: updates.updated_at }
    },
    onSuccess: (result) => {
      // Use optimistic update instead of invalidating queries to prevent re-renders
      // Update notes list cache (metadata + preview)
      queryClient.setQueryData([config.queryKey, entityId], (oldData: any[] | undefined) => {
        if (!oldData) return oldData
        return oldData.map(note => {
          if (note.id === result.id) {
            return {
              ...note,
              ...(result.title !== undefined && { title: result.title }),
              ...(result.content_preview !== undefined && { content_preview: result.content_preview }),
              ...(result.updated_at && { updated_at: result.updated_at })
            }
          }
          return note
        })
      })
      // Update content cache separately
      if (result.content !== undefined) {
        queryClient.setQueryData([config.queryKey, 'content', result.id], {
          id: result.id,
          content: result.content
        })
      }
      setIsSaving(false)
      setLastSavedAt(new Date())
      setHasUnsavedChanges(false)
    },
    onError: (error) => {
      setIsSaving(false)
      // If save failed due to network, save offline
      if (!isOnline && selectedNote) {
        saveOffline({
          id: selectedNote.id,
          entityType,
          entityId,
          tableName: config.tableName,
          title: editingTitle,
          content: editingContentRef.current,
          userId: user?.id || ''
        })
      }
    }
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
      // Pre-populate content cache for the new note
      queryClient.setQueryData([config.queryKey, 'content', newNote.id], {
        id: newNote.id,
        content: newNote.content || ''
      })
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


  // ---------- Autosave ----------
  // Debounce-based autosave that pauses while typing
  // Only saves after user stops typing for 2 seconds
  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedContentRef = useRef<string>('')

  // Initialize lastSavedContentRef when note changes
  useEffect(() => {
    if (selectedNote) {
      lastSavedContentRef.current = selectedNote.content || ''
    }
  }, [selectedNote?.id])

  // Trigger autosave when content changes (debounced)
  const triggerAutosave = useCallback(() => {
    if (!selectedNote) return

    // Clear any pending save
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current)
    }

    // Schedule new save after 2 seconds of inactivity
    autosaveTimeoutRef.current = setTimeout(() => {
      const currentContent = editingContentRef.current
      if (currentContent && currentContent !== lastSavedContentRef.current && currentContent.trim()) {
        lastSavedContentRef.current = currentContent
        saveNoteMutation.mutate({ id: selectedNote.id, content: currentContent })
      } else {
        // Content matches last saved - clear unsaved indicator
        setHasUnsavedChanges(false)
      }
    }, 2000)
  }, [selectedNote?.id])

  // Cleanup timeout on unmount or note change
  useEffect(() => {
    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current)
      }
    }
  }, [selectedNote?.id])

  useEffect(() => {
    if (!selectedNote || editingTitle === selectedNote.title || !editingTitle.trim()) return
    const timeoutId = setTimeout(() => {
      saveNoteMutation.mutate({ id: selectedNote.id, title: editingTitle })
      setIsTitleEditing(false)
    }, 2000)
    return () => clearTimeout(timeoutId)
  }, [editingTitle, selectedNote?.id])

  const saveCurrentNote = async () => {
    if (!selectedNote) return
    const currentContent = editingContentRef.current
    const updates: any = {}
    if (currentContent !== selectedNote.content) updates.content = currentContent
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

  const handleContentChange = useCallback((html: string, _text: string) => {
    // Store immediately in ref (no re-render)
    editingContentRef.current = html
    setHasUnsavedChanges(true)

    // Trigger debounced autosave - will only save after user stops typing
    triggerAutosave()

    // Debounce the state update for word count display (500ms)
    if (contentUpdateTimeoutRef.current) {
      clearTimeout(contentUpdateTimeoutRef.current)
    }
    contentUpdateTimeoutRef.current = setTimeout(() => {
      setEditingContent(html)
    }, 500)
  }, [triggerAutosave])

  // Search functions for rich text editor
  const searchMentions = useCallback(async (query: string): Promise<MentionItem[]> => {
    if (!query || query.length < 1) return []

    const { data, error } = await supabase
      .from('users')
      .select('id, first_name, last_name, email')
      .or(`first_name.ilike.%${query}%,last_name.ilike.%${query}%,email.ilike.%${query}%`)
      .limit(5)

    if (error || !data) return []

    return data.map(user => ({
      id: user.id,
      name: user.first_name && user.last_name
        ? `${user.first_name} ${user.last_name}`
        : user.email?.split('@')[0] || 'Unknown',
      email: user.email
    }))
  }, [])

  const searchAssets = useCallback(async (query: string): Promise<AssetItem[]> => {
    if (!query || query.length < 1) return []

    const { data, error } = await supabase
      .from('assets')
      .select('id, symbol, company_name')
      .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
      .limit(5)

    if (error || !data) return []

    return data.map(asset => ({
      id: asset.id,
      symbol: asset.symbol,
      companyName: asset.company_name
    }))
  }, [])

  const searchHashtags = useCallback(async (query: string): Promise<HashtagItem[]> => {
    if (!query || query.length < 1) return []

    const results: HashtagItem[] = []

    // Search themes
    const { data: themes } = await supabase
      .from('themes')
      .select('id, name, description')
      .ilike('name', `%${query}%`)
      .limit(3)

    if (themes) {
      results.push(...themes.map(t => ({
        id: t.id,
        name: t.name,
        type: 'theme' as const,
        description: t.description
      })))
    }

    // Search portfolios
    const { data: portfolios } = await supabase
      .from('portfolios')
      .select('id, name, description')
      .ilike('name', `%${query}%`)
      .limit(3)

    if (portfolios) {
      results.push(...portfolios.map(p => ({
        id: p.id,
        name: p.name,
        type: 'portfolio' as const,
        description: p.description
      })))
    }

    return results
  }, [])

  const handleTitleChange = (title: string) => {
    setEditingTitle(title)
    if (selectedNote && title !== selectedNote.title) {
      setHasUnsavedChanges(true)
    }
  }

  // Manual save function
  const handleManualSave = () => {
    if (selectedNote && hasUnsavedChanges) {
      saveNoteMutation.mutate({ id: selectedNote.id, content: editingContentRef.current, title: editingTitle })
    }
  }

  // Format last saved time for display
  const formatLastSaved = (date: Date | null) => {
    if (!date) return null
    return format(date, 'h:mm a')
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
    if (selectedNote && (editingContentRef.current !== selectedNote.content || editingTitle !== selectedNote.title)) {
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

  // ---------- Export Functions ----------
  const exportToPdf = useCallback(async () => {
    if (!selectedNote) return
    setIsExporting(true)
    setShowExportDropdown(false)

    try {
      // Lazy load the libraries
      const [{ default: jsPDF }, { default: html2canvas }] = await Promise.all([
        import('jspdf'),
        import('html2canvas')
      ])

      // Create a temporary container with the note content
      const container = document.createElement('div')
      container.style.cssText = `
        position: absolute;
        left: -9999px;
        top: 0;
        width: 800px;
        padding: 40px;
        background: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      `
      container.innerHTML = `
        <h1 style="font-size: 24px; font-weight: 600; margin-bottom: 8px; color: #111827;">${editingTitle || selectedNote.title}</h1>
        <p style="font-size: 12px; color: #6b7280; margin-bottom: 24px;">
          ${entityName} · ${selectedNote.note_type || 'General'} · ${format(new Date(selectedNote.updated_at), 'MMM d, yyyy h:mm a')}
        </p>
        <div style="font-size: 14px; line-height: 1.6; color: #374151;">
          ${editingContentRef.current || selectedNote.content}
        </div>
      `
      document.body.appendChild(container)

      // Convert to canvas
      const canvas = await html2canvas(container, {
        scale: 2,
        useCORS: true,
        logging: false
      })

      document.body.removeChild(container)

      // Create PDF
      const imgData = canvas.toDataURL('image/png')
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'px',
        format: [canvas.width / 2, canvas.height / 2]
      })
      pdf.addImage(imgData, 'PNG', 0, 0, canvas.width / 2, canvas.height / 2)

      // Download
      const fileName = `${(editingTitle || selectedNote.title).replace(/[^a-z0-9]/gi, '_')}.pdf`
      pdf.save(fileName)
    } catch (error) {
      console.error('Failed to export PDF:', error)
    } finally {
      setIsExporting(false)
    }
  }, [selectedNote, editingTitle, entityName])

  const exportToWord = useCallback(async () => {
    if (!selectedNote) return
    setIsExporting(true)
    setShowExportDropdown(false)

    try {
      // Lazy load the libraries
      const [{ Document, Packer, Paragraph, TextRun, HeadingLevel }, { saveAs }] = await Promise.all([
        import('docx'),
        import('file-saver')
      ])

      // Convert HTML to plain text paragraphs (simplified)
      const tempDiv = document.createElement('div')
      tempDiv.innerHTML = editingContentRef.current || selectedNote.content

      // Extract text content from HTML, preserving paragraphs
      const paragraphs: any[] = []

      // Add title
      paragraphs.push(
        new Paragraph({
          text: editingTitle || selectedNote.title,
          heading: HeadingLevel.HEADING_1,
          spacing: { after: 200 }
        })
      )

      // Add metadata
      paragraphs.push(
        new Paragraph({
          children: [
            new TextRun({
              text: `${entityName} · ${selectedNote.note_type || 'General'} · ${format(new Date(selectedNote.updated_at), 'MMM d, yyyy h:mm a')}`,
              size: 20,
              color: '6b7280'
            })
          ],
          spacing: { after: 400 }
        })
      )

      // Process content - walk through child nodes
      const processNode = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent?.trim()
          if (text) {
            paragraphs.push(
              new Paragraph({
                children: [new TextRun({ text })],
                spacing: { after: 120 }
              })
            )
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const el = node as HTMLElement
          const tagName = el.tagName.toLowerCase()

          if (tagName === 'p' || tagName === 'div') {
            const text = el.textContent?.trim()
            if (text) {
              paragraphs.push(
                new Paragraph({
                  children: [new TextRun({ text })],
                  spacing: { after: 120 }
                })
              )
            }
          } else if (tagName === 'h1' || tagName === 'h2' || tagName === 'h3') {
            const text = el.textContent?.trim()
            if (text) {
              paragraphs.push(
                new Paragraph({
                  text,
                  heading: tagName === 'h1' ? HeadingLevel.HEADING_1 :
                           tagName === 'h2' ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3,
                  spacing: { before: 200, after: 100 }
                })
              )
            }
          } else if (tagName === 'ul' || tagName === 'ol') {
            el.querySelectorAll('li').forEach((li) => {
              const text = li.textContent?.trim()
              if (text) {
                paragraphs.push(
                  new Paragraph({
                    children: [new TextRun({ text: `• ${text}` })],
                    spacing: { after: 60 }
                  })
                )
              }
            })
          } else if (tagName === 'br') {
            paragraphs.push(new Paragraph({ text: '' }))
          } else {
            // For other elements, process children
            el.childNodes.forEach(processNode)
          }
        }
      }

      tempDiv.childNodes.forEach(processNode)

      // If no paragraphs were added from content, add the plain text
      if (paragraphs.length <= 2) {
        const plainText = tempDiv.textContent || ''
        plainText.split('\n').filter(Boolean).forEach(line => {
          paragraphs.push(
            new Paragraph({
              children: [new TextRun({ text: line.trim() })],
              spacing: { after: 120 }
            })
          )
        })
      }

      // Create document
      const doc = new Document({
        sections: [{
          properties: {},
          children: paragraphs
        }]
      })

      // Generate and download
      const blob = await Packer.toBlob(doc)
      const fileName = `${(editingTitle || selectedNote.title).replace(/[^a-z0-9]/gi, '_')}.docx`
      saveAs(blob, fileName)
    } catch (error) {
      console.error('Failed to export Word:', error)
    } finally {
      setIsExporting(false)
    }
  }, [selectedNote, editingTitle, entityName])

  // ---------- Files & Links Extraction ----------
  interface ExtractedFile {
    fileName: string
    fileUrl: string
    fileType: string
    fileSize: number
  }

  interface ExtractedLink {
    text: string
    url: string
  }

  const extractFilesAndLinks = useCallback((content: string): { files: ExtractedFile[], links: ExtractedLink[] } => {
    const files: ExtractedFile[] = []
    const links: ExtractedLink[] = []

    if (!content) return { files, links }

    // Create a temporary DOM element to parse HTML
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = content

    // Extract file attachments
    const fileAttachments = tempDiv.querySelectorAll('[data-type="file-attachment"]')
    fileAttachments.forEach(el => {
      const fileName = el.getAttribute('data-file-name')
      const fileUrl = el.getAttribute('data-file-url')
      const fileType = el.getAttribute('data-file-type') || ''
      const fileSize = parseInt(el.getAttribute('data-file-size') || '0', 10)

      if (fileName && fileUrl) {
        files.push({ fileName, fileUrl, fileType, fileSize })
      }
    })

    // Extract links (a tags with href)
    const anchors = tempDiv.querySelectorAll('a[href]')
    anchors.forEach(el => {
      const url = el.getAttribute('href')
      const text = el.textContent || url || ''

      // Skip internal/mention links
      if (url && !url.startsWith('#') && !url.startsWith('mention:')) {
        // Avoid duplicates
        if (!links.some(l => l.url === url)) {
          links.push({ text: text.trim() || url, url })
        }
      }
    })

    return { files, links }
  }, [])

  // Get files and links from current content
  const { files: noteFiles, links: noteLinks } = extractFilesAndLinks(editingContentRef.current || selectedNote?.content || '')

  const getFileIconAndColor = (fileType: string): { icon: typeof File, bgColor: string, iconColor: string } => {
    if (fileType.startsWith('image/')) {
      return { icon: Image, bgColor: 'bg-purple-50', iconColor: 'text-purple-500' }
    }
    if (fileType.startsWith('video/')) {
      return { icon: FileVideo, bgColor: 'bg-orange-50', iconColor: 'text-orange-500' }
    }
    if (fileType.includes('spreadsheet') || fileType.includes('excel') || fileType.includes('csv') || fileType.includes('sheet')) {
      return { icon: FileSpreadsheet, bgColor: 'bg-green-50', iconColor: 'text-green-600' }
    }
    if (fileType.includes('pdf')) {
      return { icon: FileText, bgColor: 'bg-red-50', iconColor: 'text-red-500' }
    }
    if (fileType.includes('document') || fileType.includes('word') || fileType.includes('msword')) {
      return { icon: FileText, bgColor: 'bg-blue-50', iconColor: 'text-blue-500' }
    }
    return { icon: File, bgColor: 'bg-gray-100', iconColor: 'text-gray-500' }
  }

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i]
  }

  const filteredNotes = (notes || [])
    // Filter by search query (title and preview)
    .filter(note => {
      const query = searchQuery.toLowerCase()
      return note.title.toLowerCase().includes(query) ||
        (note.content_preview && note.content_preview.toLowerCase().includes(query))
    })
    // Filter by note type
    .filter(note => !noteTypeFilter || note.note_type === noteTypeFilter)
    // Sort
    .sort((a, b) => {
      switch (sortBy) {
        case 'title':
          return a.title.localeCompare(b.title)
        case 'created':
          return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        case 'updated':
        default:
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      }
    })

  // Get unique note types for filter dropdown
  const availableNoteTypes = Array.from(new Set((notes || []).map(n => n.note_type).filter(Boolean)))

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
    <div className="flex h-full bg-white rounded-xl shadow-sm overflow-hidden border border-gray-200">
      {/* Left Sidebar - Notes List */}
      <div className="w-72 bg-gray-50/50 border-r border-gray-200 flex flex-col">
        {/* Header */}
        <div className="p-4 border-b border-gray-200 bg-white">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900 tracking-tight">{entityName}</h3>
              <p className="text-xs text-gray-500 mt-0.5">{filteredNotes.length} notes</p>
            </div>
            <button
              onClick={handleCreateNote}
              disabled={createNoteMutation.isPending}
              className="w-8 h-8 flex items-center justify-center bg-primary-600 hover:bg-primary-700 text-white rounded-lg shadow-sm transition-all hover:shadow-md disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              type="text"
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 placeholder-gray-400 transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Filter Pills */}
          <div className="flex items-center gap-1.5 mt-3 flex-wrap">
            <button
              onClick={() => setNoteTypeFilter(null)}
              className={clsx(
                'px-2.5 py-1 text-xs font-medium rounded-md transition-all',
                !noteTypeFilter
                  ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              )}
            >
              All
            </button>
            {availableNoteTypes.slice(0, 3).map(type => (
              <button
                key={type}
                onClick={() => setNoteTypeFilter(noteTypeFilter === type ? null : type)}
                className={clsx(
                  'px-2.5 py-1 text-xs font-medium rounded-md transition-all capitalize',
                  noteTypeFilter === type
                    ? 'bg-primary-100 text-primary-700 ring-1 ring-primary-200'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                )}
              >
                {type}
              </button>
            ))}

            {/* Sort */}
            <div className="relative ml-auto" ref={sortDropdownRef}>
              <button
                onClick={() => setShowSortDropdown(!showSortDropdown)}
                className="flex items-center px-2 py-1 text-xs text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowUpDown className="h-3 w-3 mr-1" />
                {sortBy === 'updated' ? 'Recent' : sortBy === 'created' ? 'Created' : 'A-Z'}
              </button>

              {showSortDropdown && (
                <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 min-w-[140px]">
                  {[
                    { key: 'updated', label: 'Recently Updated' },
                    { key: 'created', label: 'Recently Created' },
                    { key: 'title', label: 'Alphabetical' }
                  ].map(option => (
                    <button
                      key={option.key}
                      onClick={() => { setSortBy(option.key as any); setShowSortDropdown(false) }}
                      className={clsx(
                        'w-full px-3 py-2 text-left text-xs hover:bg-gray-50 flex items-center justify-between',
                        sortBy === option.key && 'bg-gray-50 text-gray-900 font-medium'
                      )}
                    >
                      {option.label}
                      {sortBy === option.key && <Check className="h-3 w-3 text-gray-900" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Notes List */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {isLoading ? (
            <div className="space-y-3 p-2">
              {[...Array(4)].map((_, i) => (
                <div key={i} className="animate-pulse p-3 rounded-lg bg-gray-50">
                  <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                  <div className="h-3 bg-gray-100 rounded w-full mb-1"></div>
                  <div className="h-3 bg-gray-100 rounded w-1/2"></div>
                </div>
              ))}
            </div>
          ) : filteredNotes.length > 0 ? (
            <div className="space-y-1">
              {filteredNotes.map((note) => (
                <div
                  key={note.id}
                  className={clsx(
                    'p-3 rounded-lg cursor-pointer transition-all group relative',
                    selectedNoteId === note.id
                      ? 'bg-primary-50 ring-1 ring-primary-200 shadow-sm'
                      : 'hover:bg-white bg-transparent'
                  )}
                  onClick={() => handleNoteClick(note.id)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className={clsx(
                          'font-medium truncate text-sm',
                          selectedNoteId === note.id ? 'text-primary-900' : 'text-gray-900'
                        )}>
                          {note.title}
                        </h4>
                        {note.note_type && (
                          <span className={clsx(
                            'px-1.5 py-0.5 text-[10px] font-medium rounded capitalize',
                            note.note_type === 'research' && 'bg-amber-100 text-amber-700',
                            note.note_type === 'analysis' && 'bg-blue-100 text-blue-700',
                            note.note_type === 'meeting' && 'bg-emerald-100 text-emerald-700',
                            note.note_type === 'call' && 'bg-purple-100 text-purple-700',
                            note.note_type === 'idea' && 'bg-rose-100 text-rose-700',
                            (!note.note_type || note.note_type === 'general') && 'bg-gray-100 text-gray-700'
                          )}>
                            {note.note_type}
                          </span>
                        )}
                      </div>

                      {/* Content preview */}
                      {note.content_preview && (
                        <p className={clsx(
                          'text-xs truncate mt-1',
                          selectedNoteId === note.id ? 'text-primary-700/70' : 'text-gray-500'
                        )}>
                          {note.content_preview}
                        </p>
                      )}

                      <div className={clsx(
                        'flex items-center gap-2 text-[11px] mt-1',
                        selectedNoteId === note.id ? 'text-primary-600' : 'text-gray-400'
                      )}>
                        <span>{formatUpdatedAt(note.updated_at)}</span>
                        {note.is_shared && (
                          <>
                            <span>•</span>
                            <Share2 className="h-3 w-3" />
                          </>
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
                        className={clsx(
                          'opacity-0 group-hover:opacity-100 p-1.5 rounded-md transition-all',
                          selectedNoteId === note.id
                            ? 'hover:bg-primary-100 text-primary-600'
                            : 'hover:bg-gray-200 text-gray-400'
                        )}
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>

                      {showNoteMenu === note.id && (
                        <div className="absolute right-0 top-8 bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 min-w-[140px]">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              // Copy content from editing ref if this is the selected note, otherwise show message
                              if (note.id === selectedNoteId && editingContentRef.current) {
                                navigator.clipboard.writeText(stripHtml(editingContentRef.current))
                              }
                              setShowNoteMenu(null)
                            }}
                            className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Copy content
                          </button>
                          <div className="h-px bg-gray-100 my-1" />
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              handleDeleteNote(note.id, note.title)
                            }}
                            className="w-full px-3 py-2 text-left text-xs text-red-600 hover:bg-red-50 flex items-center gap-2"
                            disabled={softDeleteNoteMutation.isPending}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
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
            <div className="flex flex-col items-center justify-center h-40 text-gray-400">
              <Search className="h-8 w-8 mb-2 opacity-50" />
              <p className="text-sm">No notes found</p>
            </div>
          )}
        </div>
      </div>

      {/* Right Side - Note Editor */}
      <div className="flex-1 flex flex-col bg-white">
        {(isLoading || isLoadingContent) && selectedNoteId ? (
          /* Loading state when we have a selected note ID but still fetching */
          <div className="flex-1 flex flex-col">
            <div className="px-6 py-4 border-b border-gray-100 bg-white">
              <div className="animate-pulse flex items-center space-x-3">
                <div className="h-6 w-20 bg-gray-200 rounded" />
                <div className="h-4 w-px bg-gray-200" />
                <div className="h-6 w-16 bg-gray-200 rounded" />
              </div>
            </div>
            <div className="flex-1 px-8 pt-8 animate-pulse">
              <div className="h-8 w-1/3 bg-gray-200 rounded mb-6" />
              <div className="space-y-3">
                <div className="h-4 w-full bg-gray-100 rounded" />
                <div className="h-4 w-5/6 bg-gray-100 rounded" />
                <div className="h-4 w-4/6 bg-gray-100 rounded" />
              </div>
            </div>
          </div>
        ) : selectedNote ? (
          <>
            {/* Editor Header */}
            <div className="px-6 py-4 border-b border-gray-100 bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3 flex-1">
                  <div className="flex items-center space-x-3" ref={noteTypeDropdownRef}>
                    <div className="relative">
                      <button
                        onClick={() => setShowNoteTypeDropdown(!showNoteTypeDropdown)}
                        className="flex items-center"
                      >
                        <Badge variant={getNoteTypeColor(selectedNote.note_type)} size="sm">
                          {selectedNote.note_type || 'general'}
                          <ChevronDown className="ml-1 h-3 w-3" />
                        </Badge>
                      </button>

                      {showNoteTypeDropdown && (
                        <div className="absolute top-full left-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50 min-w-[140px]">
                          {noteTypeOptions.map((option) => (
                            <button
                              key={option.value}
                              onClick={() => handleNoteTypeChange(option.value)}
                              className={clsx(
                                'w-full px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors flex items-center justify-between',
                                selectedNote.note_type === option.value && 'bg-gray-50'
                              )}
                              disabled={updateNoteTypeMutation.isPending}
                            >
                              <span className="font-medium text-gray-700">{option.label}</span>
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

                    <div className="h-4 w-px bg-gray-200" />

                    {/* Collaboration Button */}
                    <button
                      onClick={() => setShowCollaborationManager(true)}
                      className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
                      title="Manage collaborators"
                    >
                      <Users className="h-3.5 w-3.5" />
                      <span className="font-medium">Share</span>
                    </button>

                    {/* Version History Button */}
                    <button
                      onClick={() => setShowVersionHistory(true)}
                      className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
                      title="Version history"
                    >
                      <History className="h-3.5 w-3.5" />
                      <span className="font-medium">History</span>
                      {versions.length > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-primary-100 text-primary-700 rounded-full font-medium">
                          {versions.length}
                        </span>
                      )}
                    </button>

                    {/* Files & Links Button */}
                    <div className="relative" ref={filesLinksDropdownRef}>
                      <button
                        onClick={() => setShowFilesLinksDropdown(!showFilesLinksDropdown)}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
                        title="Files & Links"
                      >
                        <Paperclip className="h-3.5 w-3.5" />
                        <span className="font-medium">Files</span>
                        {(noteFiles.length > 0 || noteLinks.length > 0) && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded-full font-medium">
                            {noteFiles.length + noteLinks.length}
                          </span>
                        )}
                        <ChevronDown className="h-3 w-3" />
                      </button>

                      {showFilesLinksDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-2 z-50 min-w-[280px] max-w-[360px] max-h-[400px] overflow-y-auto">
                          {noteFiles.length === 0 && noteLinks.length === 0 ? (
                            <div className="px-4 py-6 text-center">
                              <Paperclip className="h-8 w-8 text-gray-300 mx-auto mb-2" />
                              <p className="text-sm text-gray-500">No files or links</p>
                              <p className="text-xs text-gray-400 mt-1">Attach files or add links to see them here</p>
                            </div>
                          ) : (
                            <>
                              {/* Files Section */}
                              {noteFiles.length > 0 && (
                                <div>
                                  <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    Files ({noteFiles.length})
                                  </div>
                                  {noteFiles.map((file, idx) => {
                                    const { icon: FileIcon, bgColor, iconColor } = getFileIconAndColor(file.fileType)
                                    return (
                                      <a
                                        key={idx}
                                        href={file.fileUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors group"
                                        onClick={() => setShowFilesLinksDropdown(false)}
                                      >
                                        <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${bgColor} flex items-center justify-center`}>
                                          <FileIcon className={`h-4 w-4 ${iconColor}`} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs font-medium text-gray-900 truncate">{file.fileName}</p>
                                          <p className="text-[10px] text-gray-400">{formatFileSize(file.fileSize)}</p>
                                        </div>
                                        <Download className="h-3.5 w-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                      </a>
                                    )
                                  })}
                                </div>
                              )}

                              {/* Divider */}
                              {noteFiles.length > 0 && noteLinks.length > 0 && (
                                <div className="h-px bg-gray-100 my-2" />
                              )}

                              {/* Links Section */}
                              {noteLinks.length > 0 && (
                                <div>
                                  <div className="px-3 py-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                                    Links ({noteLinks.length})
                                  </div>
                                  {noteLinks.map((link, idx) => (
                                    <a
                                      key={idx}
                                      href={link.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-3 px-3 py-2 hover:bg-gray-50 transition-colors group"
                                      onClick={() => setShowFilesLinksDropdown(false)}
                                    >
                                      <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                                        <Link2 className="h-4 w-4 text-blue-500" />
                                      </div>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-gray-900 truncate">{link.text}</p>
                                        <p className="text-[10px] text-gray-400 truncate">{link.url}</p>
                                      </div>
                                      <ExternalLink className="h-3.5 w-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                                    </a>
                                  ))}
                                </div>
                              )}
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Export Button */}
                    <div className="relative" ref={exportDropdownRef}>
                      <button
                        onClick={() => setShowExportDropdown(!showExportDropdown)}
                        disabled={isExporting}
                        className="flex items-center space-x-1.5 px-2.5 py-1.5 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all disabled:opacity-50"
                        title="Export note"
                      >
                        {isExporting ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Download className="h-3.5 w-3.5" />
                        )}
                        <span className="font-medium">Export</span>
                        <ChevronDown className="h-3 w-3" />
                      </button>

                      {showExportDropdown && (
                        <div className="absolute top-full right-0 mt-1 bg-white rounded-xl shadow-xl border border-gray-100 py-1.5 z-50 min-w-[160px]">
                          <button
                            onClick={exportToPdf}
                            className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <FileDown className="h-3.5 w-3.5 text-red-500" />
                            <span>Export as PDF</span>
                          </button>
                          <button
                            onClick={exportToWord}
                            className="w-full px-3 py-2 text-left text-xs text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                          >
                            <FileText className="h-3.5 w-3.5 text-blue-500" />
                            <span>Export as Word</span>
                          </button>
                        </div>
                      )}
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
            <div className="flex-1 overflow-y-auto bg-white">
              {/* Note Title as Editable Heading */}
              <div className="px-8 pt-8 pb-0">
                {isTitleEditing ? (
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editingTitle}
                    onChange={(e) => handleTitleChange(e.target.value)}
                    onKeyDown={handleTitleKeyDown}
                    onBlur={handleTitleBlur}
                    className="w-full text-2xl font-semibold text-gray-900 mb-6 pb-4 bg-transparent border-0 border-b-2 border-gray-900 focus:outline-none tracking-tight"
                    placeholder="Untitled"
                  />
                ) : (
                  <h1
                    className="text-2xl font-semibold text-gray-900 mb-6 pb-4 border-b border-gray-100 cursor-text hover:border-gray-300 transition-colors tracking-tight"
                    onClick={handleTitleClick}
                  >
                    {editingTitle || selectedNote.title || 'Untitled'}
                  </h1>
                )}
              </div>

              {/* Note Content - Rich Text Editor */}
              <div className="flex-1 overflow-hidden">
                <RichTextEditor
                  ref={richTextEditorRef}
                  value={editingContent}
                  onChange={handleContentChange}
                  placeholder="Start writing..."
                  className="h-full"
                  minHeight="calc(100vh - 400px)"
                  enableMentions={true}
                  enableAssets={true}
                  enableHashtags={true}
                  onMentionSearch={searchMentions}
                  onAssetSearch={searchAssets}
                  onHashtagSearch={searchHashtags}
                  assetContext={entityType === 'asset' ? { id: entityId, symbol: entityName } : null}
                  templates={templatesWithShortcuts.map(t => ({
                    id: t.id,
                    name: t.name,
                    shortcut: t.shortcut!,
                    content: t.content
                  }))}
                />
              </div>
            </div>

            {/* Status Bar */}
            <div className="px-6 py-2.5 border-t border-gray-200 bg-white">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center space-x-3 text-gray-400">
                  {/* Offline Status Indicator */}
                  {!isOnline && (
                    <>
                      <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-50 text-amber-700 rounded-md border border-amber-200">
                        <WifiOff className="h-3 w-3" />
                        <span className="font-medium">Offline</span>
                        {pendingCount > 0 && (
                          <span className="text-amber-600">({pendingCount} pending)</span>
                        )}
                      </div>
                      <span className="text-gray-300">|</span>
                    </>
                  )}
                  {isOnline && pendingCount > 0 && (
                    <>
                      <button
                        onClick={() => syncPendingNotes()}
                        disabled={isSyncing}
                        className="flex items-center gap-1.5 px-2 py-1 bg-blue-50 text-blue-700 rounded-md border border-blue-200 hover:bg-blue-100 transition-colors"
                      >
                        <RefreshCw className={clsx("h-3 w-3", isSyncing && "animate-spin")} />
                        <span className="font-medium">
                          {isSyncing ? 'Syncing...' : `Sync ${pendingCount} note${pendingCount > 1 ? 's' : ''}`}
                        </span>
                      </button>
                      <span className="text-gray-300">|</span>
                    </>
                  )}
                  {(() => {
                    const plainText = stripHtml(editingContent)
                    const wordCount = plainText.split(/\s+/).filter(w => w.length > 0).length
                    const charCount = plainText.length
                    return (
                      <>
                        <span className="font-medium text-gray-500">{wordCount} words</span>
                        <span className="text-gray-300">•</span>
                        <span className="text-gray-500">{charCount >= 1000 ? `${(charCount / 1000).toFixed(1)}k` : charCount} chars</span>
                      </>
                    )
                  })()}
                  <span className="text-gray-300">|</span>
                  <button
                    type="button"
                    onClick={() => setShowSmartInputHelp(true)}
                    className="flex items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors cursor-help"
                  >
                    <HelpCircle className="w-3 h-3" />
                    <span className="text-primary-500">@</span>mention
                    <span className="mx-1">·</span>
                    <span className="text-emerald-500">$</span>asset
                    <span className="mx-1">·</span>
                    <span className="text-amber-500">#</span>tag
                    <span className="mx-1">·</span>
                    <span className="text-cyan-500">.price</span>
                    <span className="mx-1">·</span>
                    <span className="text-violet-500">.template</span>
                    <span className="mx-1">·</span>
                    <span className="text-purple-500">.AI</span>
                  </button>
                  {lastSavedAt && (
                    <>
                      <span className="text-gray-300">|</span>
                      <span>Saved {formatLastSaved(lastSavedAt)}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center space-x-3">
                  {/* Save status indicator */}
                  {isSaving ? (
                    <div className="flex items-center text-gray-500 font-medium">
                      <div className="animate-spin rounded-full h-3 w-3 border-2 border-gray-300 border-t-gray-600 mr-1.5" />
                      {isOnline ? 'Saving...' : 'Saving locally...'}
                    </div>
                  ) : saveNoteMutation.isError && isOnline ? (
                    <div className="flex items-center text-red-600 font-medium">
                      <AlertCircle className="h-3 w-3 mr-1" />
                      Save failed
                    </div>
                  ) : !isOnline && (selectedNoteId && hasPendingChanges(selectedNoteId)) ? (
                    <div className="flex items-center text-amber-600 font-medium">
                      <CloudOff className="h-3 w-3 mr-1" />
                      Saved locally
                    </div>
                  ) : hasUnsavedChanges ? (
                    <div className="flex items-center text-amber-600 font-medium">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-500 mr-1.5 animate-pulse" />
                      Unsaved
                    </div>
                  ) : (
                    <div className="flex items-center text-emerald-600 font-medium">
                      <Check className="h-3 w-3 mr-1" />
                      Saved
                    </div>
                  )}

                  {/* Manual save button */}
                  <button
                    onClick={handleManualSave}
                    disabled={!hasUnsavedChanges || isSaving}
                    className={clsx(
                      'flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-all',
                      hasUnsavedChanges && !isSaving
                        ? 'bg-primary-600 text-white hover:bg-primary-700 shadow-sm'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    )}
                    title="Save now (Ctrl+S)"
                  >
                    <Save className="h-3 w-3 mr-1.5" />
                    Save
                  </button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-gray-50/50">
            <div className="text-center">
              <div className="w-14 h-14 bg-primary-50 rounded-xl flex items-center justify-center mx-auto mb-4">
                <FileText className="h-7 w-7 text-primary-400" />
              </div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Select a note</h3>
              <p className="text-sm text-gray-500">Choose from the sidebar or create a new one</p>
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

      {/* Version History Panel */}
      {selectedNoteId && (
        <NoteVersionHistory
          noteId={selectedNoteId}
          noteType={entityType}
          isOpen={showVersionHistory}
          onClose={() => setShowVersionHistory(false)}
          onRestore={(version) => {
            // Reload the note content after restore
            queryClient.invalidateQueries({ queryKey: [config.queryKey, entityId] })
          }}
        />
      )}

      {/* Smart Input Help Modal */}
      {showSmartInputHelp && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
          onClick={() => setShowSmartInputHelp(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Smart Input Shortcuts</h3>
              <button
                onClick={() => setShowSmartInputHelp(false)}
                className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-gray-500" />
              </button>
            </div>

            {/* Content */}
            <div className="p-5 space-y-4 overflow-y-auto max-h-[60vh]">
              {/* @mention */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <AtSign className="w-5 h-5 text-primary-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">@mention</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">@</code> followed by a name to mention a team member. They'll be notified when you save.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Example: @JohnSmith</p>
                </div>
              </div>

              {/* $asset */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">$asset</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">$</code> followed by a ticker symbol to reference an asset. Creates a clickable link.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Example: $AAPL, $MSFT</p>
                </div>
              </div>

              {/* #reference */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Hash className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">#reference</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">#</code> to link to themes, portfolios, notes, or other entities.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Example: #TechTheme, #GrowthPortfolio</p>
                </div>
              </div>

              {/* .template */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-violet-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <FileCode className="w-5 h-5 text-violet-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">.template</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">.template</code> or <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">.t</code> to insert a note template with placeholders.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Press Tab to move between placeholders</p>
                </div>
              </div>

              {/* .price / .data */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-cyan-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <BarChart3 className="w-5 h-5 text-cyan-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">.price, .volume, .marketcap</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">.price</code> or other data commands to insert live or snapshot data for the current asset.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">Choose snapshot (fixed) or live (updates automatically)</p>
                </div>
              </div>

              {/* .AI */}
              <div className="flex gap-4">
                <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Sparkles className="w-5 h-5 text-purple-600" />
                </div>
                <div>
                  <div className="font-medium text-gray-900">.AI</div>
                  <p className="text-sm text-gray-600 mt-0.5">
                    Type <code className="px-1.5 py-0.5 bg-gray-100 rounded text-xs">.AI</code> then space to enter AI prompt mode. Type your question and press Enter.
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    Select a model: <code className="px-1 py-0.5 bg-gray-100 rounded">.AI.claude</code>, <code className="px-1 py-0.5 bg-gray-100 rounded">.AI.gpt</code>
                  </p>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 bg-gray-50 border-t border-gray-200">
              <p className="text-xs text-gray-500 text-center">
                Press <kbd className="px-1.5 py-0.5 bg-white border border-gray-300 rounded text-xs font-mono">Esc</kbd> to close
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}