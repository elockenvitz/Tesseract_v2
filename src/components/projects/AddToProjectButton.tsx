/**
 * AddToProjectButton
 *
 * Association-first modal for linking an asset to a project.
 * Matches the pattern of AddToListButton / AddToThemeButton.
 *
 * Primary path: pick an existing project to attach the asset to.
 * Secondary path: create a new project inline (pre-linked to the asset).
 */

import React, { useState, useEffect } from 'react'
import { FolderKanban, X, Search, Plus, Check, ChevronRight } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../hooks/useAuth'
import { Button } from '../ui/Button'
import { formatDistanceToNow } from 'date-fns'

interface AddToProjectButtonProps {
  assetId: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

interface ProjectRow {
  id: string
  title: string
  status: string
  context_type: string | null
  context_id: string | null
  updated_at: string | null
  created_by: string | null
  isLinked: boolean
}

export function AddToProjectButton({
  assetId,
  variant = 'outline',
  size = 'sm',
  className,
}: AddToProjectButtonProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newTitle, setNewTitle] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const { user } = useAuth()
  const queryClient = useQueryClient()

  // Auto-dismiss toast
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  // Fetch all projects the user created (or is assigned to)
  const { data: projects, isLoading } = useQuery({
    queryKey: ['all-projects-for-link', assetId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('id, title, status, context_type, context_id, updated_at, created_by')
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })

      if (error) throw error

      return (data || []).map((p) => ({
        ...p,
        isLinked: p.context_type === 'asset' && p.context_id === assetId,
      })) as ProjectRow[]
    },
    enabled: showDialog,
  })

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ['all-projects-for-link', assetId] })
    queryClient.invalidateQueries({ queryKey: ['entity-projects', 'asset', assetId] })
    queryClient.invalidateQueries({ queryKey: ['asset-context-projects', assetId] })
  }

  // Link asset to existing project
  const linkMutation = useMutation({
    mutationFn: async (project: ProjectRow) => {
      if (project.isLinked) {
        return { alreadyLinked: true, title: project.title }
      }
      const { error } = await supabase
        .from('projects')
        .update({ context_type: 'asset', context_id: assetId })
        .eq('id', project.id)
      if (error) throw error
      return { alreadyLinked: false, title: project.title }
    },
    onSuccess: (result) => {
      if (result.alreadyLinked) {
        setToast(`Already in ${result.title}`)
      } else {
        setToast(`Added to ${result.title}`)
        invalidateAll()
      }
      setShowDialog(false)
      setSearchQuery('')
    },
  })

  // Create new project pre-linked to this asset
  const createMutation = useMutation({
    mutationFn: async (title: string) => {
      const { data, error } = await supabase
        .from('projects')
        .insert({
          title,
          status: 'planning',
          priority: 'medium',
          created_by: user?.id,
          context_type: 'asset',
          context_id: assetId,
        })
        .select('id')
        .single()
      if (error) throw error

      await supabase.from('project_assignments').insert({
        project_id: data.id,
        assigned_to: user?.id,
        assigned_by: user?.id,
        role: 'owner',
      })

      return { id: data.id, title }
    },
    onSuccess: (result) => {
      setToast(`Added to ${result.title}`)
      setNewTitle('')
      setShowCreateForm(false)
      setShowDialog(false)
      setSearchQuery('')
      invalidateAll()
    },
  })

  const handleLink = (project: ProjectRow) => {
    if (linkMutation.isPending) return
    linkMutation.mutate(project)
  }

  const handleCreate = () => {
    if (!newTitle.trim() || createMutation.isPending) return
    createMutation.mutate(newTitle.trim())
  }

  const filtered = projects?.filter(
    (p) =>
      !searchQuery ||
      p.title.toLowerCase().includes(searchQuery.toLowerCase())
  ) || []

  const available = filtered.filter((p) => !p.isLinked)
  const linked = filtered.filter((p) => p.isLinked)

  const statusLabel = (s: string) =>
    s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={(e: React.MouseEvent) => {
          e.stopPropagation()
          setShowDialog(true)
        }}
        className={className}
      >
        <FolderKanban className="h-4 w-4 mr-2" />
        Add to Project
      </Button>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] px-4 py-2 bg-gray-900 text-white text-sm rounded-lg shadow-lg animate-in fade-in slide-in-from-bottom-2 duration-200">
          {toast}
        </div>
      )}

      {/* Modal */}
      {showDialog && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => { setShowDialog(false); setSearchQuery('') }}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-auto transform transition-all max-h-[70vh] overflow-hidden flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 flex-shrink-0">
                <div>
                  <h3 className="text-[15px] font-semibold text-gray-900">Add to Project</h3>
                  <p className="text-[11px] text-gray-500 mt-0.5">Select a project to link this asset to</p>
                </div>
                <button
                  onClick={() => { setShowDialog(false); setSearchQuery('') }}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Search */}
              <div className="px-5 pt-3 pb-1.5 flex-shrink-0">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search projects\u2026"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    autoFocus
                  />
                </div>
              </div>

              {/* Project list */}
              <div className="flex-1 overflow-y-auto px-3 py-1">
                {isLoading ? (
                  <div className="space-y-1 px-2 py-1">
                    {[1, 2, 3, 4].map((i) => (
                      <div key={i} className="h-11 bg-gray-50 rounded-lg animate-pulse" />
                    ))}
                  </div>
                ) : (
                  <>
                    {/* Available */}
                    {available.length > 0 && (
                      <div>
                        {linked.length > 0 && (
                          <p className="text-[9px] font-medium text-gray-400/70 uppercase tracking-widest mb-1 mt-2 px-2">Available</p>
                        )}
                        {available.map((project) => (
                          <button
                            key={project.id}
                            onClick={() => handleLink(project)}
                            disabled={linkMutation.isPending}
                            className="w-full flex items-center justify-between px-3 py-[7px] rounded-lg cursor-pointer hover:bg-blue-50/70 active:bg-blue-100/60 transition-colors text-left group"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-semibold text-gray-900 truncate block leading-tight">
                                {project.title}
                              </span>
                              <span className="text-[11px] text-gray-400/80 block mt-0.5 leading-tight">
                                {statusLabel(project.status)}
                                {project.updated_at && (
                                  <> &middot; {formatDistanceToNow(new Date(project.updated_at), { addSuffix: true })}</>
                                )}
                              </span>
                            </div>
                            <ChevronRight className="w-3.5 h-3.5 text-gray-200 group-hover:text-primary-500 flex-shrink-0 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Already linked */}
                    {linked.length > 0 && (
                      <div>
                        <p className="text-[9px] font-medium text-gray-400/70 uppercase tracking-widest mb-1 mt-3 px-2">Already linked</p>
                        {linked.map((project) => (
                          <div
                            key={project.id}
                            className="flex items-center justify-between px-3 py-[7px] rounded-lg cursor-default"
                          >
                            <div className="min-w-0 flex-1">
                              <span className="text-[13px] font-medium text-gray-500 truncate block leading-tight">{project.title}</span>
                              <span className="text-[11px] text-gray-400/60 block mt-0.5 leading-tight">{statusLabel(project.status)}</span>
                            </div>
                            <Check className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
                          </div>
                        ))}
                      </div>
                    )}

                    {/* No results */}
                    {filtered.length === 0 && !isLoading && (
                      <div className="py-6 text-center">
                        <p className="text-[13px] text-gray-400">
                          {projects?.length === 0 ? 'No projects yet.' : 'No projects match your search.'}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Create new — visually secondary footer */}
              <div className="border-t border-gray-200 px-5 py-2.5 flex-shrink-0 bg-gray-50/50">
                {showCreateForm ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      placeholder="Project name"
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreate()
                        if (e.key === 'Escape') {
                          setShowCreateForm(false)
                          setNewTitle('')
                        }
                      }}
                      className="flex-1 px-3 py-1.5 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                      autoFocus
                    />
                    <Button
                      size="sm"
                      onClick={handleCreate}
                      disabled={!newTitle.trim() || createMutation.isPending}
                    >
                      {createMutation.isPending ? 'Creating\u2026' : 'Create'}
                    </Button>
                    <button
                      onClick={() => { setShowCreateForm(false); setNewTitle('') }}
                      className="text-gray-400 hover:text-gray-600 transition-colors"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowCreateForm(true)}
                    className="flex items-center gap-1.5 text-[11px] font-normal text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    <Plus className="w-3 h-3" />
                    Create new project
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
