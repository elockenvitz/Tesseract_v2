import { useState, useRef, useEffect } from 'react'
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query'
import {
  TrendingUp, TrendingDown, Minus, HelpCircle, AlertTriangle, Sparkles,
  Link, X, Hash, Globe, Users, Lock, Send, Loader2, ChevronDown, ChevronRight, ChevronLeft,
  Lightbulb, FileText, BookOpen, Calendar, Bell, Clock, Building2, Briefcase, FolderKanban,
  Paperclip, Image, File
} from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { clsx } from 'clsx'

interface Attachment {
  name: string
  url: string
  type: string
  size: number
}

interface ChartAttachment {
  dataUrl: string
  symbol?: string
  timeframe?: string
  annotationCount?: number
}

type IdeaType = 'thought' | 'trade_idea' | 'research_idea' | 'thesis'
type Sentiment = 'bullish' | 'bearish' | 'neutral' | 'curious' | 'concerned' | 'excited' | null
type SourceType = 'news_article' | 'headline' | 'research' | 'earnings' | 'price_move' | 'social_media' | 'conversation' | 'idea' | 'general' | 'other'
type DateType = 'revisit' | 'alert' | 'expiration' | null
type OrgNodeType = 'division' | 'department' | 'team' | 'portfolio'

interface OrgChartNode {
  id: string
  name: string
  node_type: OrgNodeType
  parent_id: string | null
}

const categoryOptions: { value: OrgNodeType; label: string; icon: typeof Building2; color: string }[] = [
  { value: 'division', label: 'Divisions', icon: Building2, color: 'bg-purple-500' },
  { value: 'department', label: 'Departments', icon: Briefcase, color: 'bg-blue-500' },
  { value: 'team', label: 'Teams', icon: Users, color: 'bg-green-500' },
  { value: 'portfolio', label: 'Portfolios', icon: FolderKanban, color: 'bg-amber-500' },
]

interface QuickThoughtCaptureProps {
  onSuccess?: () => void
  onCancel?: () => void
  initialContent?: string
  initialSourceUrl?: string
  initialSourceTitle?: string
  initialAssetId?: string
  initialIdeaType?: IdeaType
  compact?: boolean
  autoFocus?: boolean
  placeholder?: string
  chartAttachment?: ChartAttachment
}

const ideaTypeOptions: { value: IdeaType; label: string; icon: typeof Lightbulb; color: string; description: string }[] = [
  { value: 'thought', label: 'Thought', icon: Lightbulb, color: 'text-amber-700 bg-amber-50 border-amber-300', description: 'General observation or idea' },
  { value: 'research_idea', label: 'Research', icon: FileText, color: 'text-blue-600 bg-blue-50 border-blue-200', description: 'Research topic to explore' },
  { value: 'thesis', label: 'Thesis', icon: BookOpen, color: 'text-purple-600 bg-purple-50 border-purple-200', description: 'Investment thesis draft' },
]

const sentimentOptions: { value: Sentiment; label: string; icon: typeof TrendingUp; color: string }[] = [
  { value: 'bullish', label: 'Bullish', icon: TrendingUp, color: 'text-green-600 bg-green-50 border-green-200 hover:bg-green-100' },
  { value: 'bearish', label: 'Bearish', icon: TrendingDown, color: 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100' },
  { value: 'neutral', label: 'Neutral', icon: Minus, color: 'text-slate-700 bg-slate-100 border-slate-300 hover:bg-slate-200' },
  { value: 'curious', label: 'Curious', icon: HelpCircle, color: 'text-blue-600 bg-blue-50 border-blue-200 hover:bg-blue-100' },
  { value: 'concerned', label: 'Concerned', icon: AlertTriangle, color: 'text-amber-600 bg-amber-50 border-amber-200 hover:bg-amber-100' },
  { value: 'excited', label: 'Excited', icon: Sparkles, color: 'text-purple-600 bg-purple-50 border-purple-200 hover:bg-purple-100' },
]

const sourceTypeOptions: { value: SourceType; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'news_article', label: 'News' },
  { value: 'research', label: 'Research' },
  { value: 'earnings', label: 'Earnings' },
  { value: 'price_move', label: 'Price move' },
  { value: 'social_media', label: 'Social' },
  { value: 'conversation', label: 'Conversation' },
  { value: 'other', label: 'Other' },
]

