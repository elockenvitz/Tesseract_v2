/**
 * OrgPortfolioList — Portfolios as a scannable list on a phone.
 *
 * The desktop card shows everything at once, which is right on a wide screen
 * and wrong on a narrow one: at 390px a single portfolio filled the viewport,
 * so comparing two meant scrolling past a description and a member roster to
 * reach the next name. Scanning was impossible, and scanning is what this
 * screen is for.
 *
 * So: a collapsed row per portfolio carrying identity and the two facts worth
 * comparing — its team and how many people are on it — with everything else
 * one tap away in an inline expansion. Detail is still here; it is just no
 * longer in the way of the list.
 *
 * Desktop keeps the cards. This renders only below `sm`.
 */

import { useState } from 'react'
import {
  Archive,
  Ban,
  Briefcase,
  ChevronRight,
  MoreHorizontal,
  UserPlus,
} from 'lucide-react'

/** Only the fields this list reads, so it is not coupled to the page's types. */
export interface PortfolioListItem {
  id: string
  name: string
  description?: string | null
  team_id?: string | null
  status?: string | null
  archived_at?: string | null
  [key: string]: any
}

export interface PortfolioListMember {
  id: string
  role: string
  focus?: string | null
  [key: string]: any
}

/*
  Generic over the caller's own portfolio and member types.

  Declaring the props against the local shapes made the callbacks
  contravariant: the page's `(m: PortfolioTeamMember) => string` is not
  assignable to `(m: PortfolioListMember) => string`, because a looser
  parameter cannot stand in for a stricter one. Taking the caller's types as
  parameters keeps this component ignorant of their fields while every
  handler it is given stays exactly as typed at the call site.
*/
interface OrgPortfolioListProps<
  P extends PortfolioListItem,
  M extends PortfolioListMember,
> {
  portfolios: P[]
  getMembers: (portfolioId: string) => M[]
  getTeamName: (teamId: string | null | undefined) => string | null
  getMemberDisplayName: (member: M) => string
  isOrgAdmin: boolean
  onAddMember: (portfolio: P) => void
  onMemberActions: (portfolio: P, member: M) => void
  onPortfolioActions: (portfolio: P) => void
}

/** `status` is authoritative; `archived_at` is the older signal. */
function statusOf(p: PortfolioListItem): 'active' | 'archived' | 'discarded' {
  const s = p.status || (p.archived_at ? 'archived' : 'active')
  return s === 'archived' || s === 'discarded' ? s : 'active'
}

export function OrgPortfolioList<
  P extends PortfolioListItem,
  M extends PortfolioListMember,
>({
  portfolios,
  getMembers,
  getTeamName,
  getMemberDisplayName,
  isOrgAdmin,
  onAddMember,
  onMemberActions,
  onPortfolioActions,
}: OrgPortfolioListProps<P, M>) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div
      data-slot="portfolio-list"
      className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-700 dark:bg-gray-800"
    >
      {portfolios.map(portfolio => {
        const isOpen = expanded.has(portfolio.id)
        const status = statusOf(portfolio)
        const inactive = status !== 'active'
        const members = getMembers(portfolio.id)
        const teamName = getTeamName(portfolio.team_id)

        // Grouped by role, insertion-ordered — the same grouping the card uses.
        const byRole = new Map<string, M[]>()
        for (const m of members) {
          if (!byRole.has(m.role)) byRole.set(m.role, [])
          byRole.get(m.role)!.push(m)
        }

        return (
          <div key={portfolio.id} className={inactive ? 'opacity-70' : ''}>
            <div className="flex items-center gap-1 pr-1">
              <button
                type="button"
                onClick={() => toggle(portfolio.id)}
                aria-expanded={isOpen}
                className="flex min-h-[56px] min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-left active:bg-gray-50 dark:active:bg-gray-900"
              >
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                    inactive ? 'bg-gray-200 dark:bg-gray-700' : 'bg-green-100'
                  }`}
                >
                  {status === 'discarded'
                    ? <Ban className="h-4 w-4 text-gray-400" />
                    : status === 'archived'
                      ? <Archive className="h-4 w-4 text-gray-400" />
                      : <Briefcase className="h-4 w-4 text-green-600" />}
                </span>

                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5">
                    <span className={`truncate text-sm font-medium ${inactive ? 'text-gray-500 dark:text-gray-400' : 'text-gray-900 dark:text-white'}`}>
                      {portfolio.name}
                    </span>
                    {status === 'discarded' && (
                      <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700">Discarded</span>
                    )}
                    {status === 'archived' && (
                      <span className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Archived</span>
                    )}
                  </span>
                  {/* The two facts worth comparing between portfolios. */}
                  <span className="block truncate text-[11px] text-gray-400">
                    {teamName ? `${teamName} · ` : ''}
                    {members.length} {members.length === 1 ? 'member' : 'members'}
                  </span>
                </span>

                <ChevronRight
                  className={`h-4 w-4 shrink-0 text-gray-300 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
              </button>

              {isOrgAdmin && (
                <button
                  type="button"
                  onClick={() => onPortfolioActions(portfolio)}
                  aria-label={`Actions for ${portfolio.name}`}
                  className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-lg text-gray-400 active:bg-gray-100 dark:active:bg-gray-700"
                >
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              )}
            </div>

            {isOpen && (
              /* Subordinate to the row: indented to the name, hairline above,
                 quieter ground. It reads as the row opening rather than as a
                 second object appearing. */
              <div className="space-y-2.5 border-t border-gray-100 bg-gray-50/50 py-2.5 pl-[54px] pr-3 dark:border-gray-800 dark:bg-gray-900/30">
                {portfolio.description && (
                  <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">
                    {portfolio.description}
                  </p>
                )}

                {members.length > 0 ? (
                  <div className="space-y-2">
                    {[...byRole.entries()].map(([role, roleMembers]) => (
                      <div key={role}>
                        <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                          {role}
                        </div>
                        <div className="mt-0.5 divide-y divide-gray-100 dark:divide-gray-800">
                          {roleMembers.map(m => (
                            <div key={m.id} className="flex items-center gap-2 py-1">
                              <span className="min-w-0 flex-1 truncate text-xs text-gray-700 dark:text-gray-300">
                                {getMemberDisplayName(m)}
                                {m.focus && <span className="text-gray-400"> · {m.focus}</span>}
                              </span>
                              {isOrgAdmin && status !== 'archived' && (
                                <button
                                  type="button"
                                  onClick={() => onMemberActions(portfolio, m)}
                                  aria-label={`Actions for ${getMemberDisplayName(m)}`}
                                  className="no-touch-target tap-pad shrink-0 rounded p-0.5 text-gray-400"
                                >
                                  <MoreHorizontal className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs italic text-gray-400">No team members assigned</p>
                )}

                {isOrgAdmin && !inactive && (
                  <button
                    type="button"
                    onClick={() => onAddMember(portfolio)}
                    className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 text-xs font-medium text-gray-700 active:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
                  >
                    <UserPlus className="h-3.5 w-3.5 text-gray-400" />
                    Add member
                  </button>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
