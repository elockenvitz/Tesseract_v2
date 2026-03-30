// Dual-mode process item types: thinking (analytical) vs operational (workflow)

export type ProcessItemType = 'thinking' | 'operational'

export type SignalType = 'insight' | 'question' | 'risk' | 'data_point' | 'commentary'
export type EvidenceType = 'filing' | 'chart' | 'model' | 'news' | 'internal_note' | 'other'
export type RequestType = 'question' | 'investigate' | 'validate' | 'update_model' | 'gather_data' | 'follow_up'
export type ExpectedOutput = 'short_answer' | 'written_note' | 'data_upload' | 'model_update' | 'call_summary'
export type WorkRequestStatus = 'open' | 'in_progress' | 'completed' | 'cancelled'

export interface Signal {
  id: string
  checklist_item_id: string
  signal_type: SignalType
  comment_text: string
  user_id: string
  user?: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
  }
  is_edited: boolean
  created_at: string
  updated_at: string
}

export interface Evidence {
  id: string
  file_name: string
  file_path: string
  file_size?: number
  file_type?: string
  evidence_type: EvidenceType
  description?: string | null
  uploaded_by?: string
  uploader?: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
  }
  created_at: string
}

export interface WorkRequest {
  id: string
  checklist_item_id: string
  request_type: RequestType
  prompt: string
  owner_id: string
  owner?: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
  }
  requested_by: string
  requester?: {
    id: string
    email: string
    first_name?: string | null
    last_name?: string | null
  }
  due_date?: string | null
  expected_output?: ExpectedOutput | null
  context_notes?: string | null
  status: WorkRequestStatus
  completed_at?: string | null
  created_at: string
  updated_at: string
  // Linked work
  create_tracked_task: boolean
  linked_operational_item_id?: string | null
  result_note?: string | null
  resolved_at?: string | null
  result_converted_to_signal_id?: string | null
  prompt_id?: string | null
  // Joined linked item data (for display)
  linked_item?: {
    id: string
    item_text?: string
    status?: string
    completed?: boolean
    item_type?: string
  } | null
}

// Shared item data shape — used by both card components
export interface ChecklistItemData {
  id: string
  text: string
  completed: boolean
  status?: 'unchecked' | 'completed' | 'na'
  completedAt?: string
  completedBy?: string
  completedByUser?: { id: string; email: string; first_name: string | null; last_name: string | null }
  isCustom?: boolean
  dbId?: string
  item_type?: ProcessItemType
  // Thinking fields
  takeaway?: string | null
  takeaway_updated_at?: string | null
  takeaway_revision_count?: number
  takeaway_update_source?: 'manual' | 'finding' | null
  // Operational fields
  assignee_id?: string | null
  assignee?: { id: string; email: string; first_name?: string | null; last_name?: string | null } | null
  due_date?: string | null
  notes?: string | null
  // Provenance (for operational items created from work requests)
  source_type?: 'manual' | 'work_request'
  source_work_request_id?: string | null
  source_thinking_item_id?: string | null
  source_thinking_item_text?: string | null  // denormalized for display
  // Shared
  attachments?: { id: string; file_name: string; file_path: string; file_size?: number; file_type?: string; uploaded_by?: string; uploaded_at: string }[]
}

// Display constants

export const SIGNAL_META: Record<SignalType, { label: string; color: string; bg: string; icon: string }> = {
  insight:    { label: 'Insight',    color: 'text-blue-700',   bg: 'bg-blue-50 border-blue-200',     icon: '💡' },
  question:   { label: 'Question',   color: 'text-amber-700',  bg: 'bg-amber-50 border-amber-200',   icon: '?' },
  risk:       { label: 'Risk',       color: 'text-red-700',    bg: 'bg-red-50 border-red-200',        icon: '⚠' },
  data_point: { label: 'Data Point', color: 'text-emerald-700',bg: 'bg-emerald-50 border-emerald-200',icon: '#' },
}

export const EVIDENCE_META: Record<EvidenceType, { label: string; color: string }> = {
  filing:        { label: 'Filing',        color: 'text-blue-600' },
  chart:         { label: 'Chart',         color: 'text-purple-600' },
  model:         { label: 'Model',         color: 'text-emerald-600' },
  news:          { label: 'News',          color: 'text-amber-600' },
  internal_note: { label: 'Internal Note', color: 'text-gray-600' },
  other:         { label: 'Other',         color: 'text-gray-500' },
}

export const REQUEST_TYPE_META: Record<RequestType, { label: string; color: string }> = {
  question:      { label: 'Question',      color: 'text-gray-700' },
  investigate:   { label: 'Investigate',   color: 'text-blue-700' },
  validate:      { label: 'Validate',      color: 'text-emerald-700' },
  gather_data:   { label: 'Gather Data',   color: 'text-cyan-700' },
  update_model:  { label: 'Update Model',  color: 'text-purple-700' },
  follow_up:     { label: 'Follow Up',     color: 'text-gray-600' },
}

export const EXPECTED_OUTPUT_META: Record<ExpectedOutput, { label: string }> = {
  short_answer:  { label: 'Short Answer' },
  written_note:  { label: 'Written Note' },
  data_upload:   { label: 'Data Upload' },
  model_update:  { label: 'Model Update' },
  call_summary:  { label: 'Call Summary' },
}

export const WORK_STATUS_META: Record<WorkRequestStatus, { label: string; color: string; bg: string }> = {
  open:        { label: 'Open',        color: 'text-blue-700',    bg: 'bg-blue-50' },
  in_progress: { label: 'In Progress', color: 'text-amber-700',   bg: 'bg-amber-50' },
  completed:   { label: 'Done',        color: 'text-emerald-700', bg: 'bg-emerald-50' },
  cancelled:   { label: 'Cancelled',   color: 'text-gray-500',    bg: 'bg-gray-50' },
}

// Helper: user display name
export function userName(u?: { first_name?: string | null; last_name?: string | null; email?: string } | null): string {
  if (!u) return 'Unknown'
  if (u.first_name && u.last_name) return `${u.first_name} ${u.last_name}`
  return u.email?.split('@')[0] || 'Unknown'
}

// Helper: user initials
export function userInitials(u?: { first_name?: string | null; last_name?: string | null; email?: string } | null): string {
  const name = userName(u)
  return name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase()
}

// Helper: deterministic avatar color
const AVATAR_COLORS = ['bg-blue-600', 'bg-emerald-600', 'bg-purple-600', 'bg-amber-600', 'bg-rose-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-teal-600']
export function avatarColor(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
}

// Helper: relative time
export function relativeTime(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const ms = now.getTime() - d.getTime()
    const mins = Math.floor(ms / 60000)
    const hrs = Math.floor(ms / 3600000)
    const days = Math.floor(ms / 86400000)
    if (mins < 1) return 'just now'
    if (mins < 60) return `${mins}m`
    if (hrs < 24) return `${hrs}h`
    if (days < 7) return `${days}d`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}
