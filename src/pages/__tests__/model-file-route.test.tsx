/**
 * Where a model-file search result lands.
 *
 * ── The defect this pins ──────────────────────────────────────────────────
 *
 * `useObjectSearch` returns model files as `type: 'model-file'`, so a search
 * for a model's filename produces a result a user can tap. On a phone that
 * result used to open FilesPage.
 *
 * FilesPage has no data source — there is no `files` table in any migration
 * and nothing in the app queries one — so it can only ever render its
 * unavailable state. Every model a phone found in search therefore
 * dead-ended: you searched for a file, tapped the file, and were told the
 * repository is not connected. The route also passed `initialFileId`, a prop
 * FilesPage does not declare, so even the identity was dropped on the floor.
 *
 * A model file belongs to an asset — `model_files.asset_id` is NOT NULL —
 * and the owning asset is where one actually renders, through
 * ModelFilesViewer in the estimates section. So both viewports go to the
 * asset, each through the shell the `asset` type already uses.
 *
 * ── What is deliberately NOT asserted ─────────────────────────────────────
 *
 * Anything about what the asset workspace shows. This is about which surface
 * the branch selects, and specifically that it is never Files.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ data: [], error: null }) }), auth: {} },
}))
vi.mock('../../components/layout/Layout', () => ({
  Layout: ({ children }: any) => <div>{children}</div>,
}))

// The three surfaces this branch can choose between, as sentinels.
vi.mock('../FilesPage', () => ({
  FilesPage: () => <div data-testid="files-page" />,
}))
vi.mock('../../components/mobile/asset/MobileAssetPage', () => ({
  MobileAssetPage: ({ asset }: any) => (
    <div data-testid="mobile-asset" data-asset-id={asset?.id} data-symbol={asset?.symbol} />
  ),
}))
vi.mock('../../components/tabs/AssetTab', () => ({
  AssetTab: ({ asset, initialSection }: any) => (
    <div
      data-testid="asset-tab"
      data-asset-id={asset?.id}
      data-symbol={asset?.symbol}
      data-section={initialSection}
    />
  ),
}))

vi.mock('../../components/mobile/MobileDashboard', () => ({
  MobileDashboard: () => <div data-testid="mobile-ideas-feed" />,
}))
vi.mock('../../components/dashboard/DashboardShell', () => ({
  DashboardShell: () => <div data-testid="desktop-dashboard" />,
  LENS_FOR_TAB: {},
}))
vi.mock('../../components/mobile/DesktopOnlyCard', () => ({
  DesktopOnlyCard: () => <div data-testid="desktop-only-card" />,
}))
vi.mock('../../components/trading/AddTradeIdeaModal', () => ({ AddTradeIdeaModal: () => null }))
vi.mock('../../components/pilot/PilotGraduationModal', () => ({ PilotGraduationModal: () => null }))
vi.mock('../../components/pilot/PilotTeaserModal', () => ({ PilotTeaserModal: () => null }))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isLoading: false, error: null, refetch: () => {} }),
  useQueryClient: () => ({ invalidateQueries: () => {}, setQueryData: () => {}, getQueryData: () => undefined }),
}))
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }))
vi.mock('../../contexts/OrganizationContext', () => ({
  useOrganization: () => ({ currentOrgId: 'o1' }),
  useOrganizationOptional: () => ({ currentOrgId: 'o1' }),
}))
vi.mock('../../hooks/useSessionTracking', () => ({ useSessionTracking: () => {} }))
vi.mock('../../hooks/useDashboardScope', () => ({ useDashboardScope: () => ['all', () => {}] }))
vi.mock('../../hooks/useCockpitFeed', () => ({ useCockpitFeed: () => ({ items: [], isLoading: false }) }))
vi.mock('../../components/common/Toast', () => ({ useToast: () => ({ showToast: () => {} }) }))
vi.mock('../../hooks/usePilotMode', () => ({
  usePilotMode: () => ({
    isPilot: false, isLoading: false, isInitialResolve: false, accessIsReady: true,
    effectiveIsPilot: false, hasCommittedTradeInOrg: false, hasGraduated: false,
    access: {}, accessFor: () => 'full', canSee: () => true, canUse: () => true,
  }),
}))

import { DashboardPage } from '../DashboardPage'
import { ownsMobileViewport } from '../../lib/mobile/mobile-surfaces'

const PHONE = 390
const LAPTOP = 1440

const ASSET_ID = '11111111-1111-4111-8111-111111111111'

/** The shape `useObjectSearch` actually produces for a model file. */
const MODEL_FILE_TAB_DATA = {
  id: '22222222-2222-4222-8222-222222222222',
  filename: 'NVDA_model_v4.xlsx',
  asset_id: ASSET_ID,
  assetId: ASSET_ID,
  symbol: 'NVDA',
  company_name: 'NVIDIA Corporation',
}

