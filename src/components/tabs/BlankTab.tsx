import { useEffect, useRef } from 'react'
import {
  Search,
  TrendingUp,
  FileText,
  Tag,
  Briefcase,
  List,
  Lightbulb,
  FolderKanban,
  Workflow,
  ShoppingCart,
  Plus,
  StickyNote,
  PieChart,
  Users,
  Calendar,
  Target,
  FileBox,
  LayoutTemplate
} from 'lucide-react'
import { GlobalSearch } from '../search/GlobalSearch'

interface BlankTabProps {
  onSearchResult: (result: any) => void
}

// Section configuration
const PRIMARY_SURFACES = [
  {
    id: 'idea-generator',
    title: 'Ideas',
    type: 'idea-generator',
    description: 'Discover insights',
    icon: Lightbulb,
    gradient: 'from-purple-100 to-pink-100',
    iconColor: 'text-purple-600'
  },
  {
    id: 'projects-list',
    title: 'Projects',
    type: 'projects-list',
    description: 'One-off tasks',
    icon: FolderKanban,
    gradient: 'from-violet-100 to-purple-100',
    iconColor: 'text-violet-600'
  },
  {
    id: 'workflows',
    title: 'Workflows',
    type: 'workflows',
    description: 'Repeatable processes',
    icon: Workflow,
    gradient: 'from-blue-100 to-cyan-100',
    iconColor: 'text-blue-600'
  },
  {
    id: 'trade-queue',
    title: 'Trade Queue',
    type: 'trade-queue',
    description: 'Pending decisions',
    icon: ShoppingCart,
    gradient: 'from-amber-100 to-orange-100',
    iconColor: 'text-amber-600'
  },
  {
    id: 'priorities',
    title: 'All Priorities',
    type: 'priorities',
    description: 'What needs attention',
    icon: Target,
    gradient: 'from-rose-100 to-red-100',
    iconColor: 'text-rose-600'
  },
  {
    id: 'calendar',
    title: 'Calendar',
    type: 'calendar',
    description: 'Events & deadlines',
    icon: Calendar,
    gradient: 'from-teal-100 to-emerald-100',
    iconColor: 'text-teal-600'
  }
]

const CREATE_ACTIONS = [
  {
    id: 'quick-thought',
    title: 'Quick Thought',
    action: 'capture',
    description: 'Capture an idea',
    icon: StickyNote,
    gradient: 'from-yellow-100 to-amber-100',
    iconColor: 'text-yellow-600'
  },
  {
    id: 'new-project',
    title: 'New Project',
    action: 'new-project',
    description: 'Start a project',
    icon: Plus,
    gradient: 'from-violet-100 to-purple-100',
    iconColor: 'text-violet-600'
  },
  {
    id: 'new-asset',
    title: 'Add Asset',
    action: 'new-asset',
    description: 'Track a new stock',
    icon: TrendingUp,
    gradient: 'from-primary-100 to-blue-100',
    iconColor: 'text-primary-600'
  },
  {
    id: 'new-list',
    title: 'New List',
    action: 'new-list',
    description: 'Organize assets',
    icon: List,
    gradient: 'from-purple-100 to-indigo-100',
    iconColor: 'text-purple-600'
  }
]

const UTILITY_SURFACES = [
  {
    id: 'assets-list',
    title: 'Assets',
    type: 'assets-list',
    description: 'All investments',
    icon: TrendingUp,
    gradient: 'from-primary-100 to-blue-100',
    iconColor: 'text-primary-600'
  },
  {
    id: 'portfolios-list',
    title: 'Portfolios',
    type: 'portfolios-list',
    description: 'Track performance',
    icon: Briefcase,
    gradient: 'from-success-100 to-emerald-100',
    iconColor: 'text-success-600'
  },
  {
    id: 'themes-list',
    title: 'Themes',
    type: 'themes-list',
    description: 'Organize by topic',
    icon: Tag,
    gradient: 'from-indigo-100 to-purple-100',
    iconColor: 'text-indigo-600'
  },
  {
    id: 'notes-list',
    title: 'Notes',
    type: 'notes-list',
    description: 'All your notes',
    icon: FileText,
    gradient: 'from-slate-100 to-gray-100',
    iconColor: 'text-slate-600'
  },
  {
    id: 'lists',
    title: 'Lists',
    type: 'lists',
    description: 'Asset lists',
    icon: List,
    gradient: 'from-purple-100 to-pink-100',
    iconColor: 'text-purple-600'
  },
  {
    id: 'templates',
    title: 'Templates',
    type: 'templates',
    description: 'Reusable templates',
    icon: LayoutTemplate,
    gradient: 'from-cyan-100 to-blue-100',
    iconColor: 'text-cyan-600'
  },
  {
    id: 'files',
    title: 'Files',
    type: 'files',
    description: 'Documents & models',
    icon: FileBox,
    gradient: 'from-orange-100 to-amber-100',
    iconColor: 'text-orange-600'
  },
  {
    id: 'asset-allocation',
    title: 'Allocation',
    type: 'asset-allocation',
    description: 'Portfolio allocation',
    icon: PieChart,
    gradient: 'from-emerald-100 to-teal-100',
    iconColor: 'text-emerald-600'
  },
  {
    id: 'organization',
    title: 'Organization',
    type: 'organization',
    description: 'Team & structure',
    icon: Users,
    gradient: 'from-sky-100 to-blue-100',
    iconColor: 'text-sky-600'
  }
]

