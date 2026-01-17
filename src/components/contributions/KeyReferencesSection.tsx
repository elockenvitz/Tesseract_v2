import React, { useState, useMemo } from 'react'
import { clsx } from 'clsx'
import {
  Plus,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  FileText,
  File,
  Link2,
  Presentation,
  Search,
  AlertTriangle,
  Star,
  FolderOpen,
  Filter
} from 'lucide-react'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { ReferenceCard } from './ReferenceCard'
import { useKeyReferences, type ReferenceCategory, type ReferenceImportance, type KeyReference } from '../../hooks/useKeyReferences'
import { supabase } from '../../lib/supabase'

interface KeyReferencesSectionProps {
  assetId: string
  isExpanded: boolean
  onToggleExpanded: () => void
  onOpenAddModal: () => void
  onViewModelHistory?: (modelId: string) => void
  /** When true, renders without Card wrapper and header (for embedding in other sections) */
  isEmbedded?: boolean
}

type FilterCategory = 'all' | ReferenceCategory

const CATEGORY_OPTIONS: { value: FilterCategory; label: string; icon: React.ElementType }[] = [
  { value: 'all', label: 'All', icon: FolderOpen },
  { value: 'model', label: 'Models', icon: FileSpreadsheet },
  { value: 'research', label: 'Research', icon: FileText },
  { value: 'filings', label: 'Filings', icon: File },
  { value: 'presentations', label: 'PPT', icon: Presentation },
  { value: 'other', label: 'Links', icon: Link2 },
]

const IMPORTANCE_ORDER: Record<ReferenceImportance, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
}

