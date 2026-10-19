import type { ReactNode } from 'react'

export type ResearchWorkspaceMode = 'view' | 'customize'

export interface ResearchCanvasProps {
  /** When false, render children unchanged (no wrapper, no behavior change). */
  enabled: boolean
  /** Current workspace mode. S0 renders both modes identically. */
  mode: ResearchWorkspaceMode
  children: ReactNode
}

/**
 * S0 scaffold for the Research Workspace canvas.
 *
 * When `enabled` is false this is a pure pass-through: children render with no
 * wrapper and no behavior change, so the Research page is identical to today
 * for everyone without the flag.
 *
 * When enabled it frames the same children — the resolved, structured
 * Investment Case layout — in a layout-transparent container tagged with the
 * current workspace mode. `display: contents` means the wrapper generates no
 * box, so the sections lay out exactly as they do today; S0 therefore changes
 * nothing visually even with the flag on. The drag/resize editor, widget tiles,
 * and real grid container arrive in later slices (S1/S2). The structured
 * Investment Case is always the default content — this never becomes an empty
 * widget dashboard.
 */
export function ResearchCanvas({ enabled, mode, children }: ResearchCanvasProps) {
  if (!enabled) return <>{children}</>
  return (
    <div data-research-canvas="" data-mode={mode} style={{ display: 'contents' }}>
      {children}
    </div>
  )
}
