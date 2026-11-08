import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
// BarChart3 and MessageSquare went with the Chart and Discussion tabs: the
// chart is a band of Overview and needs no nav icon, and Discussion is gone.
import { FileText, TrendingUp, Plus, Calendar, User, ArrowLeft, Share2, Users, X, Search, Trash2, MoreVertical, Archive, ArchiveRestore, Repeat, ChevronDown, ChevronUp, Layers } from 'lucide-react'
import { clsx } from 'clsx'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { Badge } from '../ui/Badge'
import { ThemeNoteEditor } from '../notes/ThemeNoteEditorUnified'
import { AddAssetToThemeModal } from '../themes/AddAssetToThemeModal'
import { ThemeIndexChart } from '../themes/ThemeIndexChart'
import { ThemeActivityFeed } from '../themes/ThemeActivityFeed'
import { ThemeContextStrip } from '../themes/ThemeContextStrip'
/* The Asset page's scoped visual language, opted into rather than copied, so
   the two workspaces cannot drift to two palettes. Everything in it lives
   under `.ux2-scope`, so importing it changes nothing elsewhere. */
import '../asset/asset-ux2.css'
import { ThemeHeldPositions } from '../themes/overview/ThemeHeldPositions'
import { ThemeNotesDigest } from '../themes/overview/ThemeNotesDigest'
import { ThemeResearchTab } from '../themes/research/ThemeResearchTab'
import { ThemeProcessesPanel } from '../themes/processes/ThemeProcessesPanel'
import { useHeldAssetIds } from '../../hooks/useHeldAssetIds'
import { MobileAssetsList } from '../mobile/MobileAssetsList'
import { BottomSheet } from '../mobile/BottomSheet'
import { useIsMobile } from '../../hooks/useMediaQuery'
import { AssetTableView } from '../table/AssetTableView'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { formatDistanceToNow } from 'date-fns'
import { TabStateManager } from '../../lib/tabStateManager'
import { getContentPreview } from '../../utils/stripHtml'
import { OptionPicker } from '../ui/OptionPicker'
import {
  THEME_MODES, THEME_MODE_LABEL, themeModeOf, themeReadModeOf, isThemeReadMode,
  type ThemeMode, type ThemeReadMode,
} from '../../lib/theme-workspace/modes'

type ThemeLifecycleStatus = 'emerging' | 'active' | 'playing_out' | 'played_out' | 'invalidated'

/**
 * Archive and delete, shared by the desktop popover and the mobile sheet so
 * the two menus cannot drift apart. Row height is the only difference: 32px
 * reads as a menu under a cursor and as a mis-tap under a thumb.
 */
function ThemeActions({ isArchived, onToggleArchive, onDelete, mobile }: {
  isArchived: boolean
  onToggleArchive: () => void
  onDelete: () => void
  mobile?: boolean
}) {
  const row = mobile
    ? 'w-full flex items-center gap-3 px-4 py-3 text-left text-sm active:bg-gray-100 dark:active:bg-gray-800'
    : 'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50 dark:hover:bg-gray-800'

  return (
    <>
      <button
        onClick={onToggleArchive}
        className={clsx(row, 'text-gray-700 dark:text-gray-300')}
      >
        {isArchived ? (
          <><ArchiveRestore className="h-4 w-4 shrink-0 text-gray-400" />Unarchive</>
        ) : (
          <><Archive className="h-4 w-4 shrink-0 text-gray-400" />Archive</>
        )}
      </button>
      <button
        onClick={onDelete}
        className={clsx(row, 'text-error-600 hover:bg-error-50')}
      >
        <Trash2 className="h-4 w-4 shrink-0" />
        Delete theme
      </button>
    </>
  )
}

interface ThemeTabProps {
  theme: any
  isFocusMode?: boolean
  onCite?: (content: string, fieldName?: string) => void
}

/**
 * The theme's sections, named once.
 *
 * They were six hand-written buttons in the nav, which is fine while there is
 * one control rendering them and wrong the moment there are two. The phone
 * picker and the desktop tab row both walk this, so a section cannot exist in
 * one and not the other — the failure Portfolio's nine tabs were fixed for, one
 * surface over.
 */
/*
 * ── Six peer tabs became three modes ──────────────────────────────────────
 *
 * This page had Thesis, Chart, Related Assets, Notes, Discussion and Process
 * side by side, which is the shape the Asset page was deliberately moved off:
 * six peers make the reader know which FEATURE holds what they want. The
 * modes ask whether they are orienting, reading, or working.
 *
 * The mapping, the migration off the old persisted values and the reasoning
 * for three modes rather than four all live in `lib/theme-workspace/modes.ts`,
 * next to the Asset page's equivalent, because the point of the change is
 * that the two pages stop being different products.
 *
 * What happened to each old tab:
 *
 *   Thesis          -> Research, as the first read mode
 *   Notes           -> Research, as a read mode (the Asset page's
 *                      "Key references"), not a tab of its own
 *   Chart           -> a band of Overview: it answers "what is this theme"
 *   Related Assets  -> a band of Overview, same reason. Kept as the theme's
 *                      own membership (`theme_assets`) rather than converted
 *                      to an asset list, which would move org-owned data into
 *                      `asset_lists` -- documented as NOT org-scoped by
 *                      design -- for no gain at 20 links across 51 themes.
 *   Discussion      -> removed. `theme_discussions` held ZERO posts across
 *                      all 51 themes, so this orphaned nothing.
 *   Process         -> Work
 *
 * The nav is driven off THEME_MODES rather than hand-written buttons. It used
 * to be six literal <button>s on desktop while the phone picker walked a
 * table, which is the defect the old note here described and then shipped:
 * two controls, one list, free to disagree.
 */
const MODE_ICON: Record<ThemeMode, typeof FileText> = {
  overview: TrendingUp,
  assets: Layers,
  research: FileText,
  work: Repeat,
}

/**
 * The old section key each mode persists itself as.
 *
 * One per mode, and each one has to be a key `LEGACY_SECTION_MODE` maps back
 * to the same mode, or a saved tab reopens somewhere else. The modes test
 * pins that round trip; this table is the half that lives here because it is
 * about what this page writes.
 *
 * Kept as old keys rather than switching to the mode names so that a build
 * without this change still reads the state and lands on a real tab.
 */
const MODE_LEGACY_KEY: Record<ThemeMode, string> = {
  overview: 'chart',
  assets: 'related-assets',
  research: 'thesis',
  work: 'processes',
}