export function KeyReferencesSection({
  assetId,
  isExpanded,
  onToggleExpanded,
  onOpenAddModal,
  onViewModelHistory,
  isEmbedded = false
}: KeyReferencesSectionProps) {
  const {
    references,
    isLoading,
    deleteReference,
    togglePinned,
    setImportance,
    setAnnotation,
    isDeleting
  } = useKeyReferences(assetId)

  const [filter, setFilter] = useState<FilterCategory>('all')
  const [searchQuery, setSearchQuery] = useState('')

  // Group and sort references
  const { criticalRefs, highPriorityRefs, normalRefs, filteredCount } = useMemo(() => {
    // Filter by category
    let filtered = filter === 'all'
      ? references
      : references.filter(r => r.category === filter)

    // Filter by search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase()
      filtered = filtered.filter(r =>
        r.title.toLowerCase().includes(query) ||
        r.description?.toLowerCase().includes(query)
      )
    }

    // Sort: pinned first, then by importance
    const sorted = [...filtered].sort((a, b) => {
      // Pinned items first
      if (a.is_pinned && !b.is_pinned) return -1
      if (!a.is_pinned && b.is_pinned) return 1
      // Then by importance
      return IMPORTANCE_ORDER[a.importance] - IMPORTANCE_ORDER[b.importance]
    })

    return {
      criticalRefs: sorted.filter(r => r.importance === 'critical'),
      highPriorityRefs: sorted.filter(r => r.importance === 'high'),
      normalRefs: sorted.filter(r => r.importance === 'normal' || r.importance === 'low'),
      filteredCount: filtered.length
    }
  }, [references, filter, searchQuery])

  // Get category counts
  const categoryCounts = useMemo(() => {
    const counts: Record<FilterCategory, number> = {
      all: references.length,
      model: 0,
      research: 0,
      filings: 0,
      presentations: 0,
      other: 0
    }
    references.forEach(r => {
      if (r.category && r.category in counts) {
        counts[r.category]++
      }
    })
    return counts
  }, [references])

  // Handle reference click - open the document
  const handleReferenceClick = async (ref: KeyReference) => {
    if (ref.reference_type === 'external_link' && ref.external_url) {
      window.open(ref.external_url, '_blank')
      return
    }

    if (ref.reference_type === 'note' && ref.target_id) {
      // Navigate to note - emit event or use callback
      // For now, we'll handle this via the parent component
      return
    }

    if (ref.reference_type === 'model' && ref.target_model?.file_path) {
      const { data } = await supabase.storage
        .from('assets')
        .createSignedUrl(ref.target_model.file_path, 3600)
      if (data?.signedUrl) {
        window.open(data.signedUrl, '_blank')
      }
    }
  }

  const handleDelete = async (id: string) => {
    if (confirm('Remove this reference from your key references?')) {
      await deleteReference(id)
    }
  }

  const renderContent = () => (
    <div className={isEmbedded ? "" : "border-t border-gray-100 px-6 py-4"}>
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-4 mb-4">
        {/* Filter Pills */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1 flex-1">
          {CATEGORY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors',
                filter === opt.value
                  ? 'bg-primary-100 text-primary-700 font-medium'
                  : 'text-gray-600 hover:bg-gray-100'
              )}
            >
              <opt.icon className="w-3.5 h-3.5" />
              {opt.label}
              {categoryCounts[opt.value] > 0 && (
                <span className={clsx(
                  'text-xs',
                  filter === opt.value ? 'text-primary-600' : 'text-gray-400'
                )}>
                  {categoryCounts[opt.value]}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Add Button */}
        <Button
          size="sm"
          onClick={onOpenAddModal}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add
        </Button>
      </div>

      {/* Search (show if many references) */}
      {references.length > 5 && (
        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search references..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent"
          />
        </div>
      )}

      {/* Loading state */}
      {isLoading ? (
        <div className="py-8 text-center text-gray-500">
          <div className="animate-spin w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full mx-auto mb-2" />
          Loading references...
        </div>
      ) : filteredCount === 0 ? (
        <div className="text-center py-8 bg-gray-50 rounded-lg border border-dashed border-gray-200">
          <FolderOpen className="h-8 w-8 text-gray-400 mx-auto mb-2" />
          <p className="text-sm text-gray-600 font-medium mb-1">
            {references.length === 0
              ? 'No key references yet'
              : `No ${filter === 'all' ? '' : filter} references`}
          </p>
          <p className="text-xs text-gray-500 mb-3">
            Add important documents to support your investment case
          </p>
          <Button size="sm" variant="outline" onClick={onOpenAddModal}>
            <Plus className="w-4 h-4 mr-1" />
            Add Reference
          </Button>
        </div>
      ) : (
        <div className="space-y-4 max-h-[500px] overflow-y-auto -mx-2 px-2">
          {/* Critical section */}
          {criticalRefs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <h4 className="text-xs font-semibold text-red-700 uppercase tracking-wide">
                  Critical
                </h4>
              </div>
              <div className="space-y-2">
                {criticalRefs.map(ref => (
                  <ReferenceCard
                    key={ref.id}
                    reference={ref}
                    onClick={() => handleReferenceClick(ref)}
                    onEdit={(id, desc) => setAnnotation(id, desc)}
                    onDelete={handleDelete}
                    onTogglePin={togglePinned}
                    onSetImportance={setImportance}
                    onViewHistory={ref.reference_type === 'model' && ref.target_id
                      ? () => onViewModelHistory?.(ref.target_id!)
                      : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* High priority section */}
          {highPriorityRefs.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Star className="w-4 h-4 text-amber-600" />
                <h4 className="text-xs font-semibold text-amber-700 uppercase tracking-wide">
                  High Priority
                </h4>
              </div>
              <div className="space-y-2">
                {highPriorityRefs.map(ref => (
                  <ReferenceCard
                    key={ref.id}
                    reference={ref}
                    onClick={() => handleReferenceClick(ref)}
                    onEdit={(id, desc) => setAnnotation(id, desc)}
                    onDelete={handleDelete}
                    onTogglePin={togglePinned}
                    onSetImportance={setImportance}
                    onViewHistory={ref.reference_type === 'model' && ref.target_id
                      ? () => onViewModelHistory?.(ref.target_id!)
                      : undefined
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {/* Normal references */}
          {normalRefs.length > 0 && (
            <div>
              {(criticalRefs.length > 0 || highPriorityRefs.length > 0) && (
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Other References
                </h4>
              )}
              <div className="space-y-2">
                {normalRefs.map(ref => (
                  <ReferenceCard
                    key={ref.id}
                    reference={ref}
                    onClick={() => handleReferenceClick(ref)}
                    onEdit={(id, desc) => setAnnotation(id, desc)}
                    onDelete={handleDelete}
                    onTogglePin={togglePinned}
                    onSetImportance={setImportance}
                    onViewHistory={ref.reference_type === 'model' && ref.target_id
                      ? () => onViewModelHistory?.(ref.target_id!)
                      : undefined
                    }
                    isCompact={normalRefs.length > 5}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  // For embedded mode, render content directly without Card wrapper
  if (isEmbedded) {
    return renderContent()
  }

  // Non-embedded mode: render with Card wrapper and header
  return (
    <Card padding="none">
      {/* Section Header */}
      <button
        onClick={onToggleExpanded}
        className="w-full px-6 py-4 flex items-center gap-2 hover:bg-gray-50 transition-colors"
      >
        <span className="font-medium text-gray-900">Key References</span>
        <span className="text-sm text-gray-500">({references.length})</span>
        {references.some(r => r.importance === 'critical') && (
          <AlertTriangle className="w-4 h-4 text-red-500 ml-1" />
        )}
        <div className="flex-1" />
        {isExpanded ? (
          <ChevronUp className="h-5 w-5 text-gray-400" />
        ) : (
          <ChevronDown className="h-5 w-5 text-gray-400" />
        )}
      </button>

      {/* Content */}
      {isExpanded && renderContent()}
    </Card>
  )
}
