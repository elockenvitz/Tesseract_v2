/**
 * OperationalItemCard
 *
 * Lean workflow task row for operational/recurring process items.
 * Supports: assignee, due date, notes, attachments, lightweight comments.
 * Does NOT show: takeaway, signals, evidence, work requests.
 */
import React, { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Check, ChevronDown, ChevronRight, Trash2, Paperclip,
  Upload, Download, FileText, X,
  Search, Send, MessageSquare, Link as LinkIcon, BrainCircuit,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import { useOrgMembers } from '../../../hooks/useOrgMembers'
import { useOrganizationOptional } from '../../../contexts/OrganizationContext'
import { assetsPath } from '../../../lib/storage/asset-paths'
import { draftKey, readDraft, writeDraft, clearDraft } from '../../../lib/asset-work/requirement-drafts'
import {
  statusOf, primaryAction, secondaryActions, ACTION_LABEL,
  type RequirementAction,
} from '../../../lib/asset-work/requirement-status'
import { ConfirmDialog } from '../ConfirmDialog'
import { useToastOptional } from '../../common/toast-context'
import {
  ChecklistItemData,
  userName, userInitials, avatarColor, relativeTime,
} from './types'

// ─── Props ──────────────────────────────────────────────────────────────

interface OperationalItemCardProps {
  item: ChecklistItemData
  stageId: string
  assetId: string
  workflowId: string
  isEditable: boolean
  isExpanded: boolean
  onToggleExpand: () => void
  /**
   * The row layout's circle: performs the primary action for the current
   * status, which the parent resolves. Kept as a nullary callback because
   * the row has one control and one destination.
   */
  onToggleStatus?: () => void
  /**
   * The detail layout's named controls. Each asks for one explicit
   * transition; the card never decides where a status should go next.
   */
  onStatusAction?: (action: RequirementAction) => void
  onRemoveCustom?: () => void
  currentUser: { id: string; email?: string; user_metadata?: { first_name?: string; last_name?: string } } | null
  scopeType?: 'asset' | 'portfolio'
  /**
   * How this requirement is presented.
   *
   * `row` is the original: a clickable header that expands an accordion
   * beneath it. `detail` is the same body with the accordion chrome
   * removed and the title promoted — for a surface where the requirement
   * IS the page rather than one line of a list.
   *
   * A presentation switch only. Every query, mutation and control below is
   * shared verbatim between the two, because the alternative — a second
   * component that writes notes, uploads files and posts comments its own
   * way — is two implementations of one capability, and they drift.
   */
  layout?: 'row' | 'detail'
  /** The surface already names the requirement; see the note at the title. */
  hideTitle?: boolean
}

// ─── Component ──────────────────────────────────────────────────────────

export function OperationalItemCard({
  item, stageId, assetId, workflowId, isEditable, isExpanded,
  onToggleExpand, onToggleStatus, onStatusAction, onRemoveCustom, currentUser,
  scopeType = 'asset', layout = 'row', hideTitle = false,
}: OperationalItemCardProps) {
  /* In the detail layout the body is the surface; there is nothing to
     expand into and nothing to collapse. */
  const detail = layout === 'detail'
  const bodyOpen = detail || isExpanded
  const itemsTable = scopeType === 'portfolio' ? 'portfolio_checklist_items' : 'asset_checklist_items'
  const attachTable = scopeType === 'portfolio' ? 'portfolio_checklist_attachments' : 'asset_checklist_attachments'
  const scopeIdField = scopeType === 'portfolio' ? 'portfolio_id' : 'asset_id'
  const qc = useQueryClient()
  // Optional on purpose: useOrganization() throws without a provider, and
  // a throw in a leaf like this takes the whole surface down. A null org
  // instead fails loudly at upload time, where assetsPath() rejects it.
  const currentOrgId = useOrganizationOptional()?.currentOrgId ?? null
  const toast = useToastOptional()
  const status = statusOf(item)
  const primary = primaryAction(status)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Local state ────────────────────────────────────────────────────

  /*
   * Unsent text survives the card.
   *
   * Switching requirements unmounts this component, so both editors open
   * from whatever was last typed into them rather than from empty. The
   * draft is cleared the moment the text is saved — see each mutation's
   * `onSuccess` — so a kept draft always means "not saved yet".
   */
  const notesDraftKey = draftKey(item.id, 'notes')
  const commentDraftKey = draftKey(item.id, 'comment')
  const keptNotes = readDraft(notesDraftKey)
  const keptComment = readDraft(commentDraftKey)

  const [editingNotes, setEditingNotes] = useState(() => keptNotes !== null)
  const [notesDraft, setNotesDraft] = useState(() => keptNotes ?? item.notes ?? '')
  const [assigningOwner, setAssigningOwner] = useState(false)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  /*
   * The comment awaiting confirmation. A native `confirm()` used to sit
   * here: it blocked the whole tab, carried no product styling, and said
   * only "Delete comment?" — not whose, and not that it cannot be undone.
   */
  const [pendingCommentDelete, setPendingCommentDelete] = useState<string | null>(null)
  const [addingComment, setAddingComment] = useState(() => keptComment !== null)
  const [commentText, setCommentText] = useState(() => keptComment ?? '')

  /*
   * Typing writes the draft; opening an editor does not. Otherwise clicking
   * into saved notes and pressing Escape left behind a "draft" identical to
   * the stored text, which reopened the editor on the next visit and
   * claimed unsaved work that did not exist.
   */
  const editNotes = (text: string) => { setNotesDraft(text); writeDraft(notesDraftKey, text) }
  const editComment = (text: string) => { setCommentText(text); writeDraft(commentDraftKey, text) }
  const openNotesEditor = () => { setNotesDraft(item.notes || ''); setEditingNotes(true) }
  const notesDirty = notesDraft !== (item.notes ?? '')

  // ─── Queries ────────────────────────────────────────────────────────

  // Org-scoped — see comment on matching swap in CollaborationManager.
  const { data: users = [] } = useOrgMembers({ enabled: assigningOwner })

  const commentsKey = ['op-item-comments', item.dbId]
  const { data: comments = [] } = useQuery({
    queryKey: commentsKey,
    queryFn: async () => {
      if (!item.dbId) return []
      const { data, error } = await supabase
        .from('checklist_item_comments')
        .select('*, user:users!checklist_item_comments_user_id_fkey(id, email, first_name, last_name)')
        .eq('checklist_item_id', item.dbId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return data || []
    },
    /* `bodyOpen`, not `isExpanded`: in the detail layout there is no
       accordion, and gating on it left the surface depending on the caller
       passing `isExpanded: true` for a body that is always open. */
    enabled: !!item.dbId && bodyOpen,
  })

  const attachKey = ['op-item-attach', assetId, workflowId, stageId, item.id, scopeType]
  const { data: attachments = [] } = useQuery({
    queryKey: attachKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from(attachTable)
        .select('*')
        .eq(scopeIdField, assetId).eq('workflow_id', workflowId)
        .eq('stage_id', stageId).eq('item_id', item.id)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
    enabled: !!assetId && !!workflowId && bodyOpen,
  })

  // ─── DB helper ──────────────────────────────────────────────────────

  const ensureDbItem = async (): Promise<string | null> => {
    if (item.dbId) return item.dbId
    if (!currentUser) return null
    const { data: existing } = await supabase.from(itemsTable)
      .select('id').eq(scopeIdField, assetId).eq('workflow_id', workflowId)
      .eq('stage_id', stageId).eq('item_id', item.id).maybeSingle()
    if (existing) return existing.id
    const insertRow: any = { workflow_id: workflowId, stage_id: stageId, item_id: item.id, item_text: item.text, completed: false, item_type: 'operational' }
    insertRow[scopeIdField] = assetId
    if (scopeType === 'asset') insertRow.created_by = currentUser.id
    const { data: created, error } = await supabase.from(itemsTable)
      .insert(insertRow)
      .select('id').single()
    if (error) { console.error('ensureDbItem:', error); return null }
    qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
    return created.id
  }

  // ─── Mutations ──────────────────────────────────────────────────────

  const updateFieldM = useMutation({
    mutationFn: async (fields: Record<string, any>) => {
      const dbId = await ensureDbItem()
      if (!dbId) throw new Error('No DB item')
      const { error } = await supabase.from(itemsTable).update(fields).eq('id', dbId)
      if (error) throw error
    },
    onSuccess: (_d, fields) => {
      /* Saved text is no longer a draft. */
      if ('notes' in fields) clearDraft(notesDraftKey)
      qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
      qc.invalidateQueries({ queryKey: ['asset-checklist', assetId, workflowId] })
    },
    /*
     * This wrote assignment, notes and the due date and reported nothing
     * when it failed: the picker closed, the row looked assigned, and the
     * database had not changed. Refetching is what puts the row back.
     */
    onError: (_e, fields) => {
      qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
      toast.error(
        'assignee_id' in fields ? 'The assignment was not saved.' : 'That change was not saved.',
        { description: 'The requirement has been put back as it was.' },
      )
    },
  })

  const addCommentM = useMutation({
    mutationFn: async (text: string) => {
      const dbId = await ensureDbItem()
      if (!dbId || !currentUser) throw new Error('Missing data')
      const { error } = await supabase.from('checklist_item_comments').insert({
        checklist_item_id: dbId, user_id: currentUser.id, comment_text: text, signal_type: 'insight',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commentsKey })
      clearDraft(commentDraftKey)
      setCommentText('')
      setAddingComment(false)
    },
  })

  const deleteCommentM = useMutation({
    mutationFn: async (id: string) => {
      if (!currentUser) throw new Error('No user')
      const { error } = await supabase.from('checklist_item_comments').delete().eq('id', id).eq('user_id', currentUser.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
  })

  const uploadFileM = useMutation({
    mutationFn: async (file: File) => {
      if (!currentUser) throw new Error('No user')
      const filePath = assetsPath(currentOrgId, assetId, workflowId, stageId, item.id, `${Date.now()}_${file.name}`)
      const { error: upErr } = await supabase.storage.from('assets').upload(filePath, file)
      if (upErr) throw upErr
      const insertRow: any = {
        workflow_id: workflowId, stage_id: stageId, item_id: item.id,
        file_name: file.name, file_path: filePath, file_size: file.size, file_type: file.type,
        uploaded_by: currentUser.id, evidence_type: 'other',
      }
      insertRow[scopeIdField] = assetId
      const { error: dbErr } = await supabase.from(attachTable).insert(insertRow)
      if (dbErr) throw dbErr
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: attachKey }); setUploading(false); setUploadError(null) },
    /* A failed upload used to end as a spinner that stopped: no file, no
       message, nothing to retry from. */
    onError: (err: unknown) => {
      setUploading(false)
      setUploadError(err instanceof Error ? err.message : 'Upload failed')
    },
  })

  const deleteFileM = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from(attachTable).delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: attachKey }),
  })

  const handleDownload = async (att: any) => {
    const { data, error } = await supabase.storage.from('assets').download(att.file_path)
    if (error || !data) return
    const url = URL.createObjectURL(data)
    const a = document.createElement('a'); a.href = url; a.download = att.file_name; a.click()
    URL.revokeObjectURL(url)
  }

  // ─── Derived ────────────────────────────────────────────────────────

  const assigneeName = item.assignee ? userName(item.assignee) : null
  const commentCount = comments.length
  const attachCount = attachments.length + (item.attachments?.length || 0)
  const filteredUsers = (users || []).filter(u => {
    if (!ownerSearch) return true
    const q = ownerSearch.toLowerCase()
    return userName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  // ─── Render ─────────────────────────────────────────────────────────

  return (
    <div className={detail
      /*
        No frame of its own in the detail layout.

        The workspace around this already heads the region "Your
        assessment" and rules it off, so a card border here produced a
        bordered box inside a bordered section — and the writing area a
        third border inside that. Three nested frames for one piece of
        text. The workspace owns the framing; this owns the content.
      */
      ? `flex min-h-0 flex-col ${!isEditable ? 'opacity-75' : ''}`
      : `rounded-lg border transition-all ${
          isExpanded ? 'border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-800' : 'border-gray-100 hover:border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-800'
        } ${!isEditable ? 'opacity-75' : ''}`}>

      {/* ── Detail header: the requirement, and what you can do to it ──
          The title, one statement of status, and the completion action.
          Nothing below repeats any of the three. */}
      {detail && (
        <div className="mb-3">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {/*
                The title is the workspace's, not the card's.

                `RequirementWorkspace` sets the requirement as the heading of
                the whole surface, 17px, directly under the stage. The card
                then set it AGAIN in 16px two hundred pixels below, which is
                how "Your work" came to read as a separate checklist item
                about the thing above it rather than the place to do it.
                Rendered only when this card is the whole surface.
              */}
              {!hideTitle && (
                <h3
                  data-testid="requirement-detail-title"
                  className={`text-[16px] font-semibold leading-snug ${status === 'completed' ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}
                >
                  {item.text}
                </h3>
              )}
              {/*
                The template carries a title, a type and an order — there is
                no description column on `workflow_checklist_templates`, so
                there are no instructions to show here. Inventing a sentence
                about what "Flex Model" means would be writing the analyst's
                process for them.
              */}
              <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400">
                <span className={
                  status === 'completed' ? 'font-medium text-emerald-600 dark:text-emerald-400'
                  : status === 'na' ? 'font-medium text-gray-400'
                  : 'font-medium text-amber-600 dark:text-amber-400'
                }>
                  {status === 'completed' ? 'Complete' : status === 'na' ? 'Not applicable' : 'Open'}
                </span>
                {item.completedAt && (
                  <>
                    <span aria-hidden>·</span>
                    <span>
                      {userName(item.completedByUser)} · {new Date(item.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                    </span>
                  </>
                )}
                {item.due_date && (
                  <>
                    <span aria-hidden>·</span>
                    <span>Due {new Date(item.due_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                  </>
                )}
                {item.isCustom && (<><span aria-hidden>·</span><span>added here</span></>)}
              </p>
            </div>

            {/*
              Named actions, not a cycle. Each button states its
              destination and performs exactly that transition; there is no
              control here that can take a finished requirement somewhere
              the reader did not ask for. Marking a completed requirement
              not applicable takes two deliberate steps — Reopen, then Mark
              not applicable — because it is two decisions.
            */}
            <div className="flex flex-shrink-0 items-center gap-1.5">
              <button
                onClick={() => onStatusAction?.(primary)}
                disabled={!isEditable}
                data-testid="requirement-detail-status"
                data-action={primary}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
                  !isEditable ? 'cursor-not-allowed bg-gray-100 text-gray-400 dark:bg-gray-800'
                  : primary === 'complete'
                    /* Outlined for the same reason as the decision card:
                       in the workspace, completing is the record of the
                       work and must not outrank the work. */
                    ? 'border border-emerald-600 text-emerald-700 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300'
                }`}
              >
                {primary === 'complete' && <Check className="h-3 w-3" strokeWidth={3} />}
                {ACTION_LABEL[primary]}
              </button>
              {isEditable && secondaryActions(status).map(a => (
                <button
                  key={a}
                  onClick={() => onStatusAction?.(a)}
                  data-testid={`requirement-detail-action-${a}`}
                  data-action={a}
                  className="rounded-md px-2 py-1 text-[11px] font-medium text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>

            {item.isCustom && isEditable && (
              <button
                onClick={() => onRemoveCustom?.()}
                aria-label="Remove this requirement"
                className="flex-shrink-0 rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-500"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* ── Header row ─────────────────────────────────────────── */}
      {!detail && (
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
        <button
          onClick={e => { e.stopPropagation(); onToggleStatus?.() }}
          disabled={!isEditable}
          className={`flex-shrink-0 w-[18px] h-[18px] mt-[1px] rounded-full border-[1.5px] flex items-center justify-center transition-colors ${
            status === 'completed' ? 'bg-emerald-500 border-emerald-500 text-white'
            : status === 'na' ? 'bg-gray-400 border-gray-400 text-white'
            : isEditable ? 'border-gray-300 hover:border-gray-400 dark:border-gray-600' : 'border-gray-200 dark:border-gray-700'
          } ${!isEditable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
        >
          {status === 'completed' && <Check className="w-2.5 h-2.5" strokeWidth={3} />}
          {status === 'na' && <span className="text-[7px] font-bold leading-none">N/A</span>}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-[13px] font-medium leading-snug ${status === 'completed' ? 'text-gray-400' : 'text-gray-900 dark:text-white'}`}>
              {item.text}
            </span>
          </div>
          {/* Collapsed preview: assignee */}
          {!isExpanded && item.assignee && (
            <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1 leading-snug dark:text-gray-400">{userName(item.assignee)}</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 mt-[1px]">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-300" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
          {item.isCustom && isEditable && (
            <button onClick={e => { e.stopPropagation(); onRemoveCustom?.() }} className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
          )}
        </div>
      </div>
      )}

      {/* ── Body: owner, notes, attachments, comments ─────────────── */}
      {bodyOpen && (
        <div className={detail
          ? 'min-h-0 flex-1 overflow-y-auto text-[12px]'
          : 'border-t border-gray-100 text-[12px] dark:border-gray-800'}>

          {/* ── Source provenance ───────────────────────────────── */}
          {item.source_type === 'work_request' && (
            <div className="flex items-start gap-2 px-3 py-2 bg-purple-50/40 border-b border-purple-100/80">
              <BrainCircuit className="w-3.5 h-3.5 text-purple-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider">Follow-up from analysis</span>
                {item.source_thinking_item_text && (
                  <p className="text-[11px] text-purple-700/80 mt-0.5 leading-snug">"{item.source_thinking_item_text}"</p>
                )}
              </div>
            </div>
          )}

          {/* ── Owner row ──────────────────────────────────────── */}
          {/* Part of the header strip in the detail layout, not a section
              of its own: who owns the requirement is identity, not work. */}
          <div className={detail
            ? 'mb-3 flex items-center gap-3 border-b border-gray-100 pb-2.5 dark:border-gray-800'
            : 'flex items-center gap-3 px-3 py-1.5 border-b border-gray-100 dark:border-gray-800'}>
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-[44px] flex-shrink-0">Owner</span>
              {assigningOwner ? (
                <div className="relative">
                  <div className="flex items-center gap-1 border border-gray-200 rounded px-1.5 py-0.5 dark:border-gray-700">
                    <Search className="w-3 h-3 text-gray-400" />
                    <input
                      value={ownerSearch} onChange={e => setOwnerSearch(e.target.value)}
                      placeholder="Search..." className="text-[11px] w-[120px] bg-transparent focus:outline-none"
                      autoFocus onKeyDown={e => { if (e.key === 'Escape') setAssigningOwner(false) }}
                    />
                    <button onClick={() => setAssigningOwner(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"><X className="w-3 h-3" /></button>
                  </div>
                  <div className="absolute top-full left-0 mt-0.5 w-[200px] bg-white border border-gray-200 rounded shadow-lg z-10 max-h-[140px] overflow-y-auto dark:border-gray-700 dark:bg-gray-800">
                    {filteredUsers.map(u => (
                      <button
                        key={u.id}
                        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-gray-50 text-[11px] dark:hover:bg-gray-800"
                        onClick={() => {
                          updateFieldM.mutate({ assignee_id: u.id })
                          setAssigningOwner(false); setOwnerSearch('')
                        }}
                      >
                        <div className={`w-4 h-4 rounded-full ${avatarColor(userName(u))} flex items-center justify-center`}>
                          <span className="text-white text-[7px] font-semibold">{userInitials(u)}</span>
                        </div>
                        <span>{userName(u)}</span>
                      </button>
                    ))}
                    {/*
                      The way back to nobody. Assignment had no inverse at
                      all: once a requirement was given to someone there
                      was no control that could take it back, so a wrong
                      pick was permanent. Same mutation, same picker, one
                      more row — and `assignee_id: null` touches only that
                      column, so notes, files, comments and completion are
                      untouched.
                    */}
                    {item.assignee_id && (
                      <button
                        data-testid="requirement-unassign"
                        className="w-full border-t border-gray-100 px-2 py-1 text-left text-[11px] text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-800"
                        onClick={() => {
                          updateFieldM.mutate({ assignee_id: null })
                          setAssigningOwner(false); setOwnerSearch('')
                        }}
                      >
                        Clear assignment
                      </button>
                    )}
                  </div>
                </div>
              ) : assigneeName ? (
                <button
                  onClick={() => isEditable && setAssigningOwner(true)}
                  aria-label={`Change or clear the assignee, currently ${assigneeName}`}
                  className="flex items-center gap-1.5 text-[11px] text-gray-700 hover:text-blue-600 transition-colors dark:text-gray-300"
                >
                  <div className={`w-4 h-4 rounded-full ${avatarColor(assigneeName)} flex items-center justify-center`}>
                    <span className="text-white text-[7px] font-semibold">{userInitials(item.assignee)}</span>
                  </div>
                  {assigneeName}
                </button>
              ) : isEditable ? (
                <button onClick={() => setAssigningOwner(true)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                  + Assign
                </button>
              ) : (
                <span className="text-[11px] text-gray-400">Unassigned</span>
              )}
            </div>
          </div>

          {/* ── Notes ───────────────────────────────────────────── */}
          {/*
            The findings, not a field called Notes.

            `asset_checklist_items.notes` is one text column per
            requirement, so this is one document the analyst keeps — not a
            feed of entries, and it is not turned into one here. In the
            detail layout it is the first and largest thing on the surface,
            set at a reading width, and the saved text itself is the edit
            affordance.
          */}
          <div className={detail
            ? 'mb-1'
            : 'px-3 py-1.5 border-b border-gray-100 dark:border-gray-800'}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {detail ? 'Working notes' : 'Notes'}
              </span>
              {isEditable && !editingNotes && (
                <button onClick={openNotesEditor} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                  {item.notes ? 'Edit' : '+ Add note'}
                </button>
              )}
              {/* Reactive, and only when the text actually differs from
                  what is stored — opening the editor is not an edit. */}
              {detail && editingNotes && notesDirty && !updateFieldM.isPending && (
                <span className="text-[10px] text-amber-600 dark:text-amber-400">Unsaved</span>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea
                  value={notesDraft} onChange={e => editNotes(e.target.value)}
                  placeholder={detail
                    ? 'What did you find? What did you conclude, and what would change it?'
                    : 'Add task notes, instructions, or context...'}
                  className={detail
                    ? 'w-full max-w-[78ch] rounded border border-gray-200 px-3 py-2 text-[13px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900'
                    : 'w-full text-[12px] px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none leading-snug dark:border-gray-700'}
                  rows={detail ? 10 : 2} autoFocus
                  onKeyDown={e => {
                    /*
                      In the detail layout Enter is a new paragraph. This
                      is somewhere analysts write several sentences, and a
                      field that saves and closes on Enter cannot hold
                      them. Ctrl/Cmd+Enter saves instead.
                    */
                    const save = detail
                      ? e.key === 'Enter' && (e.metaKey || e.ctrlKey)
                      : e.key === 'Enter' && !e.shiftKey
                    if (save) { e.preventDefault(); updateFieldM.mutate({ notes: notesDraft.trim() || null }); setEditingNotes(false) }
                    /* Escape leaves the editor; the draft is kept, so
                       nothing typed is thrown away by a stray keypress. */
                    if (e.key === 'Escape') setEditingNotes(false)
                  }}
                />
                <div className="flex items-center gap-2 mt-1">
                  <button onClick={() => { updateFieldM.mutate({ notes: notesDraft.trim() || null }); setEditingNotes(false) }} className="text-[10px] font-medium bg-gray-900 text-white px-2 py-0.5 rounded">Save</button>
                  <button onClick={() => { clearDraft(notesDraftKey); setNotesDraft(item.notes || ''); setEditingNotes(false) }} className="text-[10px] text-gray-500 dark:text-gray-400">Cancel</button>
                  {detail && <span className="text-[10px] text-gray-300">{navigator.platform.includes('Mac') ? '⌘' : 'Ctrl'}+Enter saves</span>}
                </div>
              </div>
            ) : item.notes ? (
              detail ? (
                /* The notes are the edit control. An "Edit" link above a
                   paragraph is discoverable only if you look for it. */
                <div
                  onClick={() => { if (isEditable) openNotesEditor() }}
                  className={`group/notes max-w-[78ch] whitespace-pre-wrap rounded text-[13px] leading-relaxed text-gray-800 dark:text-gray-200 ${isEditable ? 'cursor-text hover:bg-gray-50 dark:hover:bg-gray-800/60' : ''}`}
                  data-testid="requirement-notes-body"
                >
                  {item.notes}
                </div>
              ) : (
                <p className="text-[12px] text-gray-700 leading-snug whitespace-pre-wrap dark:text-gray-300">{item.notes}</p>
              )
            ) : detail && isEditable ? (
              /* Empty: one line and one action, not a card. */
              <button
                onClick={openNotesEditor}
                data-testid="requirement-notes-empty"
                /*
                  Sized like the writing it invites, not like a form field.

                  A one-line dashed strip read as a minor optional field,
                  and "Read/Summarize News" is not a field — it is the
                  place a summary gets written. In the detail layout this
                  opens to a 10-row editor, so the resting state claims
                  roughly that much room and stops the work area looking
                  like the smallest thing on the screen.
                */
                className={detail
                  ? 'w-full max-w-[78ch] rounded-md border border-dashed border-gray-300 px-3.5 py-6 text-left text-[13px] leading-relaxed text-gray-400 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-500 dark:border-gray-700 dark:hover:bg-gray-900'
                  : 'w-full max-w-[78ch] rounded border border-dashed border-gray-200 px-3 py-2.5 text-left text-[12px] text-gray-400 transition-colors hover:border-gray-300 hover:text-gray-500 dark:border-gray-700'}
              >
                Nothing documented yet — write what you found here.
              </button>
            ) : null}
          </div>

          {/*
            Supporting material, beside the discussion rather than under
            it. Both are short, both are secondary to the notes, and at
            1,194px stacking them left a column of whitespace next to each.
          */}
          {/* `xl`, not `lg`: the pane is ~725px at a 1150px viewport
              because the sidebar stacks above it, and two columns there are
              340px each — narrower than the single column they replaced. */}
          <div className={detail ? 'mt-3 grid grid-cols-1 gap-x-6 gap-y-3 border-t border-gray-100 pt-3 xl:grid-cols-2 dark:border-gray-800' : ''}>

          {/* ── Attachments ─────────────────────────────────────── */}
          <div className={detail ? 'min-w-0' : 'px-3 py-1.5 border-b border-gray-100 dark:border-gray-800'}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {detail && <Paperclip className="h-2.5 w-2.5" />}
                Attachments{attachments.length > 0 && ` (${attachments.length})`}
              </span>
              {isEditable && (
                <>
                  <input ref={fileInputRef} type="file" className="hidden" onChange={e => {
                    const f = e.target.files?.[0]; if (!f) return; setUploading(true); uploadFileM.mutate(f); e.target.value = ''
                  }} />
                  <button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium flex items-center gap-0.5">
                    {uploading ? <div className="animate-spin w-2.5 h-2.5 border border-blue-600 border-t-transparent rounded-full" /> : <Upload className="w-2.5 h-2.5" />}
                    {uploading ? 'Uploading...' : '+ Attach file'}
                  </button>
                </>
              )}
            </div>
            {/* A spinner that simply stopped was the whole failure report. */}
            {uploadError && (
              <p data-testid="requirement-upload-error" className="mt-1 text-[10px] text-red-600 dark:text-red-400">
                {uploadError} — the file was not attached.
              </p>
            )}
            {attachments.length > 0 ? (
              <div className="space-y-0">
                {attachments.map((att: any) => (
                  <div key={att.id} className="group/att flex items-center gap-2 py-0.5 hover:bg-gray-50 rounded px-1 dark:hover:bg-gray-800">
                    <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <button
                      onClick={() => handleDownload(att)}
                      className="min-w-0 flex-1 truncate text-left text-[11px] text-gray-700 hover:text-blue-600 dark:text-gray-300"
                    >
                      {att.file_name}
                    </button>
                    {detail && att.file_size ? (
                      <span className="flex-shrink-0 text-[10px] text-gray-300">{Math.max(1, Math.round(att.file_size / 1024))} KB</span>
                    ) : null}
                    <span className="flex-shrink-0 text-[10px] text-gray-400">{relativeTime(att.created_at)}</span>
                    <div className="flex flex-shrink-0 gap-0.5 opacity-0 group-hover/att:opacity-100 transition-opacity">
                      <button onClick={() => handleDownload(att)} aria-label={`Download ${att.file_name}`} className="p-0.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600"><Download className="w-3 h-3" /></button>
                      {/*
                        "Remove", deliberately — this detaches the file from
                        the requirement. The stored object is left behind by
                        `deleteFileM` today, so the control must not promise
                        a deletion the product does not perform. Reported as
                        its own issue; the semantics are untouched here.
                      */}
                      {isEditable && (
                        <button
                          onClick={() => deleteFileM.mutate(att.id)}
                          aria-label={`Remove ${att.file_name} from this requirement`}
                          title="Remove from this requirement"
                          className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : detail ? (
              <p className="text-[11px] text-gray-300">No files attached.</p>
            ) : null}
          </div>

          {/* ── Discussion ──────────────────────────────────────────
              Named apart from the notes on purpose: what colleagues say
              about a requirement is not the same artefact as what the
              analyst concluded, and the two must not read as one list. */}
          <div className={detail
            ? 'min-w-0 border-t border-gray-100 pt-3 xl:border-l xl:border-t-0 xl:pl-6 xl:pt-0 dark:border-gray-800'
            : 'px-3 py-1.5'}>
            <div className="flex items-center justify-between mb-0.5">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                {detail && <MessageSquare className="h-2.5 w-2.5" />}
                {detail ? 'Discussion' : 'Comments'}{commentCount > 0 && ` (${commentCount})`}
              </span>
              {!addingComment && (
                <button onClick={() => setAddingComment(true)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">+ Add comment</button>
              )}
            </div>
            {comments.length === 0 && !addingComment && detail && (
              <p className="text-[11px] text-gray-300">No discussion yet.</p>
            )}
            {comments.length > 0 && (
              <div className="space-y-1 mb-1.5">
                {comments.map((c: any) => {
                  const cUser = c.user
                  const isOwn = currentUser?.id === c.user_id
                  return (
                    <div key={c.id} className="group/c flex gap-2 py-1 -mx-1 px-1 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
                      <div className={`w-5 h-5 rounded-full ${avatarColor(userName(cUser))} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <span className="text-white text-[8px] font-semibold">{userInitials(cUser)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-gray-700 dark:text-gray-300">{userName(cUser)}</span>
                          <span className="text-[10px] text-gray-400">{relativeTime(c.created_at)}</span>
                          {isOwn && (
                            <button onClick={() => setPendingCommentDelete(c.id)}
                              aria-label="Delete this comment"
                              className="opacity-0 group-hover/c:opacity-100 p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 ml-auto">
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        <p className={detail
                          ? 'whitespace-pre-wrap text-[12px] leading-relaxed text-gray-700 dark:text-gray-300'
                          : 'text-[11px] text-gray-700 leading-snug dark:text-gray-300'}>{c.comment_text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {addingComment && (
              <div>
                <textarea
                  value={commentText} onChange={e => editComment(e.target.value)}
                  placeholder="Add a comment..."
                  className={detail
                    ? 'w-full rounded border border-gray-200 px-2 py-1.5 text-[12px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-gray-400 dark:border-gray-700 dark:bg-gray-900'
                    : 'w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none dark:border-gray-700'}
                  rows={detail ? 3 : 2} autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (commentText.trim()) addCommentM.mutate(commentText.trim()) }
                    /* The draft is kept, so Escape closes the composer
                       without taking the message with it. */
                    if (e.key === 'Escape') setAddingComment(false)
                  }}
                />
                <div className="flex items-center justify-end gap-2 mt-1">
                  <button onClick={() => { clearDraft(commentDraftKey); setCommentText(''); setAddingComment(false) }} className="text-[10px] text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">Discard</button>
                  <button
                    onClick={() => { if (commentText.trim()) addCommentM.mutate(commentText.trim()) }}
                    disabled={!commentText.trim()}
                    className={`px-2.5 py-0.5 text-[10px] font-medium rounded transition-colors ${commentText.trim() ? 'bg-gray-900 text-white' : 'bg-gray-200 text-gray-400'}`}
                  >
                    Send
                  </button>
                </div>
              </div>
            )}
          </div>

          </div>{/* ── end supporting pair ───────────────────────────── */}

          {/* Completion footer — the detail header already states this, and
              saying it twice on one surface is what the header replaced. */}
          {item.completedAt && !detail && (
            <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/50 text-[10px] text-gray-400 dark:border-gray-800">
              Completed by {userName(item.completedByUser)} · {new Date(item.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}

      {/* Destructive confirmation, in the product's own dialog. States
          what goes and that it does not come back; Cancel mutates
          nothing, and neither path touches the notes or comment drafts. */}
      <ConfirmDialog
        isOpen={pendingCommentDelete !== null}
        onClose={() => setPendingCommentDelete(null)}
        onConfirm={() => {
          if (pendingCommentDelete) deleteCommentM.mutate(pendingCommentDelete)
          setPendingCommentDelete(null)
        }}
        title="Delete this comment?"
        message="Your comment will be removed from this requirement for everyone. This cannot be undone."
        confirmText="Delete comment"
        isLoading={deleteCommentM.isPending}
      />
    </div>
  )
}
