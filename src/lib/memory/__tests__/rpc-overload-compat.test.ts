/**
 * The obligation RPCs must be UNIQUE after the migration bundle.
 *
 * ── The defect this pins ─────────────────────────────────────────────────
 *
 * `CREATE OR REPLACE FUNCTION` with a different argument list OVERLOADS; it
 * does not replace. The bundle adds a 10-argument
 * `raise_memory_obligation` whose extra parameter has a default, alongside
 * the live 9-argument one. A call supplying exactly the original nine named
 * arguments matches BOTH, and Postgres raises
 * `42725 function ... is not unique`.
 *
 * `useTradeReviewObligations.ts` makes exactly that nine-argument call, so
 * the Trade Book obligation sync would have started failing the moment the
 * migration was applied — while the OLD app was still deployed, which is the
 * window the whole rollout order depends on.
 *
 * ── Why this is a static test ────────────────────────────────────────────
 *
 * The migration cannot be applied to production and there is no local
 * Postgres in this worktree, so the thing under test is the MIGRATION TEXT:
 * that it drops each old signature by exact type list before creating the
 * replacement, restores the live defaults, and restores the live grants.
 * A test that asserted against a database we cannot reach would assert
 * nothing at all.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const MIGRATIONS = resolve(__dirname, '../../../../supabase/migrations')
const read = (f: string) => readFileSync(resolve(MIGRATIONS, f), 'utf8')

const WAITING_FOR = read('20261002090000_obligation_waiting_for.sql')
const SUPERSEDE = read('20260930180000_obligation_kinds_and_supersede.sql')

/** The exact live signature of the 9-argument function, from pg_proc. */
const NINE_ARG = 'uuid, text, text, uuid, uuid, timestamptz, text, uuid, text'
const TEN_ARG = `${NINE_ARG}, text`

const squash = (s: string) => s.replace(/\s+/g, ' ')

describe('exactly one callable function remains per name', () => {
  const sql = squash(WAITING_FOR)

  it('drops the 9-argument raise by EXACT typed signature', () => {
    expect(sql).toContain(
      `drop function if exists public.raise_memory_obligation( ${NINE_ARG} )`,
    )
  })

  it('drops the 9-argument supersede by EXACT typed signature', () => {
    expect(sql).toContain(
      `drop function if exists public.supersede_memory_obligation( ${NINE_ARG} )`,
    )
  })

  it('never drops by bare name', () => {
    // `drop function raise_memory_obligation` would itself raise 42725 once
    // an overload exists, and is a loaded gun if one is added later.
    expect(sql).not.toMatch(/drop function (if exists )?public\.\w+\s*;/)
    expect(sql).not.toMatch(/drop function (if exists )?public\.raise_memory_obligation\s*;/)
  })

  it('drops BEFORE it creates, so the end state is one function', () => {
    const dropAt = WAITING_FOR.indexOf('drop function if exists public.raise_memory_obligation')
    const createAt = WAITING_FOR.indexOf('create or replace function public.raise_memory_obligation')
    expect(dropAt).toBeGreaterThan(-1)
    expect(createAt).toBeGreaterThan(-1)
    expect(dropAt).toBeLessThan(createAt)
  })

  it('creates each name exactly once in the final migration', () => {
    const raises = WAITING_FOR.match(/create or replace function public\.raise_memory_obligation/g)
    const supersedes = WAITING_FOR.match(/create or replace function public\.supersede_memory_obligation/g)
    expect(raises).toHaveLength(1)
    expect(supersedes).toHaveLength(1)
  })
})

describe('OLD APP + NEW SCHEMA: a 9-argument named call still resolves', () => {
  /**
   * The compatibility that makes "migrations first, app later" safe.
   *
   * With the 9-argument function dropped, only the 10-argument one remains.
   * A caller naming the original nine parameters leaves `p_waiting_for` to
   * its default — a single unambiguous candidate, so no 42725.
   */
  const sql = squash(WAITING_FOR)

  it('the surviving function has a default on the added parameter', () => {
    expect(sql).toContain('p_waiting_for text default null')
  })

  it('preserves the live defaults on every optional parameter', () => {
    // The live function defaults p_owner_id through p_provenance. An earlier
    // draft dropped them, silently narrowing the contract for any caller
    // that omitted an optional argument.
    for (const d of [
      'p_owner_id uuid default null',
      'p_due_at timestamptz default null',
      'p_source_type text default null',
      'p_source_id uuid default null',
      "p_provenance text default 'ui'",
    ]) {
      expect(sql).toContain(d)
    }
  })

  it('keeps the parameter NAMES the old client sends', () => {
    // PostgREST calls by name. A renamed parameter breaks the old client
    // just as surely as a missing function.
    for (const p of [
      'p_org_id', 'p_kind', 'p_subject_type', 'p_subject_id', 'p_owner_id',
      'p_due_at', 'p_source_type', 'p_source_id', 'p_provenance',
    ]) {
      expect(sql).toContain(p)
    }
  })

  it('keeps the parameter ORDER, so the old names still bind', () => {
    const order = [
      'p_org_id uuid', 'p_kind text', 'p_subject_type text', 'p_subject_id uuid',
      'p_owner_id uuid', 'p_due_at timestamptz', 'p_source_type text',
      'p_source_id uuid', 'p_provenance text', 'p_waiting_for text',
    ]
    const create = sql.slice(sql.indexOf('create or replace function public.raise_memory_obligation'))
    let at = -1
    for (const p of order) {
      const next = create.indexOf(p, at + 1)
      expect(next, `${p} out of order`).toBeGreaterThan(at)
      at = next
    }
  })
})