export function BlankTab({ onSearchResult }: BlankTabProps) {
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchRef.current) {
        searchRef.current.focus()
      }
    }, 100)

    return () => clearTimeout(timer)
  }, [])

  const handleNavigate = (item: { id: string; title: string; type: string }) => {
    onSearchResult({
      id: item.id,
      title: item.title,
      type: item.type,
      data: null
    })
  }

  const handleAction = (actionId: string) => {
    switch (actionId) {
      case 'capture':
        // Open quick thought capture
        window.dispatchEvent(new CustomEvent('openThoughtsCapture', { detail: {} }))
        break
      case 'new-project':
        // Navigate to projects with create intent
        onSearchResult({
          id: 'projects-list',
          title: 'All Projects',
          type: 'projects-list',
          data: { createNew: true }
        })
        break
      case 'new-asset':
        // Navigate to assets with create intent
        onSearchResult({
          id: 'assets-list',
          title: 'All Assets',
          type: 'assets-list',
          data: { createNew: true }
        })
        break
      case 'new-list':
        // Navigate to lists with create intent
        onSearchResult({
          id: 'lists',
          title: 'Asset Lists',
          type: 'lists',
          data: { createNew: true }
        })
        break
    }
  }

  return (
    <div className="h-full overflow-auto bg-gray-50/50">
      <div className="max-w-4xl mx-auto py-8 px-6">
        {/* Search */}
        <div className="mb-10">
          <div className="flex items-center justify-center mb-4">
            <div className="w-12 h-12 bg-primary-100 rounded-full flex items-center justify-center">
              <Search className="h-6 w-6 text-primary-600" />
            </div>
          </div>
          <h2 className="text-xl font-semibold text-gray-900 text-center mb-4">
            What would you like to explore?
          </h2>
          <div className="max-w-xl mx-auto">
            <GlobalSearch
              onSelectResult={onSearchResult}
              placeholder="Search for anything..."
            />
          </div>
        </div>

        {/* Section 1: Primary Work Surfaces */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 px-1">
            Go To
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
            {PRIMARY_SURFACES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item)}
                  className="flex flex-col items-center p-4 rounded-xl bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all group"
                >
                  <div className={`w-10 h-10 bg-gradient-to-r ${item.gradient} rounded-lg flex items-center justify-center mb-2 group-hover:scale-105 transition-transform`}>
                    <Icon className={`h-5 w-5 ${item.iconColor}`} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">{item.title}</span>
                  <span className="text-xs text-gray-400 mt-0.5">{item.description}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Section 2: Create & Add */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 px-1">
            Create
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {CREATE_ACTIONS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => handleAction(item.action)}
                  className="flex items-center gap-3 p-4 rounded-xl bg-white border border-gray-200 hover:border-gray-300 hover:shadow-sm transition-all group"
                >
                  <div className={`w-10 h-10 bg-gradient-to-r ${item.gradient} rounded-lg flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform`}>
                    <Icon className={`h-5 w-5 ${item.iconColor}`} />
                  </div>
                  <div className="text-left">
                    <span className="text-sm font-medium text-gray-700 block">{item.title}</span>
                    <span className="text-xs text-gray-400">{item.description}</span>
                  </div>
                </button>
              )
            })}
          </div>
        </div>

        {/* Section 3: Supporting & Utility */}
        <div>
          <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-3 px-1">
            Browse
          </h3>
          <div className="grid grid-cols-3 sm:grid-cols-5 md:grid-cols-9 gap-2">
            {UTILITY_SURFACES.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigate(item)}
                  className="flex flex-col items-center p-3 rounded-lg bg-white border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition-all group"
                >
                  <div className={`w-8 h-8 bg-gradient-to-r ${item.gradient} rounded-md flex items-center justify-center mb-1.5 group-hover:scale-105 transition-transform`}>
                    <Icon className={`h-4 w-4 ${item.iconColor}`} />
                  </div>
                  <span className="text-xs font-medium text-gray-600">{item.title}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
