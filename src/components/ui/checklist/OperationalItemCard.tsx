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
  onToggleStatus: () => void
  onRemoveCustom?: () => void
  currentUser: { id: string; email?: string; user_metadata?: { first_name?: string; last_name?: string } } | null
  scopeType?: 'asset' | 'portfolio'
}

// ─── Component ──────────────────────────────────────────────────────────

export function OperationalItemCard({
  item, stageId, assetId, workflowId, isEditable, isExpanded,
  onToggleExpand, onToggleStatus, onRemoveCustom, currentUser,
  scopeType = 'asset',
}: OperationalItemCardProps) {
  const itemsTable = scopeType === 'portfolio' ? 'portfolio_checklist_items' : 'asset_checklist_items'
  const attachTable = scopeType === 'portfolio' ? 'portfolio_checklist_attachments' : 'asset_checklist_attachments'
  const scopeIdField = scopeType === 'portfolio' ? 'portfolio_id' : 'asset_id'
  const qc = useQueryClient()
  const status = item.status || (item.completed ? 'completed' : 'unchecked')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ─── Local state ────────────────────────────────────────────────────
  const [editingNotes, setEditingNotes] = useState(false)
  const [notesDraft, setNotesDraft] = useState(item.notes || '')
  const [assigningOwner, setAssigningOwner] = useState(false)
  const [ownerSearch, setOwnerSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [addingComment, setAddingComment] = useState(false)
  const [commentText, setCommentText] = useState('')

  // ─── Queries ────────────────────────────────────────────────────────

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase.from('users').select('id, email, first_name, last_name').order('first_name')
      if (error) throw error
      return data || []
    },
    enabled: assigningOwner,
  })

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
    enabled: !!item.dbId && isExpanded,
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
    enabled: !!assetId && !!workflowId && isExpanded,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['existing-checklist-items', assetId, workflowId] })
      qc.invalidateQueries({ queryKey: ['asset-checklist', assetId, workflowId] })
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
      const filePath = `${assetId}/${workflowId}/${stageId}/${item.id}/${Date.now()}_${file.name}`
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
    onSuccess: () => { qc.invalidateQueries({ queryKey: attachKey }); setUploading(false) },
    onError: () => setUploading(false),
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
    <div className={`rounded-lg border transition-all ${
      isExpanded ? 'border-gray-200 bg-white shadow-sm' : 'border-gray-100 hover:border-gray-200 bg-white'
    } ${!isEditable ? 'opacity-75' : ''}`}>

      {/* ── Header row ─────────────────────────────────────────── */}
      <div
        className="flex items-start gap-2.5 px-3 py-2.5 cursor-pointer select-none"
        onClick={onToggleExpand}
      >
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
          </div>
          {/* Collapsed preview: assignee */}
          {!isExpanded && item.assignee && (
            <p className="text-[12px] text-gray-500 mt-0.5 line-clamp-1 leading-snug">{userName(item.assignee)}</p>
          )}
        </div>

        <div className="flex items-center gap-1 flex-shrink-0 mt-[1px]">
          {isExpanded ? <ChevronDown className="w-3.5 h-3.5 text-gray-300" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-300" />}
          {item.isCustom && isEditable && (
            <button onClick={e => { e.stopPropagation(); onRemoveCustom?.() }} className="p-0.5 rounded hover:bg-red-50 text-gray-300 hover:text-red-500"><Trash2 className="w-3 h-3" /></button>
          )}
        </div>
      </div>

      {/* ── Expanded body ─────────────────────────────────────────── */}
      {isExpanded && (
        <div className="border-t border-gray-100 text-[12px]">

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
          <div className="flex items-center gap-3 px-3 py-1.5 border-b border-gray-100">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider w-[44px] flex-shrink-0">Owner</span>
              {assigningOwner ? (
                <div className="relative">
                  <div className="flex items-center gap-1 border border-gray-200 rounded px-1.5 py-0.5">
                    <Search className="w-3 h-3 text-gray-400" />
                    <input
                      value={ownerSearch} onChange={e => setOwnerSearch(e.target.value)}
                      placeholder="Search..." className="text-[11px] w-[120px] bg-transparent focus:outline-none"
                      autoFocus onKeyDown={e => { if (e.key === 'Escape') setAssigningOwner(false) }}
                    />
                    <button onClick={() => setAssigningOwner(false)} className="text-gray-400 hover:text-gray-600"><X className="w-3 h-3" /></button>
                  </div>
                  <div className="absolute top-full left-0 mt-0.5 w-[200px] bg-white border border-gray-200 rounded shadow-lg z-10 max-h-[140px] overflow-y-auto">
                    {filteredUsers.map(u => (
                      <button
                        key={u.id}
                        className="w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-gray-50 text-[11px]"
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
                  </div>
                </div>
              ) : assigneeName ? (
                <button
                  onClick={() => isEditable && setAssigningOwner(true)}
                  className="flex items-center gap-1.5 text-[11px] text-gray-700 hover:text-blue-600 transition-colors"
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
          <div className="px-3 py-1.5 border-b border-gray-100">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Notes</span>
              {isEditable && !editingNotes && (
                <button onClick={() => { setEditingNotes(true); setNotesDraft(item.notes || '') }} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">
                  {item.notes ? 'Edit' : '+ Add note'}
                </button>
              )}
            </div>
            {editingNotes ? (
              <div>
                <textarea
                  value={notesDraft} onChange={e => setNotesDraft(e.target.value)}
                  placeholder="Add task notes, instructions, or context..."
                  className="w-full text-[12px] px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none leading-snug"
                  rows={2} autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); updateFieldM.mutate({ notes: notesDraft.trim() || null }); setEditingNotes(false) }
                    if (e.key === 'Escape') setEditingNotes(false)
                  }}
                />
                <div className="flex gap-2 mt-1">
                  <button onClick={() => { updateFieldM.mutate({ notes: notesDraft.trim() || null }); setEditingNotes(false) }} className="text-[10px] font-medium bg-gray-900 text-white px-2 py-0.5 rounded">Save</button>
                  <button onClick={() => setEditingNotes(false)} className="text-[10px] text-gray-500">Cancel</button>
                </div>
              </div>
            ) : item.notes ? (
              <p className="text-[12px] text-gray-700 leading-snug whitespace-pre-wrap">{item.notes}</p>
            ) : null}
          </div>

          {/* ── Attachments ─────────────────────────────────────── */}
          <div className="px-3 py-1.5 border-b border-gray-100">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
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
            {attachments.length > 0 && (
              <div className="space-y-0">
                {attachments.map((att: any) => (
                  <div key={att.id} className="group/att flex items-center gap-2 py-0.5 hover:bg-gray-50 rounded -mx-1 px-1">
                    <FileText className="w-3 h-3 text-gray-400 flex-shrink-0" />
                    <span className="text-[11px] text-gray-700 truncate flex-1">{att.file_name}</span>
                    <span className="text-[10px] text-gray-400">{relativeTime(att.created_at)}</span>
                    <div className="flex gap-0.5 opacity-0 group-hover/att:opacity-100 transition-opacity">
                      <button onClick={() => handleDownload(att)} className="p-0.5 rounded hover:bg-blue-100 text-gray-400 hover:text-blue-600"><Download className="w-3 h-3" /></button>
                      {isEditable && <button onClick={() => deleteFileM.mutate(att.id)} className="p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Comments ────────────────────────────────────────── */}
          <div className="px-3 py-1.5">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                Comments{commentCount > 0 && ` (${commentCount})`}
              </span>
              {!addingComment && (
                <button onClick={() => setAddingComment(true)} className="text-[10px] text-blue-600 hover:text-blue-800 font-medium">+ Add comment</button>
              )}
            </div>
            {comments.length > 0 && (
              <div className="space-y-1 mb-1.5">
                {comments.map((c: any) => {
                  const cUser = c.user
                  const isOwn = currentUser?.id === c.user_id
                  return (
                    <div key={c.id} className="group/c flex gap-2 py-1 -mx-1 px-1 rounded hover:bg-gray-50">
                      <div className={`w-5 h-5 rounded-full ${avatarColor(userName(cUser))} flex items-center justify-center flex-shrink-0 mt-0.5`}>
                        <span className="text-white text-[8px] font-semibold">{userInitials(cUser)}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-medium text-gray-700">{userName(cUser)}</span>
                          <span className="text-[10px] text-gray-400">{relativeTime(c.created_at)}</span>
                          {isOwn && (
                            <button onClick={() => { if (confirm('Delete comment?')) deleteCommentM.mutate(c.id) }}
                              className="opacity-0 group-hover/c:opacity-100 p-0.5 rounded hover:bg-red-100 text-gray-400 hover:text-red-600 ml-auto">
                              <Trash2 className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                        <p className="text-[11px] text-gray-700 leading-snug">{c.comment_text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
            {addingComment && (
              <div>
                <textarea
                  value={commentText} onChange={e => setCommentText(e.target.value)}
                  placeholder="Add a comment..."
                  className="w-full text-[11px] px-2 py-1.5 border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none"
                  rows={2} autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (commentText.trim()) addCommentM.mutate(commentText.trim()) }
                    if (e.key === 'Escape') { setAddingComment(false); setCommentText('') }
                  }}
                />
                <div className="flex items-center justify-end gap-2 mt-1">
                  <button onClick={() => { setAddingComment(false); setCommentText('') }} className="text-[10px] text-gray-400 hover:text-gray-600">Cancel</button>
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

          {/* Completion footer */}
          {item.completedAt && (
            <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/50 text-[10px] text-gray-400">
              Completed by {userName(item.completedByUser)} · {new Date(item.completedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
