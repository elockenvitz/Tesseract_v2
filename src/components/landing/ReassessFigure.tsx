/**
 * The same decision, seen twice: when it was made, and when it was revisited.
 *
 * ── Why this is the strongest figure on the page ─────────────────────────
 *
 * Everything else here can be argued against by a PM who already has a
 * research system: they have notes, they have a process, they have a
 * meeting where decisions get made. What they do not have is the ability
 * to open a position eight months later and read WHAT THEY ACTUALLY
 * BELIEVED when they took it, as opposed to what they now remember
 * believing.
 *
 * That gap is invisible until you see the two columns side by side, which
 * is why this is a figure and not a paragraph. A paragraph claiming "you
 * can revisit the original reasoning" is a feature sentence. Two columns
 * showing a conviction that moved from High to Medium, against an
 * assumption that turned out to be wrong for a reason nobody had listed,
 * is an argument.
 *
 * ── The distinction this figure has to protect ───────────────────────────
 *
 * A bad outcome is not a bad decision. The right-hand column deliberately
 * does NOT render a verdict on the call; it renders what changed. The
 * verdict line at the bottom says the thing the whole product exists to
 * make possible: that the two questions are separable, and that you need
 * the original reasoning to separate them.
 *
 * Same honesty rules as every figure here: fictional eight-letter name,
 * no invented performance numbers, visible illustration marker, and every
 * field corresponds to something really stored.
 */

const THEN = [
  ['Thesis', 'Margin recovery as the new plant reaches scale'],
  ['Key assumption', 'The ramp completes inside two quarters'],
  ['Conviction', 'High'],
  ['What would break it', 'A second delay, or input costs holding'],
  ['Decision', 'Approved, sized to the stated conviction'],
] as const

const NOW = [
  ['What changed', 'The ramp slipped a third quarter'],
  ['Assumption', 'Wrong, and for a reason that was on the list'],
  ['Conviction', 'Medium, lowered and dated'],
  ['Valuation', 'Rebuilt on the later ramp'],
  ['Next', 'Revisit sizing, with the original case open beside it'],
] as const

export function ReassessFigure() {
  return (
    <figure
      data-illustration="true"
      className="relative overflow-hidden rounded-2xl bg-white/[0.025] ring-1 ring-inset ring-white/[0.08]"
    >
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-10 top-0 h-px bg-gradient-to-r from-transparent via-white/30 to-transparent"
      />

      <figcaption className="flex items-center justify-between gap-4 border-b border-white/[0.07] px-5 py-3.5 sm:px-7">
        <span className="flex min-w-0 items-center gap-2.5">
          <span aria-hidden="true" className="size-2 rounded-full bg-amber-300/80" />
          <span data-security-name className="truncate font-mono text-[14px] text-white">
            NORTHWIND
          </span>
          <span aria-hidden="true" className="text-slate-700">/</span>
          <span className="truncate text-[14px] font-medium text-slate-300">
            Decision review
          </span>
        </span>
        <span className="shrink-0 text-[12px] font-medium uppercase tracking-[0.14em] text-slate-500">
          Illustration
        </span>
      </figcaption>

      <div className="grid gap-px bg-white/[0.06] md:grid-cols-2">
        {/* ── Then ────────────────────────────────────────────────────── */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-slate-500">
            When the decision was made
          </p>
          <dl className="mt-5 space-y-4">
            {THEN.map(([term, def]) => (
              <div key={term}>
                <dt className="text-[14px] font-medium text-slate-500">{term}</dt>
                <dd className="mt-1 text-[16px] leading-[1.6] text-slate-300">{def}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 border-t border-white/[0.07] pt-4 text-[14px] leading-relaxed text-slate-500">
            Frozen at submission. Later edits to the note created versions and
            never altered this.
          </p>
        </div>

        {/* ── Now ─────────────────────────────────────────────────────── */}
        <div className="bg-[#07090e] p-5 sm:p-7">
          <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-amber-300/80">
            Eight months later
          </p>
          <dl className="mt-5 space-y-4">
            {NOW.map(([term, def]) => (
              <div key={term}>
                <dt className="text-[14px] font-medium text-slate-500">{term}</dt>
                <dd className="mt-1 text-[16px] leading-[1.6] text-white">{def}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 border-t border-amber-300/20 pt-4 text-[14px] leading-relaxed text-slate-400">
            The assumption that failed was one the analyst had already named,
            so the question is sizing, not judgement.
          </p>
        </div>
      </div>
    </figure>
  )
}
