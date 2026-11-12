/**
 * How an answer is written, as a contract both sides can be held to.
 *
 * ── Why this is a module and not just prompt text ────────────────────────
 *
 * The edge function tells the model how to present an answer. The client
 * decides what that presentation actually looks like: `preprocessTickers`
 * decides which ticker spelling becomes a pressable pill, `figures` decides
 * which number gets a direction colour and which column right-aligns, and
 * `AiProse` decides what a blockquote looks like.
 *
 * Those two halves can disagree silently, and when they do the failure is
 * invisible rather than loud. A prompt that asked for `AAPL` instead of
 * `$AAPL` would produce answers that read fine and have no working ticker
 * links in them. A prompt that asked the model to colour its own numbers
 * would produce markup the renderer strips. Nobody would notice either from
 * reading an answer.
 *
 * So the rules live here, the prompt mirrors them, a drift test holds the
 * mirror, and a second set of tests asserts that for each rule the CLIENT
 * does the thing the rule promises the model. That is the part worth testing:
 * not that the prompt contains a sentence, but that following the sentence
 * works.
 *
 * ── What the rules are trying to achieve ─────────────────────────────────
 *
 * One thing, mostly: a reader must be able to tell a record's own words from
 * the assistant's reading of them from a gap where it looked and found
 * nothing. Those three are different kinds of claim and carry different
 * weight, and prose flattens them by default. Everything else here is
 * legibility.
 *
 * ── What is deliberately absent ──────────────────────────────────────────
 *
 * A template. There is no required section list, no mandatory heading set and
 * no form to fill in. A fixed skeleton applied to every question produces an
 * answer whose shape carries no information, and on a one-line question it is
 * worse than no structure at all. These are the available forms and when each
 * earns its place.
 */

/**
 * The ticker spelling the client turns into a pressable pill.
 *
 * `preprocessTickers` matches a leading `$` plus one to five capitals, with an
 * optional `.X` class suffix. The prompt has to ask for exactly this: a model
 * writing a bare `AAPL` produces prose that reads correctly and navigates
 * nowhere, which is a dead end the reader cannot see.
 */
export const TICKER_FORM = '$AAPL'

/**
 * How a figure is written so the client can classify it without guessing.
 *
 * The sign is the load-bearing part. `+4.2%` is a change and `4.2%` is a
 * level, and the renderer colours only the first, because colouring a level
 * asserts a direction nobody stated. For a portfolio weight, a gross margin
 * or a multiple that is simply false.
 */
export const FIGURE_RULES: readonly string[] = Object.freeze([
  'Write a change with its sign: +4.2%, -180bps. Write a level without one: 4.2%, 18.5x.',
  'Keep the unit you were given. Do not convert, round further or rescale a figure from a record.',
  'Never write a number that is not in a record or derivable from one in a stated step.',
])

/**
 * The three kinds of claim, and how each is marked.
 *
 * Plain markdown on purpose. A custom syntax would need a parser on the
 * client, would break the moment the model spelled it slightly differently,
 * and would read as noise in any surface that showed the raw text.
 */
export const CLAIM_KINDS: readonly { kind: string; rule: string }[] = Object.freeze([
  {
    kind: 'record',
    rule: 'A fact from a record names the record it came from, inline: "the thesis (updated 4 Nov) says".',
  },
  {
    kind: 'reading',
    rule: 'Your own inference is marked as yours: "my read is", "this suggests". Never phrased as something the records state.',
  },
  {
    kind: 'gap',
    rule: 'What you looked for and did not find goes in a blockquote, last, one line each. Say what was searched. Never pad it, and never include it when there is nothing missing.',
  },
])

/**
 * When a table earns its place, and when it does not.
 *
 * A table of one row is a sentence with extra furniture. A table of prose is
 * worse than a list, because the columns promise a comparison the cells do
 * not deliver. The client right-aligns columns that are wholly figures, which
 * is the one thing a table does that a list cannot.
 */
export const TABLE_RULES: readonly string[] = Object.freeze([
  'Use a table only to compare three or more objects on the same attributes. Two objects are a sentence.',
  'A column must hold figures or short labels, never sentences. A table of prose is a list with extra lines.',
  'Keep figures in their own columns so they align for comparison down the column.',
])

/**
 * The shapes available, and what each is for.
 *
 * Ordered by how often they are right. A reader asking "is this still a buy"
 * wants the first one.
 */
export const ANSWER_FORMS: readonly { form: string; when: string }[] = Object.freeze([
  { form: 'plain prose', when: 'the default, and correct for almost every question' },
  { form: 'a short list', when: 'three or more parallel items that are genuinely parallel' },
  { form: 'headings', when: 'the answer has more than one subject; never on a single-subject answer' },
  { form: 'a table', when: 'three or more objects compared on the same attributes' },
  { form: 'a leading summary', when: 'only when the answer runs long enough that the judgment would otherwise arrive late' },
])

/**
 * The contract, as the model reads it.
 *
 * Assembled from the pieces above so the prompt cannot say something the
 * tests are not checking, and so the drift test has one string to compare.
 */
export function presentationContract(): string {
  const lines: string[] = []
  lines.push('HOW TO WRITE THE ANSWER')
  lines.push('')
  lines.push('Three kinds of claim, and a reader must be able to tell them apart:')
  for (const c of CLAIM_KINDS) lines.push(`- ${c.rule}`)
  lines.push('')
  lines.push('Figures:')
  for (const r of FIGURE_RULES) lines.push(`- ${r}`)
  lines.push(`- Write a company as its ticker in the form ${TICKER_FORM} so the reader can open it.`)
  lines.push('')
  lines.push('Tables:')
  for (const r of TABLE_RULES) lines.push(`- ${r}`)
  lines.push('')
  lines.push('Shape. These are the forms available, not a template to fill in:')
  for (const f of ANSWER_FORMS) lines.push(`- ${f.form}: ${f.when}`)
  lines.push('')
  lines.push(
    'Do not apply a fixed skeleton to every question. An answer whose shape is ' +
    'the same whatever was asked carries no information in its shape.',
  )
  return lines.join('\n')
}
