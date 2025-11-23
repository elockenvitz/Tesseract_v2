/**
 * useWorkflowState Hook
 *
 * Consolidates all state management for the WorkflowsPage component.
 * Extracted from WorkflowsPage.tsx during refactoring to reduce complexity.
 *
 * This hook manages 47+ state variables organized into logical groups:
 * - UI State (search, filters, sorting)
 * - Workflow Selection & Navigation
 * - Modal Visibility States
 * - Form Data States
 * - Template Edit Mode States
 * - Branch Management States
 */

import { useState } from 'react'
import type { WorkflowWithStats } from '../../types/workflow/workflow.types'

export interface WorkflowStateReturn {
  // UI State
  searchTerm: string
  setSearchTerm: (value: string) => void
  filterBy: 'all' | 'my' | 'public' | 'shared' | 'favorites'
  setFilterBy: (value: 'all' | 'my' | 'public' | 'shared' | 'favorites') => void
  sortBy: 'name' | 'usage' | 'created' | 'updated'
  setSortBy: (value: 'name' | 'usage' | 'created' | 'updated') => void

  // Workflow Selection & Navigation
  selectedWorkflow: WorkflowWithStats | null
  setSelectedWorkflow: (workflow: WorkflowWithStats | null) => void
  selectedWorkflowForEdit: string | null
  setSelectedWorkflowForEdit: (id: string | null) => void
  activeView: 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'branches' | 'models'
  setActiveView: (view: 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'branches' | 'models') => void
  workflowTabMemory: Record<string, 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates'>
  setWorkflowTabMemory: (memory: Record<string, 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates'>) => void

  // Expansion States
  isArchivedExpanded: boolean
  setIsArchivedExpanded: (value: boolean) => void
  isPersistentExpanded: boolean
  setIsPersistentExpanded: (value: boolean) => void
  isCadenceExpanded: boolean
  setIsCadenceExpanded: (value: boolean) => void
  isTemplateCollapsed: boolean
  setIsTemplateCollapsed: (value: boolean) => void

  // Workflow Manager Modal
  showWorkflowManager: boolean
  setShowWorkflowManager: (value: boolean) => void
  showInlineWorkflowCreator: boolean
  setShowInlineWorkflowCreator: (value: boolean) => void

  // Stage & Checklist Editing
  editingStage: string | null
  setEditingStage: (id: string | null) => void
  editingChecklistItem: string | null
  setEditingChecklistItem: (id: string | null) => void
  showAddStage: boolean
  setShowAddStage: (value: boolean) => void
  showAddChecklistItem: string | null
  setShowAddChecklistItem: (stageId: string | null) => void

  // Drag & Drop State
  draggedStage: string | null
  setDraggedStage: (id: string | null) => void
  draggedChecklistItem: string | null
  setDraggedChecklistItem: (id: string | null) => void
  dragOverItem: string | null
  setDragOverItem: (id: string | null) => void

  // Team Management Modals
  showInviteModal: boolean
  setShowInviteModal: (value: boolean) => void
  showAddStakeholderModal: boolean
  setShowAddStakeholderModal: (value: boolean) => void
  showAccessRequestModal: boolean
  setShowAccessRequestModal: (value: boolean) => void
  removeAdminConfirm: { id: string; name: string } | null
  setRemoveAdminConfirm: (value: { id: string; name: string } | null) => void
  removeStakeholderConfirm: { id: string; name: string } | null
  setRemoveStakeholderConfirm: (value: { id: string; name: string } | null) => void

  // Universe Rules Modals
  showAddRuleModal: boolean
  setShowAddRuleModal: (value: boolean) => void
  editingRule: string | null
  setEditingRule: (id: string | null) => void
  showDeleteRuleModal: boolean
  setShowDeleteRuleModal: (value: boolean) => void
  ruleToDelete: { id: string; name: string; type: string } | null
  setRuleToDelete: (value: { id: string; name: string; type: string } | null) => void
  showUniversePreview: boolean
  setShowUniversePreview: (value: boolean) => void
  universeRulesState: Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>
  setUniverseRulesState: (rules: Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>) => void
  initialUniverseRules: Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>
  setInitialUniverseRules: (rules: Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>) => void

  // Branch Management
  showCreateBranchModal: boolean
  setShowCreateBranchModal: (value: boolean) => void
  preselectedSourceBranch: string | null
  setPreselectedSourceBranch: (id: string | null) => void
  showBranchOverviewModal: boolean
  setShowBranchOverviewModal: (value: boolean) => void
  selectedBranch: any | null
  setSelectedBranch: (branch: any | null) => void
  branchToEnd: { id: string; name: string } | null
  setBranchToEnd: (value: { id: string; name: string } | null) => void
  branchToContinue: { id: string; name: string } | null
  setBranchToContinue: (value: { id: string; name: string } | null) => void
  branchToArchive: { id: string; name: string } | null
  setBranchToArchive: (value: { id: string; name: string } | null) => void
  branchToDelete: { id: string; name: string } | null
  setBranchToDelete: (value: { id: string; name: string } | null) => void
  branchStatusFilter: 'all' | 'archived' | 'deleted'
  setBranchStatusFilter: (value: 'all' | 'archived' | 'deleted') => void
  collapsedAssetGroups: Record<string, boolean>
  setCollapsedAssetGroups: (groups: Record<string, boolean>) => void
  collapsedBranches: Set<string>
  setCollapsedBranches: (branches: Set<string>) => void
  editingBranchSuffix: { id: string; currentSuffix: string } | null
  setEditingBranchSuffix: (value: { id: string; currentSuffix: string } | null) => void
  branchSuffixValue: string
  setBranchSuffixValue: (value: string) => void

  // Delete Confirmation Modals
  showDeleteConfirmModal: boolean
  setShowDeleteConfirmModal: (value: boolean) => void
  workflowToDelete: string | null
  setWorkflowToDelete: (id: string | null) => void
  showPermanentDeleteModal: boolean
  setShowPermanentDeleteModal: (value: boolean) => void
  workflowToPermanentlyDelete: string | null
  setWorkflowToPermanentlyDelete: (id: string | null) => void
  showUnarchiveModal: boolean
  setShowUnarchiveModal: (value: boolean) => void
  workflowToUnarchive: string | null
  setWorkflowToUnarchive: (id: string | null) => void
  showDeleteStageModal: boolean
  setShowDeleteStageModal: (value: boolean) => void
  stageToDelete: { id: string; key: string; label: string } | null
  setStageToDelete: (value: { id: string; key: string; label: string } | null) => void

  // Template Version Management
  showTemplateVersions: boolean
  setShowTemplateVersions: (value: boolean) => void
  showCreateVersion: boolean
  setShowCreateVersion: (value: boolean) => void
  showVersionCreated: boolean
  setShowVersionCreated: (value: boolean) => void
  showVersionDetail: boolean
  setShowVersionDetail: (value: boolean) => void
  selectedVersionId: string | null
  setSelectedVersionId: (id: string | null) => void
  createdVersionInfo: {
    versionNumber: number
    versionName: string
    versionType: 'major' | 'minor'
  } | null
  setCreatedVersionInfo: (info: {
    versionNumber: number
    versionName: string
    versionType: 'major' | 'minor'
  } | null) => void

  // Template Edit Mode
  isTemplateEditMode: boolean
  setIsTemplateEditMode: (value: boolean) => void
  templateChanges: Array<{
    type: 'stage_added' | 'stage_edited' | 'stage_deleted' | 'stage_reordered' | 'checklist_added' | 'checklist_edited' | 'checklist_deleted' | 'rule_added' | 'rule_edited' | 'rule_deleted' | 'cadence_updated' | 'universe_updated' | 'workflow_updated'
    description: string
    timestamp: number
  }>
  setTemplateChanges: (changes: Array<{
    type: 'stage_added' | 'stage_edited' | 'stage_deleted' | 'stage_reordered' | 'checklist_added' | 'checklist_edited' | 'checklist_deleted' | 'rule_added' | 'rule_edited' | 'rule_deleted' | 'cadence_updated' | 'universe_updated' | 'workflow_updated'
    description: string
    timestamp: number
  }>) => void
  showChangesList: boolean
  setShowChangesList: (value: boolean) => void
  showCancelConfirmation: boolean
  setShowCancelConfirmation: (value: boolean) => void

  // Template Upload
  showUploadTemplateModal: boolean
  setShowUploadTemplateModal: (value: boolean) => void
  templateFormData: {
    name: string
    description: string
    file: File | null
  }
  setTemplateFormData: (data: {
    name: string
    description: string
    file: File | null
  }) => void
  uploadingTemplate: boolean
  setUploadingTemplate: (value: boolean) => void

  // Workflow Editing
  isEditingWorkflow: boolean
  setIsEditingWorkflow: (value: boolean) => void
  showColorPicker: boolean
  setShowColorPicker: (value: boolean) => void
  editingWorkflowData: {
    name: string
    description: string
    color: string
  }
  setEditingWorkflowData: (data: {
    name: string
    description: string
    color: string
  }) => void
  newWorkflowData: {
    name: string
    description: string
    color: string
    is_public: boolean
    cadence_days: number
  }
  setNewWorkflowData: (data: {
    name: string
    description: string
    color: string
    is_public: boolean
    cadence_days: number
  }) => void
}

export function useWorkflowState(): WorkflowStateReturn {
  // UI State
  const [searchTerm, setSearchTerm] = useState('')
  const [filterBy, setFilterBy] = useState<'all' | 'my' | 'public' | 'shared' | 'favorites'>('all')
  const [sortBy, setSortBy] = useState<'name' | 'usage' | 'created' | 'updated'>('usage')

  // Workflow Selection & Navigation
  const [selectedWorkflow, setSelectedWorkflow] = useState<WorkflowWithStats | null>(null)
  const [selectedWorkflowForEdit, setSelectedWorkflowForEdit] = useState<string | null>(null)
  const [activeView, setActiveView] = useState<'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'branches' | 'models'>('overview')
  const [workflowTabMemory, setWorkflowTabMemory] = useState<Record<string, 'overview' | 'stages' | 'admins' | 'universe' | 'cadence' | 'templates'>>({})

  // Expansion States
  const [isArchivedExpanded, setIsArchivedExpanded] = useState(false)
  const [isPersistentExpanded, setIsPersistentExpanded] = useState(true)
  const [isCadenceExpanded, setIsCadenceExpanded] = useState(true)
  const [isTemplateCollapsed, setIsTemplateCollapsed] = useState(false)

  // Workflow Manager Modal
  const [showWorkflowManager, setShowWorkflowManager] = useState(false)
  const [showInlineWorkflowCreator, setShowInlineWorkflowCreator] = useState(false)

  // Stage & Checklist Editing
  const [editingStage, setEditingStage] = useState<string | null>(null)
  const [editingChecklistItem, setEditingChecklistItem] = useState<string | null>(null)
  const [showAddStage, setShowAddStage] = useState(false)
  const [showAddChecklistItem, setShowAddChecklistItem] = useState<string | null>(null)

  // Drag & Drop State
  const [draggedStage, setDraggedStage] = useState<string | null>(null)
  const [draggedChecklistItem, setDraggedChecklistItem] = useState<string | null>(null)
  const [dragOverItem, setDragOverItem] = useState<string | null>(null)

  // Team Management Modals
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showAddStakeholderModal, setShowAddStakeholderModal] = useState(false)
  const [showAccessRequestModal, setShowAccessRequestModal] = useState(false)
  const [removeAdminConfirm, setRemoveAdminConfirm] = useState<{ id: string; name: string } | null>(null)
  const [removeStakeholderConfirm, setRemoveStakeholderConfirm] = useState<{ id: string; name: string } | null>(null)

