import React from 'react'
import { Users, User, ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface UserOption {
  id: string
  email: string
  first_name: string | null
  last_name: string | null
}

interface ListUserFilterProps {
  users: UserOption[]
  currentUserId: string
  selectedUserId: string | 'all'
  onChange: (userId: string | 'all') => void
  className?: string
}

export function ListUserFilter({
  users,
  currentUserId,
  selectedUserId,
  onChange,
  className
}: ListUserFilterProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const dropdownRef = React.useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  const getUserDisplayName = (user: UserOption, isCurrent: boolean = false) => {
    const name = user.first_name && user.last_name
      ? `${user.first_name} ${user.last_name}`
      : user.email?.split('@')[0] || 'Unknown'

    if (isCurrent) {
      return `My Items`
    }
    return `${name}'s Items`
  }

  const getSelectedLabel = () => {
    if (selectedUserId === 'all') {
      return 'All Users'
    }
    if (selectedUserId === currentUserId) {
      return 'My Items'
    }
    const user = users.find(u => u.id === selectedUserId)
    if (user) {
      return getUserDisplayName(user)
    }
    return 'All Users'
  }

  // Sort users: current user first, then alphabetically by name
  const sortedUsers = React.useMemo(() => {
    return [...users].sort((a, b) => {
      if (a.id === currentUserId) return -1
      if (b.id === currentUserId) return 1
      const nameA = a.first_name && a.last_name ? `${a.first_name} ${a.last_name}` : a.email
      const nameB = b.first_name && b.last_name ? `${b.first_name} ${b.last_name}` : b.email
      return nameA.localeCompare(nameB)
    })
  }, [users, currentUserId])

  return (
    <div ref={dropdownRef} className={clsx('relative', className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          'flex items-center gap-2 px-3 py-2 text-sm rounded-lg border transition-colors',
          isOpen
            ? 'border-blue-300 bg-blue-50 text-blue-700'
            : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
        )}
      >
        <Users className="h-4 w-4" />
        <span className="font-medium">{getSelectedLabel()}</span>
        <ChevronDown className={clsx(
          'h-4 w-4 transition-transform',
          isOpen && 'rotate-180'
        )} />
      </button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 w-56 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-20">
          {/* All Users option */}
          <button
            onClick={() => {
              onChange('all')
              setIsOpen(false)
            }}
            className={clsx(
              'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50',
              selectedUserId === 'all' && 'bg-blue-50 text-blue-700'
            )}
          >
            <Users className="h-4 w-4" />
            <span>All Users</span>
          </button>

          <div className="border-t border-gray-100 my-1" />

          {/* Individual user options */}
          {sortedUsers.map((user) => {
            const isCurrent = user.id === currentUserId
            const isSelected = selectedUserId === user.id

            return (
              <button
                key={user.id}
                onClick={() => {
                  onChange(user.id)
                  setIsOpen(false)
                }}
                className={clsx(
                  'w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-50',
                  isSelected && 'bg-blue-50 text-blue-700'
                )}
              >
                <User className="h-4 w-4" />
                <span className="truncate flex-1">{getUserDisplayName(user, isCurrent)}</span>
                {isCurrent && (
                  <span className="text-xs text-gray-400">(You)</span>
                )}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default ListUserFilter
