/**
 * Source-level regression guards for the Security Release B call-site changes.
 *
 * These assert things about the SOURCE, not about a running database, which is
 * the point: the database policies are the boundary, and these tests stop the
 * application from quietly growing a call site that the boundary would reject —
 * or worse, one that only works because the boundary was loosened again.
 *
 * `messages` lost its UPDATE grant for `authenticated`, and `audit_events` lost
 * its INSERT grant. A `.from('messages').update(...)` reintroduced later would
 * fail at runtime in a fire-and-forget path, which is exactly the kind of
 * failure nobody notices. Failing here instead is the whole idea.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.resolve(__dirname, '..', '..', '..')

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name)
    if (statSync(p).isDirectory()) {
      if (name === 'node_modules' || name === '__tests__') continue
      sourceFiles(p, acc)
    } else if (/\.(ts|tsx)$/.test(name)) {
      acc.push(p)
    }
  }
  return acc
}

const FILES = sourceFiles(SRC).map(p => ({ path: p, text: readFileSync(p, 'utf8') }))
const rel = (p: string) => path.relative(SRC, p).replace(/\\/g, '/')

/**
 * Matches a supabase query builder chain rooted at `.from('<table>')` up to the
 * next `.from(` or the end of the statement, so a `.update(` belonging to a
 * different table cannot be misattributed.
 */
function chainsFor(text: string, table: string): string[] {
  const out: string[] = []
  const re = new RegExp(`\\.from\\(['"\`]${table}['"\`]\\)`, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const rest = text.slice(m.index + m[0].length)
    const next = rest.search(/\.from\(['"`]/)
    out.push(next === -1 ? rest.slice(0, 600) : rest.slice(0, Math.min(next, 600)))
  }
  return out
}

describe('messages: the generic UPDATE path is gone', () => {
  /**
   * Test 5. `authenticated` no longer holds UPDATE on messages. A policy broad
   * enough to let anyone mark a message read was broad enough to rewrite its
   * content, author and context — so acknowledgement and pinning moved to two
   * narrow SECURITY DEFINER RPCs and the whole-row path was removed.
   */
  it('has no .from(\'messages\').update(...) anywhere in src/', () => {
    const offenders = FILES
      .filter(f => chainsFor(f.text, 'messages').some(c => /^\s*\n?\s*\.update\s*\(/.test(c)))
      .map(f => rel(f.path))
    expect(offenders).toEqual([])
  })

  it('acknowledges through mark_messages_read, not an UPDATE', () => {
    const f = FILES.find(x => rel(x.path) === 'components/communication/MessagingSection.tsx')!
    expect(f.text).toContain("rpc('mark_messages_read'")
    expect(f.text).toContain('p_message_ids')
  })

  /** All three pin call sites moved together; one left behind would 403 silently. */
  it('pins through set_message_pinned at every pin call site', () => {
    const pinSites = [
      'components/communication/MessagingSection.tsx',
      'components/thoughts/TradeIdeaDiscussion.tsx',
      'components/trading/TradeIdeaDetailModal.tsx',
    ]
    for (const site of pinSites) {
      const f = FILES.find(x => rel(x.path) === site)
      expect(f, `${site} should exist`).toBeDefined()
      expect(f!.text, `${site} should call set_message_pinned`).toContain("rpc('set_message_pinned'")
    }
  })

  /**
   * The RPCs return a row count / boolean rather than throwing when a message is
   * outside the caller's organization. A caller that ignores that would show a
   * pin that was never saved.
   */
  it('checks the set_message_pinned result instead of assuming success', () => {
    for (const site of [
      'components/communication/MessagingSection.tsx',
      'components/thoughts/TradeIdeaDiscussion.tsx',
      'components/trading/TradeIdeaDetailModal.tsx',
    ]) {
      const f = FILES.find(x => rel(x.path) === site)!
      expect(f.text, `${site} should handle a false result`).toMatch(/data === false/)
    }
  })
})

describe('audit_events: writes go through the trusted RPC', () => {
  /** Test 6. `authenticated` no longer holds INSERT on audit_events. */
  it('has no .from(\'audit_events\').insert(...) anywhere in src/', () => {
    const offenders = FILES
      .filter(f => chainsFor(f.text, 'audit_events').some(c => /^\s*\n?\s*\.insert\s*\(/.test(c)))
      .map(f => rel(f.path))
    expect(offenders).toEqual([])
  })

  /** Test 7. */
  it('uses record_audit_event as the application write path', () => {
    const svc = FILES.find(x => rel(x.path) === 'lib/audit/audit-service.ts')!
    expect(svc.text).toContain("rpc('record_audit_event'")

    const layouts = FILES.find(x => rel(x.path) === 'hooks/useUserAssetPagePreferences.ts')!
    expect(layouts.text).toContain("rpc('record_audit_event'")
  })

  /**
   * Test 8. The forgeable fields — actor_id, org_id, actor_email, actor_name and
   * checksum — must not appear in any RPC payload. The server derives all five.
   * Under `WITH CHECK (true)` these were whatever the caller typed, which is how
   * an append-only ledger became one anyone could append to on anyone's behalf.
   */
  it('sends no attribution parameters the caller could forge', () => {
    const forgeable = ['actor_id', 'org_id', 'actor_email', 'actor_name', 'checksum']
    for (const site of ['lib/audit/audit-service.ts', 'hooks/useUserAssetPagePreferences.ts']) {
      const f = FILES.find(x => rel(x.path) === site)!
      const calls = f.text.split("rpc('record_audit_event'").slice(1)
      expect(calls.length, `${site} should call the RPC`).toBeGreaterThan(0)
      for (const call of calls) {
        const args = call.slice(0, call.indexOf('})') + 1)
        for (const field of forgeable) {
          // p_-prefixed params are the RPC's own; a bare `actor_id:` key is not.
          expect(args, `${site} must not pass ${field}`).not.toMatch(
            new RegExp(`(^|[^_a-z])${field}\\s*:`)
          )
        }
      }
    }
  })

  /**
   * The browser-side checksum was an unkeyed SHA-256 over caller-chosen fields,
   * from a recipe in this repository — it proved nothing and is deleted. This
   * fails if anyone reintroduces it.
   */
  it('no longer ships a client-side audit checksum', () => {
    // Matches code, not prose: index.ts carries a comment explaining why the
    // module was deleted, and that comment naturally names the functions.
    const offenders = FILES
      .filter(f =>
        // an import/export bound to the deleted module
        /(?:from|require\()\s*['"][^'"]*audit\/checksum['"]/.test(f.text) ||
        /(?:from|require\()\s*['"]\.\.?\/checksum['"]/.test(f.text) ||
        // or an actual call to one of its functions
        /\b(?:calculateChecksum|calculateChecksumSync|verifyChecksum)\s*\(/.test(f.text))
      .map(f => rel(f.path))
    expect(offenders).toEqual([])
  })
})
