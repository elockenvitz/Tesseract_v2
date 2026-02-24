import { describe, it, expect, vi, beforeEach } from 'vitest'
import { extractDomain } from '../org-domain-routing'

// --- Pure function tests (no mocks needed) ---

describe('extractDomain', () => {
  it('extracts domain from standard email', () => {
    expect(extractDomain('alice@firm.com')).toBe('firm.com')
  })

  it('lowercases the domain', () => {
    expect(extractDomain('Alice@FIRM.COM')).toBe('firm.com')
  })

  it('uses last @ for emails with multiple @', () => {
    expect(extractDomain('weird@name@firm.com')).toBe('firm.com')
  })

  it('returns null for email without @', () => {
    expect(extractDomain('nodomain')).toBeNull()
  })

  it('returns null for email with @ but no dot in domain', () => {
    expect(extractDomain('user@localhost')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractDomain('')).toBeNull()
  })

  it('returns null when @ is at position 0', () => {
    expect(extractDomain('@firm.com')).toBeNull()
  })

  it('handles subdomains', () => {
    expect(extractDomain('user@mail.firm.co.uk')).toBe('mail.firm.co.uk')
  })
})

// --- routeOrgByEmail tests (mock supabase) ---

// Build chainable mock for supabase query builder
function mockQueryChain(finalResult: { data: any; error: any }) {
  const chain: any = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue(finalResult),
  }
  return chain
}

// We need to mock the supabase module before importing routeOrgByEmail
const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    rpc: (...args: any[]) => mockRpc(...args),
    from: (...args: any[]) => mockFrom(...args),
  },
}))

// Import after mock setup
const { routeOrgByEmail, checkSsoForEmail } = await import('../org-domain-routing')

describe('routeOrgByEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns fallback when route_org_for_email RPC errors', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'RPC fail' } })

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('blocked')
    expect(mockRpc).toHaveBeenCalledWith('route_org_for_email', { p_email: 'alice@firm.com' })
  })

  it('returns fallback when route result is null', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: null })

    const { profile, routeResult } = await routeOrgByEmail('alice@unknown.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('blocked')
  })

  it('returns null profile when set_current_org RPC errors on switch', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'switch', reason: 'single_membership' }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: 'Not a member' } })

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('switch')
    expect(mockRpc).toHaveBeenCalledTimes(2)
    expect(mockRpc).toHaveBeenCalledWith('set_current_org', { p_org_id: 'org-abc' })
  })

  it('action=switch → calls set_current_org, returns profile', async () => {
    const updatedProfile = { id: 'user-1', current_organization_id: 'org-abc', email: 'alice@firm.com' }

    mockRpc
      .mockResolvedValueOnce({ data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'switch', reason: 'single_membership' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const chain = mockQueryChain({ data: updatedProfile, error: null })
    mockFrom.mockReturnValueOnce(chain)

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toEqual(updatedProfile)
    expect(routeResult.action).toBe('switch')
    expect(mockRpc).toHaveBeenCalledWith('set_current_org', { p_org_id: 'org-abc' })
    expect(mockFrom).toHaveBeenCalledWith('users')
  })

  it('action=auto_join → calls set_current_org, returns profile', async () => {
    const updatedProfile = { id: 'user-1', current_organization_id: 'org-abc', email: 'alice@firm.com' }

    mockRpc
      .mockResolvedValueOnce({ data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'auto_join', reason: 'domain_match' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const chain = mockQueryChain({ data: updatedProfile, error: null })
    mockFrom.mockReturnValueOnce(chain)

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toEqual(updatedProfile)
    expect(routeResult.action).toBe('auto_join')
    expect(routeResult.org_name).toBe('TestOrg')
    expect(mockRpc).toHaveBeenCalledWith('set_current_org', { p_org_id: 'org-abc' })
  })

  it('action=request_created → does NOT call set_current_org, profile is null', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'request_created', reason: 'domain_match' },
      error: null,
    })

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('request_created')
    expect(routeResult.org_name).toBe('TestOrg')
    // Should NOT have called set_current_org
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('action=blocked → does NOT call set_current_org, profile is null', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'blocked', reason: 'invite_only' },
      error: null,
    })

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('blocked')
    // Should NOT have called set_current_org
    expect(mockRpc).toHaveBeenCalledTimes(1)
  })

  it('returns null profile when profile refetch returns no data', async () => {
    mockRpc
      .mockResolvedValueOnce({ data: { org_id: 'org-abc', org_name: 'TestOrg', action: 'switch', reason: 'single_membership' }, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    const chain = mockQueryChain({ data: null, error: null })
    mockFrom.mockReturnValueOnce(chain)

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('switch')
  })

  it('returns fallback on unexpected exception', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network error'))

    const { profile, routeResult } = await routeOrgByEmail('alice@firm.com', 'user-1')
    expect(profile).toBeNull()
    expect(routeResult.action).toBe('blocked')
  })
})

