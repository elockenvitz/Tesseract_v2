import { useEffect, useState } from 'react'

/**
 * Breakpoints intentionally match Tailwind's stock scale so that a
 * `useIsMobile()` branch in JS and a `md:` prefix in CSS always agree.
 * Divergence between the two is the classic source of "the layout is
 * mobile but the component thinks it's desktop" bugs.
 */
export const MOBILE_QUERY = '(max-width: 767px)' // below Tailwind `md`
export const TABLET_QUERY = '(min-width: 768px) and (max-width: 1023px)'
export const COARSE_POINTER_QUERY = '(pointer: coarse)'

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return

    const list = window.matchMedia(query)
    // Re-sync on mount: the query may have changed between the lazy
    // initializer and this effect (e.g. an orientation change during hydration).
    setMatches(list.matches)

    const onChange = (event: MediaQueryListEvent) => setMatches(event.matches)
    list.addEventListener('change', onChange)
    return () => list.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** True on phone-width viewports. The single switch for mobile layout branching. */
export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_QUERY)
}

export function useIsTablet(): boolean {
  return useMediaQuery(TABLET_QUERY)
}

/**
 * Touch-primary input, independent of width. Use this for hit-target and
 * hover-affordance decisions — a hover-only toolbar is wrong on a touch
 * laptop even when the viewport is wide.
 */
export function useIsTouch(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY)
}

/**
 * Visible viewport height, excluding the on-screen keyboard where the browser
 * reports it. `window.innerHeight` does not shrink when the keyboard opens on
 * iOS, so anything anchored to the bottom ends up underneath it.
 */
export function useViewportHeight(): number {
  const [height, setHeight] = useState(() =>
    typeof window === 'undefined' ? 0 : window.visualViewport?.height ?? window.innerHeight
  )

  useEffect(() => {
    if (typeof window === 'undefined') return

    const update = () => setHeight(window.visualViewport?.height ?? window.innerHeight)
    update()

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', update)
    viewport?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    window.addEventListener('orientationchange', update)
    return () => {
      viewport?.removeEventListener('resize', update)
      viewport?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
      window.removeEventListener('orientationchange', update)
    }
  }, [])

  return height
}

/**
 * Height of the space the on-screen keyboard is covering, in px (0 when closed).
 * Bottom-anchored surfaces should offset by this so inputs stay visible.
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return

    const viewport = window.visualViewport
    const update = () => {
      setInset(Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop))
    }
    update()

    viewport.addEventListener('resize', update)
    viewport.addEventListener('scroll', update)
    return () => {
      viewport.removeEventListener('resize', update)
      viewport.removeEventListener('scroll', update)
    }
  }, [])

  return inset
}
