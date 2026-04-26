import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, Mail, User, Users, Settings, LogOut, ChevronDown, Lightbulb, Building2, FileText, Target, Calendar, FolderKanban, TrendingUp, Briefcase, List, Repeat, LineChart, FolderOpen, ListTodo, BookOpen, Activity, Plus, Shield, Flag, Beaker, Lock, Sparkles, Tag, StickyNote } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { useOrganization } from '../../contexts/OrganizationContext'
import { useMorphSession } from '../../hooks/useMorphSession'
import { supabase } from '../../lib/supabase'
import { GlobalSearch } from '../search/GlobalSearch'
import { FeedbackWidget } from '../feedback/FeedbackWidget'
import { MorphBanner } from '../support/MorphBanner'
import { usePilotMode } from '../../hooks/usePilotMode'
import { ProfilePage } from '../../pages/ProfilePage'
import { SettingsPage } from '../../pages/SettingsPage'
import { SetupWizard } from '../onboarding/SetupWizard'
import { TesseractLogo } from '../ui/TesseractLogo'
// SetupWizard removed — org creation disabled for normal users

interface HeaderProps {
  onSearchResult: (result: any) => void
  onFocusSearch?: () => void
  onShowDirectMessages?: () => void
  onShowNotifications?: () => void
  onShowCoverageManager?: () => void
  isCommPaneOpen?: boolean
  onToggleCommPane?: () => void
  commPaneView?: string
  onShowAI?: () => void
  onShowThoughts?: () => void
}