  // Universe Rules Modals
  const [showAddRuleModal, setShowAddRuleModal] = useState(false)
  const [editingRule, setEditingRule] = useState<string | null>(null)
  const [showDeleteRuleModal, setShowDeleteRuleModal] = useState(false)
  const [ruleToDelete, setRuleToDelete] = useState<{ id: string; name: string; type: string } | null>(null)
  const [showUniversePreview, setShowUniversePreview] = useState(false)
  const [universeRulesState, setUniverseRulesState] = useState<Array<{
    id: string
    type: string
    operator: any
    values: any
    combineWith?: 'AND' | 'OR'
  }>>([])
  const [initialUniverseRules, setInitialUniverseRules] = useState<typeof universeRulesState>([])

  // Branch Management
  const [showCreateBranchModal, setShowCreateBranchModal] = useState(false)
  const [preselectedSourceBranch, setPreselectedSourceBranch] = useState<string | null>(null)
  const [showBranchOverviewModal, setShowBranchOverviewModal] = useState(false)
  const [selectedBranch, setSelectedBranch] = useState<any | null>(null)
  const [branchToEnd, setBranchToEnd] = useState<{ id: string; name: string } | null>(null)
  const [branchToContinue, setBranchToContinue] = useState<{ id: string; name: string } | null>(null)
  const [branchToArchive, setBranchToArchive] = useState<{ id: string; name: string } | null>(null)
  const [branchToDelete, setBranchToDelete] = useState<{ id: string; name: string } | null>(null)
  const [branchStatusFilter, setBranchStatusFilter] = useState<'all' | 'archived' | 'deleted'>('all')
  const [collapsedAssetGroups, setCollapsedAssetGroups] = useState<Record<string, boolean>>({
    active: false,
    inherited: false,
    ruleBased: false,
    added: false,
    deleted: false,
    completed: false
  })
  const [collapsedBranches, setCollapsedBranches] = useState<Set<string>>(new Set())
  const [editingBranchSuffix, setEditingBranchSuffix] = useState<{ id: string; currentSuffix: string } | null>(null)
  const [branchSuffixValue, setBranchSuffixValue] = useState('')

