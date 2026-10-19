/**
 * useResearchWorkspaceEnabled (S0) — the Research Workspace feature flag.
 * Default OFF; a blocked storage never throws.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useResearchWorkspaceEnabled } from '../useResearchWorkspaceEnabled'

describe('useResearchWorkspaceEnabled', () => {
  beforeEach(() => { try { window.localStorage.clear() } catch { /* ignore */ } })
  afterEach(() => { vi.restoreAllMocks(); try { window.localStorage.clear() } catch { /* ignore */ } })

  it('defaults to false with no opt-in', () => {
    const { result } = renderHook(() => useResearchWorkspaceEnabled())
    expect(result.current).toBe(false)
  })

  it('is true when the per-viewer opt-in is set', () => {
    window.localStorage.setItem('tsx:research-workspace', '1')
    const { result } = renderHook(() => useResearchWorkspaceEnabled())
    expect(result.current).toBe(true)
  })

  it('is false for any other stored value', () => {
    window.localStorage.setItem('tsx:research-workspace', 'yes')
    const { result } = renderHook(() => useResearchWorkspaceEnabled())
    expect(result.current).toBe(false)
  })

  it('returns false (never throws) when storage access throws', () => {
    vi.spyOn(window.localStorage.__proto__, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useResearchWorkspaceEnabled())
    expect(result.current).toBe(false)
  })
})
