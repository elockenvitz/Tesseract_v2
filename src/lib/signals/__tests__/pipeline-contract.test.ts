/**
 * Standing guards on the ordering pipeline, asserted against the source.
 *
 * Each of these is a rule that no single unit test can hold, because the way
 * to break it is to ADD a call somewhere else. They read the tree instead.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const SRC = resolve(__dirname, '../../..')

/** Every production `.ts`/`.tsx` under src, excluding tests and fixtures. */
function productionFiles(dir = SRC, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      if (name === '__tests__' || name === 'node_modules') continue
      productionFiles(full, out)
    } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.fixture\.ts$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

const read = (f: string) => readFileSync(f, 'utf8')

/**
 * Source with comments removed.
 *
 * These modules explain at length what they replaced, and naming the dead
 * mechanism in a header is exactly what keeps it dead. A guard that could not
 * tell a call from a paragraph about a call would force the history to be
 * deleted to stay green, which is the wrong trade.
 */
const code = (f: string) =>
  read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

/**
 * The whole-tree scan, done once at module scope.
 *
 * Reading a thousand files is collection work, not test work: inside an `it` it
 * competes with the 5s per-test budget and times out whenever this suite runs
 * alongside the rest of `guard:unit`. The cheap `includes` pass runs first so
 * the comment-stripping regex only touches the handful of files that could
 * possibly match.
 */
const INTERLEAVE = /from\s+['"][^'"]*feed-interleave['"]|\binterleaveByKind\s*\(/
const INTERLEAVE_IMPORTERS = productionFiles()
  .filter(f => !f.endsWith(join('lib', 'mobile', 'feed-interleave.ts')))
  .filter(f => read(f).includes('interleave'))
  .filter(f => INTERLEAVE.test(code(f)))
  .map(f => f.slice(SRC.length + 1))

const ATTENTION = code(join(SRC, 'hooks/useAttention.ts'))

describe('no random ordering reaches a reader', () => {
  /**
   * `interleaveByKind` ordered the feed by seeded weighted sampling, so the
   * feed genuinely re-dealt on every refresh. `rankFeed` -> `composeFeed`
   * replaced it and it has no production caller left. The module survives with
   * its tests; what must not come back is a call to it.
   */
  it('nothing in production imports the interleaver', () => {
    expect(INTERLEAVE_IMPORTERS).toEqual([])
  })

  it('the ranker and the composer draw no random numbers', () => {
    for (const rel of ['lib/signals/feed-priority.ts', 'lib/signals/feed-compose.ts']) {
      expect(code(join(SRC, rel))).not.toMatch(/Math\.random|Date\.now\(\)/)
    }
  })
})

describe('a personal Defer does not mutate shared object state', () => {
  /**
   * Deferring a trade decision used to write `trade_queue_items.revisit_at` —
   * a column on the shared org-wide row, read by the Command Center as an alert
   * date and by the simulation page as time pressure. One reader's "later"
   * changed what the whole desk saw. Defer now routes through
   * `snooze_attention`, which is user x attention id.
   */
  it('writes no revisit_at from the attention surface', () => {
    expect(ATTENTION).not.toMatch(/revisit_at\s*:/)
  })

  it('defers through the user-scoped disposition store', () => {
    const defer = ATTENTION.slice(ATTENTION.indexOf('deferTradeIdeaMutation'))
    expect(defer).toMatch(/snooze_attention/)
  })

  /**
   * The other two write paths on this surface are genuinely shared, and stay
   * shared: approving and rejecting a trade idea are business state, invoked
   * under their own names, and every reader should see them.
   */
  it('leaves the explicitly shared actions shared', () => {
    expect(ATTENTION).toMatch(/status:\s*'approved'/)
    expect(ATTENTION).toMatch(/status:\s*'rejected'/)
  })
})

describe('one definition of "this reader has already dealt with it"', () => {
  it('the attention filter reads the shared predicate', () => {
    expect(ATTENTION).toMatch(/isPersonallySuppressed/)
  })

  it('so does the dashboard band store', () => {
    expect(read(join(SRC, 'lib/attention-feed/snooze.ts'))).toMatch(/isPersonallySuppressed/)
  })

  /**
   * Suppression removes an object; it never moves one. Keeping the predicate
   * out of the ranking modules is what lets surfaces whose ORDER legitimately
   * differs still agree about what the reader has answered.
   */
  it('and the ranker does not, because suppression is not ordering', () => {
    expect(code(join(SRC, 'lib/signals/feed-compose.ts'))).not.toMatch(/isPersonallySuppressed/)
  })
})
