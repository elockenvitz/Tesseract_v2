import { useState, useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, MessageCircle, Mail, User, Users, Settings, LogOut, ChevronDown, Lightbulb, Building2, FileText, Target, Calendar, FolderKanban, TrendingUp, Briefcase, List, Workflow, LineChart, FolderOpen, ShoppingCart } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { supabase } from '../../lib/supabase'
import { GlobalSearch } from '../search/GlobalSearch'
import { ProfilePage } from '../../pages/ProfilePage'
import { SettingsPage } from '../../pages/SettingsPage'
import { TesseractLogo } from '../ui/TesseractLogo'

interface HeaderProps {
  onSearchResult: (result: any) => void
  onFocusSearch?: () => void
  onShowMessages?: () => void
  hasUnreadMessages?: boolean
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
  onShowMessages,
  hasUnreadMessages,
  onShowDirectMessages,
  onShowNotifications,
  onShowCoverageManager,
  isCommPaneOpen,
  onToggleCommPane,
  commPaneView = 'messages',
  onShowAI = () => {},
  onShowThoughts = () => {}
}: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showAppMenu, setShowAppMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const appMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()
  const { hasUnreadNotifications, unreadCount } = useNotifications()

  // User details are already loaded in the user object from useAuth
  const userDetails = user as any

  // Check for unread direct messages (conversation_messages table only)
  const { data: hasUnreadDirectMessages, refetch: refetchDirectMessages } = useQuery({
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
          console.log('Header: Found unread direct messages in conversation', conv.conversation_id, 'count:', count)
          return true
        }
      }

      console.log('Header: No unread direct messages')
      return false
    },
    enabled: !!user?.id,
    refetchInterval: 30000, // Check every 30 seconds
    staleTime: 0 // Always consider data stale to refetch on invalidation
  })

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

    console.log('Header: Setting up realtime subscription for new messages')

    // Subscribe to new conversation messages
    const channel = supabase
      .channel('header-messages')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'conversation_messages'
        },
        (payload) => {
          console.log('Header: New message received, refetching unread status')
          refetchDirectMessages()
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
        (payload) => {
          console.log('Header: Conversation marked as read, refetching unread status')
          refetchDirectMessages()
        }
      )
      .subscribe()

    return () => {
      console.log('Header: Cleaning up realtime subscription')
      supabase.removeChannel(channel)
    }
  }, [user?.id, refetchDirectMessages])

  // Check for unread context messages (messages table only)
  // Excludes trade_idea which has its own UI in TradeQueuePage
  const { data: hasUnreadContextMessages } = useQuery({
    queryKey: ['unread-context-messages', user?.id],
    queryFn: async () => {
      if (!user?.id) return false

      const { data: contextMessages, error: contextError } = await supabase
        .from('messages')
        .select('id')
        .neq('user_id', user.id)
        .neq('context_type', 'trade_idea') // trade_idea has its own UI
        .eq('is_read', false)
        .limit(1)

      if (contextError) {
        console.error('Error fetching context messages:', contextError)
        return false
      }

      const hasUnread = contextMessages && contextMessages.length > 0
      console.log('Header: Context messages unread:', hasUnread)
      return hasUnread
    },
    enabled: !!user?.id,
    refetchInterval: 30000,
    staleTime: 0
  })

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
      if (appMenuRef.current && !appMenuRef.current.contains(event.target as Node)) {
        setShowAppMenu(false)
      }
    }

    if (showUserMenu || showAppMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu, showAppMenu])

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
          {/* Logo and Search */}
          <div className="flex items-center space-x-6 flex-1">
            {/* App Launcher */}
            <div className="relative" ref={appMenuRef}>
              <button
                onClick={() => setShowAppMenu(!showAppMenu)}
                className="flex items-center space-x-3 p-2 -ml-2 rounded-lg hover:bg-gray-100 transition-colors group"
                title="App launcher"
              >
                <TesseractLogo size={32} />
                <div>
                  <h1 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-primary-600 transition-colors">Tesseract</h1>
                </div>
              </button>

              {/* App Launcher Panel */}
              {showAppMenu && (
                <div className="absolute left-0 top-full mt-2 w-80 bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 py-3 z-50">
                  {/* Future: System status row can be added here */}

                  {/* Core */}
                  <div className="px-4 pb-2">
                    <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Core</span>
                  </div>
                  <div className="grid grid-cols-3 gap-1 px-2 pb-3">
                    {/* Priorities - Primary entry point with subtle emphasis */}
                    <button
                      onClick={() => {
                        setShowAppMenu(false)
                        onSearchResult({ id: 'priorities', title: 'Priorities', type: 'priorities', data: null })
                      }}
                      className="flex flex-col items-center p-3 rounded-lg hover:bg-rose-50 dark:hover:bg-gray-700 transition-colors group/tile ring-1 ring-rose-200 bg-rose-50/30"
                    >
                      <div className="w-11 h-11 rounded-lg flex items-center justify-center mb-1 bg-rose-100">
                        <Target className="h-6 w-6 text-rose-600" />
                      </div>
                      <span className="text-xs font-semibold text-gray-800 dark:text-gray-200 text-center leading-tight">Priorities</span>
                      <span className="text-[10px] text-gray-500 mt-0.5">Start here</span>
                    </button>

                    {/* Other Core tiles */}
                    {[
                      { id: 'trade-queue', title: 'Trade Queue', type: 'trade-queue', icon: ShoppingCart, color: 'text-amber-500', bg: 'bg-amber-50' },
                      { id: 'assets-list', title: 'Assets', type: 'assets-list', icon: TrendingUp, color: 'text-blue-500', bg: 'bg-blue-50' },
                      { id: 'portfolios-list', title: 'Portfolios', type: 'portfolios-list', icon: Briefcase, color: 'text-emerald-500', bg: 'bg-emerald-50' },
                      { id: 'idea-generator', title: 'Ideas', type: 'idea-generator', icon: Lightbulb, color: 'text-purple-500', bg: 'bg-purple-50' },
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
                      { id: 'workflows', title: 'Workflows', type: 'workflows', icon: Workflow, color: 'text-cyan-500', bg: 'bg-cyan-50' },
                      { id: 'projects-list', title: 'Projects', type: 'projects-list', icon: FolderKanban, color: 'text-indigo-500', bg: 'bg-indigo-50' },
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
                    {/* Organization - demoted with reduced emphasis */}
                    <button
                      onClick={() => {
                        setShowAppMenu(false)
                        onSearchResult({ id: 'organization', title: 'Organization', type: 'organization', data: null })
                      }}
                      className="flex flex-col items-center p-3 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors group/tile opacity-75"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-1.5 bg-gray-100">
                        <Building2 className="h-4 w-4 text-gray-400" />
                      </div>
                      <span className="text-xs font-medium text-gray-500 dark:text-gray-400 text-center leading-tight">Organization</span>
                    </button>
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

            {/* Search */}
            <div className="flex-1 max-w-lg">
            <GlobalSearch onSelectResult={onSearchResult} onFocusSearch={onFocusSearch} />
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
            
            {/* Communication Toggle */}
            <button
              onClick={() => {
                onShowMessages?.()
              }}
              className={clsx(
                "p-2 hover:bg-gray-100 rounded-lg transition-colors relative",
                isCommPaneOpen && commPaneView === 'messages'
                  ? "text-primary-600 bg-primary-100"
                  : "text-gray-400 hover:text-gray-600"
              )}
              title="Context Discussions"
            >
              <MessageCircle className="h-5 w-5" />
              {hasUnreadContextMessages && (
                <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-error-500"></span>
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
            <div className="relative bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] overflow-y-auto mx-auto transform transition-all p-8">
              <SettingsPage onClose={() => setShowSettings(false)} />
            </div>
          </div>
        </div>
      )}

    </header>
  )
}