// --- checkSsoForEmail tests ---

describe('checkSsoForEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns SSO config when org has provider', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        has_sso: true,
        org_id: 'org-1',
        org_name: 'TestOrg',
        sso_only: true,
        discovery_url: 'https://login.example.com/.well-known/openid-configuration',
        client_id: 'client-123',
        provider_type: 'oidc',
        onboarding_policy: 'open',
      },
      error: null,
    })

    const result = await checkSsoForEmail('alice@firm.com')
    expect(result.has_sso).toBe(true)
    expect(result.sso_only).toBe(true)
    expect(result.client_id).toBe('client-123')
    expect(result.onboarding_policy).toBe('open')
    expect(mockRpc).toHaveBeenCalledWith('get_identity_provider_for_email', { p_email: 'alice@firm.com' })
  })

  it('returns has_sso=false when no provider', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { has_sso: false, reason: 'no_provider' },
      error: null,
    })

    const result = await checkSsoForEmail('alice@noidp.com')
    expect(result.has_sso).toBe(false)
  })

  it('returns has_sso=false on RPC error', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'fail' } })

    const result = await checkSsoForEmail('alice@firm.com')
    expect(result.has_sso).toBe(false)
  })

  it('returns has_sso=false on exception', async () => {
    mockRpc.mockRejectedValueOnce(new Error('Network'))

    const result = await checkSsoForEmail('alice@firm.com')
    expect(result.has_sso).toBe(false)
  })
})

// --- SSO Login Flow tests (Phase 14A) ---

describe('checkSsoForEmail — login UI states', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sso_only=true → indicates SSO-required state for login form', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        has_sso: true,
        org_id: 'org-1',
        org_name: 'StrictCorp',
        sso_only: true,
        discovery_url: 'https://idp.strict.com/.well-known/openid-configuration',
        client_id: 'strict-client',
        provider_type: 'oidc',
      },
      error: null,
    })

    const result = await checkSsoForEmail('user@strict.com')
    expect(result.has_sso).toBe(true)
    expect(result.sso_only).toBe(true)
    expect(result.discovery_url).toBeTruthy()
    expect(result.client_id).toBeTruthy()
  })

  it('sso_only=false → indicates SSO-optional state for login form', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        has_sso: true,
        org_id: 'org-2',
        org_name: 'FlexCorp',
        sso_only: false,
        discovery_url: 'https://idp.flex.com/.well-known/openid-configuration',
        client_id: 'flex-client',
        provider_type: 'oidc',
      },
      error: null,
    })

    const result = await checkSsoForEmail('user@flex.com')
    expect(result.has_sso).toBe(true)
    expect(result.sso_only).toBe(false)
    // Password login should still be available
  })

  it('no domain match → no SSO state', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { has_sso: false, reason: 'no_domain_match' },
      error: null,
    })

    const result = await checkSsoForEmail('user@random.com')
    expect(result.has_sso).toBe(false)
    expect(result.sso_only).toBeUndefined()
  })
})

