/**
 * OpsSidebar — Left navigation for the Tesseract Operations Portal.
 */

import { NavLink } from 'react-router-dom'
import { LayoutDashboard, Building2, Database, LifeBuoy, Settings, BarChart3, Sparkles } from 'lucide-react'
import { clsx } from 'clsx'

const NAV_ITEMS = [
  { to: '/ops', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/ops/clients', label: 'Clients', icon: Building2 },
  { to: '/ops/holdings', label: 'Holdings', icon: Database },
  { to: '/ops/metrics', label: 'Metrics', icon: BarChart3 },
  { to: '/ops/ai-usage', label: 'AI Usage', icon: Sparkles },
  { to: '/ops/support', label: 'Support', icon: LifeBuoy },
  { to: '/ops/settings', label: 'Settings', icon: Settings },
]

export function OpsSidebar() {
  return (
    // Phone: a horizontal strip under the header. Desktop: the fixed 12rem
    // column, which on a 390px screen left the page 198px to render in.
    <nav
      aria-label="Operations"
      className="flex-shrink-0 bg-gray-900 flex gap-1 overflow-x-auto no-scrollbar px-2 py-1.5 border-b border-gray-800 md:block md:w-48 md:overflow-visible md:py-4 md:px-2 md:space-y-0.5 md:border-b-0 md:border-r"
    >
      {NAV_ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={(item as any).end}
            className={({ isActive }) => clsx(
              'flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors shrink-0 whitespace-nowrap',
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
