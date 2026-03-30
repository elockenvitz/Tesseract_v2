/**
 * DecisionItemCard
 *
 * A micro-decision-unit surface for structured analytical work.
 * Replaces the generic checklist-item + comments/attachments/assign pattern.
 *
 * Sections: Takeaway · Signals · Evidence · Work Requests
 */
import React, { useState, useRef, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronRight, Edit3, Trash2, Send,
  Plus, Paperclip, Upload, Download, FileText, X, AlertTriangle,
  Clock, User as UserIcon, Link as LinkIcon, BrainCircuit, Settings2,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useSidebarStore } from '../../../stores/sidebarStore'
import { MentionInput } from '../MentionInput'
import { WorkRequestModal } from './WorkRequestModal'
import {
  ChecklistItemData, Signal, Evidence, WorkRequest, SignalType, EvidenceType,
  SIGNAL_META, EVIDENCE_META, REQUEST_TYPE_META, EXPECTED_OUTPUT_META, WORK_STATUS_META,
  userName, userInitials, avatarColor, relativeTime, RequestType, ExpectedOutput,
  WorkRequestStatus,
} from './types'

// ─── Inline question thread ─────────────────────────────────────────────

function QuestionThread({ promptId }: { promptId: string }) {
  const { data: responses = [] } = useQuery({
    queryKey: ['prompt-responses', promptId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('id, content, user_id, created_at, user:users(id, first_name, last_name, email)')
        .eq('context_type', 'quick_thought')
        .eq('context_id', promptId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    enabled: !!promptId,
    staleTime: 30_000,
  })

  if (responses.length === 0) return null

  return (
    <div className="mt-1.5 space-y-1">
      {responses.map((r: any) => {
        const u = Array.isArray(r.user) ? r.user[0] : r.user
        return (
          <div key={r.id} className="flex items-start gap-2 pl-1">
            <div className={`w-4 h-4 rounded-full ${avatarColor(userName(u))} flex items-center justify-center flex-shrink-0 mt-0.5`}>
              <span className="text-white text-[7px] font-semibold">{userInitials(u)}</span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-gray-700 leading-snug">{r.content}</p>
              <p className="text-[9px] text-gray-400 mt-0.5">{userName(u)} · {relativeTime(r.created_at)}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Props ──────────────────────────────────────────────────────────────

interface DecisionItemCardProps {
  item: ChecklistItemData
  stageId: string
  assetId: string
  workflowId: string
  isEditable: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  onToggleStatus: () => void
  onRemoveCustom?: () => void
  currentUser: { id: string; email?: string; user_metadata?: { first_name?: string; last_name?: string } } | null
  /** Scope for table selection: 'asset' (default) or 'portfolio' */
  scopeType?: 'asset' | 'portfolio'
}

// ─── Component ──────────────────────────────────────────────────────────

export function DecisionItemCard({
  item, stageId, assetId, workflowId, isEditable, isExpanded,
  onToggleExpand, onToggleStatus, onRemoveCustom, currentUser,
  scopeType = 'asset',
}: DecisionItemCardProps) {
  const itemsTable = scopeType === 'portfolio' ? 'portfolio_checklist_items' : 'asset_checklist_items'
  const attachTable = scopeType === 'portfolio' ? 'portfolio_checklist_attachments' : 'asset_checklist_attachments'
  const scopeIdField = scopeType === 'portfolio' ? 'portfolio_id' : 'asset_id'
  const qc = useQueryClient()
  const openInspector = useSidebarStore(s => s.openInspector)
  const status = item.status || (item.completed ? 'completed' : 'unchecked')

  // ─── Local state ────────────────────────────────────────────────────
  const [editingCommentary, setEditingCommentary] = useState(false)
  const [commentaryDraft, setCommentaryDraft] = useState('')
  const [addingSignal, setAddingSignal] = useState(false)
  const [signalType, setSignalType] = useState<SignalType>('insight')
  const [signalText, setSignalText] = useState('')
  const [signalMentions, setSignalMentions] = useState<string[]>([])
  const [signalReferences, setSignalReferences] = useState<Array<{type: string; id: string; text: string}>>([])
  const [editingSignalId, setEditingSignalId] = useState<string | null>(null)
  const [editingSignalText, setEditingSignalText] = useState('')
  const [addingEvidence, setAddingEvidence] = useState(false)
  const [evidenceType, setEvidenceType] = useState<EvidenceType>('other')
  const [evidenceDesc, setEvidenceDesc] = useState('')
  const [showWorkRequestModal, setShowWorkRequestModal] = useState(false)
  const [editingResultNoteId, setEditingResultNoteId] = useState<string | null>(null)
  const [resultNoteDraft, setResultNoteDraft] = useState('')
  const [convertingResultId, setConvertingResultId] = useState<string | null>(null)
  const [updatingViewFromWrId, setUpdatingViewFromWrId] = useState<string | null>(null)
  const [confirmDeleteWrId, setConfirmDeleteWrId] = useState<string | null>(null)
  const [showAttachMenu, setShowAttachMenu] = useState(false)
  const [addingLink, setAddingLink] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkLabel, setLinkLabel] = useState('')
  const [fileDragOver, setFileDragOver] = useState(false)
  const attachMenuRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // close attach menu on click outside
  useEffect(() => {
    if (!showAttachMenu) return
    const handler = (e: MouseEvent) => {
      if (attachMenuRef.current && !attachMenuRef.current.contains(e.target as Node)) setShowAttachMenu(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showAttachMenu])

  // ─── Queries ────────────────────────────────────────────────────────

  const commentsKey = ['checklist-comments', assetId, workflowId, stageId, item.id]
  const { data: allComments = [] } = useQuery<Signal[]>({
    queryKey: commentsKey,
    queryFn: async () => {
      if (!item.dbId) return []
      const { data, error } = await supabase
        .from('checklist_item_comments')
        .select('*, user:users!checklist_item_comments_user_id_fkey(id, email, first_name, last_name)')
        .eq('checklist_item_id', item.dbId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data || []) as Signal[]
    },
    enabled: !!item.dbId,
  })
  const signals = allComments.filter(c => c.signal_type !== 'commentary')
  const commentaries = allComments.filter(c => c.signal_type === 'commentary')
  const myCommentary = commentaries.find(c => c.user_id === currentUser?.id)

  // sync commentary draft with own commentary when data loads
  useEffect(() => {
    if (!editingCommentary && myCommentary) setCommentaryDraft(myCommentary.comment_text)
  }, [myCommentary?.comment_text])

  const evidenceKey = ['checklist-evidence', assetId, workflowId, stageId, item.id, scopeType]
  const { data: evidence = [] } = useQuery<Evidence[]>({
    queryKey: evidenceKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(attachTable)
        .select('*')
        .eq(scopeIdField, assetId)
        .eq('workflow_id', workflowId)
        .eq('stage_id', stageId)
        .eq('item_id', item.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as Evidence[]
    },
    enabled: !!assetId && !!workflowId,
  })

  const workReqKey = ['checklist-work-requests', assetId, workflowId, stageId, item.id]
  const { data: workRequests = [] } = useQuery<WorkRequest[]>({
    queryKey: workReqKey,
    queryFn: async () => {
      if (!item.dbId) return []
      const { data, error } = await supabase
        .from('checklist_work_requests')
        .select(`
          *,
          owner:users!checklist_work_requests_owner_id_fkey(id, email, first_name, last_name),
          requester:users!checklist_work_requests_requested_by_fkey(id, email, first_name, last_name),
          linked_item:asset_checklist_items!checklist_work_requests_linked_operational_item_id_fkey(id, item_text, status, completed, item_type)
        `)
        .eq('checklist_item_id', item.dbId)
        .order('created_at', { ascending: false })
      if (error) throw error
      // Normalize joined linked_item (PostgREST may return array for nullable FK)
      return (data || []).map((d: any) => ({
        ...d,
        linked_item: Array.isArray(d.linked_item) ? d.linked_item[0] || null : d.linked_item,
      })) as WorkRequest[]
    },
    enabled: !!item.dbId,
  })

  // ─── DB item helper ─────────────────────────────────────────────────

  const ensureDbItem = async (): Promise<string | null> => {
    if (item.dbId) return item.dbId
    if (!currentUser) return null
    const { data: existing } = await supabase
      .from(itemsTable)
      .select('id')
      .eq(scopeIdField, assetId).eq('workflow_id', workflowId)
      .eq('stage_id', stageId).eq('item_id', item.id)
      .maybeSingle()
    if (existing) return existing.id
    const insertRow: any = { workflow_id: workflowId, stage_id: stageId, item_id: item.id, item_text: item.text, completed: false, item_type: 'thinking' }
    insertRow[scopeIdField] = assetId
    if (scopeType === 'asset') insertRow.created_by = currentUser.id
    const { data: created, error } = await supabase
      .from(itemsTable)
      .insert(insertRow)
      .select('id').single()
    if (error) { console.error('ensureDbItem error:', error); return null }
    qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
    return created.id
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  const saveCommentaryM = useMutation({
    mutationFn: async ({ text, existingId }: { text: string; existingId?: string }) => {
      const dbId = await ensureDbItem()
      if (!dbId || !currentUser) throw new Error('Missing data')
      if (existingId) {
        const { error } = await supabase.from('checklist_item_comments')
          .update({ comment_text: text, is_edited: true })
          .eq('id', existingId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('checklist_item_comments').insert({
          checklist_item_id: dbId, user_id: currentUser.id,
          comment_text: text, signal_type: 'commentary',
        })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey })
      setEditingCommentary(false)
      setUpdatingViewFromWrId(null)
    },
  })

  const addSignalM = useMutation({
    mutationFn: async (data: { signal_type: SignalType; text: string }) => {
      const dbId = await ensureDbItem()
      if (!dbId || !currentUser) throw new Error('Missing data')
      const { error } = await supabase.from('checklist_item_comments').insert({
        checklist_item_id: dbId,
        user_id: currentUser.id,
        comment_text: data.text,
        signal_type: data.signal_type,
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey })
      qc.invalidateQueries({ queryKey: ['checklist-item-comments', assetId, workflowId] })
      setAddingSignal(false)
      setSignalText('')
      setSignalMentions([])
      setSignalReferences([])
    },
  })

  const editSignalM = useMutation({
    mutationFn: async ({ id, text }: { id: string; text: string }) => {
      if (!currentUser) throw new Error('No user')
      const { error } = await supabase.from('checklist_item_comments')
        .update({ comment_text: text, is_edited: true })
        .eq('id', id).eq('user_id', currentUser.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey })
      setEditingSignalId(null)
    },
  })

  const deleteSignalM = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUser) throw new Error('No user')
      const { error } = await supabase.from('checklist_item_comments')
        .delete().eq('id', id).eq('user_id', currentUser.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
  })

  const uploadEvidenceM = useMutation({
    mutationFn: async ({ file, evidenceType: et, description }: { file: File; evidenceType: EvidenceType; description: string }) => {
      if (!currentUser) throw new Error('No user')
      const filePath = `${assetId}/${workflowId}/${stageId}/${item.id}/${Date.now()}_${file.name}`
      const { error: upErr } = await supabase.storage.from('assets').upload(filePath, file)
      if (upErr) throw upErr
      const insertRow: any = {
        workflow_id: workflowId, stage_id: stageId, item_id: item.id,
        file_name: file.name, file_path: filePath, file_size: file.size, file_type: file.type,
        uploaded_by: currentUser.id, evidence_type: et, description: description || null,
      }
      insertRow[scopeIdField] = assetId
      const { error: dbErr } = await supabase.from(attachTable).insert(insertRow)
      if (dbErr) throw dbErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: evidenceKey })
      setAddingEvidence(false)
      setEvidenceDesc('')
      setEvidenceType('other')
      setUploading(false)
    },
    onError: () => setUploading(false),
  })

  const deleteEvidenceM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(attachTable).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: evidenceKey }),
  })

  const createWorkRequestM = useMutation({
    mutationFn: async (data: { request_type: RequestType; prompt: string; owner_id: string; due_date?: string; expected_output?: ExpectedOutput; context_notes?: string; create_tracked_task?: boolean }) => {
      const dbId = await ensureDbItem()
      if (!dbId || !currentUser) throw new Error('Missing data')

      // 1. Create the work request
      const { data: wrRow, error: wrErr } = await supabase.from('checklist_work_requests').insert({
        checklist_item_id: dbId,
        request_type: data.request_type,
        prompt: data.prompt,
        owner_id: data.owner_id,
        requested_by: currentUser.id,
        due_date: data.due_date || null,
        expected_output: data.expected_output || null,
        context_notes: data.context_notes || null,
        create_tracked_task: data.create_tracked_task || false,
      }).select('id').single()
      if (wrErr) throw wrErr

      // 2. Create a prompt so it appears in the assignee's prompt feed
      if (wrRow) {
        const promptTitle = `${item.text}`
        const { data: promptRow, error: promptErr } = await supabase.from('quick_thoughts').insert({
          created_by: currentUser.id,
          content: data.prompt,
          idea_type: 'prompt',
          visibility: 'team',
          tags: [
            `title:${promptTitle}`,
            `assignee:${data.owner_id}`,
            `source:work_request:${wrRow.id}`,
            `category:${data.request_type}`,
          ],
          asset_id: assetId || null,
        }).select('id').single()
        if (promptErr) console.error('Error creating prompt:', promptErr)

        // Link prompt back to work request
        if (promptRow) {
          await supabase.from('checklist_work_requests')
            .update({ prompt_id: promptRow.id })
            .eq('id', wrRow.id)
        }

        // Notify the assignee
        const { error: notifErr } = await supabase.from('notifications').insert({
          user_id: data.owner_id,
          type: 'note_shared',
          title: promptTitle,
          message: data.prompt.slice(0, 200),
          metadata: { work_request_id: wrRow.id, asset_id: assetId, checklist_item_id: dbId, prompt_id: promptRow?.id },
        })
        if (notifErr) console.error('Error creating notification:', notifErr)
      }

      // 3. If tracked task requested, create linked operational item
      if (data.create_tracked_task && wrRow) {
        const taskItemId = `wr_task_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`
        const taskInsertRow: any = {
          workflow_id: workflowId,
          stage_id: stageId,
          item_id: taskItemId,
          item_text: data.prompt,
          completed: false,
          item_type: 'operational',
          source_type: 'work_request',
          source_work_request_id: wrRow.id,
          source_thinking_item_id: dbId,
          assignee_id: data.owner_id,
          due_date: data.due_date || null,
        }
        taskInsertRow[scopeIdField] = assetId
        if (scopeType === 'asset') taskInsertRow.created_by = currentUser.id
        const { data: taskRow, error: taskErr } = await supabase.from(itemsTable).insert(taskInsertRow).select('id').single()
        if (taskErr) { console.error('Error creating linked task:', taskErr) }
        else if (taskRow) {
          // 3. Back-link the work request to the created item
          await supabase.from('checklist_work_requests')
            .update({ linked_operational_item_id: taskRow.id })
            .eq('id', wrRow.id)
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workReqKey })
      qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
      qc.invalidateQueries({ queryKey: ['asset-checklist', assetId, workflowId] })
      qc.invalidateQueries({ queryKey: ['recent-quick-ideas'] })
      qc.invalidateQueries({ queryKey: ['quick-thoughts'] })
      qc.invalidateQueries({ queryKey: ['direct-open-prompt-count'] })
      setShowWorkRequestModal(false)
    },
  })

  const updateWorkRequestStatusM = useMutation({
    mutationFn: async ({ id, status: s }: { id: string; status: WorkRequestStatus }) => {
      const updates: any = { status: s }
      if (s === 'completed') updates.completed_at = new Date().toISOString()
      const { error } = await supabase.from('checklist_work_requests').update(updates).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workReqKey }),
  })

  const saveResultNoteM = useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) => {
      const { error } = await supabase.from('checklist_work_requests')
        .update({ result_note: note || null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workReqKey }),
  })

  const deleteWorkRequestM = useMutation({
    mutationFn: async (id: string) => {
      // Find the linked prompt before deleting
      const { data: wr } = await supabase.from('checklist_work_requests').select('prompt_id').eq('id', id).single()
      // Delete the work request
      const { error } = await supabase.from('checklist_work_requests').delete().eq('id', id)
      if (error) throw error
      // Delete the linked prompt if it exists
      if (wr?.prompt_id) {
        await supabase.from('quick_thoughts').delete().eq('id', wr.prompt_id)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: workReqKey })
      qc.invalidateQueries({ queryKey: ['open-prompts-list'] })
      qc.invalidateQueries({ queryKey: ['direct-open-prompt-count'] })
      qc.invalidateQueries({ queryKey: ['recent-quick-ideas'] })
    },
  })

  const resolveQuestionM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('checklist_work_requests')
        .update({ resolved_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: workReqKey }),
  })

  const convertResultToSignalM = useMutation({
    mutationFn: async ({ wrId, signalType, text }: { wrId: string; signalType: SignalType; text: string }) => {
      const dbId = await ensureDbItem()
      if (!dbId || !currentUser) throw new Error('Missing data')
      // Create the signal
      const { data: sig, error: sigErr } = await supabase.from('checklist_item_comments').insert({
        checklist_item_id: dbId, user_id: currentUser.id,
        comment_text: text, signal_type: signalType,
      }).select('id').single()
      if (sigErr) throw sigErr
      // Mark the work request as converted
      if (sig) {
        await supabase.from('checklist_work_requests')
          .update({ result_converted_to_signal_id: sig.id, resolved_at: new Date().toISOString() })
          .eq('id', wrId)
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey })
      qc.invalidateQueries({ queryKey: workReqKey })
    },
  })

  // ─── Download evidence ──────────────────────────────────────────────

  const handleDownload = async (ev: Evidence) => {
    const { data, error } = await supabase.storage.from('assets').download(ev.file_path)
    if (error || !data) return
    const url = URL.createObjectURL(data)
    const a = document.createElement('a')
    a.href = url; a.download = ev.file_name; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Derived ────────────────────────────────────────────────────────

  const signalCount = signals.length
  const evidenceCount = evidence.length
  const activeFollowUps = workRequests.filter(w => w.status !== 'cancelled')
  // Deduplicate by prompt text (keep most recent of each)
  const seenPrompts = new Map<string, typeof activeFollowUps[0]>()
  for (const wr of activeFollowUps) {
    const key = wr.prompt.trim().toLowerCase()
    const existing = seenPrompts.get(key)
    if (!existing || new Date(wr.created_at) > new Date(existing.created_at)) seenPrompts.set(key, wr)
  }
  const dedupedFollowUps = Array.from(seenPrompts.values())
  const openQuestions = dedupedFollowUps.filter(w => !w.resolved_at)
  const answeredQuestions = dedupedFollowUps.filter(w => !!w.resolved_at)
  // Primary blocker: in-flight first, then most recent open
  const primaryBlocker = openQuestions.find(w => w.status === 'in_progress') || openQuestions[0] || null
  const additionalOpen = openQuestions.filter(w => w !== primaryBlocker)
  const hasContent = commentaries.length > 0 || signalCount > 0 || evidenceCount > 0 || dedupedFollowUps.length > 0
  const isLowConfidence = status === 'completed' && !hasContent

  const latestSignal = signals.length > 0 ? signals[signals.length - 1] : null

  // ─── Derived: state badge ────────────────────────────────────────────
  const stateBadge = (() => {
    if (status === 'completed' || status === 'na') return null
    if (openQuestions.length > 0) return { text: openQuestions.length === 1 ? '1 open question' : `${openQuestions.length} open`, color: 'text-amber-600 bg-amber-50' }
    if (commentaries.length === 0) return { text: 'Needs commentary', color: 'text-amber-600 bg-amber-50' }
    return null
  })()

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <>
      <div className={`rounded-lg border transition-all ${
        isExpanded ? 'border-gray-200 bg-white shadow-sm' : 'border-gray-100 hover:border-gray-200 bg-white'
      } ${!isEditable ? 'opacity-75' : ''}`}>

        {/* ── Row ────────────────────────────────────────────────── */}
        <div className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer select-none" onClick={onToggleExpand}>
          <button
            onClick={e => { e.stopPropagation(); onToggleStatus() }}
            disabled={!isEditable}
            className={`flex-shrink-0 w-[18px] h-[18px] mt-[1px] rounded-full border-[1.5px] flex items-center justify-center transition-colors ${
              status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white'
              : status === 'na' ? 'bg-gray-400 border-gray-400 text-white'
              : isEditable ? 'border-gray-300 hover:border-gray-400' : 'border-gray-200'
            } ${!isEditable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
          >
            {status === 'completed' && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
            {status === 'na' && <span className="text-[7px] font-bold leading-none">N/A</span>}
          </button>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className={`text-[13px] font-medium leading-snug ${status === 'completed' ? 'text-gray-400' : 'text-gray-900'}`}>
                {item.text}
              </span>
              {stateBadge && !isExpanded && (
                <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full flex-shrink-0 ${stateBadge.color}`}>{stateBadge.text}</span>
              )}
            </div>
            {/* Collapsed preview */}
            {!isExpanded && commentaries.length > 0 && (
              <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1 leading-snug">{commentaries[0].comment_text}</p>
            )}
          </div>

          <div className="flex items-center gap-1 flex-shrink-0 mt-[1px]">
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-300" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
            {item.isCustom && isEditable && (
              <button onClick={e => { e.stopPropagation(); onRemoveCustom?.() }} className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
            )}
          </div>
        </div>

        {/* ── Expanded ────────────────────────────────────────────── */}
        {isExpanded && (
          <div className="border-t border-gray-100">
            {/* Commentary — per-user entries */}
            <div className="px-4 pt-3 pb-2 space-y-2.5">
              {/* Other people's commentary */}
              {commentaries.filter(c => c.user_id !== currentUser?.id).map(c => (
                <div key={c.id}>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-4 h-4 rounded-full ${avatarColor(userName(c.user))} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white text-[7px] font-semibold">{userInitials(c.user)}</span>
                    </div>
                    <span className="text-[11px] font-medium text-gray-600">{userName(c.user)}</span>
                    <span className="text-[10px] text-gray-400">{relativeTime(c.created_at)}{c.is_edited ? ' · edited' : ''}</span>
                  </div>
                  <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap pl-[22px] mt-0.5">{c.comment_text}</p>
                </div>
              ))}

              {/* My commentary */}
              {editingCommentary ? (
                <div>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-4 h-4 rounded-full ${avatarColor(userName({ first_name: currentUser?.user_metadata?.first_name, last_name: currentUser?.user_metadata?.last_name, email: currentUser?.email }))} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white text-[7px] font-semibold">{userInitials({ first_name: currentUser?.user_metadata?.first_name, last_name: currentUser?.user_metadata?.last_name, email: currentUser?.email })}</span>
                    </div>
                    <span className="text-[11px] font-medium text-gray-600">{userName({ first_name: currentUser?.user_metadata?.first_name, last_name: currentUser?.user_metadata?.last_name, email: currentUser?.email })}</span>
                  </div>
                  <div className="pl-[22px] mt-0.5">
                    <textarea value={commentaryDraft} onChange={e => setCommentaryDraft(e.target.value)} placeholder="Add your commentary..." className="w-full text-[13px] leading-relaxed px-0 py-0 border-0 focus:outline-none focus:ring-0 resize-none text-gray-900 placeholder:text-gray-300" rows={1} autoFocus onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (commentaryDraft.trim()) saveCommentaryM.mutate({ text: commentaryDraft.trim(), existingId: myCommentary?.id }) }; if (e.key === 'Escape') setEditingCommentary(false) }} onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px' }} />
                    <div className="flex items-center gap-2 mt-0.5">
                      <button onClick={() => { if (commentaryDraft.trim()) saveCommentaryM.mutate({ text: commentaryDraft.trim(), existingId: myCommentary?.id }) }} className="text-[10px] font-medium text-blue-600 hover:text-blue-700">Save</button>
                      <button onClick={() => setEditingCommentary(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                  </div>
                </div>
              ) : myCommentary ? (
                <div onClick={() => { if (isEditable) { setEditingCommentary(true); setCommentaryDraft(myCommentary.comment_text) } }} className={`group/commentary ${isEditable ? 'cursor-text' : ''}`}>
                  <div className="flex items-center gap-1.5">
                    <div className={`w-4 h-4 rounded-full ${avatarColor(userName(myCommentary.user))} flex items-center justify-center flex-shrink-0`}>
                      <span className="text-white text-[7px] font-semibold">{userInitials(myCommentary.user)}</span>
                    </div>
                    <span className="text-[11px] font-medium text-gray-600">{userName(myCommentary.user)}</span>
                    <span className="text-[10px] text-gray-400">{relativeTime(myCommentary.created_at)}{myCommentary.is_edited ? ' · edited' : ''}</span>
                    {isEditable && <Edit3 className="w-3 h-3 text-transparent group-hover/commentary:text-gray-300 transition-colors flex-shrink-0" />}
                  </div>
                  <p className="text-[13px] text-gray-800 leading-relaxed whitespace-pre-wrap pl-[22px] mt-0.5">{myCommentary.comment_text}</p>
                </div>
              ) : isEditable ? (
                <button onClick={() => { setEditingCommentary(true); setCommentaryDraft('') }} className="w-full text-left">
                  <p className="text-[13px] text-gray-300 hover:text-gray-400 transition-colors leading-relaxed">Add your commentary...</p>
                </button>
              ) : null}
            </div>

            {/* Supporting notes */}
            {(signalCount > 0 || evidenceCount > 0 || addingSignal || addingEvidence) && (
              <div className="px-4 py-2 border-t border-gray-50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Supporting notes</span>
                </div>
                {addingSignal && (
                  <div className="mb-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex gap-1.5 mb-2">
                      {(Object.entries(SIGNAL_META) as [SignalType, typeof SIGNAL_META[SignalType]][]).map(([key, meta]) => (
                        <button key={key} onClick={() => setSignalType(key)} className={`px-2 py-0.5 text-[10px] font-medium rounded-md transition-colors ${signalType === key ? `${meta.bg} ${meta.color}` : 'text-gray-500 hover:bg-gray-100'}`}>{meta.label}</button>
                      ))}
                      <button onClick={() => setAddingSignal(false)} className="ml-auto text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                    <MentionInput value={signalText} onChange={(v, m, r) => { setSignalText(v); setSignalMentions(m); setSignalReferences(r) }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (signalText.trim()) addSignalM.mutate({ signal_type: signalType, text: signalText.trim() }) }; if (e.key === 'Escape') setAddingSignal(false) }} placeholder="Write your note..." className="text-[12px]" rows={2} hideHelper />
                    <div className="flex justify-end mt-2"><button onClick={() => { if (signalText.trim()) addSignalM.mutate({ signal_type: signalType, text: signalText.trim() }) }} disabled={!signalText.trim()} className={`px-3 py-1 text-[11px] font-medium rounded-md ${signalText.trim() ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-400'}`}>Add</button></div>
                  </div>
                )}
                {addingEvidence && (
                  <div className="mb-3">
                    <input ref={fileInputRef} type="file" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (!f) return; setUploading(true); uploadEvidenceM.mutate({ file: f, evidenceType: 'other', description: evidenceDesc.trim() }); e.target.value = '' }} />
                    <div
                      onDragOver={e => { e.preventDefault(); e.stopPropagation(); setFileDragOver(true) }}
                      onDragLeave={e => { e.preventDefault(); e.stopPropagation(); setFileDragOver(false) }}
                      onDrop={e => {
                        e.preventDefault(); e.stopPropagation(); setFileDragOver(false)
                        const f = e.dataTransfer.files?.[0]
                        if (!f) return
                        setUploading(true)
                        uploadEvidenceM.mutate({ file: f, evidenceType: 'other', description: '' })
                      }}
                      onClick={() => { if (!uploading) fileInputRef.current?.click() }}
                      className={`flex flex-col items-center justify-center gap-1 py-5 rounded-lg border-2 border-dashed cursor-pointer transition-colors ${
                        fileDragOver
                          ? 'border-blue-400 bg-blue-50/50'
                          : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50/50'
                      }`}
                    >
                      {uploading ? (
                        <>
                          <div className="animate-spin w-5 h-5 border-2 border-gray-400 border-t-transparent rounded-full" />
                          <span className="text-[11px] text-gray-500">Uploading...</span>
                        </>
                      ) : (
                        <>
                          <Paperclip className={`w-4 h-4 ${fileDragOver ? 'text-blue-500' : 'text-gray-300'}`} />
                          <span className="text-[11px] text-gray-400">
                            {fileDragOver ? 'Drop to upload' : 'Drop file or click to browse'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="flex items-center justify-end mt-1.5">
                      <button onClick={() => { setAddingEvidence(false); setFileDragOver(false) }} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  {signals.map(s => { const meta = SIGNAL_META[s.signal_type as SignalType] || SIGNAL_META.insight; const isOwn = currentUser?.id === s.user_id; const isEditing = editingSignalId === s.id; return (
                    <div key={s.id} className="group/sig">{isEditing ? (
                      <div className="p-2.5 bg-gray-50 rounded-lg"><textarea value={editingSignalText} onChange={e => setEditingSignalText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); editSignalM.mutate({ id: s.id, text: editingSignalText.trim() }) }; if (e.key === 'Escape') setEditingSignalId(null) }} className="w-full text-[12px] px-0 py-0 border-0 focus:outline-none focus:ring-0 resize-none bg-transparent" rows={2} autoFocus /><div className="flex gap-2 mt-1.5"><button onClick={() => editSignalM.mutate({ id: s.id, text: editingSignalText.trim() })} className="text-[11px] font-medium bg-gray-900 text-white px-3 py-0.5 rounded-md">Save</button><button onClick={() => setEditingSignalId(null)} className="text-[11px] text-gray-400">Cancel</button></div></div>
                    ) : (
                      <div className="flex items-start gap-2.5"><span className={`text-[11px] mt-[1px] flex-shrink-0 ${meta.color}`}>{meta.icon}</span><div className="flex-1 min-w-0"><p className="text-[12px] text-gray-700 leading-relaxed">{s.comment_text}</p><div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-gray-400"><span>{userName(s.user)} · {relativeTime(s.created_at)}</span>{isOwn && <><span className="mx-0.5">·</span><button onClick={() => { setEditingSignalId(s.id); setEditingSignalText(s.comment_text) }} className="hover:text-blue-600">Edit</button><span className="mx-0.5">·</span><button onClick={() => { if (confirm('Delete?')) deleteSignalM.mutate(s.id) }} className="hover:text-red-500">Delete</button></>}</div></div></div>
                    )}</div>
                  ) })}
                  {evidence.map(ev => (
                    <div key={ev.id} className="group/ev flex items-center gap-2.5 py-0.5"><Paperclip className="w-3 h-3 text-gray-300 flex-shrink-0" /><div className="flex-1 min-w-0"><span className="text-[12px] text-gray-700">{ev.file_name}</span>{ev.description && <span className="text-[10px] ml-1.5 text-gray-400">{ev.description}</span>}</div><div className="flex gap-1.5 text-[10px] text-gray-400 flex-shrink-0"><button onClick={() => handleDownload(ev)} className="hover:text-blue-600">Download</button>{isEditable && <button onClick={() => { if (confirm('Remove?')) deleteEvidenceM.mutate(ev.id) }} className="hover:text-red-500">Remove</button>}</div></div>
                  ))}
                </div>
              </div>
            )}

            {/* Prompts */}
            {(dedupedFollowUps.length > 0 || isEditable) && (
              <div className="px-4 py-2 border-t border-gray-50">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wider">Prompts</span>
                  {isEditable && <button onClick={() => setShowWorkRequestModal(true)} className="text-[10px] text-blue-600 hover:text-blue-700 font-medium">+ Ask</button>}
                </div>
                <div className="space-y-3">
                  {dedupedFollowUps.map(wr => {
                    const typeMeta = REQUEST_TYPE_META[wr.request_type as RequestType]
                    return (
                      <div key={wr.id}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-[12px] leading-relaxed flex-1">
                            {typeMeta && <span className={`font-medium ${typeMeta.color}`}>{typeMeta.label}</span>}
                            <span className="text-gray-400"> to {userName(wr.owner)}</span>
                            <span className="text-gray-300 mx-1">·</span>
                            <span className="text-gray-700">{wr.prompt}</span>
                          </p>
                          <div className="flex items-center gap-1.5 flex-shrink-0 mt-0.5 text-[10px]">
                            {wr.prompt_id && (
                              <button onClick={() => openInspector('prompt', wr.prompt_id!)} className="text-blue-600 hover:text-blue-700">Open</button>
                            )}
                            {currentUser?.id === wr.requested_by && (
                              <button onClick={() => setConfirmDeleteWrId(wr.id)} className="text-gray-300 hover:text-red-500">Remove</button>
                            )}
                          </div>
                        </div>
                        {wr.prompt_id && <QuestionThread promptId={wr.prompt_id} />}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Attach button */}
            {isEditable && !addingEvidence && !addingLink && (
              <div className="px-4 py-1.5 border-t border-gray-50 relative" ref={attachMenuRef}>
                <button
                  onClick={() => setShowAttachMenu(!showAttachMenu)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded transition-colors"
                >
                  <Plus className="w-3 h-3" />
                  <span>Attach</span>
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-full left-4 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 min-w-[140px]">
                    <button onClick={() => { setAddingEvidence(true); setEvidenceDesc(''); setShowAttachMenu(false) }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left">
                      <Paperclip className="w-3.5 h-3.5 text-gray-400" />File
                    </button>
                    <button onClick={() => { setAddingLink(true); setLinkUrl(''); setLinkLabel(''); setShowAttachMenu(false) }} className="w-full flex items-center gap-2.5 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 text-left">
                      <LinkIcon className="w-3.5 h-3.5 text-gray-400" />Link
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Inline link attach */}
            {addingLink && (
              <div className="px-4 py-2 border-t border-gray-50">
                <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Attach link</span>
                    <button onClick={() => setAddingLink(false)} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
                  </div>
                  <input
                    value={linkUrl}
                    onChange={e => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="w-full text-[12px] px-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300"
                    autoFocus
                    onKeyDown={e => { if (e.key === 'Escape') setAddingLink(false) }}
                  />
                  <input
                    value={linkLabel}
                    onChange={e => setLinkLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="w-full text-[12px] px-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-300"
                    onKeyDown={e => {
                      if (e.key === 'Enter' && linkUrl.trim()) {
                        e.preventDefault()
                        addSignalM.mutate({ signal_type: 'data_point', text: `${linkLabel.trim() ? linkLabel.trim() + ': ' : ''}${linkUrl.trim()}` })
                        setAddingLink(false)
                      }
                      if (e.key === 'Escape') setAddingLink(false)
                    }}
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => { if (linkUrl.trim()) { addSignalM.mutate({ signal_type: 'data_point', text: `${linkLabel.trim() ? linkLabel.trim() + ': ' : ''}${linkUrl.trim()}` }); setAddingLink(false) } }}
                      disabled={!linkUrl.trim()}
                      className={`px-3 py-1 text-[11px] font-medium rounded-md ${linkUrl.trim() ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-400'}`}
                    >Attach</button>
                  </div>
                </div>
              </div>
            )}

            {item.completedAt && (<div className="px-4 py-2 border-t border-gray-50 text-[10px] text-gray-400">{status === 'na' ? 'N/A' : 'Completed'} by {userName(item.completedByUser)} · {new Date(item.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>)}
          </div>
        )}
      </div>

      {/* Confirm delete question */}
      {confirmDeleteWrId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm" onClick={() => setConfirmDeleteWrId(null)}>
          <div className="bg-white rounded-lg shadow-xl w-full max-w-sm mx-4 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-gray-900 mb-1">Remove question</h3>
            <p className="text-[13px] text-gray-500 mb-4">This will remove the question and its linked prompt. Any responses will no longer be visible here.</p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDeleteWrId(null)} className="px-3 py-1.5 text-[12px] text-gray-600 hover:text-gray-900 transition-colors">Cancel</button>
              <button onClick={() => { deleteWorkRequestM.mutate(confirmDeleteWrId); setConfirmDeleteWrId(null) }} className="px-3 py-1.5 text-[12px] font-medium text-white bg-red-600 rounded-md hover:bg-red-700 transition-colors">Remove</button>
            </div>
          </div>
        </div>
      )}

      {/* Work Request Modal */}
      {showWorkRequestModal && (
        <WorkRequestModal
          onSubmit={data => createWorkRequestM.mutate(data)}
          onClose={() => setShowWorkRequestModal(false)}
        />
      )}
    </>
  )
}
