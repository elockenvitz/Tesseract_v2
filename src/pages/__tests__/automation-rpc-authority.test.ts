/**
 * The browser may not name its own authority when running automation rules.
 *
 * Two RPCs took the caller's identity and the trigger source as arguments and
 * believed them:
 *
 *   execute_single_automation_rule(p_rule_id, p_user_id, p_trigger_source)
 *     gated on `p_user_id IS NOT NULL AND p_trigger_source = 'manual'`. Both
 *     halves are chosen by the caller, so sending 'scheduler' skipped the
 *     permission check entirely.
 *
 *   evaluate_pending_rules()
 *     had no caller check at all and EXECUTE for `authenticated`. Measured
 *     against production on 2026-11-06, a user in one organization processed
 *     another organization's rule. Any logged-in user was the scheduler for
 *     all 26 organizations.
 *
 * Both are now service_role only. The two buttons go through wrappers that
 * derive the actor from auth.uid() and fix the trigger source server-side:
 * run_workflow_rule(uuid) and run_due_workflow_rules().
 *
 * This is pinned as a source guard rather than a render test on purpose.
 * WorkflowsPage is a 617 KB component behind a dozen providers; mounting it to
 * observe one argument would test the mocks. What actually matters is that no
 * code path asks the database for the forbidden functions, and that the two
 * mutations carry no forgeable argument. Both are properties of the source.
 *
 * The scan is comment-stripped so that prose explaining the fix, including the
 * comments this change added, can neither satisfy nor break the guard.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'

const SRC = path.join(process.cwd(), 'src')
const WORKFLOWS_PAGE = path.join(SRC, 'pages', 'WorkflowsPage.tsx')

/** The two functions C2 revokes from `authenticated`. */
const FORBIDDEN = ['execute_single_automation_rule', 'evaluate_pending_rules'] as const

/** The wrappers that derive authority server-side. */
const AUTHORIZED = {
  runRuleMutation: 'run_workflow_rule',
  runSchedulerTickMutation: 'run_due_workflow_rules',
} as const

/** The arguments that were the bypass. Neither may cross the network again. */
const FORGEABLE_ARGS = ['p_user_id', 'p_trigger_source'] as const

function codeOf(abs: string): string {
  return readFileSync(abs, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1')
}

function sourceFiles(dir = SRC, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    if (statSync(full).isDirectory()) {
      if (entry === '__tests__' || entry === 'test') continue
      sourceFiles(full, acc)
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full)
    }
  }
  return acc
}

/**
 * The comment-stripped source of every application file, read once.
 *
 * Scanned lazily and memoised on purpose. Two other guards in this repo
 * (`benchmark-read-paths`, `storage-access-invariants`) walk the same ~2800
 * files, and each full walk costs about a second. An earlier draft of this
 * file called the walk once per function name, four times in all, which
 * pushed this suite and both of those over vitest's 5s default when the
 * project runs them in parallel. One walk serves every assertion here.
 */
let corpus: Array<{ rel: string; code: string }> | null = null

function sources(): Array<{ rel: string; code: string }> {
  if (corpus === null) {
    corpus = sourceFiles().map(abs => ({
      rel: path.relative(SRC, abs).split(path.sep).join('/'),
      code: codeOf(abs),
    }))
  }
  return corpus
}

/**
 * Every file whose code asks the database for `fn`, as a path relative to src.
 *
 * Matches the function name inside an rpc() call rather than anywhere in the
 * file, so a variable or a string that merely shares the name is not an
 * offender, while every spelling of the call that reaches PostgREST is.
 */
function rpcCallersOf(fn: string): string[] {
  const call = new RegExp(String.raw`\.rpc\(\s*['"\`]${fn}['"\`]`)
  return sources()
    .filter(f => call.test(f.code))
    .map(f => f.rel)
    .sort()
}

/**
 * The body of one `const <name> = useMutation({ ... })`, brace-balanced.
 *
 * Returns null when the declaration is absent, which the tests treat as a
 * failure rather than a pass: a guard that silently stops finding its subject
 * is not a guard.
 */
function mutationBody(code: string, name: string): string | null {
  const anchor = `const ${name} = useMutation({`
  const start = code.indexOf(anchor)
  if (start === -1) return null

  let depth = 0
  for (let i = start + anchor.length - 1; i < code.length; i++) {
    if (code[i] === '{') depth++
    else if (code[i] === '}') {
      depth--
      if (depth === 0) return code.slice(start, i + 1)
    }
  }
  return null
}

describe('who may run a workflow automation rule', () => {
  it('no code anywhere asks the database for the two revoked functions', () => {
    const offenders = FORBIDDEN.flatMap(fn =>
      rpcCallersOf(fn).map(file => `${file} calls ${fn}`)
    )
    expect(offenders).toEqual([])
  })

  it('the authorized wrappers are the ones actually called', () => {
    for (const fn of Object.values(AUTHORIZED)) {
      expect(rpcCallersOf(fn), `nothing calls ${fn}`).toContain('pages/WorkflowsPage.tsx')
    }
  })

  it.each(Object.entries(AUTHORIZED))(
    '%s calls %s and no other automation RPC',
    (mutation, authorized) => {
      const body = mutationBody(codeOf(WORKFLOWS_PAGE), mutation)
      expect(body, `${mutation} was not found in WorkflowsPage.tsx`).not.toBeNull()

      expect(body).toContain(authorized)
      for (const fn of FORBIDDEN) {
        expect(body, `${mutation} must not call ${fn}`).not.toContain(fn)
      }
    }
  )

  it.each(Object.keys(AUTHORIZED))(
    '%s sends no forgeable identity or trigger source',
    mutation => {
      const body = mutationBody(codeOf(WORKFLOWS_PAGE), mutation)
      expect(body, `${mutation} was not found in WorkflowsPage.tsx`).not.toBeNull()

      for (const arg of FORGEABLE_ARGS) {
        expect(body, `${mutation} must not send ${arg}`).not.toContain(arg)
      }
    }
  )
})
