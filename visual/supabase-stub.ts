/**
 * Supabase, replaced by fixtures, for the visual harness only.
 *
 * Aliased in vite.visual.config.ts. The real client throws at module load
 * without environment variables, and a screenshot harness has none — the same
 * constraint the gallery lives under, solved the same way but in a separate
 * entry so `guard:gallery` keeps proving the gallery itself never reaches
 * Supabase.
 */
const HOLDINGS = [
  { asset_id: 'a1', assets: { id: 'a1', symbol: 'NVDA', company_name: 'NVIDIA Corporation', sector: 'Technology' } },
  { asset_id: 'a2', assets: { id: 'a2', symbol: 'MSFT', company_name: 'Microsoft Corporation', sector: 'Technology' } },
  { asset_id: 'a3', assets: { id: 'a3', symbol: 'ASML', company_name: 'ASML Holding N.V.', sector: 'Technology' } },
]
const SECTOR = [
  { id: 'a4', symbol: 'AVGO', company_name: 'Broadcom Inc.', sector: 'Technology' },
  { id: 'a5', symbol: 'TSM',  company_name: 'Taiwan Semiconductor Manufacturing', sector: 'Technology' },
]
const TEAM = [
  { asset_id: 'a6', assets: { id: 'a6', symbol: 'AMD', company_name: 'Advanced Micro Devices', sector: 'Technology' } },
]

function table(name: string) {
  const api: any = {
    select: () => api, eq: () => api, in: () => api, or: () => api, order: () => api,
    maybeSingle: () => Promise.resolve({ data: { sector_focus: ['Technology'] }, error: null }),
    limit: () => Promise.resolve({
      data: name === 'portfolio_holdings' ? HOLDINGS
          : name === 'coverage' ? TEAM
          : name === 'assets' ? SECTOR
          : [],
      error: null,
    }),
  }
  return api
}

export const supabase = {
  from: (name: string) => table(name),
  auth: { getUser: async () => ({ data: { user: { id: 'u1' } }, error: null }) },
}
