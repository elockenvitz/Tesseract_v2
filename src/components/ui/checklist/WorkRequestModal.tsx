/**
 * WorkRequestModal
 *
 * Structured work-request creation — replaces generic "Assign Task" modal.
 * Captures: request type, prompt, owner, due date, expected output, context.
 */
import React, { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { X, Search, LinkIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase'
import {
  RequestType, ExpectedOutput, REQUEST_TYPE_META, EXPECTED_OUTPUT_META,
  userName, userInitials, avatarColor,
} from './types'

interface Props {
  onSubmit: (data: {
    request_type: RequestType
    prompt: string
    owner_id: string
    due_date?: string
    expected_output?: ExpectedOutput
    context_notes?: string
    create_tracked_task: boolean
  }) => void
  onClose: () => void
}

export function WorkRequestModal({ onSubmit, onClose }: Props) {
  const [requestType, setRequestType] = useState<RequestType>('question')
  const [prompt, setPrompt] = useState('')
  const [ownerId, setOwnerId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [expectedOutput, setExpectedOutput] = useState<ExpectedOutput | ''>('')
  const [contextNotes, setContextNotes] = useState('')
  const [createTrackedTask, setCreateTrackedTask] = useState(false)
  const [userSearch, setUserSearch] = useState('')

  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('id, email, first_name, last_name')
        .order('first_name')
      if (error) throw error
      return data || []
    },
  })

  const filteredUsers = (users || []).filter(u => {
    if (!userSearch) return true
    const q = userSearch.toLowerCase()
    return userName(u).toLowerCase().includes(q) || u.email.toLowerCase().includes(q)
  })

  const canSubmit = prompt.trim() && ownerId && requestType

  const handleSubmit = () => {
    if (!canSubmit) return
    onSubmit({
      request_type: requestType,
      prompt: prompt.trim(),
      owner_id: ownerId,
      due_date: dueDate || undefined,
      expected_output: expectedOutput || undefined,
      context_notes: contextNotes.trim() || undefined,
      create_tracked_task: createTrackedTask,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[85vh] flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Request Follow-up</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {/* Request Type */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Request Type <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-1.5">
              {(Object.entries(REQUEST_TYPE_META) as [RequestType, typeof REQUEST_TYPE_META[RequestType]][]).map(([key, meta]) => (
                <button
                  key={key}
                  onClick={() => setRequestType(key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                    requestType === key
                      ? 'bg-gray-900 text-white border-gray-900'
                      : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
                  }`}
                >
                  {meta.label}
                </button>
              ))}
            </div>
          </div>

          {/* Prompt */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              What needs to be answered? <span className="text-red-500">*</span>
            </label>
            <textarea
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="e.g., Validate the cap rate assumptions in the tower lease model against recent transactions"
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 focus:border-gray-400 resize-none placeholder:text-gray-400"
              rows={3}
              autoFocus
            />
          </div>

          {/* Owner */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Owner <span className="text-red-500">*</span>
            </label>
            {ownerId ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 rounded-md">
                {(() => {
                  const u = users?.find(u => u.id === ownerId)
                  const name = userName(u)
                  const color = avatarColor(name)
                  return (
                    <>
                      <div className={`w-6 h-6 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
                        <span className="text-white text-[10px] font-semibold">{userInitials(u)}</span>
                      </div>
                      <span className="text-sm text-gray-900 font-medium">{name}</span>
                      <button
                        onClick={() => setOwnerId('')}
                        className="ml-auto p-0.5 rounded hover:bg-gray-200 text-gray-400"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </>
                  )
                })()}
              </div>
            ) : (
              <div>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                  <input
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="Search by name or email"
                    className="w-full text-sm pl-8 pr-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
                  />
                </div>
                <div className="mt-1 max-h-[140px] overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                  {filteredUsers.map(u => {
                    const name = userName(u)
                    const color = avatarColor(name)
                    return (
                      <button
                        key={u.id}
                        onClick={() => { setOwnerId(u.id); setUserSearch('') }}
                        className="w-full flex items-center gap-2.5 px-3 py-1.5 text-left hover:bg-gray-50 transition-colors"
                      >
                        <div className={`w-5 h-5 rounded-full ${color} flex items-center justify-center flex-shrink-0`}>
                          <span className="text-white text-[8px] font-semibold">{userInitials(u)}</span>
                        </div>
                        <span className="text-sm text-gray-700">{name}</span>
                        <span className="text-xs text-gray-400 ml-auto">{u.email}</span>
                      </button>
                    )
                  })}
                  {filteredUsers.length === 0 && (
                    <div className="px-3 py-2 text-xs text-gray-400 text-center">No users found</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Due Date + Expected Output — side by side */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Due Date
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={e => setDueDate(e.target.value)}
                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
                Expected Output
              </label>
              <select
                value={expectedOutput}
                onChange={e => setExpectedOutput(e.target.value as ExpectedOutput | '')}
                className="w-full text-sm px-3 py-1.5 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 bg-white"
              >
                <option value="">— None —</option>
                {(Object.entries(EXPECTED_OUTPUT_META) as [ExpectedOutput, { label: string }][]).map(([key, meta]) => (
                  <option key={key} value={key}>{meta.label}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Context */}
          <div>
            <label className="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">
              Context / Notes
            </label>
            <textarea
              value={contextNotes}
              onChange={e => setContextNotes(e.target.value)}
              placeholder="Any additional context, links, or constraints..."
              className="w-full text-sm px-3 py-2 border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none placeholder:text-gray-400"
              rows={2}
            />
          </div>

          {/* Create Tracked Task */}
          <div className="pt-1 border-t border-gray-100">
            <label className="flex items-start gap-3 cursor-pointer group">
              <div className="pt-0.5">
                <div
                  onClick={() => setCreateTrackedTask(!createTrackedTask)}
                  className={`w-[34px] h-[18px] rounded-full transition-colors relative flex-shrink-0 cursor-pointer ${
                    createTrackedTask ? 'bg-gray-900' : 'bg-gray-300'
                  }`}
                >
                  <div className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${
                    createTrackedTask ? 'translate-x-[17px]' : 'translate-x-[2px]'
                  }`} />
                </div>
              </div>
              <div onClick={() => setCreateTrackedTask(!createTrackedTask)}>
                <div className="flex items-center gap-1.5">
                  <LinkIcon className="w-3.5 h-3.5 text-gray-500" />
                  <span className="text-sm font-medium text-gray-800">Create tracked operational task</span>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">
                  Creates a linked task in the stage checklist that can be independently assigned, tracked, and completed. Use this when follow-up needs active workflow tracking.
                </p>
              </div>
            </label>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-gray-200 bg-gray-50/50">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${
              canSubmit
                ? 'bg-gray-900 text-white hover:bg-gray-800'
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  )
}