export function Header({
  onSearchResult,
  onFocusSearch,
  onShowDirectMessages,
  onShowNotifications,
  onShowCoverageManager,
  isCommPaneOpen,
  onToggleCommPane,
  commPaneView = 'thoughts',
  onShowAI = () => {},
  onShowThoughts = () => {}
}: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showAppMenu, setShowAppMenu] = useState(false)
  const [showOrgSwitcher, setShowOrgSwitcher] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showCustomization, setShowCustomization] = useState(false)
  // showOrgWizard removed — org creation disabled for normal users
  const userMenuRef = useRef<HTMLDivElement>(null)
  const appMenuRef = useRef<HTMLDivElement>(null)
  const orgSwitcherRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()
  const { hasUnreadNotifications, unreadCount } = useNotifications()
  const { currentOrg, userOrgs, switchOrg, isLoading } = useOrganization()

  // Preload every org logo as soon as the user-orgs query resolves, so the
  // first time the dropdown opens the browser already has the images in
  // memory cache. Without this, each `<img src={signed-url}>` in the menu
  // triggers its own network round-trip on the click, and the user sees
  // empty squares for a beat before the logos pop in.
  useEffect(() => {
    for (const org of userOrgs) {
      if (!org.logo_url) continue
      const img = new Image()
      img.src = org.logo_url
    }
  }, [userOrgs])
  const { activeSession } = useMorphSession()
  const pilotMode = usePilotMode()

  // During an active morph session, display the target user's identity in the
  // header/user menu so the admin sees "what the user sees". auth.uid() stays
  // the admin, so mutations and audit trails remain correct.
  const { data: morphTargetUser } = useQuery({
    queryKey: ['morph-target-user', activeSession?.target_user_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('users')
        .select('email, first_name, last_name, full_name, user_type')
        .eq('id', activeSession!.target_user_id)
        .maybeSingle()
      if (error) return null
      return data
    },
    enabled: !!activeSession?.target_user_id,
    staleTime: 5 * 60 * 1000,
  })

  // Platform admin check — gates "Create Organization" for multi-org users
  const { data: isPlatformAdmin = false } = useQuery({
    queryKey: ['is-platform-admin', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('is_platform_admin')
      if (error) return false
      return data === true
    },
    enabled: !!user?.id,
    staleTime: 10 * 60 * 1000,
  })

  // User details are already loaded in the user object from useAuth.
  // When morphing, overlay target user's display fields (name, email, avatar,
  // role) so the header reflects who the admin is viewing-as.
  const userDetails = (morphTargetUser
    ? { ...(user as any), ...morphTargetUser }
    : (user as any))

  // Check for unread direct messages (conversation_messages table only)
  const { data: hasUnreadDirectMessages, refetch: refetchDirectMessagesUnstable } = useQuery({
    queryKey: ['unread-direct-messages', user?.id],
    queryFn: async () => {
      if (!user?.id) return false

      // Check direct messages by getting user's conversations
      const { data: userConversations, error: convError } = await supabase
        .from('conversation_participants')
        .select('conversation_id, last_read_at')
        .eq('user_id', user.id)

      if (convError) {
        console.error('Error fetching user conversations for notification:', convError)
        return false
      }

      if (!userConversations || userConversations.length === 0) {
        return false
      }

      // Check each conversation for unread messages
      for (const conv of userConversations) {
        const { count } = await supabase
          .from('conversation_messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', conv.conversation_id)
          .neq('user_id', user.id)
          .gt('created_at', conv.last_read_at || '1970-01-01')

        if (count && count > 0) {
          return true
        }
      }

      return false
    },
    enabled: !!user?.id,
    refetchInterval: 5000, // Check every 5 seconds for near-instant notification
    refetchOnWindowFocus: true,
    staleTime: 0,
  })

  // Stable ref for refetch to avoid re-creating realtime subscription on every render
  const refetchDMRef = useRef(refetchDirectMessagesUnstable)
  refetchDMRef.current = refetchDirectMessagesUnstable

  // Listen for openSettings event from AI section
  useEffect(() => {
    const handleOpenSettings = () => {
      setShowSettings(true)
    }
    window.addEventListener('openSettings', handleOpenSettings)
    return () => window.removeEventListener('openSettings', handleOpenSettings)
  }, [])

  // Subscribe to real-time message updates
  useEffect(() => {
    if (!user?.id) return

    // Subscribe to new conversation messages for immediate notification.
    // Uses broadcast channel as a reliable fallback alongside postgres_changes,
    // since RLS can prevent realtime events from reaching the subscriber.
    const channel = supabase
      .channel('header-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages'
        },
        () => {
          // Small delay to ensure DB write is committed before refetch
          setTimeout(() => refetchDMRef.current(), 500)
        }
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'conversation_participants',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          refetchDMRef.current()
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [user?.id])

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
      if (appMenuRef.current && !appMenuRef.current.contains(event.target as Node)) {
        setShowAppMenu(false)
      }
      if (orgSwitcherRef.current && !orgSwitcherRef.current.contains(event.target as Node)) {
        setShowOrgSwitcher(false)
      }
    }

    if (showUserMenu || showAppMenu || showOrgSwitcher) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu, showAppMenu, showOrgSwitcher])

  const handleSignOut = async () => {
    try {
      await signOut()
      setShowUserMenu(false)
    } catch (error) {
      console.error('Failed to sign out:', error)
    }
  }

  // Function to get user initials from first and last name, fallback to email
  const getUserInitials = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return (userDetails.first_name[0] + userDetails.last_name[0]).toUpperCase()
    }

    // Fallback to email-based initials
    const email = userDetails?.email || user?.email
    if (!email) return ''

    const parts = email.split('@')[0].split('.')
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }

    const name = email.split('@')[0]
    return name.length >= 2 ? name.substring(0, 2).toUpperCase() : name.toUpperCase()
  }

  // Function to get display name
  const getDisplayName = () => {
    if (userDetails?.first_name && userDetails?.last_name) {
      return `${userDetails.first_name} ${userDetails.last_name}`
    }
    
    // Fallback to email username
    const email = userDetails?.email || user?.email
    if (!email) return ''

    // Try to parse name from email if it follows firstname.lastname@domain format
    const emailParts = email.split('@')[0].split('.')
    if (emailParts.length >= 2) {
      return emailParts.map((part: string) =>
        part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
      ).join(' ')
    }

    return email.split('@')[0]
  }

  return (
    <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 sticky top-0 z-40">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo, Org Switcher, and Search */}
          <div className="flex items-center flex-1">
            {/* App Launcher — icon only */}
            <div className="relative" ref={appMenuRef}>
              <button
                onClick={() => setShowAppMenu(!showAppMenu)}
                className="flex items-center justify-center w-9 h-9 -ml-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                aria-label="App launcher"
                title="App launcher"
              >
                <TesseractLogo size={28} />
              </button>

              {/* App Launcher Panel */}
              {showAppMenu && pilotMode.effectiveIsPilot && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-3 z-50">
                  {/* Pilot badge */}
                  <div className="px-4 pb-2 flex items-center gap-1.5">
                    <Sparkles className="w-3 h-3 text-primary-500" />
                    <span className="text-xs font-semibold text-primary-700 uppercase tracking-wider">Pilot</span>
                  </div>

                  {/* Primary — Dashboard as the landing surface. Reads
                      as "your workspace" so pilots know where to
                      return when they need an overview. */}
                  <div className="px-2 pb-2">
                    <button
                      onClick={() => {
                        setShowAppMenu(false)
                        onSearchResult({ id: 'dashboard', title: 'Dashboard', type: 'dashboard', data: null })
                      }}
                      className="w-full flex items-center gap-3 p-3 rounded-lg ring-1 ring-primary-200 bg-primary-50/40 hover:bg-primary-50 transition-colors"
                    >
                      <div className="w-10 h-10 rounded-lg flex items-center justify-center bg-primary-100 shrink-0">
                        <Activity className="h-5 w-5 text-primary-600" />
                      </div>
                      <div className="flex-1 text-left">
                        <div className="text-sm font-semibold text-gray-900 dark:text-white">Dashboard</div>
                        <div className="text-[11px] text-gray-500">What needs your attention</div>
                      </div>
                    </button>
                  </div>

                  {/* Secondary tiles — the pilot decision loop. Idea
                      Pipeline → Trade Lab sit alongside each other as
                      the two routing paths into a decision. */}
                  <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                    <button
                      onClick={() => {
                        setShowAppMenu(false)
                        onSearchResult({ id: 'trade-queue', title: 'Idea Pipeline', type: 'trade-queue', data: null })
                      }}
                      className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-1 bg-amber-50">
                        <Lightbulb className="h-5 w-5 text-amber-500" />
                      </div>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200">Idea Pipeline</span>
                    </button>
                    <button
                      onClick={() => {
                        setShowAppMenu(false)
                        window.dispatchEvent(new CustomEvent('openTradeLab', { detail: {} }))
                      }}
                      className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-1 bg-primary-50">
                        <Beaker className="h-5 w-5 text-primary-600" />
                      </div>
                      <span className="text-[11px] font-medium text-gray-700 dark:text-gray-200">Trade Lab</span>
                    </button>
                  </div>

                  {/* Teaser: downstream surfaces (preview until unlocked) */}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-3 px-4 pb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Connected surfaces</span>
                    <Lock className="w-3 h-3 text-gray-300" />
                  </div>
                  <div className="grid grid-cols-2 gap-1 px-2 pb-2">
                    {[
                      { key: 'tradeBook' as const, type: 'trade-book', title: 'Trade Book',  icon: BookOpen, bg: 'bg-indigo-50', color: 'text-indigo-500' },
                      { key: 'outcomes'  as const, type: 'outcomes',   title: 'Outcomes',    icon: Target,   bg: 'bg-teal-50',    color: 'text-teal-500' },
                    ].map(item => {
                      const level = pilotMode.accessFor(item.key)
                      if (level === 'hidden') return null
                      return (
                        <button
                          key={item.type}
                          onClick={() => {
                            setShowAppMenu(false)
                            if (level === 'full') {
                              onSearchResult({ id: item.type, title: item.title, type: item.type, data: null })
                            } else {
                              window.dispatchEvent(new CustomEvent('pilot-teaser', {
                                detail: { featureLabel: item.title, reason: 'preview' }
                              }))
                            }
                          }}
                          className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors opacity-75"
                          title={level === 'preview' ? 'Pilot preview — unlocks after your first accepted decision' : undefined}
                        >
                          <div className={clsx('w-9 h-9 rounded-lg flex items-center justify-center mb-1 relative', item.bg)}>
                            <item.icon className={clsx('h-5 w-5', item.color)} />
                            {level === 'preview' && (
                              <div className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full bg-white flex items-center justify-center shadow-sm">
                                <Lock className="w-2 h-2 text-gray-400" />
                              </div>
                            )}
                          </div>
                          <span className="text-[11px] font-medium text-gray-600 dark:text-gray-300">{item.title}</span>
                        </button>
                      )
                    })}
                  </div>

                  {/* Organization (always allowed so pilots can manage members) */}
                  {pilotMode.canSee('organization') && (
                    <div className="border-t border-gray-100 dark:border-gray-700 pt-2 px-2 pb-1">
                      <button
                        onClick={() => {
                          setShowAppMenu(false)
                          onSearchResult({ id: 'organization', title: 'Organization', type: 'organization', data: null })
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      >
                        <Building2 className="h-4 w-4 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">Organization</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Full (non-pilot) app menu */}
              {showAppMenu && !pilotMode.effectiveIsPilot && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-3 z-50">
                  {/* Future: System status row can be added here */}

                  {/* Core */}
                  <div className="px-4 pb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Core</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-3">
                    {[
                      { id: 'priorities', title: 'Priorities', type: 'priorities', icon: Flag, color: 'text-rose-500', bg: 'bg-rose-50' },
                      { id: 'idea-generator', title: 'Ideas', type: 'idea-generator', icon: Lightbulb, color: 'text-purple-500', bg: 'bg-purple-50' },
                      { id: 'trade-queue', title: 'Pipeline', type: 'trade-queue', icon: ListTodo, color: 'text-amber-500', bg: 'bg-amber-50' },
                      { id: 'assets-list', title: 'Assets', type: 'assets-list', icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
                      { id: 'portfolios-list', title: 'Portfolios', type: 'portfolios-list', icon: Briefcase, color: 'text-emerald-500', bg: 'bg-emerald-50' },
                      { id: 'themes-list', title: 'Themes', type: 'themes-list', icon: Tag, color: 'text-fuchsia-500', bg: 'bg-fuchsia-50' },
                      { id: 'trade-lab', title: 'Trade Lab', type: 'trade-lab', icon: Beaker, color: 'text-orange-500', bg: 'bg-orange-50' },
                      { id: 'trade-book', title: 'Trade Book', type: 'trade-book', icon: BookOpen, color: 'text-indigo-500', bg: 'bg-indigo-50' },
                      { id: 'outcomes', title: 'Outcomes', type: 'outcomes', icon: Target, color: 'text-teal-500', bg: 'bg-teal-50' },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setShowAppMenu(false)
                          onSearchResult({ id: item.id, title: item.title, type: item.type, data: null })
                        }}
                        className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group/tile"
                      >
                        <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center mb-1.5', item.bg)}>
                          <item.icon className={clsx('h-5 w-5', item.color)} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 text-center leading-tight">{item.title}</span>
                      </button>
                    ))}
                  </div>

                  {/* Work Management */}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-3 px-4 pb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Work Management</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-3">
                    {[
                      { id: 'lists', title: 'Lists', type: 'lists', icon: List, color: 'text-violet-500', bg: 'bg-violet-50' },
                      { id: 'notes-list', title: 'Notes', type: 'notes-list', icon: StickyNote, color: 'text-yellow-600', bg: 'bg-yellow-50' },
                      { id: 'workflows', title: 'Process', type: 'workflows', icon: Repeat, color: 'text-cyan-500', bg: 'bg-cyan-50' },
                      { id: 'projects-list', title: 'Projects', type: 'projects-list', icon: FolderKanban, color: 'text-indigo-500', bg: 'bg-indigo-50' },
                      { id: 'templates', title: 'Templates', type: 'templates', icon: FileText, color: 'text-amber-600', bg: 'bg-amber-50' },
                      { id: 'coverage', title: 'Coverage', type: 'coverage', icon: Users, color: 'text-sky-500', bg: 'bg-sky-50' },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setShowAppMenu(false)
                          onSearchResult({ id: item.id, title: item.title, type: item.type, data: null })
                        }}
                        className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group/tile"
                      >
                        <div className={clsx('w-10 h-10 rounded-lg flex items-center justify-center mb-1.5', item.bg)}>
                          <item.icon className={clsx('h-5 w-5', item.color)} />
                        </div>
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 text-center leading-tight">{item.title}</span>
                      </button>
                    ))}
                    {/* Ops Portal: access via /ops directly — no product UI link */}
                  </div>

                  {/* Tools - visually de-emphasized */}
                  <div className="border-t border-gray-100 dark:border-gray-700 pt-3 px-4 pb-2">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Tools</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-1">
                    {[
                      { id: 'charting', title: 'Charting', type: 'charting', icon: LineChart, color: 'text-gray-400', bg: 'bg-gray-100' },
                      { id: 'files', title: 'Files', type: 'files', icon: FolderOpen, color: 'text-gray-400', bg: 'bg-gray-100' },
                      { id: 'calendar', title: 'Calendar', type: 'calendar', icon: Calendar, color: 'text-gray-400', bg: 'bg-gray-100' },
                    ].map(item => (
                      <button
                        key={item.id}
                        onClick={() => {
                          setShowAppMenu(false)
                          onSearchResult({ id: item.id, title: item.title, type: item.type, data: null })
                        }}
                        className="flex flex-col items-center p-2.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group/tile"
                      >
                        <div className={clsx('w-8 h-8 rounded-md flex items-center justify-center mb-1', item.bg)}>
                          <item.icon className={clsx('h-4 w-4', item.color)} />
                        </div>
                        <span className="text-[11px] font-medium text-gray-500 dark:text-gray-400 text-center leading-tight">{item.title}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Divider + Org Switcher */}
            {currentOrg && (
              <>
              <div className="h-5 w-px bg-gray-200 dark:bg-gray-700 mx-3 flex-shrink-0" />
              <div className="relative" ref={orgSwitcherRef}>
                <button
                  onClick={() => { if (userOrgs.length > 1) setShowOrgSwitcher(!showOrgSwitcher) }}
                  className={clsx(
                    'flex items-center gap-1.5 px-2 py-1 rounded-md text-sm transition-colors',
                    userOrgs.length > 1
                      ? 'hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer'
                      : 'cursor-default'
                  )}
                  aria-label="Switch organization"
                  title={userOrgs.length > 1 ? 'Switch organization' : currentOrg.name}
                >
                  <span className="font-semibold text-base text-gray-800 dark:text-gray-200 max-w-[200px] truncate">
                    {currentOrg.name}
                  </span>
                  {!!currentOrg.settings?.pilot_mode && (
                    <span className="px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded">
                      Pilot
                    </span>
                  )}
                  {userOrgs.length > 1 && (
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                  )}
                </button>

                {showOrgSwitcher && userOrgs.length > 1 && (
                  <div className="absolute left-0 top-full mt-1 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl border border-gray-200 dark:border-gray-700 py-1 z-50">
                    <div className="px-3 py-2 border-b border-gray-100 dark:border-gray-700">
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Switch Organization</p>
                    </div>
                    {userOrgs.map((org) => (
                      <button
                        key={org.id}
                        onClick={async () => {
                          try {
                            await switchOrg(org.id)
                            setShowOrgSwitcher(false)
                          } catch (err: any) {
                            console.error('Failed to switch org:', err)
                          }
                        }}
                        className={clsx(
                          'w-full flex items-center space-x-3 px-3 py-2.5 text-sm transition-colors text-left',
                          org.id === currentOrg.id
                            ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-700 dark:text-indigo-300'
                            : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                        )}
                      >
                        {org.logo_url ? (
                          <img
                            src={org.logo_url}
                            alt=""
                            loading="eager"
                            decoding="async"
                            className="w-6 h-6 rounded object-cover flex-shrink-0"
                          />
                        ) : (
                          <div className="w-6 h-6 rounded bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0">
                            <Building2 className="w-3.5 h-3.5 text-gray-500" />
                          </div>
                        )}
                        <span className="font-medium truncate">{org.name}</span>
                        {org.id === currentOrg.id && (
                          <span className="ml-auto text-indigo-500 text-xs">Active</span>
                        )}
                      </button>
                    ))}
                    {/* Create Organization removed — orgs are provisioned by platform admin only */}
                  </div>
                )}
              </div>
              </>
            )}

            {/* Search */}
            <div className="flex-1 max-w-lg ml-5">
              <GlobalSearch onSelectResult={onSearchResult} onFocusSearch={onFocusSearch} />
            </div>

            {/* Feedback pill — lives next to the search bar so it's
                always reachable without floating over the page. */}
            <div className="ml-3 flex-shrink-0">
              <FeedbackWidget />
            </div>

            {/* Morph-session indicator — only renders when actively morphing */}
            <div className="ml-3 flex-shrink-0">
              <MorphBanner />
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
            {/* Capture Thought Button */}
            <button
              onClick={() => {
                onShowThoughts()
              }}
              className={clsx(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors relative",
                isCommPaneOpen && commPaneView === 'thoughts'
                  ? "text-amber-600 bg-amber-100"
                  : "text-gray-400 hover:text-gray-600"
              )}
              title="Capture a thought"
            >
              <Lightbulb className="h-5 w-5" />
            </button>

            {/* AI Button */}
            <button
              onClick={() => {
                onShowAI()
              }}
              className={clsx(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors relative",
                isCommPaneOpen && commPaneView === 'ai'
                  ? "text-primary-600 bg-primary-100"
                  : "text-gray-400 hover:text-gray-600"
              )}
              title="AI Assistant"
            >
              <div className="w-5 h-5 bg-gradient-to-r from-blue-500 to-purple-500 rounded flex items-center justify-center">
                <span className="text-white text-xs font-bold">AI</span>
              </div>
            </button>
            
            {/* Direct Messages Button */}
            <button
              onClick={() => {
                onShowDirectMessages?.()
              }}
              className={clsx(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors relative",
                isCommPaneOpen && commPaneView === 'direct-messages'
                  ? "text-primary-600 bg-primary-100"
                  : "text-gray-400 hover:text-gray-600"
              )}
              title="Direct messages"
            >
              <Mail className="h-5 w-5" />
              {hasUnreadDirectMessages && (
                <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-red-500"></span>
              )}
            </button>
            
            {/* Notifications Button */}
            <button
              onClick={() => {
                onShowNotifications?.()
              }}
              className={clsx(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors relative",
                isCommPaneOpen && commPaneView === 'notifications'
                  ? "text-primary-600 bg-primary-100"
                  : "text-gray-400 hover:text-gray-600"
              )}
              title="View notifications"
            >
              <Bell className="h-5 w-5" />
              {hasUnreadNotifications && (
                <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-bold text-white bg-error-500 rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            
            {/* Profile Button */}
            <div className="relative" ref={userMenuRef}>
              <button
                onClick={() => setShowUserMenu(!showUserMenu)}
                className="flex items-center space-x-3 p-2 text-gray-700 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                title="Account menu"
              >
                <div className="w-8 h-8 rounded-full bg-primary-600 flex items-center justify-center">
                  <span className="text-white text-sm font-semibold">
                    {getUserInitials()}
                  </span>
                </div>
                <div className="hidden md:block text-left">
                  <p className="text-sm font-medium text-gray-900">
                    {getDisplayName()}
                  </p>
                  <p className="text-xs text-gray-500 capitalize">{userDetails?.user_role || 'Investor'}</p>
                </div>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {/* User Menu Dropdown */}
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-48 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 py-1 z-50">
                  {/* Menu Items */}
                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowProfile(true)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <User className="h-4 w-4 mr-3 text-gray-400" />
                    Profile
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      onSearchResult({
                        id: 'templates',
                        title: 'Templates',
                        type: 'templates'
                      })
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <FileText className="h-4 w-4 mr-3 text-gray-400" />
                    Templates
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      onShowCoverageManager?.()
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <Users className="h-4 w-4 mr-3 text-gray-400" />
                    Coverage
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      onSearchResult({
                        id: 'organization',
                        title: 'Organization',
                        type: 'organization',
                        data: null
                      })
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <Building2 className="h-4 w-4 mr-3 text-gray-400" />
                    Organization
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowCustomization(true)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <Sparkles className="h-4 w-4 mr-3 text-gray-400" />
                    Customize workspace
                  </button>

                  <button
                    onClick={() => {
                      setShowUserMenu(false)
                      setShowSettings(true)
                    }}
                    className="w-full px-4 py-2 text-left text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center transition-colors"
                  >
                    <Settings className="h-4 w-4 mr-3 text-gray-400" />
                    Settings
                  </button>

                  {/* Sign Out */}
                  <div className="border-t border-gray-200 dark:border-gray-700 mt-1 pt-1">
                    <button
                      onClick={handleSignOut}
                      className="w-full px-4 py-2 text-left text-sm text-error-600 hover:bg-error-50 flex items-center transition-colors"
                    >
                      <LogOut className="h-4 w-4 mr-3" />
                      Sign Out
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      
      {/* Profile Modal */}
      {showProfile && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div 
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowProfile(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all p-8">
              <ProfilePage onClose={() => setShowProfile(false)} />
            </div>
          </div>
        </div>
      )}
      
      {/* Settings Modal */}
      {showSettings && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div
            className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
            onClick={() => setShowSettings(false)}
          />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] mx-auto transform transition-all flex flex-col overflow-hidden">
              {/* Inner scroll container so the scrollbar respects the rounded corners */}
              <div className="overflow-y-auto p-8">
                <SettingsPage onClose={() => setShowSettings(false)} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Customize Workspace Modal — opens the SetupWizard in
          'workspace_customization' framing. Reachable from the user
          menu so it's always discoverable, not just from the
          dashboard prompt card. */}
      {showCustomization && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center">
          <div className="w-full max-w-3xl h-[90vh] overflow-hidden bg-white dark:bg-gray-800 rounded-2xl shadow-2xl">
            <SetupWizard
              mode="workspace_customization"
              onComplete={() => setShowCustomization(false)}
              onSkip={() => setShowCustomization(false)}
              isModal
            />
          </div>
        </div>
      )}

      {/* Org Setup Wizard — only manually triggered, never auto-opens */}
      {/* Org creation is disabled for normal users; provisioned by platform admin only */}
    </header>
  )
}