export function ThemeTab({ theme, isFocusMode = false, onCite }: ThemeTabProps) {
  const { user } = useAuth()

  /*
   * A tab persisted before the modes existed holds one of the six old section
   * keys, so both of these read through the migration rather than trusting
   * the stored string. `themeModeOf` falls back to Overview for anything it
   * does not recognise, which is also the right answer for no saved state.
   *
   * The read mode is seeded separately because Notes USED to be a tab: a
   * reader who left the page there has to arrive in Research already on the
   * notes, or the restructure quietly loses the destination they saved.
   */
  const [activeMode, setActiveMode] = useState<ThemeMode>(() =>
    themeModeOf(TabStateManager.loadTabState(theme.id)?.activeTab),
  )
  const [researchRead, setResearchRead] = useState<ThemeReadMode>(() => {
    const saved = TabStateManager.loadTabState(theme.id)
    /* Its own key first, then the legacy section, because only a tab saved
       BEFORE this change can express a read mode through `activeTab` (the
       Notes tab), and after it the dedicated key is the truth. */
    if (isThemeReadMode(saved?.themeResearchRead)) return saved.themeResearchRead
    return themeReadModeOf(saved?.activeTab) ?? 'thesis'
  })

  /* Collapsing the band hides the context strip and keeps identity, Share,
     the overflow and the tabs: the Asset page's compact working bar. Not
     persisted, same as there -- it is a per-sitting posture, not a setting. */
  const [headerCollapsed, setHeaderCollapsed] = useState(false)

  const [showNoteEditor, setShowNoteEditor] = useState(() => {
    const savedState = TabStateManager.loadTabState(theme.id)
    return savedState?.showNoteEditor || false
  })

  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => {
    const savedState = TabStateManager.loadTabState(theme.id)
    return savedState?.selectedNoteId || null
  })

  const [isTabStateInitialized, setIsTabStateInitialized] = useState(false)

  // Mark tab state as initialized after first render
  useEffect(() => {
    setIsTabStateInitialized(true)
  }, [])

  /* Handle noteId from navigation (e.g., from dashboard note click).
     Notes are a read mode now rather than a tab, so this sets BOTH halves:
     landing in Research on the thesis would leave the reader looking at the
     case while the note they clicked sat one control away. */
  useEffect(() => {
    if (theme.noteId && theme.id) {
      setActiveMode('research')
      setResearchRead('notes')
      setShowNoteEditor(true)
      setSelectedNoteId(theme.noteId)
    }
  }, [theme.id, theme.noteId])

  // Debug logging
  useEffect(() => {
  }, [showNoteEditor, selectedNoteId])

  // Save tab state when it changes
  useEffect(() => {
    if (isTabStateInitialized && theme.id) {
      /*
       * Two keys, because the mode and the read mode are two axes.
       *
       * `activeTab` keeps carrying an OLD section key, one per mode, so it
       * still round-trips through `themeModeOf` and a build without this
       * change reads it and lands somewhere sensible rather than on its
       * fallback. The read mode goes in its own key.
       *
       * Writing the read mode into `activeTab` was the first attempt and was
       * wrong: 'changes' is not one of the six old sections, so
       * `themeModeOf('changes')` falls through to 'overview' and a reader who
       * left the page on the change log came back to the Overview.
       */
      TabStateManager.saveTabState(theme.id, {
        activeTab: MODE_LEGACY_KEY[activeMode],
        themeResearchRead: researchRead,
        showNoteEditor,
        selectedNoteId
      })
    }
  }, [theme.id, activeMode, researchRead, showNoteEditor, selectedNoteId, isTabStateInitialized])
  const [showAddAssetModal, setShowAddAssetModal] = useState(false)
  const [showShareModal, setShowShareModal] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [invitePermission, setInvitePermission] = useState<'read' | 'write'>('read')
  const [deleteConfirm, setDeleteConfirm] = useState<{
    isOpen: boolean
    collaborationId: string | null
    userEmail: string
  }>({
    isOpen: false,
    collaborationId: null,
    userEmail: ''
  })
  const [showBulkRemoveConfirm, setShowBulkRemoveConfirm] = useState<{ isOpen: boolean; assetIds: string[] }>({ isOpen: false, assetIds: [] })
  const [showLifecycleDropdown, setShowLifecycleDropdown] = useState(false)
  const lifecycleDropdownRef = useRef<HTMLDivElement>(null)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const moreMenuRef = useRef<HTMLDivElement>(null)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const colorPickerRef = useRef<HTMLDivElement>(null)
  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(theme.name || '')
  const [isEditingDescription, setIsEditingDescription] = useState(false)
  // Type badge and description are revealed together from the header chevron.
  // The name itself is click-to-edit, so it cannot double as the disclosure.
  const isMobileViewport = useIsMobile()
  const [showThemeMeta, setShowThemeMeta] = useState(false)
  const [descriptionDraft, setDescriptionDraft] = useState(theme.description || '')
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const queryClient = useQueryClient()

  // Update local state when switching theme
  useEffect(() => {
    if (theme.id) {
      setNameDraft(theme.name || '')
      setDescriptionDraft(theme.description || '')
      setIsEditingName(false)
      setIsEditingDescription(false)
    }
  }, [theme.id, theme.name, theme.description])


  // ---------- Queries ----------
  const { data: notes } = useQuery({
    queryKey: ['theme-notes', theme.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_notes')
        .select('*')
        .eq('theme_id', theme.id)
        .neq('is_deleted', true)
        .order('updated_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: relatedAssets } = useQuery({
    queryKey: ['theme-related-assets', theme.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('theme_assets')
        .select(`
          *,
          assets(id, symbol, company_name, sector, industry, country, exchange, asset_type, currency, isin, figi, mic, identity_source, market_cap, current_price, lifecycle_status, current_symbol, lifecycle_checked_at, lifecycle_note, created_at, updated_at, created_by)
        `)
        .eq('theme_id', theme.id)
        .order('added_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Transform related assets for AssetTableView
  const themeAssets = useMemo(() => {
    if (!relatedAssets) return []
    return relatedAssets.map((ta: any) => ta.assets).filter(Boolean)
  }, [relatedAssets])

  /* The roster already knows every symbol, so the Overview's held-positions
     band is given a lookup rather than issuing its own asset query for names
     this page has in hand. */
  const symbolOf = useCallback(
    (assetId: string): string | null =>
      themeAssets.find((a: any) => a?.id === assetId)?.symbol ?? null,
    [themeAssets],
  )

  // Map asset ID to theme_asset ID for removal
  const assetToThemeAssetMap = useMemo(() => {
    const map = new Map<string, string>()
    relatedAssets?.forEach((ta: any) => {
      if (ta.assets?.id) {
        map.set(ta.assets.id, ta.id)
      }
    })
    return map
  }, [relatedAssets])

  // Partition into Held vs Watchlist by checking portfolio_holdings_positions
  const themeAssetIds = useMemo(() => themeAssets.map((a: any) => a.id).filter(Boolean), [themeAssets])
  const { heldIds, isLoading: isHeldLoading } = useHeldAssetIds(themeAssetIds)
  const { heldAssets, watchlistAssets } = useMemo(() => {
    const held: any[] = []
    const watch: any[] = []
    for (const a of themeAssets) {
      if (a?.id && heldIds.has(a.id)) held.push(a)
      else watch.push(a)
    }
    return { heldAssets: held, watchlistAssets: watch }
  }, [themeAssets, heldIds])

  // Bulk remove assets from theme mutation
  const bulkRemoveFromThemeMutation = useMutation({
    mutationFn: async (assetIds: string[]) => {
      const themeAssetIds = assetIds
        .map(assetId => assetToThemeAssetMap.get(assetId))
        .filter(Boolean) as string[]
      if (themeAssetIds.length === 0) throw new Error('No items to remove')
      const { error } = await supabase
        .from('theme_assets')
        .delete()
        .in('id', themeAssetIds)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-related-assets', theme.id] })
      setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })
    }
  })

  const handleBulkRemoveFromTheme = useCallback((assetIds: string[]) => {
    setShowBulkRemoveConfirm({ isOpen: true, assetIds })
  }, [])

  const handleOpenAsset = useCallback((asset: any) => {
    if (!asset?.id) return
    window.dispatchEvent(new CustomEvent('navigate-to-asset', {
      detail: {
        id: asset.id,
        title: asset.symbol || asset.name || 'Asset',
        type: 'asset',
        data: asset,
      }
    }))
  }, [])

  // Fetch owner details
  const { data: ownerDetails } = useQuery({
    queryKey: ['theme-owner', theme.created_by],
    queryFn: async () => {
      if (!theme.created_by) return null

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .eq('id', theme.created_by)
        .single()

      if (error) throw error
      return data
    },
    enabled: showShareModal && !!theme.created_by
  })

  // Fetch existing collaborations
  const { data: collaborations, isLoading: collaborationsLoading } = useQuery({
    queryKey: ['theme-collaborations', theme.id],
    queryFn: async () => {
      // First get collaborations
      const { data: collaborationsData, error: collaborationsError } = await supabase
        .from('theme_collaborations')
        .select('*')
        .eq('theme_id', theme.id)
        .order('created_at', { ascending: false })

      if (collaborationsError) throw collaborationsError
      if (!collaborationsData || collaborationsData.length === 0) return []

      // Get unique user IDs
      const userIds = [...new Set(collaborationsData.map((c: any) => c.user_id))]

      // Fetch user details separately
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .in('id', userIds)

      if (usersError) throw usersError

      // Combine the data
      const usersMap = new Map(usersData?.map(u => [u.id, u]) || [])

      return collaborationsData.map((collaboration: any) => ({
        ...collaboration,
        user: usersMap.get(collaboration.user_id)
      }))
    },
    enabled: showShareModal
  })

  // Search for users to invite
  const { data: searchResults } = useQuery({
    queryKey: ['user-search', searchQuery],
    queryFn: async () => {
      if (!searchQuery.trim() || searchQuery.length < 2) return []

      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .or(`email.ilike.%${searchQuery.toLowerCase()}%,first_name.ilike.%${searchQuery.toLowerCase()}%,last_name.ilike.%${searchQuery.toLowerCase()}%`)
        .neq('id', user?.id) // Exclude current user
        .limit(10)

      if (error) throw error

      // Filter out users who are already collaborators or the owner
      const existingUserIds = new Set(collaborations?.map((c: any) => c.user_id) || [])
      existingUserIds.add(theme.created_by) // Exclude the owner

      const filteredResults = data?.filter(u => !existingUserIds.has(u.id)) || []

      return filteredResults
    },
    enabled: showShareModal && searchQuery.length >= 2
  })

  // ---------- Mutation (safer: maybeSingle + diagnostics) ----------
  const updateThemeMutation = useMutation({
    mutationFn: async (updates: any) => {
      if (!theme?.id) throw new Error('Missing theme.id')

      const { error } = await supabase
        .from('themes')
        .update(updates)
        .eq('id', theme.id)

      if (error) {
        throw error
      }

      return { ...theme, ...updates }
    },
    onSuccess: (result) => {
      // Update the theme object directly
      Object.assign(theme, result)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['all-themes'] })
    },
    onError: (error) => {
      console.error('Theme update failed:', error)
    }
  })

  // ---------- Collaboration Mutations ----------
  const inviteUserMutation = useMutation({
    mutationFn: async ({ userId, permission }: { userId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .insert({
          theme_id: theme.id,
          user_id: userId,
          permission,
          invited_by: user?.id
        })

      if (error) throw error

      // Create notification for the invited user
      await supabase
        .from('notifications')
        .insert({
          user_id: userId,
          type: 'theme_shared',
          title: 'Theme Shared With You',
          message: `${user?.first_name || user?.email?.split('@')[0] || 'Someone'} shared the theme "${theme.name}" with you`,
          context_type: 'theme',
          context_id: theme.id,
          context_data: {
            theme_name: theme.name,
            theme_id: theme.id,
            shared_by: user?.id,
            permission
          }
        })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
      setSearchQuery('')
    }
  })

  const updatePermissionMutation = useMutation({
    mutationFn: async ({ collaborationId, permission }: { collaborationId: string; permission: 'read' | 'write' }) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .update({ permission })
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
    }
  })

  const removeCollaborationMutation = useMutation({
    mutationFn: async (collaborationId: string) => {
      const { error } = await supabase
        .from('theme_collaborations')
        .delete()
        .eq('id', collaborationId)

      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['theme-collaborations', theme.id] })
      setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })
    }
  })

  // ---------- Helpers ----------
  const handleInviteUser = (userId: string) => {
    inviteUserMutation.mutate({ userId, permission: invitePermission })
  }

  const handleUpdatePermission = (collaborationId: string, permission: 'read' | 'write') => {
    updatePermissionMutation.mutate({ collaborationId, permission })
  }

  const handleRemoveCollaboration = (collaborationId: string, userEmail: string) => {
    setDeleteConfirm({
      isOpen: true,
      collaborationId,
      userEmail
    })
  }

  const confirmRemoveCollaboration = () => {
    if (deleteConfirm.collaborationId) {
      removeCollaborationMutation.mutate(deleteConfirm.collaborationId)
    }
  }

  const getUserDisplayName = (user: any) => {
    if (!user) return 'Unknown User'

    if (user.first_name && user.last_name) {
      return `${user.first_name} ${user.last_name}`
    }

    return user.email?.split('@')[0] || 'Unknown User'
  }

  const getPermissionColor = (permission: string) => {
    switch (permission) {
      case 'write': return 'warning'
      case 'read': return 'success'
      default: return 'default'
    }
  }

  const handleLifecycleChange = (next: ThemeLifecycleStatus) => {
    if (next === (theme.lifecycle_status || 'active')) return
    updateThemeMutation.mutate({ lifecycle_status: next })
  }

  const handleColorChange = (next: string) => {
    if (next === theme.color) return
    updateThemeMutation.mutate({ color: next })
  }

  const commitName = () => {
    const trimmed = nameDraft.trim()
    if (!trimmed) {
      setNameDraft(theme.name || '')
      setIsEditingName(false)
      return
    }
    if (trimmed !== theme.name) {
      updateThemeMutation.mutate({ name: trimmed })
    }
    setIsEditingName(false)
  }

  const commitDescription = () => {
    const trimmed = descriptionDraft.trim()
    if (trimmed !== (theme.description || '')) {
      updateThemeMutation.mutate({ description: trimmed })
    }
    setIsEditingDescription(false)
  }

  const handleToggleArchive = () => {
    updateThemeMutation.mutate({ is_archived: !theme.is_archived })
    setShowMoreMenu(false)
  }

  const deleteThemeMutation = useMutation({
    mutationFn: async () => {
      if (!theme?.id) throw new Error('Missing theme.id')
      const { error } = await supabase.from('themes').delete().eq('id', theme.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-themes'] })
      setShowDeleteConfirm(false)
      window.dispatchEvent(new CustomEvent('close-tab', { detail: { tabId: theme.id } }))
    },
    onError: (error) => {
      console.error('Theme delete failed:', error)
    }
  })

  const handleNoteClick = useCallback((noteId: string) => {
    setSelectedNoteId(noteId)
    setShowNoteEditor(true)
  }, [])

  const handleNoteSelect = (noteId: string) => {
    setSelectedNoteId(noteId)
    // Ensure editor stays visible when selecting notes within the editor
    if (!showNoteEditor) {
      setShowNoteEditor(true)
    }
  }

  const handleCreateNote = () => {
    setSelectedNoteId(null)
    setShowNoteEditor(true)
  }

  const handleCloseNoteEditor = () => {
    setShowNoteEditor(false)
    setSelectedNoteId(null)
    queryClient.invalidateQueries({ queryKey: ['theme-notes', theme.id] })
  }

  const themeTypeOptions = [
    { value: 'general', label: 'General', dotColor: 'bg-gray-400' },
    { value: 'sector', label: 'Sector', dotColor: 'bg-blue-500' },
    { value: 'geography', label: 'Geography', dotColor: 'bg-green-500' },
    { value: 'strategy', label: 'Strategy', dotColor: 'bg-amber-500' },
    { value: 'macro', label: 'Macro', dotColor: 'bg-red-500' },
  ]

  const currentThemeType = themeTypeOptions.find(opt => opt.value === (theme.theme_type || 'general')) || themeTypeOptions[0]

  const lifecycleOptions: { value: ThemeLifecycleStatus; label: string; pillClass: string; dotClass: string }[] = [
    { value: 'emerging',    label: 'Emerging',     pillClass: 'bg-sky-50 text-sky-700 border-sky-200',       dotClass: 'bg-sky-500' },
    { value: 'active',      label: 'Active',       pillClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', dotClass: 'bg-emerald-500' },
    { value: 'playing_out', label: 'Playing Out',  pillClass: 'bg-amber-50 text-amber-700 border-amber-200', dotClass: 'bg-amber-500' },
    { value: 'played_out',  label: 'Played Out',   pillClass: 'bg-gray-100 text-gray-700 border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:bg-gray-800',   dotClass: 'bg-gray-500' },
    { value: 'invalidated', label: 'Invalidated',  pillClass: 'bg-rose-50 text-rose-700 border-rose-200',    dotClass: 'bg-rose-500' },
  ]
  const currentLifecycle = lifecycleOptions.find(o => o.value === (theme.lifecycle_status || 'active')) || lifecycleOptions[1]

  const colorOptions = [
    '#3b82f6', '#10b981', '#f59e0b', '#ef4444',
    '#8b5cf6', '#06b6d4', '#f97316', '#6b7280',
  ]

  // Close popovers on click outside
  useEffect(() => {
    if (!showLifecycleDropdown && !showMoreMenu && !showColorPicker) return
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node
      if (showLifecycleDropdown && lifecycleDropdownRef.current && !lifecycleDropdownRef.current.contains(target)) {
        setShowLifecycleDropdown(false)
      }
      if (showMoreMenu && moreMenuRef.current && !moreMenuRef.current.contains(target)) {
        setShowMoreMenu(false)
      }
      if (showColorPicker && colorPickerRef.current && !colorPickerRef.current.contains(target)) {
        setShowColorPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showLifecycleDropdown, showMoreMenu, showColorPicker])

  /**
   * The notes surface, unchanged from when it was its own tab.
   *
   * It is built here rather than inline in the JSX because it is no longer a
   * branch of this component's nav: it is handed to `ThemeResearchTab` as
   * `notesSlot` and rendered by the read-mode row inside that pane. Keeping
   * it in this file keeps the note queries, the editor state and the handlers
   * (`handleNoteClick`, `handleCreateNote`, `handleCloseNoteEditor`) where
   * they already live, so nothing about how notes behave changed -- only
   * where the reader finds them.
   */
  const notesSurface = showNoteEditor ? (
    <div className="space-y-4">
      <div className="flex items-center space-x-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleCloseNoteEditor}
          className="flex items-center"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Notes
        </Button>
      </div>
      <ThemeNoteEditor
        themeId={theme.id}
        themeName={theme.name}
        selectedNoteId={selectedNoteId ?? undefined}
        onNoteSelect={handleNoteSelect}
        onClose={handleCloseNoteEditor}
      />
    </div>
  ) : (
    <div className="space-y-6">
      {notes && notes.length > 0 && (
        <div className="flex items-center justify-between">
          <Button size="sm" onClick={handleCreateNote}>
            <Plus className="h-4 w-4 mr-2" />
            Add Note
          </Button>
        </div>
      )}
      {notes && notes.length > 0 ? (
        <div className="space-y-4">
          {notes.map((note) => (
            <Card
              key={note.id}
              padding="sm"
              className="cursor-pointer hover:shadow-md transition-shadow"
              onClick={() => handleNoteClick(note.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center space-x-2 mb-2">
                    <h4 className="font-semibold text-gray-900 dark:text-white">{note.title}</h4>
                    {note.note_type && (
                      <Badge variant="default" size="sm">
                        {note.note_type}
                      </Badge>
                    )}
                    {note.is_shared && (
                      <Badge variant="primary" size="sm">
                        Shared
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-gray-600 line-clamp-2 mb-2 dark:text-gray-400">
                    {getContentPreview(note.content || '', 150)}
                  </p>
                  <div className="flex items-center space-x-4 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex items-center">
                      <Calendar className="h-3 w-3 mr-1" />
                      {formatDistanceToNow(new Date(note.updated_at || 0), { addSuffix: true })}
                    </div>
                    <div className="flex items-center">
                      <User className="h-3 w-3 mr-1" />
                      You
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-gray-400 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white">No related notes</h3>
          <p className="text-gray-500 mb-4 dark:text-gray-400">Create notes to document your research and thoughts about this theme.</p>
          <Button size="sm" onClick={() => {
            handleCreateNote()
          }}>
            <Plus className="h-4 w-4 mr-2" />
            Add First Note
          </Button>
        </div>
      )}
    </div>
  )

  return (
    /*
     * ── The same shell as the Asset page ─────────────────────────────────
     *
     * This page used to be a `space-y-6` stack with the nav and content
     * inside a `<Card>`, which is why it never looked like the Asset page
     * however closely the controls inside it were matched: the Asset page is
     * a full-bleed workspace with a floating identity band, a sticky header
     * and ONE scrollport under it, and this was a card sitting in a padded
     * document.
     *
     * `ux2-scope` is the Asset page's scoped visual language
     * (`asset/asset-ux2.css`): the band surface, its hairline and shadow, the
     * ink levels, the strip dividers. It is opted into here rather than
     * copied, so the two pages cannot drift to two palettes. Nothing outside
     * a `.ux2-scope` root is affected, which is what that file's own note
     * asks for.
     *
     * The negative margins cancel Layout's content padding, which is
     * `px-3 py-4 sm:px-6 sm:py-6 lg:px-8`. They are written per breakpoint
     * rather than as the Asset page's flat `-mx-8 -my-6`, because that
     * over-pulls by 20px at phone width, and unlike the Asset page this one
     * has no separate mobile shell to hide it.
     */
    <div className="theme-ux2 ux2-scope flex flex-col bg-gray-50 dark:bg-gray-900 -mx-3 -my-4 sm:-mx-6 sm:-my-6 lg:-mx-8 h-[calc(100%+32px)] sm:h-[calc(100%+48px)] overflow-hidden">
      {/* Sticky header: identity band + mode nav, both out of the scroll. */}
      <div className="flex-shrink-0 sticky top-0 z-10 bg-gray-50 dark:bg-gray-900 px-3 sm:px-6 lg:px-8 pt-4 space-y-2 shadow-sm">
      {/* The identity band. Same treatment as `AssetWorkspaceHeader`: a solid
          surface floating over the grey content, meeting the tab bar with no
          gutter (-mt-4 pulls it up over the header's pt-4).

          Its CONTENTS are unchanged -- the swatch, click-to-rename, the type
          badge, the lifecycle pill, the description, Share and the overflow
          menu, and the phone's `showThemeMeta` disclosure all behave exactly
          as before. Only the surface they sit on is new, which is the whole
          point: this is a chrome pass, not a rewrite of the header. */}
      <div className="ux2-band -mx-3 sm:-mx-6 lg:-mx-8 -mt-4 px-3 sm:px-6 lg:px-8 pt-4 pb-3 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 flex-1 min-w-0">
          {/* Color swatch — display-only. Color is derived from
              theme_type (sector/macro/etc.), not user-picked. */}
          <div className="mt-1.5">
            <span
              className="block w-5 h-5 rounded-full border-2 border-white shadow-sm ring-1 ring-gray-200"
              style={{ backgroundColor: theme.color || '#3b82f6' }}
              title={`Color reflects this theme's type (${theme.theme_type || 'general'})`}
            />
          </div>

          <div className="min-w-0 flex-1">
            {/* Name row.

                Name and description on ONE baseline row, which is how the
                Asset band reads: the ticker, then the company name beside it
                in muted type. The description was a second line under the
                name, so the band spent two rows saying what the thing IS
                while the two pills that say how it is DOING sat up beside the
                name. Those have moved to the right, next to Share and the
                overflow, which is where the Asset band keeps everything that
                is not identity.

                `items-baseline`, not `items-center`: the description is
                smaller type than the name, and centring it leaves it floating
                off the name's baseline. */}
            <div className="flex items-baseline gap-3 flex-wrap">
              {isEditingName ? (
                <input
                  autoFocus
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitName() }
                    if (e.key === 'Escape') { setNameDraft(theme.name || ''); setIsEditingName(false) }
                  }}
                  className="text-lg sm:text-2xl font-bold text-gray-900 bg-white border border-primary-400 rounded px-2 py-0.5 min-w-0 focus:outline-none focus:ring-2 focus:ring-primary-300 dark:text-white dark:bg-gray-800"
                />
              ) : (
                /* On a phone the name is the disclosure for the theme's
                   details — type, status, description — which is what a tap
                   there is reaching for. Rename lives in the overflow menu at
                   that width; a tap-to-rename h1 is both undiscoverable and
                   easy to trigger by accident on touch. Desktop keeps
                   click-to-rename. */
                <button
                  type="button"
                  onClick={() => isMobileViewport ? setShowThemeMeta(v => !v) : setIsEditingName(true)}
                  aria-expanded={isMobileViewport ? showThemeMeta : undefined}
                  title={isMobileViewport ? 'Show theme details' : 'Click to rename'}
                  className="flex items-center gap-1.5 min-w-0 text-left rounded px-1 -mx-1 hover:bg-gray-50 dark:hover:bg-gray-800"
                >
                  <h1 className="text-lg sm:text-2xl font-bold text-gray-900 truncate dark:text-white">
                    {theme.name}
                  </h1>
                  <ChevronDown className={clsx(
                    'sm:hidden h-4 w-4 shrink-0 text-gray-400 transition-transform',
                    showThemeMeta && 'rotate-180',
                  )} />
                </button>
              )}

              {/* The description, beside the name rather than under it.

                  Still click-to-edit, and still inside the phone's
                  `showThemeMeta` reveal. `truncate` with a `max-w` so a long
                  description cannot push the band's right-hand controls off
                  the row; the whole of it is in the title. A button rather
                  than a `<p onClick>` because it is a control. */}
              {isEditingDescription ? (
                <input
                  autoFocus
                  value={descriptionDraft}
                  onChange={(e) => setDescriptionDraft(e.target.value)}
                  onBlur={commitDescription}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') { e.preventDefault(); commitDescription() }
                    if (e.key === 'Escape') { setDescriptionDraft(theme.description || ''); setIsEditingDescription(false) }
                  }}
                  placeholder="Add a short description..."
                  className="w-full sm:w-auto sm:min-w-[28ch] text-sm sm:text-base text-gray-700 bg-white border border-primary-400 rounded px-2 py-0.5 focus:outline-none focus:ring-2 focus:ring-primary-300 dark:text-gray-300 dark:bg-gray-800"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingDescription(true)}
                  title={theme.description || 'Click to edit description'}
                  className={clsx(
                    'min-w-0 max-w-[48ch] truncate text-left text-sm sm:text-base cursor-text hover:bg-gray-50 rounded px-1 -mx-1 dark:hover:bg-gray-800',
                    !showThemeMeta && 'hidden sm:block',
                    theme.description ? 'text-gray-600 dark:text-gray-400' : 'text-gray-400 italic'
                  )}
                >
                  {theme.description || 'Add a short description...'}
                </button>
              )}

              {theme.is_archived && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700 dark:text-gray-300">
                  <Archive className="w-3 h-3" />
                  Archived
                </span>
              )}
            </div>

          </div>
        </div>

        {/* Right side: Actions.

            "Add Assets" is gone from here — it was a header button that
            appeared and disappeared with the active tab, sat nowhere near the
            table it added to, and pushed Share and the overflow around as it
            came and went. Related Assets carries its own button, next to the
            list. See the related-assets panel below.

            On a phone Share collapses into the overflow rather than sitting
            beside it as a second, differently-shaped button; the menu itself
            becomes a sheet, because a 48px-wide popover of 32px rows anchored
            to the screen edge is not a touch menu. */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Type and lifecycle, on the RIGHT.

              They were beside the name, which put two pieces of status in the
              middle of the theme's identity and left the description pushed
              onto a second line to get out of their way. The Asset band
              divides the row the same way: what the thing is on the left,
              everything about its state and everything you can do to it on
              the right.

              Order is deliberate: type first because it never changes, then
              lifecycle because it does, then the actions. Both keep the
              phone's `showThemeMeta` reveal, so at 390px the band is still
              just the name and the controls. */}
          <span
            className={clsx(
              'inline-flex shrink-0 items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 border border-gray-200 dark:border-gray-700 dark:text-gray-300 dark:bg-gray-800',
              !showThemeMeta && 'hidden sm:inline-flex'
            )}
            title="Theme type (set at creation)"
          >
            <span className={clsx('w-1.5 h-1.5 rounded-full', currentThemeType.dotColor)} />
            {currentThemeType.label}
          </span>

          <div
            className={clsx('relative shrink-0', !showThemeMeta && 'hidden sm:block')}
            ref={lifecycleDropdownRef}
          >
            <button
              onClick={() => setShowLifecycleDropdown(s => !s)}
              className={clsx(
                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border transition-colors',
                currentLifecycle.pillClass
              )}
            >
              <span className={clsx('w-1.5 h-1.5 rounded-full', currentLifecycle.dotClass)} />
              {currentLifecycle.label}
            </button>
            {showLifecycleDropdown && (
              /* `right-0`, not `left-0`: the pill now sits near the right
                 edge of the band, and a menu opening rightwards from there
                 would hang off the page. */
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 dark:border-gray-700 dark:bg-gray-800">
                {lifecycleOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => { handleLifecycleChange(opt.value); setShowLifecycleDropdown(false) }}
                    className={clsx(
                      'w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors',
                      opt.value === (theme.lifecycle_status || 'active') ? 'bg-gray-50 font-medium text-gray-900 dark:text-white dark:bg-gray-900' : 'text-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 dark:text-gray-300'
                    )}
                  >
                    <span className={clsx('w-2 h-2 rounded-full', opt.dotClass)} />
                    {opt.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowShareModal(true)}
            className="hidden sm:inline-flex"
          >
            <Share2 className="h-4 w-4 mr-1" />
            Share
          </Button>
          <div className="relative" ref={moreMenuRef}>
            <button
              onClick={() => setShowMoreMenu(s => !s)}
              aria-haspopup="menu"
              aria-expanded={showMoreMenu}
              aria-label="More actions"
              className="flex items-center justify-center h-9 w-9 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 transition-colors dark:hover:bg-gray-800 dark:border-gray-700 dark:bg-gray-800"
            >
              <MoreVertical className="h-4 w-4 text-gray-600 dark:text-gray-400" />
            </button>

            {showMoreMenu && !isMobileViewport && (
              <div className="absolute right-0 top-full mt-1 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 dark:border-gray-700 dark:bg-gray-800">
                <ThemeActions
                  isArchived={!!theme.is_archived}
                  onToggleArchive={handleToggleArchive}
                  onDelete={() => { setShowMoreMenu(false); setShowDeleteConfirm(true) }}
                />
              </div>
            )}
          </div>

          {/* Collapse, in the band itself rather than on the page, exactly
              where the Asset page puts it. Collapsed keeps identity, Share,
              the overflow and the tabs below: a compact working bar. */}
          <button
            type="button"
            onClick={() => setHeaderCollapsed(v => !v)}
            aria-expanded={!headerCollapsed}
            aria-label={headerCollapsed ? 'Show theme context' : 'Hide theme context'}
            title={headerCollapsed ? 'Show theme context' : 'Hide theme context'}
            className="hidden sm:inline-flex items-center justify-center h-9 w-9 rounded-lg text-[color:var(--ux2-ink-2)] hover:bg-black/[0.04] dark:hover:bg-white/[0.06] transition-colors"
          >
            {headerCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* The context strip. Phone-hidden rather than squeezed: five facts in
          a 390px row is five truncated facts, and `showThemeMeta` already
          carries the theme's details at that width. */}
      {!headerCollapsed && (
        <div className="hidden sm:block">
          <ThemeContextStrip
            themeId={theme.id}
            assetIds={themeAssetIds}
            noteCount={notes?.length ?? 0}
            /* A cell names a fact; this is where the page resolves it. The
               Asset strip's own comment records what happens when the cell
               names a page instead: its Research cells landed wherever
               Research was last scrolled to. */
            onJump={({ mode, read }) => {
              setActiveMode(mode)
              if (read) setResearchRead(read)
            }}
          />
        </div>
      )}
      </div>

      {isMobileViewport && (
        <BottomSheet
          open={showMoreMenu}
          onClose={() => setShowMoreMenu(false)}
          title={theme.name}
          fitContent
        >
          <div className="py-1 pb-safe">
            <button
              onClick={() => { setShowMoreMenu(false); setIsEditingName(true) }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800"
            >
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              Rename theme
            </button>
            <button
              onClick={() => { setShowMoreMenu(false); setShowShareModal(true) }}
              className="w-full flex items-center gap-3 px-4 py-3 text-left text-sm text-gray-700 dark:text-gray-300 active:bg-gray-100 dark:active:bg-gray-800"
            >
              <Share2 className="h-4 w-4 shrink-0 text-gray-400" />
              Share
            </button>
            <ThemeActions
              mobile
              isArchived={!!theme.is_archived}
              onToggleArchive={handleToggleArchive}
              onDelete={() => { setShowMoreMenu(false); setShowDeleteConfirm(true) }}
            />
          </div>
        </BottomSheet>
      )}

        {/* Mode nav. In the sticky header now, not inside a Card: the Asset
            page's modes sit on the header's bottom edge and the active one is
            a white tab joined to the content below it. A bordered Card put a
            second frame around the whole workspace. */}
        <div className="border-b border-gray-200 dark:border-gray-700">
          {/*
            Four modes, asking one question: am I orienting, looking at the
            names, reading, or working. This was six peer sections, which
            asked the reader to know which FEATURE held the thing they wanted.

            The phone picker stays. Four fit a 390px row, so overflow is no
            longer the reason for it, but it is the accepted treatment on this
            and on Portfolio, and a picker that names the current mode in
            words beats three truncated icons. Desktop keeps the tab row.

            The row is still `overflow-x-auto no-scrollbar`. That was the
            defect when six items could not fit; with three it cannot trigger,
            and the class is left rather than churned.
          */}
          {isMobileViewport ? (
            <div className="flex items-center px-3 py-1.5">
              {/* Sized to its own label, not to the screen.

                  It was `w-full`, which stretched a 28px control across the
                  whole width and read as a large empty dropdown sitting over
                  the theme's modes, a permanent band that looked like it cost
                  more than it did. Compact, with "Section" dimmed in front of
                  the current one, it reads as a label you can change rather
                  than an empty control. */}
              <OptionPicker
                label="Theme section"
                prefix="Section"
                value={activeMode}
                onChange={setActiveMode}
                options={THEME_MODES.map(mode => ({
                  value: mode,
                  label: THEME_MODE_LABEL[mode],
                  /* The one count the desktop row carries, kept rather than
                     dropped on the phone. It moved with Related Assets, which
                     is on Assets, which is the mode it counts. */
                  count: mode === 'assets' && relatedAssets && relatedAssets.length > 0
                    ? relatedAssets.length
                    : undefined,
                }))}
              />
            </div>
          ) : (
          <nav className="flex space-x-1 overflow-x-auto no-scrollbar" aria-label="Theme modes">
            {/* One list, both controls. The six literal buttons that stood
                here could disagree with the phone picker beside them, which
                is exactly what the note above this nav warned about and then
                did anyway. Four modes still fit a 390px screen, so the
                overflow the picker exists for is close to moot.

                The styling is the Asset page's, not a second treatment: the
                active mode is a white tab with a top-and-sides border and
                `-mb-px`, so it sits ON the header's bottom edge and joins the
                content below instead of underlining a word above it. */}
            {THEME_MODES.map(mode => {
              const Icon = MODE_ICON[mode]
              const current = activeMode === mode
              return (
                <button
                  key={mode}
                  onClick={() => setActiveMode(mode)}
                  aria-current={current ? 'page' : undefined}
                  className={clsx(
                    'shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium rounded-t-lg transition-colors',
                    current
                      ? 'bg-white border-t border-l border-r border-gray-200 text-primary-600 -mb-px dark:border-gray-700 dark:bg-gray-800'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50 dark:hover:text-gray-200 dark:hover:bg-gray-800 dark:text-gray-400',
                  )}
                >
                  <div className="flex items-center space-x-2">
                    <Icon className="h-4 w-4" />
                    <span>{THEME_MODE_LABEL[mode]}</span>
                    {mode === 'assets' && (
                      /* The same count pill shape the Asset page's Work tab
                         uses, rather than this page's generic Badge, so the
                         two navs do not differ by a border radius.

                         ALWAYS rendered, and hidden rather than omitted when
                         there is nothing to count. `relatedAssets` arrives
                         from a query, so this used to be absent on first
                         paint and appear a moment later -- the pill plus the
                         row's `space-x-2` gap widened this tab by ~26px and
                         shoved Research and Work to the right on every single
                         load. An invisible element still occupies its box, so
                         the row is laid out once and never reflows: no shift
                         when the count arrives, and none when it turns out to
                         be zero either. */
                      <span
                        className={clsx(
                          'text-[10px] font-semibold bg-purple-100 text-purple-700 px-1.5 py-px rounded-full min-w-[18px] text-center dark:bg-purple-900/60 dark:text-purple-200',
                          !relatedAssets?.length && 'invisible',
                        )}
                      >
                        {relatedAssets?.length ?? 0}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </nav>
          )}
        </div>
      </div>

      {/* ONE scrollport under the sticky header, as on the Asset page. The
          header, the band and the nav stay put; only this moves. */}
      <div className="flex-1 overflow-auto px-3 sm:px-6 lg:px-8 py-4">
          {activeMode === 'research' && (
            <ThemeResearchTab
              themeId={theme.id}
              themeIsPublic={!!theme.is_public}
              /* Lifted out of the pane so the page can land on a read mode:
                 a note opened from the dashboard, or a tab saved on the old
                 Notes section, both have to arrive already on the notes. */
              readMode={researchRead}
              onReadModeChange={setResearchRead}
              notesSlot={notesSurface}
              notesCount={notes?.length ?? 0}
            />
          )}

          {/* ── Overview: where this theme stands ───────────────────────────
              A digest, and nothing else. Four bands, each a few rows deep,
              each handing off to the mode that owns the detail:

                the index chart       what the theme has done
                held in portfolios    what the firm has at risk in it
                notes                 what has been written lately
                activity              what has happened to it

              The roster is NOT here. It was, for one commit, and it was
              wrong: a sortable table with selection, bulk remove and its own
              Add control is a working surface, and stacking it under a chart
              and two digests made it something you scroll past everything
              else to reach. It is the Assets mode below.

              Nothing on this page is edited. Every row leaves. Two editable
              copies of one list is the duplication this restructure exists to
              reduce, not to spread. */}
          {activeMode === 'overview' && (
            <div className="space-y-8">
              <ThemeIndexChart
                symbols={themeAssets.map((a: any) => a.symbol).filter(Boolean)}
                themeName={theme.name}
              />

              <ThemeHeldPositions
                assetIds={themeAssetIds}
                symbolOf={symbolOf}
                onViewAll={() => setActiveMode('assets')}
              />

              <ThemeNotesDigest
                /* The same rows the Research pane's notes surface reads. A
                   second query for them under another key would be a second
                   cache entry free to disagree with the first. */
                notes={notes}
                onOpenNote={(noteId) => {
                  setActiveMode('research')
                  setResearchRead('notes')
                  handleNoteClick(noteId)
                }}
                onCreateNote={() => {
                  setActiveMode('research')
                  setResearchRead('notes')
                  handleCreateNote()
                }}
                onViewAll={() => {
                  setActiveMode('research')
                  setResearchRead('notes')
                }}
              />

              {/* Built long before this and rendered nowhere until now:
                  `theme_activity` carries 53 real rows and had no reader. */}
              <ThemeActivityFeed themeId={theme.id} />
            </div>
          )}

          {/* ── Assets: the names in the theme ─────────────────────────────
              Unchanged from when it was the Related Assets tab, and from the
              commit that briefly made it a band of Overview: the same table,
              the same selection and bulk remove, the same Add control beside
              the list it adds to rather than in the page header. Only the way
              in moved. */}
          {activeMode === 'assets' && (
            <div className="space-y-8">
              {(!relatedAssets || themeAssets.length === 0) ? (
                <div className="text-center py-12">
                  <TrendingUp className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                  <h3 className="text-lg font-medium text-gray-900 dark:text-white">No related assets</h3>
                  <p className="text-gray-500 mb-4 dark:text-gray-400">Assets related to this theme will appear here.</p>
                  <Button size="sm" onClick={() => setShowAddAssetModal(true)}>
                    <Plus className="h-4 w-4 mr-2" />
                    Add Related Asset
                  </Button>
                </div>
              ) : (
                <>
                  {/* Add lives with the lists it adds to, not in the page
                      header. The header button was the only way in once the
                      theme had any assets, so it moves here rather than
                      disappearing. */}
                  <div className="flex items-center justify-between gap-3 -mb-4">
                    <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
                      Related Assets
                      <span className="ml-2 text-xs font-normal text-gray-400 tabular-nums">
                        {themeAssets.length}
                      </span>
                    </h3>
                    <Button size="sm" variant="outline" onClick={() => setShowAddAssetModal(true)}>
                      <Plus className="h-4 w-4 mr-1" />
                      Add Assets
                    </Button>
                  </div>

                  {heldAssets.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Held</h3>
                        <Badge variant="success" size="sm">{heldAssets.length}</Badge>
                        <span className="text-xs text-gray-500 dark:text-gray-400">In at least one portfolio</span>
                      </div>
                      {/* The configurable grid does not resolve to 390px —
                          same reasoning as the Assets page. The phone gets the
                          watchlist list, which reads to find a name and open
                          it. Bulk "remove from theme" stays on desktop: it is a
                          multi-select destructive action and a list has nowhere
                          to put it. */}
                      {isMobileViewport ? (
                        <MobileAssetsList
                          assets={heldAssets}
                          isLoading={isHeldLoading}
                          onAssetSelect={handleOpenAsset}
                        />
                      ) : (
                      <AssetTableView
                        assets={heldAssets}
                        isLoading={isHeldLoading}
                        onAssetSelect={handleOpenAsset}
                        storageKey={`themeAssets_held_${theme.id}`}
                        onBulkAction={handleBulkRemoveFromTheme}
                        bulkActionLabel="Remove from Theme"
                        bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
                      />
                      )}
                    </section>
                  )}

                  {watchlistAssets.length > 0 && (
                    <section>
                      <div className="flex items-center gap-2 mb-3">
                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Watchlist</h3>
                        <Badge variant="default" size="sm">{watchlistAssets.length}</Badge>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Candidates to fish from</span>
                      </div>
                      {/* The configurable grid does not resolve to 390px —
                          same reasoning as the Assets page. The phone gets the
                          watchlist list, which reads to find a name and open
                          it. Bulk "remove from theme" stays on desktop: it is a
                          multi-select destructive action and a list has nowhere
                          to put it. */}
                      {isMobileViewport ? (
                        <MobileAssetsList
                          assets={watchlistAssets}
                          isLoading={isHeldLoading}
                          onAssetSelect={handleOpenAsset}
                        />
                      ) : (
                      <AssetTableView
                        assets={watchlistAssets}
                        isLoading={isHeldLoading}
                        onAssetSelect={handleOpenAsset}
                        storageKey={`themeAssets_watch_${theme.id}`}
                        onBulkAction={handleBulkRemoveFromTheme}
                        bulkActionLabel="Remove from Theme"
                        bulkActionIcon={<Trash2 className="h-4 w-4 mr-1" />}
                      />
                      )}
                    </section>
                  )}
                </>
              )}
            </div>
          )}

          {/* Notes are not a branch here any more. The surface is built once
              as `notesSurface` above and handed to the Research pane as
              `notesSlot`, because the read-mode row that reveals it lives
              inside that pane. */}

          {/* Discussion was a seventh surface for talking about a theme. It
              held ZERO posts across all 51 themes, so nothing was orphaned by
              removing it; the panel, the hook and the table are all gone now
              (20261104120000_drop_theme_discussions.sql, with a rollback
              beside it that recreates the schema but cannot recreate rows
              that never existed). */}
          {activeMode === 'work' && (
            <ThemeProcessesPanel themeId={theme.id} />
          )}

      </div>

      {/* Add Asset Modal */}
      <AddAssetToThemeModal
        isOpen={showAddAssetModal}
        onClose={() => setShowAddAssetModal(false)}
        themeId={theme.id}
        themeName={theme.name}
      />

      {/* Share Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowShareModal(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all dark:bg-gray-800">
              {/* Header */}
              <div className="flex items-center justify-between p-3 sm:p-6 border-b border-gray-200 dark:border-gray-700">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Manage Collaborators</h3>
                  <p className="text-sm text-gray-600 mt-1 dark:text-gray-400">Share "{theme.name}" with other users</p>
                </div>
                <button
                  onClick={() => setShowShareModal(false)}
                  className="text-gray-400 hover:text-gray-600 transition-colors dark:hover:text-gray-300"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="p-3 sm:p-6 space-y-6">
                {/* Public/Private Toggle */}
                <Card>
                  <div className="p-4 bg-gray-50 rounded-lg dark:bg-gray-900">
                    <label className="flex items-center">
                      <input
                        type="checkbox"
                        checked={theme.is_public || false}
                        onChange={(e) => {
                          updateThemeMutation.mutate({ is_public: e.target.checked })
                        }}
                        className="mr-2 rounded"
                      />
                      <span className="text-sm text-gray-700 font-medium dark:text-gray-300">
                        Make public (visible to all users)
                      </span>
                    </label>
                    <p className="text-xs text-gray-500 mt-2 dark:text-gray-400">
                      {theme.is_public
                        ? 'This theme is visible to everyone.'
                        : 'This theme is private. Share with specific users below.'
                      }
                    </p>
                  </div>
                </Card>

                {/* Theme Owner */}
                {ownerDetails && (
                  <Card>
                    <h4 className="text-sm font-semibold text-gray-900 mb-4 dark:text-white">Theme Owner</h4>
                    <div className="flex items-center space-x-3 p-3 border border-gray-200 rounded-lg bg-gray-50 dark:border-gray-700 dark:bg-gray-900">
                      <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                        <Users className="h-4 w-4 text-primary-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {getUserDisplayName(ownerDetails)}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">{ownerDetails.email}</p>
                      </div>
                      <Badge variant="primary" size="sm" className="ml-auto">Owner</Badge>
                    </div>
                  </Card>
                )}

                {/* Invite New User */}
                {!theme.is_public && (
                  <Card>
                    <h4 className="text-sm font-semibold text-gray-900 mb-4 dark:text-white">Invite New Collaborator</h4>

                    <div className="space-y-4">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                        <input
                          type="text"
                          placeholder="Search by email or name..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:border-gray-600"
                        />
                      </div>
                      {searchQuery.length >= 2 && (
                        <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto dark:border-gray-700">
                          {searchResults && searchResults.length > 0 ? (
                            searchResults.map((searchUser: any) => (
                              <div
                                key={searchUser.id}
                                className="flex items-center justify-between p-3 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 dark:hover:bg-gray-800 dark:border-gray-800"
                              >
                                <div>
                                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                                    {searchUser.first_name && searchUser.last_name
                                      ? `${searchUser.first_name} ${searchUser.last_name}`
                                      : getUserDisplayName(searchUser)
                                    }
                                  </p>
                                  <p className="text-xs text-gray-500 dark:text-gray-400">{searchUser.email}</p>
                                </div>
                                <div className="flex items-center space-x-2">
                                  <select
                                    value={invitePermission}
                                    onChange={(e) => setInvitePermission(e.target.value as 'read' | 'write')}
                                    className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 dark:border-gray-600"
                                  >
                                    <option value="read">Read Only</option>
                                    <option value="write">Read & Write</option>
                                  </select>
                                  <Button
                                    size="sm"
                                    onClick={() => handleInviteUser(searchUser.id)}
                                    disabled={inviteUserMutation.isPending}
                                  >
                                    <Plus className="h-3 w-3 mr-1" />
                                    Invite
                                  </Button>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="flex items-center justify-center py-8 text-center text-gray-500 text-sm dark:text-gray-400">
                              No users found matching "{searchQuery}"
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                )}

                {/* Current Collaborators */}
                {!theme.is_public && (
                  <Card>
                    <div className="flex items-center justify-between mb-4">
                      <h4 className="text-sm font-semibold text-gray-900 dark:text-white">Current Collaborators</h4>
                      {collaborations && (
                        <Badge variant="default" size="sm">
                          {collaborations.filter((c: any) => c.user_id !== theme.created_by).length} collaborator
                          {collaborations.filter((c: any) => c.user_id !== theme.created_by).length !== 1 ? 's' : ''}
                        </Badge>
                      )}
                    </div>

                    {collaborationsLoading ? (
                      <div className="space-y-3">
                        {[...Array(2)].map((_, i) => (
                          <div key={i} className="animate-pulse flex items-center space-x-3">
                            <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
                            <div className="flex-1 space-y-2">
                              <div className="h-4 bg-gray-200 rounded w-1/3"></div>
                              <div className="h-3 bg-gray-200 rounded w-1/2"></div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : collaborations && collaborations.filter((c: any) => c.user_id !== theme.created_by).length > 0 ? (
                      <div className="space-y-3">
                        {collaborations.filter((c: any) => c.user_id !== theme.created_by).map((collaboration: any) => (
                          <div
                            key={collaboration.id}
                            className="flex items-center justify-between p-3 border border-gray-200 rounded-lg dark:border-gray-700"
                          >
                            <div className="flex items-center space-x-3">
                              <div className="w-8 h-8 bg-primary-100 rounded-full flex items-center justify-center">
                                <Users className="h-4 w-4 text-primary-600" />
                              </div>
                              <div>
                                <p className="text-sm font-medium text-gray-900 dark:text-white">
                                  {getUserDisplayName(collaboration.user)}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">{collaboration.user?.email}</p>
                              </div>
                            </div>

                            <div className="flex items-center space-x-2">
                              <select
                                value={collaboration.permission}
                                onChange={(e) => handleUpdatePermission(collaboration.id, e.target.value as any)}
                                className="text-xs px-2 py-1 border border-gray-300 rounded focus:ring-1 focus:ring-primary-500 dark:border-gray-600"
                                disabled={updatePermissionMutation.isPending}
                              >
                                <option value="read">Read Only</option>
                                <option value="write">Read & Write</option>
                              </select>

                              <Badge variant={getPermissionColor(collaboration.permission)} size="sm">
                                {collaboration.permission}
                              </Badge>

                              <button
                                onClick={() => handleRemoveCollaboration(collaboration.id, collaboration.user?.email || 'Unknown')}
                                className="p-1 text-gray-400 hover:text-error-600 transition-colors"
                                disabled={removeCollaborationMutation.isPending}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center py-8 text-gray-500 dark:text-gray-400">
                        <Users className="h-8 w-8 text-gray-400 mx-auto mb-2" />
                        <p className="text-sm">No collaborators yet</p>
                        <p className="text-xs">Search for users above to start collaborating</p>
                      </div>
                    )}
                  </Card>
                )}
              </div>

              {/* Footer */}
              <div className="flex justify-end space-x-3 p-3 sm:p-6 border-t border-gray-200 dark:border-gray-700">
                <Button variant="outline" onClick={() => setShowShareModal(false)}>
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation */}
      {deleteConfirm.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-3 sm:p-6 dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">Remove Collaborator</h3>
              <p className="text-gray-600 mb-4 dark:text-gray-400">
                Are you sure you want to remove {deleteConfirm.userEmail} from this theme? They will no longer be able to access it.
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setDeleteConfirm({ isOpen: false, collaborationId: null, userEmail: '' })}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={confirmRemoveCollaboration}
                  className="flex-1"
                  loading={removeCollaborationMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Theme Confirmation */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-3 sm:p-6 dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">Delete Theme</h3>
              <p className="text-gray-600 mb-4 dark:text-gray-400">
                Delete "{theme.name}"? This removes the theme and its asset associations. Related notes and projects are kept.
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => deleteThemeMutation.mutate()}
                  className="flex-1"
                  loading={deleteThemeMutation.isPending}
                >
                  Delete
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Remove from Theme Confirmation */}
      {showBulkRemoveConfirm.isOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-3 sm:p-6 dark:bg-gray-800">
              <h3 className="text-lg font-semibold text-gray-900 mb-2 dark:text-white">Remove Assets from Theme</h3>
              <p className="text-gray-600 mb-4 dark:text-gray-400">
                Are you sure you want to remove {showBulkRemoveConfirm.assetIds.length} asset{showBulkRemoveConfirm.assetIds.length !== 1 ? 's' : ''} from this theme?
              </p>
              <div className="flex space-x-3">
                <Button
                  variant="outline"
                  onClick={() => setShowBulkRemoveConfirm({ isOpen: false, assetIds: [] })}
                  className="flex-1"
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => bulkRemoveFromThemeMutation.mutate(showBulkRemoveConfirm.assetIds)}
                  className="flex-1"
                  loading={bulkRemoveFromThemeMutation.isPending}
                >
                  Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}