describe('grants survive the drop', () => {
  const sql = squash(WAITING_FOR)

  it('re-grants raise to the roles the live ACL had', () => {
    // CREATE OR REPLACE keeps an ACL; DROP discards it. Live ACL was
    // authenticated + service_role.
    expect(sql).toContain(
      `grant execute on function public.raise_memory_obligation( ${TEN_ARG} ) to authenticated, service_role`,
    )
  })

  it('re-grants supersede to the same roles', () => {
    expect(sql).toContain(
      `grant execute on function public.supersede_memory_obligation(${TEN_ARG}) to authenticated, service_role`,
    )
  })

  it('never grants either to anon', () => {
    expect(sql).not.toMatch(/grant execute on function public\.(raise|supersede)_memory_obligation[^;]*anon/)
  })

  it('revokes from public before granting', () => {
    const revokeAt = sql.indexOf('revoke all on function public.raise_memory_obligation')
    const grantAt = sql.indexOf('grant execute on function public.raise_memory_obligation')
    expect(revokeAt).toBeGreaterThan(-1)
    expect(revokeAt).toBeLessThan(grantAt)
  })
})

/**
 * `REVOKE ... FROM public` does not take a privilege away from `anon`.
 *
 * The test directly above — "never grants either to anon" — asserts that no
 * GRANT statement names anon, and it passed while production had
 * `anon=X/postgres` on both recreated functions. It could not have failed:
 * the privilege did not arrive through a GRANT in this file. It arrived
 * through Supabase's ALTER DEFAULT PRIVILEGES, which hands anon EXECUTE on
 * every new function in `public`, and DROP had discarded the foundation's
 * explicit `revoke ... from public, anon`.
 *
 * Both functions are SECURITY DEFINER and guard on
 * `is_member_of_org(p_org_id) or auth.uid() is null` — and auth.uid() IS
 * null for an anonymous caller, so the guard passes for any organisation.
 * PostgREST publishes them to the publishable key that ships in the browser
 * bundle. That was an unauthenticated write path into any org's
 * memory_obligations and memory_events.
 *
 * The absence of a grant is therefore not the invariant. The presence of an
 * explicit revoke is.
 */
describe('anon is revoked, not merely ungranted', () => {
  const REVOKE_ANON = squash(read('20261003020000_obligation_rpc_revoke_anon.sql'))

  for (const fn of ['raise_memory_obligation', 'supersede_memory_obligation'] as const) {
    it(`revokes ${fn} from anon by exact signature`, () => {
      expect(REVOKE_ANON).toContain(
        `revoke all on function public.${fn}( ${TEN_ARG} ) from anon`,
      )
    })
  }

  it('states the invariant for clear_memory_obligation too', () => {
    expect(REVOKE_ANON).toContain(
      'revoke all on function public.clear_memory_obligation(uuid, text) from anon',
    )
  })

  it('revokes from anon specifically, not only from public', () => {
    // The whole defect in one assertion: `from public` is not `from anon`.
    const fromAnon = REVOKE_ANON.match(/from anon/g) ?? []
    expect(fromAnon).toHaveLength(3)
  })
})

describe('the bundle no longer leaves a latent overload', () => {
  it('20260930180000 still creates the 9-arg supersede, and the final migration removes it', () => {
    // Recorded rather than silently reconciled: the earlier migration is
    // left intact so the bundle reads as the history it is, and the
    // ambiguity it would create is closed by the later one.
    expect(squash(SUPERSEDE)).toContain('create or replace function public.supersede_memory_obligation(')
    expect(squash(WAITING_FOR)).toContain(
      `drop function if exists public.supersede_memory_obligation( ${NINE_ARG} )`,
    )
  })

  it('clear_memory_obligation is untouched — no overload introduced', () => {
    expect(WAITING_FOR).not.toMatch(/create or replace function public\.clear_memory_obligation/)
    expect(WAITING_FOR).not.toMatch(/drop function[^;]*clear_memory_obligation/)
  })
})

describe('the client call shapes the schema must satisfy', () => {
  const SRC = resolve(__dirname, '../../..')
  const hook = readFileSync(resolve(SRC, 'hooks/useTradeReviewObligations.ts'), 'utf8')
  const writer = readFileSync(resolve(SRC, 'lib/memory/obligation-writer.ts'), 'utf8')

  it('the OLD-shape caller passes exactly the nine original names', () => {
    // This is the call that would have raised 42725. Pinned so a future
    // edit to either side is visible against the other.
    for (const p of [
      'p_org_id', 'p_kind', 'p_subject_type', 'p_subject_id', 'p_owner_id',
      'p_due_at', 'p_source_type', 'p_source_id', 'p_provenance',
    ]) {
      expect(hook).toContain(`${p}:`)
    }
    expect(hook).not.toContain('p_waiting_for')
  })

  it('the NEW-shape caller passes all ten, resolving unambiguously', () => {
    expect(writer).toContain('p_waiting_for:')
    expect(writer).toContain("supabase.rpc('supersede_memory_obligation'")
  })
})
