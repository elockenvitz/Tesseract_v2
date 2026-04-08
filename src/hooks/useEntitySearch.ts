import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

export type EntityType = 'user' | 'asset' | 'theme' | 'portfolio' | 'note' | 'workflow' | 'list' | 'trade_idea' | 'project' | 'trade' | 'trade_sheet' | 'meeting'

export interface EntitySearchResult {
  id: string
  type: EntityType
  title: string
  subtitle?: string
  icon?: string
  color?: string
  data: any
}

interface UseEntitySearchOptions {
  query: string
  types?: EntityType[]
  limit?: number
  enabled?: boolean
}

const DEFAULT_TYPES: EntityType[] = ['user', 'asset', 'theme', 'portfolio', 'note', 'workflow', 'list', 'trade_idea', 'project']

export function useEntitySearch({
  query,
  types = DEFAULT_TYPES,
  limit = 5,
  enabled = true
}: UseEntitySearchOptions) {
  const { data: results = [], isLoading, error } = useQuery({
    queryKey: ['entity-search', query, types.join(','), limit],
    queryFn: async () => {
      const searchResults: EntitySearchResult[] = []
      const searchPromises: Promise<void>[] = []

      // Search users
      if (types.includes('user')) {
        searchPromises.push(
          (async () => {
            let usersQuery = supabase
              .from('users')
              .select('id, email, first_name, last_name')

            // If query is provided, filter by it; otherwise return all users
            if (query.trim()) {
              usersQuery = usersQuery.or(`email.ilike.%${query}%,first_name.ilike.%${query}%,last_name.ilike.%${query}%`)
            }

            const { data: users } = await usersQuery.limit(limit)

            if (users) {
              searchResults.push(...users.map(user => ({
                id: user.id,
                type: 'user' as const,
                title: [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email,
                subtitle: user.email,
                icon: 'user',
                data: user
              })))
            }
          })()
        )
      }

      // Search assets
      if (types.includes('asset')) {
        searchPromises.push(
          (async () => {
            const { data: assets } = await supabase
              .from('assets')
              .select('id, symbol, company_name, sector, priority')
              .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`)
              .limit(limit)

            if (assets) {
              searchResults.push(...assets.map(asset => ({
                id: asset.id,
                type: 'asset' as const,
                title: asset.symbol,
                subtitle: asset.company_name,
                icon: 'trending-up',
                data: asset
              })))
            }
          })()
        )
      }

      // Search themes
      if (types.includes('theme')) {
        searchPromises.push(
          (async () => {
            const { data: themes } = await supabase
              .from('org_themes_v')
              .select('id, name, description, color, theme_type')
              .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
              .limit(limit)

            if (themes) {
              searchResults.push(...themes.map(theme => ({
                id: theme.id,
                type: 'theme' as const,
                title: theme.name,
                subtitle: theme.description || theme.theme_type,
                icon: 'tag',
                color: theme.color,
                data: theme
              })))
            }
          })()
        )
      }

      // Search portfolios
      if (types.includes('portfolio')) {
        searchPromises.push(
          (async () => {
            const { data: portfolios } = await supabase
              .from('portfolios')
              .select('id, name, description, benchmark, portfolio_id')
              .or(`name.ilike.%${query}%,description.ilike.%${query}%,portfolio_id.ilike.%${query}%`)
              .limit(limit)

            if (portfolios) {
              searchResults.push(...portfolios.map(portfolio => ({
                id: portfolio.id,
                type: 'portfolio' as const,
                title: portfolio.name,
                subtitle: portfolio.benchmark || portfolio.description,
                icon: 'briefcase',
                data: portfolio
              })))
            }
          })()
        )
      }

      // Search workflows
      if (types.includes('workflow')) {
        searchPromises.push(
          (async () => {
            const { data: workflows } = await supabase
              .from('org_workflows_v')
              .select('id, name, description, color')
              .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
              .eq('deleted', false)
              .limit(limit)

            if (workflows) {
              searchResults.push(...workflows.map(workflow => ({
                id: workflow.id,
                type: 'workflow' as const,
                title: workflow.name,
                subtitle: workflow.description,
                icon: 'git-branch',
                color: workflow.color,
                data: workflow
              })))
            }
          })()
        )
      }

      // Search lists
      if (types.includes('list')) {
        searchPromises.push(
          (async () => {
            const { data: lists } = await supabase
              .from('asset_lists')
              .select('id, name, description, color')
              .or(`name.ilike.%${query}%,description.ilike.%${query}%`)
              .limit(limit)

            if (lists) {
              searchResults.push(...lists.map(list => ({
                id: list.id,
                type: 'list' as const,
                title: list.name,
                subtitle: list.description,
                icon: 'list',
                color: list.color,
                data: list
              })))
            }
          })()
        )
      }

      // Search notes (across all note types)
      if (types.includes('note')) {
        searchPromises.push(
          (async () => {
            const [assetNotes, portfolioNotes, themeNotes, customNotes] = await Promise.all([
              supabase
                .from('asset_notes')
                .select('id, title, content, assets(symbol)')
                .or(`title.ilike.%${query}%`)
                .neq('is_deleted', true)
                .limit(2),
              supabase
                .from('portfolio_notes')
                .select('id, title, content, portfolios(name)')
                .or(`title.ilike.%${query}%`)
                .neq('is_deleted', true)
                .limit(2),
              supabase
                .from('theme_notes')
                .select('id, title, content, themes(name)')
                .or(`title.ilike.%${query}%`)
                .neq('is_deleted', true)
                .limit(2),
              supabase
                .from('custom_notebook_notes')
                .select('id, title, content, custom_notebooks(name)')
                .or(`title.ilike.%${query}%`)
                .neq('is_deleted', true)
                .limit(2)
            ])

            if (assetNotes.data) {
              searchResults.push(...assetNotes.data.map(note => ({
                id: note.id,
                type: 'note' as const,
                title: note.title,
                subtitle: (note.assets as any)?.symbol ? `${(note.assets as any).symbol} note` : 'Asset note',
                icon: 'file-text',
                data: { ...note, noteType: 'asset' }
              })))
            }

            if (portfolioNotes.data) {
              searchResults.push(...portfolioNotes.data.map(note => ({
                id: note.id,
                type: 'note' as const,
                title: note.title,
                subtitle: (note.portfolios as any)?.name ? `${(note.portfolios as any).name} note` : 'Portfolio note',
                icon: 'file-text',
                data: { ...note, noteType: 'portfolio' }
              })))
            }

            if (themeNotes.data) {
              searchResults.push(...themeNotes.data.map(note => ({
                id: note.id,
                type: 'note' as const,
                title: note.title,
                subtitle: (note.themes as any)?.name ? `${(note.themes as any).name} note` : 'Theme note',
                icon: 'file-text',
                data: { ...note, noteType: 'theme' }
              })))
            }

            if (customNotes.data) {
              searchResults.push(...customNotes.data.map(note => ({
                id: note.id,
                type: 'note' as const,
                title: note.title,
                subtitle: (note.custom_notebooks as any)?.name ? `${(note.custom_notebooks as any).name}` : 'Notebook',
                icon: 'file-text',
                data: { ...note, noteType: 'custom' }
              })))
            }
          })()
        )
      }

      // Search trade ideas
      if (types.includes('trade_idea')) {
        searchPromises.push(
          (async () => {
            const { data: ideas } = await supabase
              .from('trade_queue_items')
              .select('id, action, stage, assets(id, symbol, company_name)')
              .or(`action.ilike.%${query}%`)
              .limit(limit)

            // Also search by symbol if the query didn't match actions
            const { data: ideasBySymbol } = await supabase
              .from('trade_queue_items')
              .select('id, action, stage, assets!inner(id, symbol, company_name)')
              .or(`symbol.ilike.%${query}%,company_name.ilike.%${query}%`, { referencedTable: 'assets' })
              .limit(limit)

            const combined = new Map<string, any>()
            for (const item of [...(ideas || []), ...(ideasBySymbol || [])]) {
              combined.set(item.id, item)
            }

            for (const idea of combined.values()) {
              const asset = idea.assets as any
              const symbol = asset?.symbol || '?'
              const companyName = asset?.company_name || ''
              searchResults.push({
                id: idea.id,
                type: 'trade_idea' as const,
                title: `${idea.action || 'Trade'} ${symbol}`,
                subtitle: [companyName, idea.stage].filter(Boolean).join(' · '),
                icon: 'zap',
                data: idea
              })
            }
          })()
        )
      }

      // Search projects
      if (types.includes('project')) {
        searchPromises.push(
          (async () => {
            const { data: projects } = await supabase
              .from('projects')
              .select('id, title, description, status')
              .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
              .limit(limit)

            if (projects) {
              searchResults.push(...projects.map(project => ({
                id: project.id,
                type: 'project' as const,
                title: (project as any).title,
                subtitle: [project.description, project.status].filter(Boolean).join(' · '),
                icon: 'folder',
                data: project
              })))
            }
          })()
        )
      }

      // Search trades (lab_variants)
      if (types.includes('trade')) {
        searchPromises.push(
          (async () => {
            const { data: variants } = await supabase
              .from('lab_variants')
              .select('id, direction, sizing_input, created_at, asset:assets(id, symbol, company_name), portfolio:portfolios!inner(id, name)')
              .limit(limit)

            if (variants) {
              for (const v of variants as any[]) {
                const symbol = v.asset?.symbol || '?'
                const matchesQuery = !query.trim() ||
                  symbol.toLowerCase().includes(query.toLowerCase()) ||
                  (v.asset?.company_name || '').toLowerCase().includes(query.toLowerCase()) ||
                  (v.direction || '').toLowerCase().includes(query.toLowerCase())
                if (!matchesQuery) continue
                searchResults.push({
                  id: v.id,
                  type: 'trade' as const,
                  title: `${v.direction || 'Trade'} ${symbol}`,
                  subtitle: [v.sizing_input, v.portfolio?.name].filter(Boolean).join(' · '),
                  icon: 'arrow-right-left',
                  data: v
                })
              }
            }
          })()
        )
      }

      // Search trade sheets
      if (types.includes('trade_sheet')) {
        searchPromises.push(
          (async () => {
            const { data: sheets } = await supabase
              .from('trade_sheets')
              .select('id, name, status, created_at, portfolio:portfolios(name)')
              .or(`name.ilike.%${query}%`)
              .limit(limit)

            if (sheets) {
              searchResults.push(...(sheets as any[]).map(sheet => ({
                id: sheet.id,
                type: 'trade_sheet' as const,
                title: sheet.name || 'Trade Sheet',
                subtitle: [sheet.status, sheet.portfolio?.name].filter(Boolean).join(' · '),
                icon: 'clipboard-check',
                data: sheet
              })))
            }
          })()
        )
      }

      // Search meetings / calendar events
      if (types.includes('meeting')) {
        searchPromises.push(
          (async () => {
            const { data: events } = await supabase
              .from('calendar_events')
              .select('id, title, description, start_time, end_time, event_type')
              .or(`title.ilike.%${query}%,description.ilike.%${query}%`)
              .order('start_time', { ascending: false })
              .limit(limit)

            if (events) {
              searchResults.push(...events.map(evt => {
                let timeLabel = ''
                if (evt.start_time) {
                  try {
                    const d = new Date(evt.start_time)
                    timeLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
                      ', ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
                  } catch { /* ignore */ }
                }
                return {
                  id: evt.id,
                  type: 'meeting' as const,
                  title: evt.title || 'Meeting',
                  subtitle: [evt.event_type, timeLabel].filter(Boolean).join(' · '),
                  icon: 'calendar',
                  data: evt
                }
              }))
            }
          })()
        )
      }

      // Run all searches in parallel
      await Promise.all(searchPromises)

      return searchResults
    },
    enabled: enabled,
    staleTime: 30000 // Cache for 30 seconds
  })

  // Group results by type
  const groupedResults = types.reduce((acc, type) => {
    acc[type] = results.filter(r => r.type === type)
    return acc
  }, {} as Record<EntityType, EntitySearchResult[]>)

  return {
    results,
    groupedResults,
    isLoading,
    error
  }
}

// Helper to get icon component name for a type
export function getEntityIcon(type: EntityType): string {
  const icons: Record<EntityType, string> = {
    user: 'User',
    asset: 'TrendingUp',
    theme: 'Tag',
    portfolio: 'Briefcase',
    note: 'FileText',
    workflow: 'GitBranch',
    list: 'List',
    trade_idea: 'Zap',
    project: 'Folder',
    trade: 'ArrowRightLeft',
    trade_sheet: 'ClipboardCheck',
    meeting: 'Calendar'
  }
  return icons[type]
}

// Helper to get type label
export function getEntityLabel(type: EntityType): string {
  const labels: Record<EntityType, string> = {
    user: 'User',
    asset: 'Asset',
    theme: 'Theme',
    portfolio: 'Portfolio',
    note: 'Note',
    workflow: 'Workflow',
    list: 'List',
    trade_idea: 'Trade Idea',
    project: 'Project',
    trade: 'Trade',
    trade_sheet: 'Trade Sheet',
    meeting: 'Meeting'
  }
  return labels[type]
}

// Helper to get type color
export function getEntityColor(type: EntityType): string {
  const colors: Record<EntityType, string> = {
    user: 'blue',
    asset: 'green',
    theme: 'purple',
    portfolio: 'orange',
    note: 'gray',
    workflow: 'cyan',
    list: 'pink',
    trade_idea: 'amber',
    project: 'indigo',
    trade: 'rose',
    trade_sheet: 'teal',
    meeting: 'sky'
  }
  return colors[type]
}
