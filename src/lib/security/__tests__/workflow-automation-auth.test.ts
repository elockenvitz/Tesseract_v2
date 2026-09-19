/**
 * workflow-automation runs with the service-role key across every
 * organization. The gateway's verify_jwt admits the public anon key (a validly
 * signed project JWT that ships in the browser bundle), so the function's own
 * gate is the only thing between a page visitor and cross-tenant writes.
 *
 * The gate module is pure, so it is exercised directly. The handler is Deno,
 * so its ordering is asserted on the source: nothing privileged may be
 * constructed before the gate has returned.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  AUTOMATION_SECRET_HEADER,
  authorizeAutomationRequest,
  timingSafeEqual,
} from '../../../../supabase/functions/workflow-automation/authorize'

const SECRET = 'internal-automation-secret-value'
// Shapes only — the gate never decodes a JWT, which is the point.
const ANON_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.sig'
const USER_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYXV0aGVudGljYXRlZCIsInN1YiI6InUxIn0.sig'

function headers(values: Record<string, string>) {
  const lower = new Map(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]))
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null }
}

describe('who may run workflow automation', () => {
  it('rejects a caller holding only the public anon key', () => {
    const result = authorizeAutomationRequest(
      'POST',
      headers({ authorization: `Bearer ${ANON_JWT}`, apikey: ANON_JWT }),
      SECRET,
    )
    expect(result).toEqual({ ok: false, status: 401, reason: 'secret_header_missing' })
  })

  it('rejects a signed-in user JWT that does not carry the internal secret', () => {
    const result = authorizeAutomationRequest(
      'POST',
      headers({ authorization: `Bearer ${USER_JWT}` }),
      SECRET,
    )
    expect(result).toEqual({ ok: false, status: 401, reason: 'secret_header_missing' })
  })

  it('does not treat any JWT as authority: the Authorization header changes nothing', () => {
    const withJwt = authorizeAutomationRequest(
      'POST',
      headers({ authorization: `Bearer ${USER_JWT}`, [AUTOMATION_SECRET_HEADER]: 'nope' }),
      SECRET,
    )
    const withoutJwt = authorizeAutomationRequest(
      'POST',
      headers({ [AUTOMATION_SECRET_HEADER]: 'nope' }),
      SECRET,
    )
    expect(withJwt).toEqual(withoutJwt)
  })

  it('rejects a wrong secret, including a prefix of the right one', () => {
    for (const presented of ['wrong', SECRET.slice(0, -1), `${SECRET}x`, SECRET.toUpperCase()]) {
      expect(
        authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: presented }), SECRET),
      ).toEqual({ ok: false, status: 401, reason: 'secret_mismatch' })
    }
  })

  it('fails closed when the server secret is not configured', () => {
    for (const configured of [undefined, null, '']) {
      expect(
        authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: SECRET }), configured),
      ).toEqual({ ok: false, status: 401, reason: 'server_secret_missing' })
    }
  })

  it('does not let an empty header match an empty server secret', () => {
    const result = authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: '' }), '')
    expect(result.ok).toBe(false)
  })

  it('accepts POST only', () => {
    for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE', 'PATCH']) {
      expect(
        authorizeAutomationRequest(method, headers({ [AUTOMATION_SECRET_HEADER]: SECRET }), SECRET),
      ).toEqual({ ok: false, status: 405, reason: 'method_not_allowed' })
    }
  })

  it('admits the scheduler: POST with the matching secret', () => {
    expect(
      authorizeAutomationRequest('POST', headers({ [AUTOMATION_SECRET_HEADER]: SECRET }), SECRET),
    ).toEqual({ ok: true })
  })

  it('compares secrets by content and length', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true)
    expect(timingSafeEqual('abc', 'abd')).toBe(false)
    expect(timingSafeEqual('abc', 'ab')).toBe(false)
    expect(timingSafeEqual('', 'a')).toBe(false)
  })
})

describe('the handler authorizes before it becomes privileged', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'supabase/functions/workflow-automation/index.ts'),
    'utf8',
  )
  // Comments may mention these names; only code counts.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

  it('reads the server secret from WORKFLOW_AUTOMATION_SECRET', () => {
    expect(code).toContain('Deno.env.get("WORKFLOW_AUTOMATION_SECRET")')
  })

  it('returns on a failed gate before the service-role key or client exists', () => {
    const gate = code.indexOf('authorizeAutomationRequest(')
    const reject = code.indexOf('if (!auth.ok)')
    const serviceKey = code.indexOf('SUPABASE_SERVICE_ROLE_KEY')
    const client = code.indexOf('createClient(')
    expect(gate).toBeGreaterThan(-1)
    expect(reject).toBeGreaterThan(gate)
    expect(serviceKey).toBeGreaterThan(reject)
    expect(client).toBeGreaterThan(reject)
    expect(code.slice(reject, serviceKey)).toMatch(/return new Response\(/)
  })

  it('creates the service-role client in exactly one place', () => {
    expect(code.match(/createClient\(/g)).toHaveLength(1)
  })

  it('answers no browser: no CORS headers and no preflight handling', () => {
    expect(code).not.toMatch(/Access-Control-Allow/i)
    expect(code).not.toMatch(/corsHeaders/)
    expect(code).not.toMatch(/"OPTIONS"/)
  })

  it('takes no identifiers from the request', () => {
    expect(code).not.toMatch(/req\.(json|text|formData|arrayBuffer|blob|body|url)\b/)
    expect(code).not.toMatch(/searchParams/)
  })
})