  // Delete Confirmation Modals
  const [showDeleteConfirmModal, setShowDeleteConfirmModal] = useState(false)
  const [workflowToDelete, setWorkflowToDelete] = useState<string | null>(null)
  const [showPermanentDeleteModal, setShowPermanentDeleteModal] = useState(false)
  const [workflowToPermanentlyDelete, setWorkflowToPermanentlyDelete] = useState<string | null>(null)
  const [showUnarchiveModal, setShowUnarchiveModal] = useState(false)
  const [workflowToUnarchive, setWorkflowToUnarchive] = useState<string | null>(null)
  const [showDeleteStageModal, setShowDeleteStageModal] = useState(false)
  const [stageToDelete, setStageToDelete] = useState<{ id: string; key: string; label: string } | null>(null)

  // Template Version Management
  const [showTemplateVersions, setShowTemplateVersions] = useState(false)
  const [showCreateVersion, setShowCreateVersion] = useState(false)
  const [showVersionCreated, setShowVersionCreated] = useState(false)
  const [showVersionDetail, setShowVersionDetail] = useState(false)
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null)
  const [createdVersionInfo, setCreatedVersionInfo] = useState<{
    versionNumber: number
    versionName: string
    versionType: 'major' | 'minor'
  } | null>(null)

  // Template Edit Mode
  const [isTemplateEditMode, setIsTemplateEditMode] = useState(false)
  const [templateChanges, setTemplateChanges] = useState<Array<{
    type: 'stage_added' | 'stage_edited' | 'stage_deleted' | 'stage_reordered' | 'checklist_added' | 'checklist_edited' | 'checklist_deleted' | 'rule_added' | 'rule_edited' | 'rule_deleted' | 'cadence_updated' | 'universe_updated' | 'workflow_updated'
    description: string
    timestamp: number
  }>>([])
  const [showChangesList, setShowChangesList] = useState(false)
  const [showCancelConfirmation, setShowCancelConfirmation] = useState(false)

  // Template Upload
  const [showUploadTemplateModal, setShowUploadTemplateModal] = useState(false)
  const [templateFormData, setTemplateFormData] = useState({
    name: '',
    description: '',
    file: null as File | null
  })
  const [uploadingTemplate, setUploadingTemplate] = useState(false)

  // Workflow Editing
  const [isEditingWorkflow, setIsEditingWorkflow] = useState(false)
  const [showColorPicker, setShowColorPicker] = useState(false)
  const [editingWorkflowData, setEditingWorkflowData] = useState({
    name: '',
    description: '',
    color: ''
  })
  const [newWorkflowData, setNewWorkflowData] = useState({
    name: '',
    description: '',
    color: '#3b82f6',
    is_public: false,
    cadence_days: 365
  })

  return {
    // UI State
    searchTerm,
    setSearchTerm,
    filterBy,
    setFilterBy,
    sortBy,
    setSortBy,

    // Workflow Selection & Navigation
    selectedWorkflow,
    setSelectedWorkflow,
    selectedWorkflowForEdit,
    setSelectedWorkflowForEdit,
    activeView,
    setActiveView,
    workflowTabMemory,
    setWorkflowTabMemory,

    // Expansion States
    isArchivedExpanded,
    setIsArchivedExpanded,
    isPersistentExpanded,
    setIsPersistentExpanded,
    isCadenceExpanded,
    setIsCadenceExpanded,
    isTemplateCollapsed,
    setIsTemplateCollapsed,

    // Workflow Manager Modal
    showWorkflowManager,
    setShowWorkflowManager,
    showInlineWorkflowCreator,
    setShowInlineWorkflowCreator,

    // Stage & Checklist Editing
    editingStage,
    setEditingStage,
    editingChecklistItem,
    setEditingChecklistItem,
    showAddStage,
    setShowAddStage,
    showAddChecklistItem,
    setShowAddChecklistItem,

    // Drag & Drop State
    draggedStage,
    setDraggedStage,
    draggedChecklistItem,
    setDraggedChecklistItem,
    dragOverItem,
    setDragOverItem,

    // Team Management Modals
    showInviteModal,
    setShowInviteModal,
    showAddStakeholderModal,
    setShowAddStakeholderModal,
    showAccessRequestModal,
    setShowAccessRequestModal,
    removeAdminConfirm,
    setRemoveAdminConfirm,
    removeStakeholderConfirm,
    setRemoveStakeholderConfirm,

    // Universe Rules Modals
    showAddRuleModal,
    setShowAddRuleModal,
    editingRule,
    setEditingRule,
    showDeleteRuleModal,
    setShowDeleteRuleModal,
    ruleToDelete,
    setRuleToDelete,
    showUniversePreview,
    setShowUniversePreview,
    universeRulesState,
    setUniverseRulesState,
    initialUniverseRules,
    setInitialUniverseRules,

    // Branch Management
    showCreateBranchModal,
    setShowCreateBranchModal,
    preselectedSourceBranch,
    setPreselectedSourceBranch,
    showBranchOverviewModal,
    setShowBranchOverviewModal,
    selectedBranch,
    setSelectedBranch,
    branchToEnd,
    setBranchToEnd,
    branchToContinue,
    setBranchToContinue,
    branchToArchive,
    setBranchToArchive,
    branchToDelete,
    setBranchToDelete,
    branchStatusFilter,
    setBranchStatusFilter,
    collapsedAssetGroups,
    setCollapsedAssetGroups,
    collapsedBranches,
    setCollapsedBranches,
    editingBranchSuffix,
    setEditingBranchSuffix,
    branchSuffixValue,
    setBranchSuffixValue,

    // Delete Confirmation Modals
    showDeleteConfirmModal,
    setShowDeleteConfirmModal,
    workflowToDelete,
    setWorkflowToDelete,
    showPermanentDeleteModal,
    setShowPermanentDeleteModal,
    workflowToPermanentlyDelete,
    setWorkflowToPermanentlyDelete,
    showUnarchiveModal,
    setShowUnarchiveModal,
    workflowToUnarchive,
    setWorkflowToUnarchive,
    showDeleteStageModal,
    setShowDeleteStageModal,
    stageToDelete,
    setStageToDelete,

    // Template Version Management
    showTemplateVersions,
    setShowTemplateVersions,
    showCreateVersion,
    setShowCreateVersion,
    showVersionCreated,
    setShowVersionCreated,
    showVersionDetail,
    setShowVersionDetail,
    selectedVersionId,
    setSelectedVersionId,
    createdVersionInfo,
    setCreatedVersionInfo,

    // Template Edit Mode
    isTemplateEditMode,
    setIsTemplateEditMode,
    templateChanges,
    setTemplateChanges,
    showChangesList,
    setShowChangesList,
    showCancelConfirmation,
    setShowCancelConfirmation,

    // Template Upload
    showUploadTemplateModal,
    setShowUploadTemplateModal,
    templateFormData,
    setTemplateFormData,
    uploadingTemplate,
    setUploadingTemplate,

    // Workflow Editing
    isEditingWorkflow,
    setIsEditingWorkflow,
    showColorPicker,
    setShowColorPicker,
    editingWorkflowData,
    setEditingWorkflowData,
    newWorkflowData,
    setNewWorkflowData,
  }
}
