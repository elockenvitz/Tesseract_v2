/**
 * holdings-sftp-sync runs with the service-role key and WRITES portfolio holdings
 * (snapshots + positions) for every active holdings_integration_configs row's
 * organization. The org is read from those server-trusted config rows, never from
 * the caller. The gateway's verify_jwt admits the public anon key, so the
 * function's own x-automation-secret gate is the only thing between a page visitor
 * and a cross-tenant holdings write.
 *
 * The gate module is pure, so it is exercised directly. The handler is Deno, so
 * its ordering is asserted on the source: nothing privileged (a service_role
 * client, the SFTP/API fetch, a write) may run before the gate returns ok.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_SECRET_HEADER,
  authorizeAutomationRequest,
} from '../../../../supabase/functions/_shared/automation-auth'

const SECRET = 'internal-automation-secret-value'
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'
const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsInN1YiI6InUxIn0.sig'

function headers(values: Record<string, string>) {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

describe('who may run holdings-sftp-sync', () => {
  it('rejects MISSING credentials (no secret header)', () => {
    expect(authorizeAutomationRequest('POST', headers({}), SECRET))
      .toEqual({ ok: false, status: 401, reason: 'secret_header_missing' })
  })

  it('rejects an ordinary authenticated user JWT with no internal secret', () => {
    expect(authorizeAutomationRequest('POST', headers({ authorization: `Bearer ${USER_JWT}` }), SECRET))
      .toEqual({ ok: false, status: 401, reason: 'secret_header_missing' })
  })

  it('rejects the public anon key the same way', () => {
    expect(authorizeAutomationRequest('POST', headers({ authorization: `Bearer ${ANON_JWT}`, apikey: ANON_JWT }), SECRET))
      .toEqual({ ok: false, status: 401, reason: 'secret_header_missing' })
  })

  it('rejects INVALID credentials (wrong secret)', () => {
    expect(authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: 'wrong' }), SECRET))
      .toEqual({ ok: false, status: 401, reason: 'secret_mismatch' })
  })

  it('fails closed when the SERVER secret is not configured', () => {
    expect(authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: 'anything' }), undefined))
      .toEqual({ ok: false, status: 401, reason: 'server_secret_missing' })
  })

  it('rejects a non-POST method (405) even with the right secret', () => {
    expect(authorizeAutomationRequest('GET', headers({ [AUTOMATION_SECRET_HEADER]: SECRET }), SECRET))
      .toEqual({ ok: false, status: 405, reason: 'method_not_allowed' })
  })

  it('admits the AUTHORIZED caller (POST + matching secret)', () => {
    expect(authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: SECRET }), SECRET))
      .toEqual({ ok: true })
  })

  it('NO privileged side effects after denied auth: the gate runs before any service_role client', () => {
    const src = readFileSync(
      resolve(__dirname, '../../../../supabase/functions/holdings-sftp-sync/index.ts'), 'utf8')
    const gateAt = src.indexOf('authorizeAutomationRequest(')
    const clientAt = src.indexOf('createClient(supabaseUrl, serviceRoleKey)')
    expect(gateAt).toBeGreaterThan(-1)
    expect(clientAt).toBeGreaterThan(-1)
    expect(gateAt).toBeLessThan(clientAt)
    expect(src).not.toMatch(/Access-Control-Allow-Origin/)
  })
})
