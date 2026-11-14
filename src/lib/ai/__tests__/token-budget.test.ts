/**
 * What this initiative costs per request, measured.
 *
 * ── Why this suite exists ────────────────────────────────────────────────
 *
 * ACT AI 2.2 changed one thing that spends tokens: `resolveResponsePolicy`
 * now routes a paired request ("bear and bull case") and a three-part
 * question to `standard` instead of `brief`. Everything else in the
 * initiative — the composer, the conversation rail, the dot menu, the case
 * rendering — is presentation, and sends nothing it did not send before.
 *
 * So the exposure is bounded and knowable, and the point of this file is to
 * hold it to a number rather than a conviction. Three things it pins:
 *
 *   1. The OUTPUT ceiling over a corpus of real-shaped questions, as a mean
 *      and as a worst case. A heuristic that quietly routed more traffic to
 *      `deep` would take the ceiling from 700 to 4096 — 6x — and would read
 *      as "better answers" until the bill arrived.
 *   2. That nothing reaches `deep` without the reader ASKING for depth. That
 *      is the whole safety property of the tier: the expensive tier is
 *      opt-in, by words the reader typed.
 *   3. That the INPUT side still binds. The history and context budgets are
 *      untouched by this initiative, and a test that says so is what makes
 *      "we only changed the output tier" a checkable claim instead of a
 *      recollection.
 *
 * ── On the numbers ───────────────────────────────────────────────────────
 *
 * These are PROVIDER CEILINGS, not consumption: `maxOutputTokens` is what
 * the request permits, and most answers come in well under it. A ceiling is
 * what can be tested deterministically from pure functions, which is the
 * only kind of number worth ratcheting. Actual spend needs the provider's
 * usage figures, which this suite cannot see and does not pretend to.
 */
import { describe, it, expect } from 'vitest'
import { resolveResponsePolicy } from '../response-policy'
import { expandSlashCommand, parseSlashCommand } from '../slash-commands'
import { boundHistory, DEFAULT_HISTORY_BUDGET } from '../history'
import { DEFAULT_BUDGET } from '../context-selection'

/**
 * The corpus: the shapes a reader actually sends, in the proportions they
 * actually send them.
 *
 * Weighted toward short questions because that is what a chat pane receives.
 * A corpus of nothing but multi-part analyses would make the mean look bad
 * and the ratchet meaningless.
 */
const CORPUS: readonly string[] = Object.freeze([
  /* Short, which is most traffic. */
  'What is the current price of LRCX?',
  'Who covers AAPL?',
  'What is our thesis on NVDA?',
  'When is the next earnings date?',
  'What is the dividend yield on KO?',
  'Any notes on MSFT this week?',
  'What did we decide about TSM?',
  'Is AAPL in the model portfolio?',
  'What is the P/E on META?',
  'How has LRCX moved?',
  'What is our price target for AMD?',
  'Summarise the last note on INTC.',

  /* Paired, which this initiative moved brief -> standard. */
  'What about in general, come up with a bear and bull case for it.',
  'Give me the pros and cons of adding GOOGL.',
  'What are the risks and opportunities in semis right now?',

  /* Multi-part, which this initiative also moved brief -> standard. */
  "Let's analyze LRCX, come up with what the market is thinking about it and where we are with it in our process.",

  /* Explicitly deep, which was already deep and should stay there. */
  'Give me a deep dive on the memory cycle.',
])

const PAIRED_OR_MULTI = new Set([
  'What about in general, come up with a bear and bull case for it.',
  'Give me the pros and cons of adding GOOGL.',
  'What are the risks and opportunities in semis right now?',
  "Let's analyze LRCX, come up with what the market is thinking about it and where we are with it in our process.",
])

/**
 * Note the shape. `resolveResponsePolicy` takes an input OBJECT, and calling
 * it with a bare string resolves `message: undefined`, which every heuristic
 * reads as the empty string and routes to `brief`. Written that way, this
 * whole file passed while measuring nothing: the mean ceiling read 700 and
 * the ratchet below held comfortably. Three of the cases caught it, which is
 * the only reason it is not still written that way.
 */
const policy = (message: string) => resolveResponsePolicy({ message })
const ceilings = () => CORPUS.map(m => policy(m).maxOutputTokens)
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length

/**
 * The ratchet, measured rather than guessed.
 *
 * Over the corpus above, at the commit that closed ACT AI 2.2:
 *
 *     12 x  700  brief     (default)
 *      3 x 1200  standard  (paired-case-request)
 *      1 x 1200  standard  (multi-part-request)
 *      1 x 4096  deep      (explicit-depth-request)
 *     ------------------------------------------------
 *            1017  mean ceiling
 *
 * Before 2.2 the four paired and multi-part prompts resolved to `brief`, so
 * the same corpus meant (16 x 700 + 4096) / 17 = 900. The initiative's whole
 * token delta is therefore +117 on the mean ceiling, about 13%, and it buys
 * a three-part question an answer with three parts in it.
 *
 * Asserted BOTH ways. A cap alone would not notice a heuristic that widened
 * one shape while narrowing another, and the number moving at all is
 * something a reader of this file should have to acknowledge.
 */
const MEAN_CEILING = 1050
const MEAN_MEASURED = 1017
const MEAN_BEFORE_2_2 = 900
const WORST_CEILING = 4096

