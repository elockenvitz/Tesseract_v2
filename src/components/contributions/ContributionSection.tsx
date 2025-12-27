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
  Trash2,
  Save,
  X,
  Check,
  Bold,
  Italic,
  ListOrdered,
  Link,
  Heading2,
  Undo2,
  Redo2
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { formatDistanceToNow } from 'date-fns'
import { useAuth } from '../../hooks/useAuth'
import {
  useContributions,
  useContributionHistory,
  useAggregateHistory,
  type ContributionVisibility
} from '../../hooks/useContributions'
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
}

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

export function ContributionSection({
  assetId,
  section,
  title,
  description,
  icon: Icon,
  className,
  defaultVisibility = 'firm',
  activeTab = 'aggregated',
  onTabChange
}: ContributionSectionProps) {
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
  const [pendingTargetIds, setPendingTargetIds] = useState<string[]>([])
  const [editingContributionId, setEditingContributionId] = useState<string | null>(null)
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
  const [stableButtonText, setStableButtonText] = useState<string | null>(null)
  const [inputMetadata, setInputMetadata] = useState<SmartInputMetadata>({ mentions: [], references: [], dataSnapshots: [], aiContent: [] })
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
    updateVisibility
  } = useContributions({
    assetId,
    section
  })

  const { history: aggregateHistory, isLoading: historyLoading } = useAggregateHistory({
    assetId,
    section
  })

  const selectedContribution = activeTab !== 'aggregated'
    ? contributions.find(c => c.created_by === activeTab)
    : null

  const { history: individualHistory } = useContributionHistory(selectedContribution?.id)

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

  const handleStartEdit = () => {
    setEditContent(myContribution?.content || '')
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

    await saveContribution.mutateAsync({
      content: editContent.trim(),
      sectionKey: section,
      visibility: selectedVisibility,
      targetIds: selectedTargetIds
    })

    setIsEditing(false)
    setEditContent('')
  }

  const handleCancel = () => {
    setIsEditing(false)
    setEditContent('')
  }

  const handleDelete = async () => {
    if (confirm('Are you sure you want to delete your view?')) {
      await deleteContribution.mutateAsync()
      if (onTabChange) {
        onTabChange('aggregated')
      }
    }
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

  return (
    <div className={clsx('bg-white border border-gray-200 rounded-lg', className)}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <div className="flex items-center space-x-3">
          {Icon && <Icon className="w-5 h-5 text-gray-400" />}
          <div className="flex items-center gap-3">
            <h3 className="text-base font-semibold text-gray-900">{title}</h3>
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
                <VisibilityBadge
                  contribution={selectedContribution}
                  isOwn={selectedContribution.created_by === user?.id}
                />
              </>
            )}
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* View toggles */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            {activeTab === 'aggregated' ? (
              <>
                <button
                  onClick={() => { setViewMode('combined'); setShowHistory(false) }}
                  className={clsx(
                    'flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                    viewMode === 'combined' && !showHistory
                      ? 'bg-white text-gray-900 shadow-sm'
                      : 'text-gray-600 hover:text-gray-900'
                  )}
                >
                  <List className="w-4 h-4 mr-1.5" />
                  All Views
                </button>
                <button
                  onClick={() => { setViewMode('ai'); setShowHistory(false) }}
                  className={clsx(
                    'flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                    viewMode === 'ai' && !showHistory
                      ? 'bg-purple-100 text-purple-700 shadow-sm'
                      : 'text-purple-600 hover:text-purple-700 hover:bg-purple-50'
                  )}
                >
                  <Sparkles className="w-4 h-4 mr-1.5" />
                  Summary
                </button>
              </>
            ) : (
              <button
                onClick={() => setShowHistory(false)}
                className={clsx(
                  'flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                  !showHistory
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                )}
              >
                <List className="w-4 h-4 mr-1.5" />
                Content
              </button>
            )}
            <button
              onClick={() => setShowHistory(true)}
              className={clsx(
                'flex items-center px-3 py-1.5 text-sm rounded-md transition-colors',
                showHistory
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <History className="w-4 h-4 mr-1.5" />
              History
            </button>
          </div>

          {!isEditing && (
            <button
              onClick={handleStartEdit}
              title={myContribution ? 'Edit your view' : 'Add your view'}
              className="flex items-center justify-center p-2 text-white bg-primary-600 hover:bg-primary-700 rounded-lg transition-colors"
            >
              <Edit3 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="p-5">
        {isLoading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
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
                      <div className="text-sm text-gray-500 text-center py-6">Loading history...</div>
                    ) : aggregateHistory.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-6">No edit history yet</div>
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
                    <div className="text-center py-6">
                      <p className="text-gray-400 text-sm">No views shared yet</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {contributions.map((c) => (
                        <div key={c.id} className="text-gray-700 leading-relaxed">
                          <span className="font-medium text-gray-900">{c.user?.full_name}:</span>{' '}
                          <div className="inline prose prose-sm max-w-none prose-p:inline prose-p:m-0">
                            <SmartInputRenderer content={c.content} inline />
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  <div>
                    {/* Combined Summary View - Native concatenation */}
                    {contributions.length === 0 ? (
                      <div className="text-center py-6">
                        <p className="text-gray-400 text-sm">No views to summarize</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {[...contributions]
                          .sort((a, b) => new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime())
                          .map((c) => (
                          <div key={c.id} className="text-gray-700 leading-relaxed">
                            <span className="text-gray-500">{formatDistanceToNow(new Date(c.updated_at), { addSuffix: true })}</span>
                            {' '}<span className="font-medium">{c.user?.full_name}</span> said{' '}
                            "<span className="prose prose-sm max-w-none inline prose-p:inline prose-p:m-0">
                              <SmartInputRenderer content={c.content} inline />
                            </span>"
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Individual user view */}
            {activeTab !== 'aggregated' && (
              <>
                {isEditing && activeTab === user?.id ? (
                  <div className="space-y-3">
                    <UniversalSmartInput
                      ref={smartInputRef}
                      value={editContent}
                      onChange={(value, metadata) => {
                        handleContentChange(value)
                        setInputMetadata(metadata)
                      }}
                      onKeyDown={handleKeyDown}
                      placeholder={`Share your perspective on ${title.toLowerCase()}... Use @mention, #reference, .template, .price, .AI`}
                      textareaClassName="text-base min-h-[200px]"
                      rows={6}
                      minHeight="200px"
                      assetContext={assetContext}
                      enableMentions={true}
                      enableHashtags={true}
                      enableTemplates={true}
                      enableDataFunctions={true}
                      enableAI={true}
                    />

                    <div className="flex items-center justify-between">
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
                        {myContribution && (
                          <button
                            onClick={handleDelete}
                            className="flex items-center px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg"
                          >
                            <Trash2 className="w-4 h-4 mr-1.5" />
                            Delete
                          </button>
                        )}
                        <button
                          onClick={handleCancel}
                          className="flex items-center px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-100 rounded-lg"
                        >
                          Cancel
                        </button>
                        <button
                          onClick={handleSave}
                          disabled={!editContent.trim() || saveContribution.isPending}
                          className="flex items-center px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {saveContribution.isPending ? (
                            <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                          ) : (
                            <Save className="w-4 h-4 mr-1.5" />
                          )}
                          Save
                        </button>
                      </div>
                    </div>
                  </div>
                ) : showHistory ? (
                  <div className="space-y-2">
                    {individualHistory.length === 0 ? (
                      <div className="text-sm text-gray-400 text-center py-6">No edit history yet</div>
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
                    {selectedContribution ? (
                      <div className="prose prose-sm max-w-none text-gray-700 leading-relaxed">
                        <SmartInputRenderer content={selectedContribution.content} />
                      </div>
                    ) : activeTab === user?.id ? (
                      <p className="text-gray-400 text-sm text-center py-6">You haven't shared your view yet</p>
                    ) : (
                      <div className="text-sm text-gray-400 text-center py-8">
                        This person hasn't shared a view for this section yet
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