function setViewportWidth(width: number) {
  window.matchMedia = ((query: string) => {
    const max = /max-width:\s*(\d+)px/.exec(query)
    const min = /min-width:\s*(\d+)px/.exec(query)
    const matches =
      (!max || width <= Number(max[1])) &&
      (!min || width >= Number(min[1])) &&
      !/pointer:\s*coarse/.test(query)
    return {
      matches, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {},
      addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
    }
  }) as any
}

/** Seed session state so DashboardPage opens with a model-file tab active. */
function seedModelFileTab(data: any = MODEL_FILE_TAB_DATA) {
  const tab = { id: 'tab-model-file', title: data.filename ?? 'Model', type: 'model-file', data }
  sessionStorage.setItem(
    'tesseract_tabs_u1_o1',
    JSON.stringify({
      tabs: [tab],
      activeTabId: tab.id,
      tabStates: {},
      version: 3,
      userId: 'u1',
      orgId: 'o1',
    })
  )
}

describe('a model-file result never lands on Files', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('opens the owning asset on a phone, not the Files empty state', () => {
    setViewportWidth(PHONE)
    seedModelFileTab()
    render(<DashboardPage />)

    // The defect, stated directly.
    expect(screen.queryByTestId('files-page')).not.toBeInTheDocument()

    const asset = screen.getByTestId('mobile-asset')
    expect(asset).toHaveAttribute('data-asset-id', ASSET_ID)
  })

  it('opens the asset workspace on the models section on a laptop', () => {
    setViewportWidth(LAPTOP)
    seedModelFileTab()
    render(<DashboardPage />)

    expect(screen.queryByTestId('files-page')).not.toBeInTheDocument()

    const tab = screen.getByTestId('asset-tab')
    expect(tab).toHaveAttribute('data-asset-id', ASSET_ID)
    expect(tab).toHaveAttribute('data-section', 'models')
  })

  it('carries the symbol through, which the old route read from a key that never existed', () => {
    // It read `data.assets.symbol`; useObjectSearch spreads the row flat, so
    // the asset workspace was handed an undefined symbol on every model.
    setViewportWidth(LAPTOP)
    seedModelFileTab()
    render(<DashboardPage />)

    expect(screen.getByTestId('asset-tab')).toHaveAttribute('data-symbol', 'NVDA')
  })

  it('still does not fall back to Files when a restored tab has no asset id', () => {
    // `model_files.asset_id` is NOT NULL so this should be unreachable, but
    // the point of the change is that Files is never the answer.
    setViewportWidth(PHONE)
    seedModelFileTab({ id: 'f1', filename: 'orphan.xlsx' })
    render(<DashboardPage />)

    expect(screen.queryByTestId('files-page')).not.toBeInTheDocument()
    expect(screen.queryByTestId('mobile-asset')).not.toBeInTheDocument()
  })
})

describe('model-file viewport ownership', () => {
  it('agrees with the asset surface it now renders, not with Files', () => {
    // MobileAssetPage relies on the shell for horizontal padding. Leaving the
    // flag set — it was set when this rendered FilesPage — would have pushed
    // the asset page's text to the bezel.
    expect(ownsMobileViewport('model-file')).toBe(ownsMobileViewport('asset'))
    expect(ownsMobileViewport('model-file')).toBe(false)
  })
})