const dateTypeOptions: { value: DateType; label: string; icon: typeof Calendar; color: string }[] = [
  { value: 'revisit', label: 'Revisit', icon: Clock, color: 'text-blue-600' },
  { value: 'alert', label: 'Alert', icon: Bell, color: 'text-amber-600' },
  { value: 'expiration', label: 'Expires', icon: Calendar, color: 'text-red-600' },
]

export function QuickThoughtCapture({
  onSuccess,
  onCancel,
  initialContent = '',
  initialSourceUrl = '',
  initialSourceTitle = '',
  initialAssetId,
  initialIdeaType = 'thought',
  compact = false,
  autoFocus = false,
  placeholder = "What's on your mind? Capture a quick thought...",
  chartAttachment: initialChartAttachment
}: QuickThoughtCaptureProps) {
  const [content, setContent] = useState(initialContent)
  const [ideaType, setIdeaType] = useState<IdeaType>(initialIdeaType)
  const [sentiment, setSentiment] = useState<Sentiment>(null)
  const [sourceType, setSourceType] = useState<SourceType>('general')
  const [sourceUrl, setSourceUrl] = useState(initialSourceUrl)
  const [chartAttachment, setChartAttachment] = useState<ChartAttachment | undefined>(initialChartAttachment)
  const [sourceTitle, setSourceTitle] = useState(initialSourceTitle)
  const [visibility, setVisibility] = useState<'private' | 'public' | 'organization' | 'team' | 'portfolio'>('private')
  const [selectedOrgNodeId, setSelectedOrgNodeId] = useState<string | null>(null)
  const [selectedOrgNodeType, setSelectedOrgNodeType] = useState<string | null>(null)
  const [selectedOrgNodeName, setSelectedOrgNodeName] = useState<string | null>(null)
  const [visibilityStep, setVisibilityStep] = useState<'main' | 'category' | 'items'>('main')
  const [selectedCategory, setSelectedCategory] = useState<'division' | 'department' | 'team' | 'portfolio' | null>(null)
  const [dateType, setDateType] = useState<DateType>(null)
  const [dateValue, setDateValue] = useState<string>('')
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState('')
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showVisibilityMenu, setShowVisibilityMenu] = useState(false)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()

  // Get org chart nodes for visibility options
  const { data: orgChartNodes } = useQuery({
    queryKey: ['org-chart-nodes-visibility'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return []

      const { data, error } = await supabase
        .from('org_chart_nodes')
        .select('id, name, node_type, parent_id')
        .order('name')

      if (error) {
        console.error('Error fetching org chart nodes:', error)
        return []
      }

      return (data || []) as OrgChartNode[]
    }
  })

  // Group nodes by type
  const nodesByType = {
    division: orgChartNodes?.filter(n => n.node_type === 'division') || [],
    department: orgChartNodes?.filter(n => n.node_type === 'department') || [],
    team: orgChartNodes?.filter(n => n.node_type === 'team') || [],
    portfolio: orgChartNodes?.filter(n => n.node_type === 'portfolio') || [],
  }

  useEffect(() => {
    if (autoFocus && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [autoFocus])

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [content])

  const createThought = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      // Determine visibility based on selected org node
      let finalVisibility = visibility
      let visibilityTeamId = null
      let visibilityOrgId = null
      let visibilityPortfolioId = null

      if (visibility === 'organization' && selectedOrgNodeId && selectedOrgNodeType) {
        if (selectedOrgNodeType === 'team') {
          finalVisibility = 'team'
          visibilityTeamId = selectedOrgNodeId
        } else if (selectedOrgNodeType === 'portfolio') {
          finalVisibility = 'portfolio'
          visibilityPortfolioId = selectedOrgNodeId
        } else {
          // For division/department, store in visibility_org_id
          finalVisibility = 'organization'
          visibilityOrgId = selectedOrgNodeId
        }
      }

      const { data, error } = await supabase
        .from('quick_thoughts')
        .insert({
          created_by: user.id,
          content: content.trim(),
          idea_type: ideaType,
          sentiment,
          source_type: sourceType,
          source_url: sourceUrl || null,
          source_title: sourceTitle || null,
          asset_id: initialAssetId || null,
          tags: tags.length > 0 ? tags : null,
          visibility: finalVisibility,
          visibility_team_id: visibilityTeamId,
          visibility_org_id: visibilityOrgId,
          visibility_portfolio_id: visibilityPortfolioId,
          date_type: dateType,
          revisit_date: dateValue || null,
          attachments: attachments.length > 0 ? attachments : null,
          chart_snapshot: chartAttachment ? {
            dataUrl: chartAttachment.dataUrl,
            symbol: chartAttachment.symbol,
            timeframe: chartAttachment.timeframe,
            annotationCount: chartAttachment.annotationCount
          } : null,
        })
        .select()
        .single()

      if (error) throw error
      return data
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['quick-thoughts'] })
      setContent('')
      setIdeaType('thought')
      setSentiment(null)
      setSourceType('general')
      setSourceUrl('')
      setSourceTitle('')
      setDateType(null)
      setDateValue('')
      setTags([])
      setAttachments([])
      setChartAttachment(undefined)
      setShowAdvanced(false)
      setVisibility('private')
      setSelectedOrgNodeId(null)
      setSelectedOrgNodeType(null)
      setSelectedOrgNodeName(null)
      setVisibilityStep('main')
      setSelectedCategory(null)
      onSuccess?.()
    },
  })

  const handleSubmit = () => {
    if (!content.trim()) return
    createThought.mutate()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel?.()
    }
  }

  const addTag = () => {
    const tag = tagInput.trim().toLowerCase().replace(/[^a-z0-9-]/g, '')
    if (tag && !tags.includes(tag)) {
      setTags([...tags, tag])
    }
    setTagInput('')
  }

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter(t => t !== tagToRemove))
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    setIsUploading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Not authenticated')

      const newAttachments: Attachment[] = []

      for (const file of Array.from(files)) {
        // Generate unique filename
        const fileExt = file.name.split('.').pop()
        const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`

        // Upload to Supabase storage
        const { data, error } = await supabase.storage
          .from('thought-attachments')
          .upload(fileName, file)

        if (error) {
          console.error('Upload error:', error)
          continue
        }

        // Get public URL
        const { data: urlData } = supabase.storage
          .from('thought-attachments')
          .getPublicUrl(fileName)

        newAttachments.push({
          name: file.name,
          url: urlData.publicUrl,
          type: file.type,
          size: file.size,
        })
      }

      setAttachments(prev => [...prev, ...newAttachments])
    } catch (error) {
      console.error('File upload error:', error)
    } finally {
      setIsUploading(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const removeAttachment = (url: string) => {
    setAttachments(prev => prev.filter(a => a.url !== url))
  }

  const getFileIcon = (type: string) => {
    if (type.startsWith('image/')) return Image
    return File
  }

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  const getVisibilityLabel = () => {
    if (visibility === 'organization' && selectedOrgNodeName) {
      return selectedOrgNodeName
    }
    if (visibility === 'private') return 'Only me'
    if (visibility === 'public') return 'Public'
    return 'Select'
  }

  const getVisibilityIcon = () => {
    if (visibility === 'organization' && selectedOrgNodeType) {
      const category = categoryOptions.find(c => c.value === selectedOrgNodeType)
      if (category) {
        const Icon = category.icon
        return <Icon className="h-3.5 w-3.5" />
      }
      return <Users className="h-3.5 w-3.5" />
    }
    if (visibility === 'private') return <Lock className="h-3.5 w-3.5" />
    if (visibility === 'public') return <Globe className="h-3.5 w-3.5" />
    return <Lock className="h-3.5 w-3.5" />
  }

  const handleVisibilitySelect = (type: 'private' | 'public' | 'organization' | 'team' | 'portfolio') => {
    if (type === 'organization') {
      setVisibility('organization')
      setVisibilityStep('category')
    } else {
      setVisibility(type)
      setSelectedOrgNodeId(null)
      setSelectedOrgNodeType(null)
      setSelectedOrgNodeName(null)
      setVisibilityStep('main')
      setSelectedCategory(null)
      setShowVisibilityMenu(false)
    }
  }

  const handleCategorySelect = (category: OrgNodeType) => {
    setSelectedCategory(category)
    setVisibilityStep('items')
  }

  const handleNodeSelect = (node: OrgChartNode) => {
    setSelectedOrgNodeId(node.id)
    setSelectedOrgNodeType(node.node_type)
    setSelectedOrgNodeName(node.name)
    setShowVisibilityMenu(false)
    setVisibilityStep('main')
  }

  const handleVisibilityBack = () => {
    if (visibilityStep === 'items') {
      setVisibilityStep('category')
      setSelectedCategory(null)
    } else if (visibilityStep === 'category') {
      setVisibilityStep('main')
      // Don't clear visibility yet - user might want to select something else
    }
  }

  return (
    <div className={clsx(
      "bg-white rounded-lg border border-gray-200 shadow-sm",
      compact ? "p-3" : "p-4"
    )}>
      {/* Idea Type - ABOVE text field */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {ideaTypeOptions.map((option) => {
          const Icon = option.icon
          const isSelected = ideaType === option.value
          return (
            <button
              key={option.value}
              onClick={() => setIdeaType(option.value)}
              title={option.description}
              className={clsx(
                "flex items-center space-x-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                isSelected ? option.color + ' border-current' : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      {/* Chart attachment preview */}
      {chartAttachment && (
        <div className="mb-3 p-2 bg-indigo-50 border border-indigo-200 rounded-lg">
          <div className="flex items-start gap-3">
            <div className="relative flex-shrink-0">
              <img
                src={chartAttachment.dataUrl}
                alt={`Chart for ${chartAttachment.symbol || 'asset'}`}
                className="w-24 h-16 object-cover rounded border border-indigo-200"
              />
              {chartAttachment.annotationCount && chartAttachment.annotationCount > 0 && (
                <span className="absolute -top-1 -right-1 px-1.5 py-0.5 bg-indigo-500 text-white text-[10px] font-medium rounded-full">
                  +{chartAttachment.annotationCount}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-indigo-700">
                Chart attached {chartAttachment.symbol && `for $${chartAttachment.symbol}`}
              </p>
              {chartAttachment.timeframe && (
                <p className="text-[10px] text-indigo-500">
                  {chartAttachment.timeframe} timeframe
                </p>
              )}
            </div>
            <button
              onClick={() => setChartAttachment(undefined)}
              className="p-1 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-100 rounded"
              title="Remove chart"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main input */}
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={clsx(
            "w-full resize-none border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent text-gray-900 placeholder-gray-400 caret-gray-900",
            compact ? "text-sm min-h-[60px]" : "text-base min-h-[80px]"
          )}
          rows={compact ? 2 : 3}
        />
      </div>

      {/* Sentiment buttons - BELOW text field */}
      <div className="flex flex-wrap gap-1.5 mt-2 mb-3">
        {sentimentOptions.map((option) => {
          const Icon = option.icon
          const isSelected = sentiment === option.value
          return (
            <button
              key={option.value}
              onClick={() => setSentiment(isSelected ? null : option.value)}
              className={clsx(
                "flex items-center space-x-1 px-2 py-1 rounded-full text-xs font-medium border transition-all",
                isSelected ? option.color : "text-gray-500 bg-white border-gray-200 hover:bg-gray-50"
              )}
            >
              <Icon className="h-3 w-3" />
              <span>{option.label}</span>
            </button>
          )
        })}
      </div>

      {/* Date picker - IN MAIN SECTION (not in more options) */}
      <div className="flex items-center gap-2 mb-3">
        <div className="flex items-center gap-1">
          {dateTypeOptions.map((option) => {
            const Icon = option.icon
            const isSelected = dateType === option.value
            return (
              <button
                key={option.value}
                onClick={() => setDateType(isSelected ? null : option.value)}
                className={clsx(
                  "flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all",
                  isSelected
                    ? `${option.color} bg-gray-100`
                    : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
                )}
              >
                <Icon className="h-3 w-3" />
                <span>{option.label}</span>
              </button>
            )
          })}
        </div>
        {dateType && (
          <input
            type="date"
            value={dateValue}
            onChange={(e) => setDateValue(e.target.value)}
            className="text-xs border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-primary-500"
          />
        )}
      </div>

      {/* Advanced options toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        className="text-xs text-gray-500 hover:text-gray-700 flex items-center space-x-1 mb-3"
      >
        <ChevronDown className={clsx("h-3 w-3 transition-transform", showAdvanced && "rotate-180")} />
        <span>{showAdvanced ? 'Hide options' : 'More options'}</span>
      </button>

      {/* Advanced options - compact layout */}
      {showAdvanced && (
        <div className="mb-3 p-2 bg-gray-50 rounded-lg space-y-2">
          {/* Source type and URL on same row */}
          <div className="flex gap-2">
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as SourceType)}
              className="text-xs border border-gray-200 rounded px-1.5 py-1 focus:ring-1 focus:ring-primary-500 bg-white"
            >
              {sourceTypeOptions.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
            <div className="flex-1 relative">
              <Link className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
              <input
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                placeholder="Source URL..."
                className="w-full text-xs border border-gray-200 rounded pl-6 pr-2 py-1 focus:ring-1 focus:ring-primary-500"
              />
            </div>
          </div>

          {/* Source Title - only show if URL entered */}
          {sourceUrl && (
            <input
              type="text"
              value={sourceTitle}
              onChange={(e) => setSourceTitle(e.target.value)}
              placeholder="Source title..."
              className="w-full text-xs border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-primary-500"
            />
          )}

          {/* Tags and Attachments - same row */}
          <div className="flex items-center gap-2">
            <Hash className="h-3 w-3 text-gray-400 flex-shrink-0" />
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  addTag()
                }
              }}
              placeholder="Add tags..."
              className="flex-1 text-xs border border-gray-200 rounded px-2 py-1 focus:ring-1 focus:ring-primary-500"
            />
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileUpload}
              className="hidden"
              accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.csv"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-1.5 py-1 rounded hover:bg-gray-100"
              title="Attach files"
            >
              {isUploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
            </button>
          </div>
          {/* Tags list */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {tags.map(tag => (
                <span
                  key={tag}
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] bg-gray-200 text-gray-700"
                >
                  #{tag}
                  <button onClick={() => removeTag(tag)} className="ml-1 hover:text-red-600">
                    <X className="h-2.5 w-2.5" />
                  </button>
                </span>
              ))}
            </div>
          )}
          {/* Attachments list */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {attachments.map(attachment => {
                const FileIcon = getFileIcon(attachment.type)
                return (
                  <div
                    key={attachment.url}
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] bg-blue-50 text-blue-700 border border-blue-200"
                  >
                    <FileIcon className="h-2.5 w-2.5" />
                    <span className="max-w-[100px] truncate">{attachment.name}</span>
                    <span className="text-blue-400">({formatFileSize(attachment.size)})</span>
                    <button
                      onClick={() => removeAttachment(attachment.url)}
                      className="ml-0.5 hover:text-red-600"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Footer with visibility and submit */}
      <div className="flex items-center justify-between pt-2 border-t border-gray-100">
        {/* Visibility selector */}
        <div className="relative">
          <button
            onClick={() => setShowVisibilityMenu(!showVisibilityMenu)}
            className="flex items-center space-x-1.5 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-50"
          >
            {getVisibilityIcon()}
            <span>{getVisibilityLabel()}</span>
            <ChevronDown className="h-3 w-3" />
          </button>

          {showVisibilityMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => {
                setShowVisibilityMenu(false)
                setVisibilityStep('main')
              }} />
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[220px] z-20 max-h-64 overflow-y-auto">
                {/* Step 1: Main options */}
                {visibilityStep === 'main' && (
                  <>
                    {/* Private option */}
                    <button
                      onClick={() => handleVisibilitySelect('private')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'private' && "bg-gray-50"
                      )}
                    >
                      <Lock className="h-4 w-4 text-gray-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Only me</div>
                        <div className="text-xs text-gray-500">Private to you</div>
                      </div>
                    </button>

                    {/* Organization option - navigates to category selection */}
                    <button
                      onClick={() => handleVisibilitySelect('organization')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'organization' && "bg-gray-50"
                      )}
                    >
                      <Building2 className="h-4 w-4 text-indigo-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Organization</div>
                        <div className="text-xs text-gray-500">
                          {selectedOrgNodeName || 'Select division, department, team...'}
                        </div>
                      </div>
                      <ChevronRight className="h-4 w-4 text-gray-400" />
                    </button>

                    {/* Public option */}
                    <button
                      onClick={() => handleVisibilitySelect('public')}
                      className={clsx(
                        "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                        visibility === 'public' && "bg-gray-50"
                      )}
                    >
                      <Globe className="h-4 w-4 text-green-500" />
                      <div className="flex-1">
                        <div className="text-sm font-medium text-gray-900">Public</div>
                        <div className="text-xs text-gray-500">Visible to everyone</div>
                      </div>
                    </button>
                  </>
                )}

                {/* Step 2: Category selection */}
                {visibilityStep === 'category' && (
                  <>
                    {/* Back button */}
                    <button
                      onClick={handleVisibilityBack}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">Back</span>
                    </button>

                    {/* Category options */}
                    {categoryOptions.map((category) => {
                      const Icon = category.icon
                      const count = nodesByType[category.value]?.length || 0
                      return (
                        <button
                          key={category.value}
                          onClick={() => handleCategorySelect(category.value)}
                          disabled={count === 0}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                            count === 0 && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className={clsx("h-4 w-4 rounded flex items-center justify-center", category.color)}>
                            <Icon className="h-2.5 w-2.5 text-white" />
                          </div>
                          <div className="flex-1">
                            <div className="text-sm font-medium text-gray-900">{category.label}</div>
                            <div className="text-xs text-gray-500">{count} available</div>
                          </div>
                          {count > 0 && <ChevronRight className="h-4 w-4 text-gray-400" />}
                        </button>
                      )
                    })}
                  </>
                )}

                {/* Step 3: Item selection */}
                {visibilityStep === 'items' && selectedCategory && (
                  <>
                    {/* Back button with category name */}
                    <button
                      onClick={handleVisibilityBack}
                      className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 border-b border-gray-100"
                    >
                      <ChevronLeft className="h-4 w-4 text-gray-500" />
                      <span className="text-sm text-gray-600">
                        Back to {categoryOptions.find(c => c.value === selectedCategory)?.label || 'categories'}
                      </span>
                    </button>

                    {/* Items in selected category */}
                    {nodesByType[selectedCategory]?.map((node) => {
                      const category = categoryOptions.find(c => c.value === selectedCategory)
                      const Icon = category?.icon || Users
                      return (
                        <button
                          key={node.id}
                          onClick={() => handleNodeSelect(node)}
                          className={clsx(
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50",
                            selectedOrgNodeId === node.id && "bg-primary-50"
                          )}
                        >
                          <div className={clsx("h-4 w-4 rounded flex items-center justify-center", category?.color || 'bg-gray-500')}>
                            <Icon className="h-2.5 w-2.5 text-white" />
                          </div>
                          <div className="text-sm font-medium text-gray-900">{node.name}</div>
                        </button>
                      )
                    })}

                    {/* Empty state */}
                    {(!nodesByType[selectedCategory] || nodesByType[selectedCategory].length === 0) && (
                      <div className="px-3 py-4 text-center text-sm text-gray-500">
                        No {selectedCategory}s found
                      </div>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center space-x-2">
          {onCancel && (
            <button
              onClick={onCancel}
              className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-800"
            >
              Cancel
            </button>
          )}
          <button
            onClick={handleSubmit}
            disabled={!content.trim() || createThought.isPending}
            className={clsx(
              "flex items-center space-x-1.5 px-4 py-1.5 rounded-lg text-sm font-medium transition-colors",
              content.trim()
                ? "bg-primary-600 text-white hover:bg-primary-700"
                : "bg-gray-100 text-gray-400 cursor-not-allowed"
            )}
          >
            {createThought.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            <span>Capture</span>
          </button>
        </div>
      </div>

      {/* Keyboard hint */}
      <div className="text-[10px] text-gray-400 text-right mt-1">
        Press <kbd className="px-1 py-0.5 bg-gray-100 rounded text-[10px]">Cmd+Enter</kbd> to capture
      </div>
    </div>
  )
}
