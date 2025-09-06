import { useState } from 'react'
import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bell, MessageCircle, Mail, User, Users, Settings, LogOut, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'
import { useAuth } from '../../hooks/useAuth'
import { useNotifications } from '../../hooks/useNotifications'
import { supabase } from '../../lib/supabase'
import { GlobalSearch } from '../search/GlobalSearch'
import { ProfilePage } from '../../pages/ProfilePage'
import { SettingsPage } from '../../pages/SettingsPage'

interface HeaderProps {
  onSearchResult: (result: any) => void
  onFocusSearch?: () => void
  onShowMessages?: () => void
  hasUnreadMessages?: boolean
  onShowDirectMessages?: () => void
  onShowNotifications?: () => void
  isCoverageManagerOpen?: boolean
  onCloseCoverageManager?: () => void
  onShowCoverageManager?: () => void
  isCommPaneOpen?: boolean
  onToggleCommPane?: () => void
  commPaneView?: string
  onShowAI?: () => void
}

export function Header({ 
  onSearchResult, 
  onFocusSearch, 
  onShowMessages, 
  hasUnreadMessages, 
  onShowDirectMessages, 
  onShowNotifications, 
  isCoverageManagerOpen,
  onCloseCoverageManager,
  onShowCoverageManager,
  isCommPaneOpen,
  onToggleCommPane,
  commPaneView = 'messages',
  onShowAI = () => {}
}: HeaderProps) {
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [showProfile, setShowProfile] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const { user, signOut } = useAuth()
  const { hasUnreadNotifications, unreadCount } = useNotifications()

  // Fetch user details including names
  const { data: userDetails } = useQuery({
    queryKey: ['user-details', user?.id],
    queryFn: async () => {
      if (!user?.id) return null
      
      const { data, error } = await supabase
        .from('users')
        .select('first_name, last_name, email')
        .eq('id', user.id)
        .single()
      
      if (error) throw error
      return data
    },
    enabled: !!user?.id
  })

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setShowUserMenu(false)
      }
    }

    if (showUserMenu) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [showUserMenu])

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
    if (!email) return 'U'
    
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
    if (!email) return 'User'
    
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
    <header className="bg-white border-b border-gray-200 sticky top-0 z-40">
      <div className="px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* Logo and Search */}
          <div className="flex items-center space-x-6 flex-1">
            <div className="flex items-center space-x-3">
            <img 
              src="/Tesseract Icon.png" 
              alt="Tesseract" 
              className="w-8 h-8"
            />
            <div>
              <h1 className="text-lg font-bold text-gray-900">Tesseract</h1>
            </div>
            </div>

            {/* Search */}
            <div className="flex-1 max-w-lg">
            <GlobalSearch onSelectResult={onSearchResult} onFocusSearch={onFocusSearch} />
            </div>
          </div>

          {/* Right side actions */}
          <div className="flex items-center space-x-4">
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
              title="Toggle communication panel"
            >
              <MessageCircle className="h-5 w-5" />
              {hasUnreadMessages && (
                <span className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-primary-500"></span>
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
                <span className="absolute top-1 right-1 flex items-center justify-center h-4 w-4 text-xs font-bold text-white bg-error-500 rounded-full">
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
                  <p className="text-xs text-gray-500">Investor</p>
                </div>
                <ChevronDown className="h-4 w-4 text-gray-400" />
              </button>

              {/* User Menu Dropdown */}
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-50">
                  {/* User Info */}
                  <div className="px-4 py-3 border-b border-gray-200">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 rounded-full bg-primary-600 flex items-center justify-center">
                        <span className="text-white font-semibold">
                          {getUserInitials()}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">
                          {getDisplayName()}
                        </p>
                        <p className="text-xs text-gray-500 truncate">
                          {userDetails?.email || user?.email}
                        </p>
                      </div>
                    </div>
                  {/* Menu Items */}
                  <div className="py-2">
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        setShowProfile(true)
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                    >
                      <User className="h-4 w-4 mr-3 text-gray-400" />
                      View Profile
                    </button>
                    
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        onShowCoverageManager?.()
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                    >
                      <Users className="h-4 w-4 mr-3 text-gray-400" />
                      Coverage Management
                    </button>
                    
                    <button
                      onClick={() => {
                        setShowUserMenu(false)
                        setShowSettings(true)
                      }}
                      className="w-full px-4 py-2 text-left text-sm text-gray-700 hover:bg-gray-100 flex items-center transition-colors"
                    >
                      <Settings className="h-4 w-4 mr-3 text-gray-400" />
                      Account Settings
                    </button>
                  </div>
                  </div>
                  {/* Sign Out */}
                  <div className="border-t border-gray-200 py-2">
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
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all p-8">
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
            <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full mx-auto transform transition-all p-8">
              <SettingsPage onClose={() => setShowSettings(false)} />
            </div>
          </div>
        </div>
      )}
    </header>
  )
}