import React, { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import {
  Users,
  Building2,
  Globe,
  Loader2,
  Briefcase,
  FolderTree,
  Edit3,
  History,
  Sparkles,
  List,
  ChevronDown,
  ChevronUp,
  Trash2,
  Save,
  X,
  Check,
  Bold,
  Italic,
  ListOrdered,
  Link,
  Link2,
  Heading2,
  Undo2,
  Redo2,
  Star,
  FileText,
  Plus,
  File,
  FileEdit,
  Upload,
  RotateCcw
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../hooks/useAuth'
import {
  useContributions,
  useContributionHistory,
  useAggregateHistory,
  useThesisAnalysis,
  type ContributionVisibility,
  type ContributionAttachment
} from '../../hooks/useContributions'
import { ThesisSummaryView } from './ThesisSummaryView'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { InfoTooltip } from '../ui/Tooltip'
import { supabase } from '../../lib/supabase'
import { useQuery } from '@tanstack/react-query'
import { DiffView } from './DiffView'
import { UniversalSmartInput, SmartInputRenderer, type SmartInputMetadata } from '../smart-input'
import type { UniversalSmartInputRef } from '../smart-input'

type TabType = 'aggregated' | string

interface ContributionSectionProps {
  assetId: string
  section: string
  title: string
  description?: string
  icon?: React.ElementType
  className?: string
  defaultVisibility?: ContributionVisibility
  activeTab?: TabType
  onTabChange?: (tab: TabType) => void
  coveringAnalystIds?: Set<string>
  /** Hide the All/Summary/History buttons (when controlled from parent level) */
  hideViewModeButtons?: boolean
  /** Hide visibility controls (when controlled from parent level) */
  hideVisibility?: boolean
  /** Shared visibility from parent (used when hideVisibility is true) */
  sharedVisibility?: ContributionVisibility
  /** Shared target IDs from parent */
  sharedTargetIds?: string[]
  /** Section type for color theming */
  sectionType?: 'thesis' | 'forecasts' | 'supporting' | 'custom'
  /** Flat mode: removes section wrapper and header, shows only content (for aggregated view) */
  flatMode?: boolean
  /** Hide this section entirely when there are no contributions */
  hideWhenEmpty?: boolean
}

// Section color themes - unified blue accent with amber hover
const SECTION_THEMES = {
  thesis: {
    accent: 'border-l-blue-400',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    hoverBorder: 'hover:border-amber-200',
    hoverBg: 'hover:bg-amber-50/30',
  },
  forecasts: {
    accent: 'border-l-blue-400',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    hoverBorder: 'hover:border-amber-200',
    hoverBg: 'hover:bg-amber-50/30',
  },
  supporting: {
    accent: 'border-l-blue-400',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    hoverBorder: 'hover:border-amber-200',
    hoverBg: 'hover:bg-amber-50/30',
  },
  custom: {
    accent: 'border-l-blue-400',
    iconBg: 'bg-blue-50',
    iconColor: 'text-blue-600',
    hoverBorder: 'hover:border-amber-200',
    hoverBg: 'hover:bg-amber-50/30',
  },
} as const

const VISIBILITY_OPTIONS: { value: ContributionVisibility; label: string; icon: React.ElementType; description: string }[] = [
  { value: 'firm', label: 'Firm-wide', icon: Globe, description: 'Everyone in the firm can see this' },
  { value: 'division', label: 'Division', icon: Building2, description: 'Visible to your division' },
  { value: 'department', label: 'Department', icon: FolderTree, description: 'Visible to your department' },
  { value: 'team', label: 'Team', icon: Users, description: 'Visible to your team' },
  { value: 'portfolio', label: 'Portfolio', icon: Briefcase, description: 'Only your portfolio can see this' }
]

const VISIBILITY_CONFIG: Record<ContributionVisibility, { icon: React.ElementType; label: string; color: string; bgColor: string }> = {
  portfolio: { icon: Briefcase, label: 'Portfolio', color: 'text-indigo-600', bgColor: 'bg-indigo-50' },
  team: { icon: Users, label: 'Team', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  department: { icon: FolderTree, label: 'Dept', color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  division: { icon: Building2, label: 'Division', color: 'text-purple-600', bgColor: 'bg-purple-50' },
  firm: { icon: Globe, label: 'Firm', color: 'text-green-600', bgColor: 'bg-green-50' }
}

// Component to view references in read mode
function ViewReferences({
  attachments
}: {
  attachments: ContributionAttachment[]
}) {
  if (attachments.length === 0) return null

  return (
    <div className="pt-3 border-t border-gray-100">
      <div className="text-xs font-medium text-gray-500 mb-2">References</div>
      <div className="flex flex-wrap gap-2">
        {attachments.map((attachment, index) => (
          <div
            key={index}
            className={clsx(
              'flex items-center gap-1.5 px-2 py-1 rounded-md text-xs',
              attachment.type === 'link' && 'bg-blue-50 text-blue-700',
              attachment.type === 'note' && 'bg-amber-50 text-amber-700',
              attachment.type === 'file' && 'bg-purple-50 text-purple-700'
            )}
          >
            {attachment.type === 'link' && <Link2 className="w-3 h-3 shrink-0" />}
            {attachment.type === 'note' && <FileText className="w-3 h-3 shrink-0" />}
            {attachment.type === 'file' && <File className="w-3 h-3 shrink-0" />}
            {attachment.type === 'link' && attachment.url ? (
              <a
                href={attachment.url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline truncate max-w-[150px]"
              >
                {attachment.title}
              </a>
            ) : (
              <span className="truncate max-w-[150px]">{attachment.title}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function ContributionSection({
  assetId,
  section,
  title,
  description,
  icon: Icon,
  className,
  defaultVisibility = 'firm',
  activeTab = 'aggregated',
  onTabChange,
  coveringAnalystIds = new Set(),
  hideViewModeButtons = false,
  hideVisibility = false,
  sharedVisibility,
  sharedTargetIds = [],
  sectionType = 'thesis',
  flatMode = false,
  hideWhenEmpty = false
}: ContributionSectionProps) {
  // Get theme based on section type
  const theme = SECTION_THEMES[sectionType]
  const { user } = useAuth()
  const [viewMode, setViewMode] = useState<'combined' | 'ai'>('combined')
  const [showHistory, setShowHistory] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [undoStack, setUndoStack] = useState<string[]>([])
  const [redoStack, setRedoStack] = useState<string[]>([])
  const isUndoRedoRef = useRef(false)
  const [selectedVisibility, setSelectedVisibility] = useState<ContributionVisibility>(defaultVisibility)
  const [showVisibilityDropdown, setShowVisibilityDropdown] = useState(false)
  const [selectedTargetIds, setSelectedTargetIds] = useState<string[]>([])
  const [showTeamDropdown, setShowTeamDropdown] = useState(false)
  const [showVisibilityChange, setShowVisibilityChange] = useState(false)
  const [visibilityChangeStep, setVisibilityChangeStep] = useState<'level' | 'targets'>('level')
  const [pendingVisibility, setPendingVisibility] = useState<ContributionVisibility | null>(null)
  const [isHovered, setIsHovered] = useState(false)
  const [pendingTargetIds, setPendingTargetIds] = useState<string[]>([])
  const [editingContributionId, setEditingContributionId] = useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [stableButtonText, setStableButtonText] = useState<string | null>(null)
  const [inputMetadata, setInputMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
  const [isDraftMode, setIsDraftMode] = useState(false) // When true, save goes to draft instead of publish
  const [viewingDraft, setViewingDraft] = useState(false) // When true, show draft content instead of published
  const [showDiscardConfirm, setShowDiscardConfirm] = useState(false) // Show discard draft confirmation dialog
  const smartInputRef = useRef<UniversalSmartInputRef>(null)
  const visibilityRef = useRef<HTMLDivElement>(null)
  const teamRef = useRef<HTMLDivElement>(null)
  const visibilityChangeRef = useRef<HTMLDivElement>(null)

  const {
    contributions,
    myContribution,
    isLoading,
    isFetching,
    error,
    saveContribution,
    deleteContribution,
    updateVisibility,
    saveDraft,
    publishDraft,
    discardDraft
  } = useContributions({
    assetId,
    section
  })

  // Hide section if no contributions and hideWhenEmpty is true
  if (hideWhenEmpty && !isLoading && contributions.length === 0) {
    return null
  }

  const { history: aggregateHistory, isLoading: historyLoading } = useAggregateHistory({
    assetId,
    section
  })

  const selectedContribution = activeTab !== 'aggregated'
    ? contributions.find(c => c.created_by === activeTab)
    : null

  const { history: individualHistory } = useContributionHistory(selectedContribution?.id)

  // Thesis analysis for AI summary view
  const {
    analysis: thesisAnalysis,
    isLoading: analysisLoading,
    isGenerating: analysisGenerating,
    isStale: analysisStale,
    isConfigured: aiConfigured,
    error: analysisError,
    generateAnalysis,
    regenerateAnalysis
  } = useThesisAnalysis({
    assetId,
    section,
    contributions,
    coveringAnalystIds
  })

  // Get asset info for smart input context
  const { data: assetInfo } = useQuery({
    queryKey: ['asset-info', assetId],
    queryFn: async () => {
      const { data } = await supabase
        .from('assets')
        .select('id, symbol, company_name')
        .eq('id', assetId)
        .single()
      return data
    },
    enabled: !!assetId
  })

  const assetContext = assetInfo ? { id: assetInfo.id, symbol: assetInfo.symbol } : null

  // Get user's org chart context
  const { data: userOrgContext } = useQuery({
    queryKey: ['user-org-context', user?.id],
    queryFn: async () => {
      const { data: memberships } = await supabase
        .from('org_chart_node_members')
        .select('node_id, org_chart_nodes(id, name, color, node_type, parent_id)')
        .eq('user_id', user?.id)

      if (!memberships) return { portfolios: [], teams: [], departments: [], divisions: [] }

      const directNodes = memberships
        .map(m => m.org_chart_nodes as { id: string; name: string; color: string; node_type: string; parent_id: string | null })
        .filter(Boolean)

      const { data: allNodes } = await supabase
        .from('org_chart_nodes')
        .select('id, name, color, node_type, parent_id')

      if (!allNodes) return { portfolios: [], teams: [], departments: [], divisions: [] }

      const nodeMap = new Map(allNodes.map(n => [n.id, n]))
      const teamsSet = new Map<string, typeof allNodes[0]>()
      const departmentsSet = new Map<string, typeof allNodes[0]>()
      const divisionsSet = new Map<string, typeof allNodes[0]>()

      const traverseUp = (nodeId: string | null) => {
        if (!nodeId) return
        const node = nodeMap.get(nodeId)
        if (!node) return
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        else if (node.node_type === 'department') departmentsSet.set(node.id, node)
        else if (node.node_type === 'division') divisionsSet.set(node.id, node)
        traverseUp(node.parent_id)
      }

      directNodes.forEach(node => {
        if (node.node_type === 'team') teamsSet.set(node.id, node)
        traverseUp(node.parent_id)
      })

      const portfolios = directNodes.filter(n => n.node_type === 'portfolio').sort((a, b) => a.name.localeCompare(b.name))
      const teams = Array.from(teamsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const departments = Array.from(departmentsSet.values()).sort((a, b) => a.name.localeCompare(b.name))
      const divisions = Array.from(divisionsSet.values()).sort((a, b) => a.name.localeCompare(b.name))

      return { portfolios, teams, departments, divisions }
    },
    enabled: !!user?.id
  })

  const getTargetOptions = (visibility: ContributionVisibility) => {
    if (!userOrgContext) return []
    switch (visibility) {
      case 'firm': return []
      case 'division': return userOrgContext.divisions
      case 'department': return userOrgContext.departments
      case 'team': return userOrgContext.teams
      case 'portfolio': return userOrgContext.portfolios
      default: return []
    }
  }

  const targetOptions = getTargetOptions(selectedVisibility)
  const pendingTargetOptions = getTargetOptions(pendingVisibility || 'firm')

  useEffect(() => {
    setSelectedTargetIds([])
  }, [selectedVisibility])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (visibilityRef.current && !visibilityRef.current.contains(event.target as Node)) {
        setShowVisibilityDropdown(false)
      }
      if (teamRef.current && !teamRef.current.contains(event.target as Node)) {
        setShowTeamDropdown(false)
      }
      if (visibilityChangeRef.current && !visibilityChangeRef.current.contains(event.target as Node)) {
        resetVisibilityChangeState()
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (isEditing && smartInputRef.current) {
      smartInputRef.current.focus()
    }
  }, [isEditing])

  // Only update button text when not fetching to prevent flash
  useEffect(() => {
    if (!isFetching && !isLoading) {
      setHasLoadedOnce(true)
      setStableButtonText(myContribution ? 'Edit' : 'Add View')
    }
  }, [isFetching, isLoading, myContribution])

  // Check if there's an unpublished draft
  const hasDraft = myContribution?.draft_content !== null && myContribution?.draft_content !== undefined

  const handleStartEdit = () => {
    // If there's a draft, load the draft content and enable draft mode
    if (hasDraft) {
      setEditContent(myContribution?.draft_content || '')
      setIsDraftMode(true)
    } else {
      setEditContent(myContribution?.content || '')
      setIsDraftMode(false)
    }
    setSelectedVisibility(myContribution?.visibility || defaultVisibility)
    setUndoStack([])
    setRedoStack([])
    setIsEditing(true)
    if (onTabChange && user?.id) {
      onTabChange(user.id)
    }
  }

  const handleSave = async () => {
    if (!editContent.trim()) return

    // Use shared visibility if controlled from parent, otherwise use local state
    const visibilityToUse = hideVisibility && sharedVisibility ? sharedVisibility : selectedVisibility
    const targetIdsToUse = hideVisibility && sharedTargetIds ? sharedTargetIds : selectedTargetIds

    await saveContribution.mutateAsync({
      content: editContent.trim(),
      sectionKey: section,
      visibility: visibilityToUse,
      targetIds: targetIdsToUse
    })

    setIsEditing(false)
    setEditContent('')
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditContent('')
    setViewingDraft(false) // Go back to published view
  }

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete your view?')) {
      await deleteContribution.mutateAsync()
      if (onTabChange) {
        onTabChange('aggregated')
      }
    }
  }

  // Save as draft without publishing
  const handleSaveDraft = async () => {
    if (!editContent.trim()) return

    await saveDraft.mutateAsync({
      content: editContent.trim(),
      sectionKey: section
    })

    setIsEditing(false)
    setEditContent('')
    setIsDraftMode(false)
    setViewingDraft(false) // Go back to published view
  }

  // Publish draft content
  const handlePublishDraft = async () => {
    // Use shared visibility if controlled from parent, otherwise use local state
    const visibilityToUse = hideVisibility && sharedVisibility ? sharedVisibility : selectedVisibility
    const targetIdsToUse = hideVisibility && sharedTargetIds ? sharedTargetIds : selectedTargetIds

    await publishDraft.mutateAsync({
      sectionKey: section,
      visibility: visibilityToUse,
      targetIds: targetIdsToUse
    })

    setIsEditing(false)
    setEditContent('')
    setIsDraftMode(false)
  }

  // Discard draft and revert to published content
  const handleDiscardDraft = async () => {
    setShowDiscardConfirm(true)
  }

  const confirmDiscardDraft = async () => {
    await discardDraft.mutateAsync({
      sectionKey: section
    })

    setShowDiscardConfirm(false)
    setIsEditing(false)
    setEditContent('')
    setIsDraftMode(false)
    setViewingDraft(false) // Go back to published view
  }

  const handleVisibilityLevelSelect = (newVisibility: ContributionVisibility) => {
    const targets = getTargetOptions(newVisibility)
    if (newVisibility === 'firm' || targets.length === 0) {
      // No targets needed, save immediately
      if (editingContributionId) {
        handleVisibilityChangeSave(editingContributionId, newVisibility, [])
      }
    } else {
      // Show target selection step
      setPendingVisibility(newVisibility)
      setPendingTargetIds([])
      setVisibilityChangeStep('targets')
    }
  }

  const handleVisibilityChangeSave = async (contributionId: string, visibility: ContributionVisibility, targetIds: string[]) => {
    try {
      console.log('handleVisibilityChangeSave called:', { contributionId, visibility, targetIds, myContribution })
      await updateVisibility.mutateAsync({
        contributionId,
        visibility,
        targetIds
      })
      console.log('Visibility change saved successfully')
      resetVisibilityChangeState()
    } catch (error) {
      console.error('Failed to save visibility change:', error)
      alert('Failed to save visibility change. Please try again.')
    }
  }

  const resetVisibilityChangeState = () => {
    setShowVisibilityChange(false)
    setVisibilityChangeStep('level')
    setPendingVisibility(null)
    setPendingTargetIds([])
    setEditingContributionId(null)
  }

  // Text formatting helpers
  const insertFormatting = (before: string, after: string = before, placeholder: string = '') => {
    const textarea = smartInputRef.current?.getTextarea()
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = editContent.substring(start, end)
    const textToWrap = selectedText || placeholder

    const newContent =
      editContent.substring(0, start) +
      before + textToWrap + after +
      editContent.substring(end)

    handleContentChange(newContent)

    // Set cursor position after update
    setTimeout(() => {
      textarea.focus()
      if (selectedText) {
        // If text was selected, select the wrapped text
        textarea.setSelectionRange(start + before.length, start + before.length + textToWrap.length)
      } else {
        // If no text was selected, place cursor after the placeholder
        textarea.setSelectionRange(start + before.length, start + before.length + placeholder.length)
      }
    }, 0)
  }

  const insertListItem = (prefix: string) => {
    const textarea = smartInputRef.current?.getTextarea()
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = editContent.substring(start, end)

    // Check if we're at the start of a line or need a newline
    const beforeCursor = editContent.substring(0, start)
    const needsNewline = beforeCursor.length > 0 && !beforeCursor.endsWith('\n')

    let newContent: string
    if (selectedText) {
      // Convert selected lines to list items
      const lines = selectedText.split('\n')
      const listItems = lines.map((line, i) => {
        const itemPrefix = prefix === '1. ' ? `${i + 1}. ` : prefix
        return itemPrefix + line
      }).join('\n')
      newContent = editContent.substring(0, start) + (needsNewline ? '\n' : '') + listItems + editContent.substring(end)
    } else {
      // Insert a single list item
      newContent = editContent.substring(0, start) + (needsNewline ? '\n' : '') + prefix + editContent.substring(end)
    }

    handleContentChange(newContent)

    setTimeout(() => {
      textarea.focus()
      const newCursorPos = start + (needsNewline ? 1 : 0) + prefix.length + (selectedText ? selectedText.length : 0)
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
  }

  const formatBold = () => insertFormatting('**', '**', 'bold text')
  const formatItalic = () => insertFormatting('*', '*', 'italic text')
  const formatHeading = () => insertFormatting('## ', '\n', 'Heading')
  const formatBulletList = () => insertListItem('- ')
  const formatNumberedList = () => insertListItem('1. ')
  const formatLink = () => {
    const textarea = smartInputRef.current?.getTextarea()
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = editContent.substring(start, end)

    if (selectedText) {
      // Wrap selected text as link text
      insertFormatting('[', '](url)', '')
    } else {
      insertFormatting('[', '](url)', 'link text')
    }
  }

  // Content change handler with undo history
  const handleContentChange = (newContent: string) => {
    if (!isUndoRedoRef.current) {
      setUndoStack(prev => [...prev, editContent])
      setRedoStack([]) // Clear redo stack on new changes
    }
    isUndoRedoRef.current = false
    setEditContent(newContent)
  }

  const handleUndo = () => {
    if (undoStack.length === 0) return
    const previousContent = undoStack[undoStack.length - 1]
    setUndoStack(prev => prev.slice(0, -1))
    setRedoStack(prev => [...prev, editContent])
    isUndoRedoRef.current = true
    setEditContent(previousContent)

    // Refocus textarea
    setTimeout(() => smartInputRef.current?.focus(), 0)
  }

  const handleRedo = () => {
    if (redoStack.length === 0) return
    const nextContent = redoStack[redoStack.length - 1]
    setRedoStack(prev => prev.slice(0, -1))
    setUndoStack(prev => [...prev, editContent])
    isUndoRedoRef.current = true
    setEditContent(nextContent)

    // Refocus textarea
    setTimeout(() => smartInputRef.current?.focus(), 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleCancel()
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      handleSave()
    } else if (e.key === 'b' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      formatBold()
    } else if (e.key === 'i' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      formatItalic()
    } else if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault()
      handleUndo()
    } else if ((e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey) ||
               (e.key === 'y' && (e.metaKey || e.ctrlKey))) {
      e.preventDefault()
      handleRedo()
    }
  }

  const selectedVisibilityConfig = VISIBILITY_OPTIONS.find(v => v.value === selectedVisibility)!
  const SelectedVisibilityIcon = selectedVisibilityConfig.icon

  // Render visibility badge (clickable for own contributions)
  const VisibilityBadge = ({ contribution, isOwn }: { contribution: { id: string; visibility: ContributionVisibility; visibility_targets?: { node_id: string; node?: { id: string; name: string; color: string | null; node_type: string } }[] }; isOwn: boolean }) => {
    const config = VISIBILITY_CONFIG[contribution.visibility]
    const VIcon = config.icon
    const targets = contribution.visibility_targets || []
    const targetNames = targets.map(t => t.node?.name).filter(Boolean)

    const handleOpenDropdown = () => {
      // Pre-populate pending state with current targets
      if (!showVisibilityChange) {
        setEditingContributionId(contribution.id)
        setPendingVisibility(contribution.visibility)
        setPendingTargetIds(targets.map(t => t.node_id))
        setVisibilityChangeStep(contribution.visibility !== 'firm' && targets.length > 0 ? 'targets' : 'level')
      }
      setShowVisibilityChange(!showVisibilityChange)
    }

    if (isOwn) {
      return (
        <div className="relative" ref={visibilityChangeRef}>
          <button
            onClick={handleOpenDropdown}
            className={clsx(
              'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
              config.bgColor, config.color,
              'hover:ring-2 hover:ring-offset-1 hover:ring-gray-300 cursor-pointer'
            )}
          >
            <VIcon className="w-3 h-3 mr-1" />
            {config.label}
            {targetNames.length > 0 && (
              <span className="ml-1 text-xs opacity-75">
                ({targetNames.length > 2 ? `${targetNames.slice(0, 2).join(', ')}...` : targetNames.join(', ')})
              </span>
            )}
            <ChevronDown className="w-3 h-3 ml-0.5" />
          </button>

          {showVisibilityChange && (
            <div className="absolute left-0 top-7 z-20 w-64 bg-white border rounded-lg shadow-lg py-1">
              {visibilityChangeStep === 'level' ? (
                <>
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b">
                    Change visibility
                  </div>
                  {VISIBILITY_OPTIONS.map((option) => {
                    const OptionIcon = option.icon
                    const isSelected = contribution.visibility === option.value
                    const targets = getTargetOptions(option.value)
                    const needsTargets = option.value !== 'firm' && targets.length > 0
                    return (
                      <button
                        key={option.value}
                        onClick={() => handleVisibilityLevelSelect(option.value)}
                        className={clsx(
                          'w-full flex items-center px-3 py-2 text-sm text-left hover:bg-gray-50',
                          isSelected && 'bg-primary-50'
                        )}
                      >
                        <OptionIcon className="w-4 h-4 mr-2 text-gray-500" />
                        <div className="flex-1">
                          <span className="font-medium text-gray-900">{option.label}</span>
                          {needsTargets && (
                            <span className="text-xs text-gray-400 ml-1">→</span>
                          )}
                        </div>
                        {isSelected && <Check className="w-4 h-4 text-primary-600" />}
                      </button>
                    )
                  })}
                </>
              ) : (
                <>
                  <div className="px-3 py-1.5 text-xs font-medium text-gray-500 border-b flex items-center">
                    <button
                      onClick={() => setVisibilityChangeStep('level')}
                      className="mr-2 text-gray-400 hover:text-gray-600"
                    >
                      ←
                    </button>
                    Select {pendingVisibility === 'portfolio' ? 'portfolios' :
                            pendingVisibility === 'team' ? 'teams' :
                            pendingVisibility === 'department' ? 'departments' : 'divisions'}
                  </div>
                  <div className="max-h-48 overflow-y-auto">
                    {pendingTargetOptions.map((target) => {
                      const isSelected = pendingTargetIds.includes(target.id)
                      return (
                        <button
                          key={target.id}
                          onClick={() => {
                            setPendingTargetIds(prev =>
                              prev.includes(target.id)
                                ? prev.filter(id => id !== target.id)
                                : [...prev, target.id]
                            )
                          }}
                          className={clsx(
                            'w-full flex items-center px-3 py-2 text-sm hover:bg-gray-50',
                            isSelected && 'bg-primary-50'
                          )}
                        >
                          <div className={clsx(
                            'w-4 h-4 rounded border mr-3 flex items-center justify-center',
                            isSelected ? 'bg-primary-600 border-primary-600' : 'border-gray-300'
                          )}>
                            {isSelected && <Check className="w-3 h-3 text-white" />}
                          </div>
                          <span
                            className="w-3 h-3 rounded-full mr-2"
                            style={{ backgroundColor: target.color || '#6b7280' }}
                          />
                          <span className="flex-1 text-left">{target.name}</span>
                        </button>
                      )
                    })}
                  </div>
                  <div className="border-t px-3 py-2 flex justify-end space-x-2">
                    <button
                      onClick={() => resetVisibilityChangeState()}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleVisibilityChangeSave(contribution.id, pendingVisibility!, pendingTargetIds)}
                      disabled={pendingTargetIds.length === 0}
                      className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Save
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )
    }

    return (
      <span className={clsx(
        'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium',
        config.bgColor, config.color
      )}>
        <VIcon className="w-3 h-3 mr-1" />
        {config.label}
        {targetNames.length > 0 && (
          <span className="ml-1 text-xs opacity-75">
            ({targetNames.length > 2 ? `${targetNames.slice(0, 2).join(', ')}...` : targetNames.join(', ')})
          </span>
        )}
      </span>
    )
  }

  // Get most recent update time for header
  const lastUpdated = contributions.length > 0
    ? contributions.reduce((latest, c) =>
        new Date(c.updated_at) > new Date(latest.updated_at) ? c : latest
      ).updated_at
    : null

  // Show toolbar when hovering, editing, or history is open
  const showToolbar = isHovered || isEditing || showHistory

  // Flat mode: render just the contributions without wrapper/header (for aggregated view)
  if (flatMode && activeTab === 'aggregated') {
    if (isLoading) {
      return (
        <div className="flex items-center justify-center py-3">
          <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
        </div>
      )
    }
    if (error) {
      return null // Hide errors in flat mode
    }
    if (contributions.length === 0) {
      return null // Hide empty sections in flat mode
    }

    // Sort contributions: covering analysts first, then by recency
    const sortedContributions = [...contributions].sort((a, b) => {
      const aIsCovering = coveringAnalystIds.has(a.created_by)
      const bIsCovering = coveringAnalystIds.has(b.created_by)
      if (aIsCovering && !bIsCovering) return -1
      if (!aIsCovering && bIsCovering) return 1
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
    })

    // Render clean aggregated view
    return (
      <div className={clsx("space-y-4", className)}>
        {/* Section header */}
        <div className="flex items-center gap-2.5 border-b border-gray-100 pb-2">
          <h3 className="text-sm font-semibold text-gray-700">{title}</h3>
          <span className="text-xs text-gray-400">
            {contributions.length} {contributions.length === 1 ? 'analyst' : 'analysts'}
          </span>
        </div>

        {/* Contributions - clean list */}
        <div className="space-y-4">
          {sortedContributions.map((c) => {
            const isCovering = coveringAnalystIds.has(c.created_by)
            return (
              <div key={c.id} className="group">
                {/* Author line - clickable to view analyst's full research */}
                <div className="flex items-center gap-2 mb-1">
                  {isCovering && (
                    <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" title="Covering Analyst" />
                  )}
                  <button
                    onClick={() => onTabChange?.(c.created_by)}
                    className={clsx(
                      "text-sm font-medium hover:underline transition-colors",
                      isCovering
                        ? "text-amber-700 hover:text-amber-800"
                        : "text-gray-700 hover:text-primary-600"
                    )}
                    title={`View ${c.user?.full_name}'s full research`}
                  >
                    {c.user?.full_name}
                  </button>
                  <span className="text-xs text-gray-400">
                    {formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}
                  </span>
                </div>
                {/* Content - clickable to view analyst's full research */}
                <button
                  onClick={() => onTabChange?.(c.created_by)}
                  className="text-left w-full text-sm text-gray-600 leading-relaxed pl-5 prose prose-sm max-w-none [&>p]:m-0 [&>ul]:m-0 [&>ol]:m-0 hover:text-gray-900 transition-colors cursor-pointer"
                  title={`View ${c.user?.full_name}'s full research`}
                >
                  <SmartInputRenderer content={c.content} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div
      className={clsx(
        'bg-white border border-gray-200 rounded-lg border-l-4 transition-all duration-200',
        theme.accent,
        theme.hoverBorder,
        theme.hoverBg,
        'hover:shadow-sm',
        className
      )}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-100 min-h-[48px]">
        <div className="flex items-center space-x-3">
          {Icon && (
            <div className={clsx('p-1.5 rounded-lg', theme.iconBg)}>
              <Icon className={clsx('w-4 h-4', theme.iconColor)} />
            </div>
          )}
          <div className="flex items-center gap-3 flex-wrap">
            {activeTab === 'aggregated' && user ? (
              <button
                onClick={handleStartEdit}
                className="group flex items-center gap-1.5"
                title="Click to add your view"
              >
                <h3 className="text-base font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">{title}</h3>
                <Edit3 className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
              </button>
            ) : (
              <h3 className="text-base font-semibold text-gray-900">{title}</h3>
            )}
            {description && (
              <InfoTooltip content={description} position="right" />
            )}
            {activeTab === 'aggregated' && lastUpdated && !showHistory && (
              <span className="text-xs text-gray-400">
                Updated {formatDistanceToNow(new Date(lastUpdated), { addSuffix: true })}
              </span>
            )}
            {activeTab !== 'aggregated' && selectedContribution && !showHistory && (
              <>
                <span className="text-xs text-gray-400">
                  Updated {formatDistanceToNow(new Date(selectedContribution.updated_at), { addSuffix: true })}
                </span>
                {/* Draft toggle button - clickable icon to view/hide draft */}
                {hasDraft && selectedContribution.created_by === user?.id && (
                  <button
                    onClick={() => setViewingDraft(!viewingDraft)}
                    className={clsx(
                      'inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium transition-colors',
                      viewingDraft
                        ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300'
                        : 'bg-amber-50 text-amber-700 hover:bg-amber-100'
                    )}
                    title={viewingDraft ? 'Click to view published' : 'Click to view draft'}
                  >
                    <FileEdit className="w-3 h-3 mr-1" />
                    Draft
                  </button>
                )}
                {/* Hide visibility badge when controlled from parent */}
                {!hideVisibility && (
                  <VisibilityBadge
                    contribution={selectedContribution}
                    isOwn={selectedContribution.created_by === user?.id}
                  />
                )}
              </>
            )}
          </div>
        </div>

        {showToolbar && (
          <div className="flex items-center space-x-2 animate-in fade-in duration-150">
            {/* View toggles - hidden when controlled from parent */}
            {!hideViewModeButtons && (
              <div className="flex items-center bg-gray-100 rounded p-0.5">
                {activeTab === 'aggregated' ? (
                  <>
                    <button
                      onClick={() => { setViewMode('combined'); setShowHistory(false) }}
                      className={clsx(
                        'flex items-center px-2 py-0.5 text-xs rounded transition-colors',
                        viewMode === 'combined' && !showHistory
                          ? 'bg-white text-gray-900 shadow-sm'
                          : 'text-gray-600 hover:text-gray-900'
                      )}
                    >
                      <List className="w-3 h-3 mr-1" />
                      All
                    </button>
                    <button
                      onClick={() => { setViewMode('ai'); setShowHistory(false) }}
                      className={clsx(
                        'flex items-center px-2 py-0.5 text-xs rounded transition-colors',
                        viewMode === 'ai' && !showHistory
                          ? 'bg-purple-100 text-purple-700 shadow-sm'
                          : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                      )}
                    >
                      <Sparkles className="w-3 h-3 mr-1" />
                      Summary
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => setShowHistory(false)}
                    className={clsx(
                      'flex items-center px-2 py-0.5 text-xs rounded transition-colors',
                      !showHistory
                        ? 'bg-white text-gray-900 shadow-sm'
                        : 'text-gray-600 hover:text-gray-900'
                    )}
                  >
                    <List className="w-3 h-3 mr-1" />
                    Content
                  </button>
                )}
                <button
                  onClick={() => setShowHistory(true)}
                  className={clsx(
                    'flex items-center px-2 py-0.5 text-xs rounded transition-colors',
                    showHistory
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <History className="w-3 h-3 mr-1" />
                  History
                </button>
              </div>
            )}

            {!isEditing && activeTab === user?.id && (
              <button
                onClick={handleStartEdit}
                title={myContribution ? 'Edit your view' : 'Add your view'}
                className="flex items-center justify-center p-1 text-white bg-primary-600 hover:bg-primary-700 rounded transition-colors"
              >
                <Edit3 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>

      {/* Content */}
      <div className="px-5 py-3">
        {isLoading && (
          <div className="flex items-center justify-center py-3">
            <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            Failed to load. Please try again.
          </div>
        )}

        {!isLoading && !error && (
          <>
            {/* Aggregated view */}
            {activeTab === 'aggregated' && (
              <>
                {showHistory ? (
                  <div className="space-y-2">
                    {historyLoading ? (
                      <div className="text-sm text-gray-500 text-center py-2">Loading history...</div>
                    ) : aggregateHistory.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-2">No edit history yet</div>
                    ) : (
                      aggregateHistory.slice(0, 10).map((h: any) => (
                        <div key={h.id} className="pb-2 border-b border-gray-100 last:border-0">
                          <div className="flex items-center space-x-2 mb-1">
                            <div className="w-5 h-5 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-medium text-gray-600">
                              {h.user?.full_name?.charAt(0) || '?'}
                            </div>
                            <span className="font-medium text-gray-900 text-sm">{h.user?.full_name}</span>
                            <span className="text-xs text-gray-400">
                              {formatDistanceToNow(new Date(h.changed_at), { addSuffix: true })}
                            </span>
                          </div>
                          <DiffView
                            oldText={h.old_content}
                            newText={h.new_content}
                            className="text-sm"
                          />
                        </div>
                      ))
                    )}
                  </div>
                ) : viewMode === 'combined' ? (
                  contributions.length === 0 ? (
                    <div className="text-center py-1">
                      {user && (
                        <button
                          onClick={handleStartEdit}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          Add your view
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {contributions.map((c) => {
                        const isCovering = coveringAnalystIds.has(c.created_by)
                        return (
                          <div key={c.id} className="text-sm text-gray-700 leading-relaxed">
                            <span className="font-medium text-gray-900 inline-flex items-center gap-1 align-top">
                              {isCovering && <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" title="Covering Analyst" />}
                              {c.user?.full_name}:
                            </span>{' '}
                            <span className="prose prose-sm max-w-none inline [&>p]:inline [&>p]:m-0">
                              <SmartInputRenderer content={c.content} inline />
                            </span>
                          </div>
                        )
                      })}
                    </div>
                  )
                ) : (
                  <ThesisSummaryView
                    contributions={contributions}
                    analysis={thesisAnalysis}
                    isLoading={analysisLoading}
                    isGenerating={analysisGenerating}
                    isStale={analysisStale}
                    isConfigured={aiConfigured}
                    error={analysisError}
                    onRegenerate={(method) => regenerateAnalysis(method)}
                    coveringAnalystIds={coveringAnalystIds}
                    assetId={assetId}
                    section={section}
                  />
                )}
              </>
            )}

            {/* Individual user view */}
            {activeTab !== 'aggregated' && (
              <>
                {isEditing && activeTab === user?.id ? (
                  <div className="space-y-4">
                    {/* Conclusion Section */}
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">
                        Conclusion
                        <span className="ml-1 font-normal text-gray-400">(visible to others)</span>
                      </label>
                      <UniversalSmartInput
                        ref={smartInputRef}
                        value={editContent}
                        onChange={(value, metadata) => {
                          handleContentChange(value)
                          setInputMetadata(metadata)
                        }}
                        onKeyDown={handleKeyDown}
                        placeholder={`Share your perspective on ${title.toLowerCase()}... Use @mention, #reference, .template, .price, .AI`}
                        textareaClassName="text-base min-h-[120px]"
                        rows={4}
                        minHeight="120px"
                        assetContext={assetContext}
                        enableMentions={true}
                        enableHashtags={true}
                        enableTemplates={true}
                        enableDataFunctions={true}
                        enableAI={true}
                      />
                    </div>

                    
                    {/* Formatting Toolbar + Actions */}
                    <div className="flex items-center justify-between pt-1">
                      {/* Formatting Toolbar */}
                      <div className="flex items-center space-x-0.5">
                        <button
                          type="button"
                          onClick={handleUndo}
                          disabled={undoStack.length === 0}
                          title="Undo (⌘Z)"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Undo2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={handleRedo}
                          disabled={redoStack.length === 0}
                          title="Redo (⌘⇧Z)"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                        >
                          <Redo2 className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-gray-300 mx-1" />
                        <button
                          type="button"
                          onClick={formatBold}
                          title="Bold (⌘B)"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <Bold className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={formatItalic}
                          title="Italic (⌘I)"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <Italic className="w-4 h-4" />
                        </button>
                        <div className="w-px h-4 bg-gray-300 mx-1" />
                        <button
                          type="button"
                          onClick={formatHeading}
                          title="Heading"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <Heading2 className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={formatBulletList}
                          title="Bullet List"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <List className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={formatNumberedList}
                          title="Numbered List"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <ListOrdered className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={formatLink}
                          title="Link"
                          className="p-1.5 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
                        >
                          <Link className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center space-x-2">
                        {/* Discard draft button - only show if editing a draft */}
                        {hasDraft && (
                          <button
                            onClick={handleDiscardDraft}
                            disabled={discardDraft.isPending}
                            className="flex items-center px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            {discardDraft.isPending ? (
                              <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-4 h-4 mr-1.5" />
                            )}
                            Discard Draft
                          </button>
                        )}
                        <button
                          onClick={handleCancel}
                          className="flex items-center px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                        >
                          Cancel
                        </button>
                        {/* Save as Draft button */}
                        <button
                          onClick={handleSaveDraft}
                          disabled={!editContent.trim() || saveDraft.isPending}
                          className="flex items-center px-3 py-1.5 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {saveDraft.isPending ? (
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <FileEdit className="w-4 h-4 mr-1.5" />
                          )}
                          Save Draft
                        </button>
                        {/* Publish button */}
                        <button
                          onClick={hasDraft ? handlePublishDraft : handleSave}
                          disabled={!editContent.trim() || saveContribution.isPending || publishDraft.isPending}
                          className="flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {(saveContribution.isPending || publishDraft.isPending) ? (
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <Upload className="w-4 h-4 mr-1.5" />
                          )}
                          Publish
                        </button>
                      </div>
                    </div>
                  </div>
                ) : showHistory ? (
                  <div className="space-y-2">
                    {individualHistory.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-2">No edit history yet</div>
                    ) : (
                      individualHistory.slice(0, 10).map((h) => (
                        <div key={h.id} className="pb-2 border-b border-gray-100 last:border-0">
                          <div className="text-xs text-gray-400 mb-1">
                            {formatDistanceToNow(new Date(h.changed_at), { addSuffix: true })}
                          </div>
                          <DiffView
                            oldText={h.old_content}
                            newText={h.new_content}
                            className="text-sm"
                          />
                        </div>
                      ))
                    )}
                  </div>
                ) : (
                  <>
                    {/* Show draft content when viewing draft, otherwise show published */}
                    {viewingDraft && hasDraft && selectedContribution?.created_by === user?.id ? (
                      <div className="space-y-3">
                        <div className="bg-amber-50/50 -mx-5 px-5 py-3 border-l-2 border-amber-400">
                          <div className="text-xs text-amber-600 mb-2">
                            Draft saved {myContribution?.draft_updated_at
                              ? formatDistanceToNow(new Date(myContribution.draft_updated_at), { addSuffix: true })
                              : 'recently'
                            }
                          </div>
                          <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                            <SmartInputRenderer content={myContribution?.draft_content || ''} />
                          </div>
                        </div>
                        {/* Draft action buttons */}
                        <div className="flex items-center gap-2 pt-2 border-t border-gray-100">
                          <button
                            onClick={handleStartEdit}
                            className="flex items-center px-3 py-1.5 text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg"
                          >
                            <Edit3 className="w-3.5 h-3.5 mr-1.5" />
                            Continue Editing
                          </button>
                          <button
                            onClick={handleDiscardDraft}
                            disabled={discardDraft.isPending}
                            className="flex items-center px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            {discardDraft.isPending ? (
                              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                            ) : (
                              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />
                            )}
                            Discard Draft
                          </button>
                        </div>
                      </div>
                    ) : selectedContribution ? (
                      <div className="space-y-3">
                        <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                          <SmartInputRenderer content={selectedContribution.content} />
                        </div>

                        {/* References (only shown if exists) */}
                        {selectedContribution.attachments && selectedContribution.attachments.length > 0 && (
                          <ViewReferences
                            attachments={selectedContribution.attachments}
                          />
                        )}
                      </div>
                    ) : (
                      <div className="text-center py-1">
                        {activeTab === user?.id ? (
                          <button
                            onClick={handleStartEdit}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary-600 hover:text-primary-700 hover:bg-primary-50 rounded-lg transition-colors"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Add your view
                          </button>
                        ) : (
                          <p className="text-gray-400 text-sm">No contribution yet</p>
                        )}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Discard Draft Confirmation Dialog */}
      <ConfirmDialog
        isOpen={showDiscardConfirm}
        onClose={() => setShowDiscardConfirm(false)}
        onConfirm={confirmDiscardDraft}
        title="Discard Draft"
        message="Are you sure you want to discard your draft changes? This will permanently delete your unpublished work and cannot be undone."
        confirmText="Discard Draft"
        cancelText="Keep Editing"
        variant="warning"
        isLoading={discardDraft.isPending}
      />
    </div>
  )
}