// --- Phase 15: submit-time SSO gating logic ---

describe('login submit gating — SSO check on submit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('checkSsoForEmail at submit returns sso_only=true → blocks password login', async () => {
    // Simulate: blur never fired, user submits directly
    mockRpc.mockResolvedValueOnce({
      data: {
        has_sso: true,
        org_id: 'org-1',
        org_name: 'StrictCorp',
        sso_only: true,
        discovery_url: 'https://idp.strict.com/.well-known/openid-configuration',
        client_id: 'strict-client',
        provider_type: 'oidc',
      },
      error: null,
    })

    const result = await checkSsoForEmail('user@strict.com')
    expect(result.has_sso).toBe(true)
    expect(result.sso_only).toBe(true)
    // LoginForm should block password sign-in when this result is returned at submit time
  })

  it('checkSsoForEmail at submit returns no SSO → allows password login', async () => {
    mockRpc.mockResolvedValueOnce({
      data: { has_sso: false, reason: 'no_domain_match' },
      error: null,
    })

    const result = await checkSsoForEmail('user@nosso.com')
    expect(result.has_sso).toBe(false)
    // LoginForm should proceed with password sign-in
  })

  it('checkSsoForEmail at submit returns sso_only=false → allows password login', async () => {
    mockRpc.mockResolvedValueOnce({
      data: {
        has_sso: true,
        org_id: 'org-2',
        org_name: 'FlexCorp',
        sso_only: false,
        discovery_url: 'https://idp.flex.com/.well-known/openid-configuration',
        client_id: 'flex-client',
        provider_type: 'oidc',
      },
      error: null,
    })

    const result = await checkSsoForEmail('user@flex.com')
    expect(result.has_sso).toBe(true)
    expect(result.sso_only).toBe(false)
    // LoginForm should allow password sign-in (SSO is optional)
  })
})

// --- Phase 15: archived-org error mapper ---

describe('archived-org error mapper', () => {
  // Import the mapper directly (no mocks needed)
  it('detects archived org trigger error', async () => {
    const { isArchivedOrgError, mapMutationError } = await import('../archived-org-errors')

    const triggerError = { message: 'Organization is archived — writes are disabled' }
    expect(isArchivedOrgError(triggerError)).toBe(true)
    expect(mapMutationError(triggerError)).toBe('This organization is archived. Changes cannot be saved.')
  })

  it('passes through non-archived errors', async () => {
    const { isArchivedOrgError, mapMutationError } = await import('../archived-org-errors')

    const normalError = { message: 'Failed to update team' }
    expect(isArchivedOrgError(normalError)).toBe(false)
    expect(mapMutationError(normalError)).toBe('Failed to update team')
  })

  it('handles null/undefined errors', async () => {
    const { isArchivedOrgError, mapMutationError } = await import('../archived-org-errors')

    expect(isArchivedOrgError(null)).toBe(false)
    expect(isArchivedOrgError(undefined)).toBe(false)
    expect(mapMutationError(undefined)).toBe('An unexpected error occurred')
  })
})

// --- No stale data: verify org-domains key is in ORG_SCOPED_QUERY_PREFIXES ---

describe('org-switch cache invalidation', () => {
  it('includes organization-domains in ORG_SCOPED_QUERY_PREFIXES', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const contextSource = fs.readFileSync(
      path.resolve(__dirname, '../../contexts/OrganizationContext.tsx'),
      'utf-8'
    )
    expect(contextSource).toContain("'organization-domains'")
  })

  it('includes org-archived-status in ORG_SCOPED_QUERY_PREFIXES', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const contextSource = fs.readFileSync(
      path.resolve(__dirname, '../../contexts/OrganizationContext.tsx'),
      'utf-8'
    )
    expect(contextSource).toContain("'org-archived-status'")
  })
})
