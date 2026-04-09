/**
 * OpsSidebar — Left navigation for the Tesseract Operations Portal.
 */

import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Building2, Database, LifeBuoy, Settings } from 'lucide-react'
import { clsx } from 'clsx'

const NAV_ITEMS = [
  { to: '/ops', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/ops/clients', label: 'Clients', icon: Building2 },
  { to: '/ops/holdings', label: 'Holdings', icon: Database },
  { to: '/ops/support', label: 'Support', icon: LifeBuoy },
  { to: '/ops/settings', label: 'Settings', icon: Settings },
]

export function OpsSidebar() {
  return (
    <nav className="w-48 flex-shrink-0 bg-gray-900 border-r border-gray-800 py-4 px-2 space-y-0.5">
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={(item as any).end}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
              isActive
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
            )}
          >
            <Icon className="w-4 h-4 flex-shrink-0" />
            {item.label}
          </NavLink>
        )
      })}
    </nav>
  )
}
