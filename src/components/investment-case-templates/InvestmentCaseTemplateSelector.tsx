import { useState, useRef, useEffect } from 'react'
import { clsx } from 'clsx'
import { ChevronDown, FileText, Star, Share2, Check, Settings, Loader2 } from 'lucide-react'
import { useInvestmentCaseTemplates } from '../../hooks/useInvestmentCaseTemplates'
import { InvestmentCaseTemplate } from '../../types/investmentCaseTemplates'

interface Props {
  selectedTemplateId: string | null
  onSelect: (template: InvestmentCaseTemplate | null) => void
  onManageTemplates?: () => void
}

export function InvestmentCaseTemplateSelector({ selectedTemplateId, onSelect, onManageTemplates }: Props) {
  const { templates, myTemplates, sharedTemplates, defaultTemplate, isLoading } = useInvestmentCaseTemplates()
  const [isOpen, setIsOpen] = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const selectedTemplate = selectedTemplateId
    ? templates.find(t => t.id === selectedTemplateId)
    : null

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Auto-select default template on initial load
  useEffect(() => {
    if (!selectedTemplateId && defaultTemplate && !isLoading) {
      onSelect(defaultTemplate)
    }
  }, [defaultTemplate, selectedTemplateId, isLoading, onSelect])

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500">
        <Loader2 className="w-4 h-4 animate-spin" />
        <span>Loading templates...</span>
      </div>
    )
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors',
          isOpen
            ? 'border-primary-300 bg-primary-50 text-primary-700'
            : 'border-gray-300 bg-white text-gray-700 hover:border-gray-400'
        )}
      >
        <FileText className="w-4 h-4" />
        <span className="truncate max-w-[180px]">
          {selectedTemplate ? selectedTemplate.name : 'Select PDF Template'}
        </span>
        <ChevronDown className={clsx(
          'w-4 h-4 transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 w-72 bg-white rounded-lg shadow-lg border border-gray-200 z-50 py-1 max-h-80 overflow-auto">
          {/* No template option */}
          <button
            onClick={() => {
              onSelect(null)
              setIsOpen(false)
            }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-gray-50',
              !selectedTemplateId && 'bg-primary-50'
            )}
          >
            <div className="w-4 h-4 flex items-center justify-center">
              {!selectedTemplateId && <Check className="w-4 h-4 text-primary-600" />}
            </div>
            <span className="text-gray-700">Default (No Template)</span>
          </button>

          {/* My Templates */}
          {myTemplates.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide border-t border-gray-100 mt-1">
                My Templates
              </div>
              {myTemplates.map(template => (
                <TemplateOption
                  key={template.id}
                  template={template}
                  isSelected={selectedTemplateId === template.id}
                  isHovered={hoveredId === template.id}
                  onSelect={() => {
                    onSelect(template)
                    setIsOpen(false)
                  }}
                  onMouseEnter={() => setHoveredId(template.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              ))}
            </>
          )}

          {/* Shared Templates */}
          {sharedTemplates.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-medium text-gray-500 uppercase tracking-wide border-t border-gray-100 mt-1">
                Shared Templates
              </div>
              {sharedTemplates.map(template => (
                <TemplateOption
                  key={template.id}
                  template={template}
                  isSelected={selectedTemplateId === template.id}
                  isHovered={hoveredId === template.id}
                  isShared
                  onSelect={() => {
                    onSelect(template)
                    setIsOpen(false)
                  }}
                  onMouseEnter={() => setHoveredId(template.id)}
                  onMouseLeave={() => setHoveredId(null)}
                />
              ))}
            </>
          )}

          {/* Empty state */}
          {templates.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-gray-500">
              No templates available
            </div>
          )}

          {/* Manage Templates */}
          {onManageTemplates && (
            <button
              onClick={() => {
                onManageTemplates()
                setIsOpen(false)
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-left text-sm text-primary-600 hover:bg-primary-50 border-t border-gray-100 mt-1"
            >
              <Settings className="w-4 h-4" />
              Manage Templates
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// Template Option Component
interface TemplateOptionProps {
  template: InvestmentCaseTemplate
  isSelected: boolean
  isHovered: boolean
  isShared?: boolean
  onSelect: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

function TemplateOption({
  template,
  isSelected,
  isHovered,
  isShared,
  onSelect,
  onMouseEnter,
  onMouseLeave
}: TemplateOptionProps) {
  return (
    <button
      onClick={onSelect}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={clsx(
        'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50',
        isSelected && 'bg-primary-50'
      )}
    >
      <div className="w-4 h-4 flex items-center justify-center">
        {isSelected && <Check className="w-4 h-4 text-primary-600" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1">
          <span className="text-sm text-gray-900 truncate">{template.name}</span>
          {template.is_default && (
            <Star className="w-3 h-3 text-yellow-500 flex-shrink-0" />
          )}
          {isShared && (
            <Share2 className="w-3 h-3 text-blue-500 flex-shrink-0" />
          )}
        </div>
        {template.description && (
          <p className="text-xs text-gray-500 truncate">{template.description}</p>
        )}
      </div>
      {/* Color indicator */}
      <div
        className="w-3 h-3 rounded-full flex-shrink-0"
        style={{ backgroundColor: template.style_config.colors.primary }}
        title={`Primary color: ${template.style_config.colors.primary}`}
      />
    </button>
  )
}
