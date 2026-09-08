/**
 * Opening another app hides Quick Ideas. It does not throw the draft away.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * On a phone the communication pane is a full-height sheet. Open Quick Ideas,
 * reach past it to the menu button in the header, pick another surface — and
 * the new surface opened BEHIND the sheet, which stayed exactly where it was.
 * Nothing looked like it had happened, and the way out was to hunt for the
 * sheet's own close control.
 *
 * ── Why hiding preserves the draft, and unmounting would not ──────────────
 *
 * `CommunicationPane` is rendered unconditionally by `Layout` and merely
 * translated off-screen when closed, so the capture form inside it keeps its
 * React state: which of the four types is open, and everything typed into it.
 * That is why the fix is "close the pane", not "stop rendering it" — and why
 * this file asserts the mount, not just the toggle. A future change that made
 * the pane conditional would pass a naive close test and silently destroy
 * every in-progress capture.
 *
 * No draft is written to the backend. This is page-lifetime UI state, which is
 * what an unsubmitted object should be.
 */

import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, fireEvent, cleanup } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const layout = readFileSync(resolve(__dirname, '../Layout.tsx'), 'utf8')

vi.mock('../../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrg: { id: 'o1', name: 'Acme' }, userOrgs: [], switchOrg: () => {} }),
}))

import { MobileNavDrawer } from '../../mobile/MobileNavDrawer'
import { CANONICAL_HOME_TAB } from '../../../lib/tabStateManager'

afterEach(cleanup)

const homeTab = { ...CANONICAL_HOME_TAB, isActive: true } as any

/**
 * The drawer as Layout wires it: navigation closes the pane first, then opens
 * the surface. Reproduced so the ORDER can be observed.
 */
function drawerWiredLikeLayout(isCommPaneOpen: boolean) {
  const events: string[] = []
  const toggleCommPane = () => events.push('close-pane')
  const onSearchResult = (r: any) => events.push(`open:${r.type}`)
  const onTabChange = (id: string) => events.push(`activate:${id}`)

  render(
    <MobileNavDrawer
      open
      onClose={() => {}}
      onSearchResult={result => {
        if (isCommPaneOpen) toggleCommPane()
        onSearchResult(result)
      }}
      onOpenSearch={() => {}}
      tabs={[homeTab, { id: 'asset-1', title: 'AMZN', type: 'asset' } as any]}
      activeTabId={CANONICAL_HOME_TAB.id}
      onTabChange={id => {
        if (isCommPaneOpen) toggleCommPane()
        onTabChange(id)
      }}
      onTabClose={() => {}}
    />,
  )
  return events
}

const tap = (text: string) => {
  const el = [...document.body.querySelectorAll('button')]
    .find(b => b.textContent?.trim().startsWith(text))
  if (!el) throw new Error(`no control named ${text}`)
  fireEvent.click(el)
}

describe('the pane gets out of the way when you go somewhere', () => {
  it('closes before opening the surface, so the new app is not behind it', () => {
    const events = drawerWiredLikeLayout(true)

    tap('Assets')

    expect(events).toEqual(['close-pane', 'open:assets-list'])
  })

  it('closes when activating an open workspace too', () => {
    const events = drawerWiredLikeLayout(true)

    tap('AMZN')

    expect(events).toEqual(['close-pane', 'activate:asset-1'])
  })

  it('closes when returning to Ideas', () => {
    const events = drawerWiredLikeLayout(true)

    tap('Ideas')

    expect(events).toEqual(['close-pane', `activate:${CANONICAL_HOME_TAB.id}`])
  })

  it('does nothing extra when the pane was already shut', () => {
    const events = drawerWiredLikeLayout(false)

    tap('Assets')

    expect(events).toEqual(['open:assets-list'])
  })
})

describe('hiding is a hide, so the draft survives', () => {
  it('renders the pane unconditionally, whatever its open state', () => {
    // `{isCommPaneOpen && <CommunicationPane` would pass every test above and
    // destroy an in-progress capture on the way past.
    const at = layout.indexOf('<CommunicationPane')
    const before = layout.slice(Math.max(0, at - 200), at)

    expect(at).toBeGreaterThan(0)
    expect(before).not.toMatch(/isCommPaneOpen\s*&&\s*\(?\s*$/)
    expect(layout).toContain('isOpen={isCommPaneOpen}')
  })

  it('hides by transform rather than by dropping the subtree', () => {
    const pane = readFileSync(
      resolve(__dirname, '../../communication/CommunicationPane.tsx'), 'utf8',
    )

    // Off-screen, still mounted: the four capture forms keep their state.
    expect(pane).toContain("isOpen ? 'translate-y-0' : 'translate-y-full'")
  })

  it('keeps the open capture type in the pane, not in the drawer', () => {
    const thoughts = readFileSync(
      resolve(__dirname, '../../communication/ThoughtsSection.tsx'), 'utf8',
    )

    // `captureMode` is component state inside the pane. Held there, closing
    // the pane cannot reset it; held in the drawer or in Layout, every
    // navigation would.
    expect(thoughts).toContain("const [captureMode, setCaptureMode] = useState<CaptureMode>('collapsed')")
  })

  it('writes no unsubmitted object to the backend', () => {
    const thoughts = readFileSync(
      resolve(__dirname, '../../communication/ThoughtsSection.tsx'), 'utf8',
    )

    // An unsubmitted capture is UI state for the life of the page. Anything
    // that persisted it would be creating a record the user did not ask for.
    const draftWrites = thoughts.match(/from\('(quick_thoughts|trade_queue_items)'\)\s*\.\s*(insert|upsert)/g) ?? []
    expect(draftWrites).toEqual([])
  })
})

describe('the wiring is Layout own, not a drawer behaviour', () => {
  it('closes the pane from Layout, where the pane state lives', () => {
    const flat = layout.replace(/\s+/g, ' ')

    // The close happens FIRST in both handlers, so the surface never opens
    // behind a sheet that is still up.
    for (const call of ['onSearchResult?.(result)', 'onTabChange(tabId)']) {
      const at = flat.indexOf(call)
      expect(at).toBeGreaterThan(0)
      expect(flat.slice(at - 90, at)).toContain('if (isCommPaneOpen) toggleCommPane()')
    }
  })

  it('leaves desktop alone, because the drawer is phone-only', () => {
    expect(layout.replace(/\s+/g, ' ')).toContain('{isMobile && ( <MobileNavDrawer')
  })
})
