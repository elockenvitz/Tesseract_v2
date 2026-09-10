import React from 'react'
import { clsx } from 'clsx'

interface CardProps {
  children: React.ReactNode
  className?: string
  padding?: 'none' | 'sm' | 'md' | 'lg'
  onClick?: () => void
  id?: string
}

export function Card({ children, className, padding = 'md', onClick, id }: CardProps) {
  /**
   * `md` and `lg` step down on a phone and are unchanged from 640px up.
   *
   * 247 of the 302 `<Card>` usages in the app take the `md` default, and it
   * was a flat 24px at every width — so on a 320px screen a card spent 48px,
   * 15% of the viewport, on padding before any content existed, on top of
   * whatever the page and the shell already applied. Exactly one usage in the
   * codebase overrode it responsively, which is the tell that this belongs in
   * the primitive rather than at the call sites.
   *
   * `sm:` is Tailwind's 640px breakpoint and phones are below it, so every
   * desktop rendering is byte-identical. Stepping down rather than removing:
   * 16px is still a card, 0 would be a list row.
   *
   * `lg` is stepped for consistency, not need — it currently has no callers.
   */
  const paddingClasses = {
    none: '',
    sm: 'p-4',
    md: 'p-4 sm:p-6',
    lg: 'p-5 sm:p-8',
  }

  return (
    <div
      id={id}
      className={clsx(
        'bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow duration-200',
        paddingClasses[padding],
        className
      )}
      onClick={onClick}
    >
      {children}
    </div>
  )
}