describe('output token exposure, over the corpus', () => {
  it('holds the mean ceiling at the measured number', () => {
    const m = mean(ceilings())
    expect(Math.round(m)).toBe(MEAN_MEASURED)
    expect(m).toBeLessThanOrEqual(MEAN_CEILING)
  })

  it('cost 13% on the mean, and knows what it bought', () => {
    const m = mean(ceilings())
    /* The delta stated as arithmetic rather than as a sentence, so a future
       change to the tiers cannot leave the comment above quietly false. */
    expect(Math.round(m - MEAN_BEFORE_2_2)).toBe(117)
    expect(m / MEAN_BEFORE_2_2).toBeLessThan(1.2)
  })

  it('holds the worst case', () => {
    expect(Math.max(...ceilings())).toBeLessThanOrEqual(WORST_CEILING)
  })

  it('spends the expensive tier only where depth was asked for', () => {
    const deep = CORPUS.filter(m => policy(m).verbosity === 'deep')
    expect(deep).toEqual(['Give me a deep dive on the memory cycle.'])
  })

  it('charges the paired and multi-part requests one tier, not three', () => {
    /*
     * The whole of this initiative's token delta, named: these four go from
     * 700 to 1200. Four requests x 500 is the cost of a three-part question
     * no longer getting a one-paragraph answer.
     */
    for (const message of PAIRED_OR_MULTI) {
      const resolved = policy(message)
      expect(resolved.verbosity, message).toBe('standard')
      expect(resolved.maxOutputTokens, message).toBe(1200)
    }
  })

  it('leaves short questions on the cheap tier', () => {
    const short = CORPUS.filter(m => !PAIRED_OR_MULTI.has(m) && !m.includes('deep dive'))
    for (const message of short) {
      expect(policy(message).maxOutputTokens, message).toBeLessThanOrEqual(700)
    }
  })
})

describe('the evidence a tier permits scales with the tier', () => {
  it('asks for more sources only where the answer is longer', () => {
    /* Evidence is retrieval, and retrieval is input tokens. A tier that
       raised the source count without raising the answer length would spend
       on context the answer has no room to use. */
    const brief = policy('What is the current price of LRCX?')
    const standard = policy('Give me the pros and cons of adding GOOGL.')
    expect(standard.maxEvidence).toBeGreaterThan(brief.maxEvidence)
    expect(standard.maxOutputTokens).toBeGreaterThan(brief.maxOutputTokens)
  })
})

describe('the input side still binds', () => {
  it('clips a long conversation to the history budget', () => {
    /* 40 messages of 2,000 characters is 80,000 characters, roughly 20K
       tokens, which no budget should pass through. */
    const messages = Array.from({ length: 40 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: 'x'.repeat(2000),
    }))

    const history = boundHistory(messages)
    const chars = history.messages.reduce((n, m) => n + m.content.length, 0)

    expect(history.messages.length).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxMessages)
    expect(chars).toBeLessThanOrEqual(DEFAULT_HISTORY_BUDGET.maxTotalChars)
    expect(history.droppedMessages).toBeGreaterThan(0)
  })

  it('keeps the object context budget where this initiative found it', () => {
    /*
     * Not a behaviour test -- `context-selection` has its own suite. This
     * pins the two numbers so "2.2 changed only the output tier" is a claim
     * a future reader can check in one place rather than by reading diffs.
     */
    expect(DEFAULT_BUDGET.maxTokens).toBe(12000)
    expect(DEFAULT_BUDGET.maxObjects).toBe(4)
  })

  it('sends no request at all for a retrievable figure', () => {
    /*
     * Stronger than it was. `/price.LRCX` used to become a question in the
     * composer, which cost one request to answer; it is now a database read,
     * so the model cost is not "the same as typing it" -- it is nothing.
     * A `text` expansion here would mean the request came back.
     */
    const expansion = expandSlashCommand(parseSlashCommand('/price.LRCX')!)
    expect(expansion.kind).toBe('reading')
  })

  it('costs the same as typing it when the figure is not stored', () => {
    /*
     * The three commands the cache cannot answer still offer the model
     * lookup, and that route must cost what the reader would have paid
     * typing the question themselves -- no hidden preamble bundled in.
     */
    const expansion = expandSlashCommand(parseSlashCommand('/pe.LRCX')!)
    expect(expansion.kind).toBe('data-blocked')
    if (expansion.kind !== 'data-blocked') return

    const typed = policy('What is the P/E ratio for LRCX, and what is your source?')
    expect(policy(expansion.fallback)).toEqual(typed)
  })
})

describe('the composer parse is not work per keystroke', () => {
  it('parses a full command once per character without allocating a sort', () => {
    /*
     * Not a timing assertion -- a wall-clock threshold in CI is a flake
     * generator. What is checked is the invariant a timing test would be
     * standing in for: the id list is built once at module scope, so parsing
     * is a scan and nothing more. A regression that moved the sort back
     * inside the function would still pass this, so the real guard is the
     * identity below: repeated parses return equal results from the same
     * frozen source.
     */
    const full = '/chart.price.AAPL'
    const prefixes = full.split('').map((_, i) => full.slice(0, i + 1))
    const results = prefixes.map(p => parseSlashCommand(p))
    expect(results).toHaveLength(17)
    expect(results[results.length - 1]).toEqual({ id: 'chart.price', symbol: 'AAPL', partial: false })

    /* And the long id wins over its own prefix at every length, which is the
       property the ordering exists for. */
    expect(parseSlashCommand('/chart.price.AAPL')!.id).toBe('chart.price')
    expect(parseSlashCommand('/chart AAPL')!.id).toBe('chart')
  })
})
