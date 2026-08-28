import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { CARD_COVERAGE, measuredTypes, unmeasuredTypes } from '../card-coverage'
import { CONTENT_REGISTRY } from '../content-registry'
import type { SignalType } from '../contract'

/**
 * The presentation half of the "a new card type must be decided on" guard.
 *
 * `content-registry.test` already stops a type existing without a declared
 * capability. Nothing stopped one existing without ever being RENDERED at a
 * measured width — so a type could ship having never met the layout contract in
 * `e2e/signal-cards.spec.ts`, and every gate in the repo would still be green.
 *
 * These tests do not demand a fixture for every type. They demand a decision
 * for every type, and they demand that a claimed fixture is real.
 */

const SPEC = resolve(__dirname, '../../../../e2e/signal-cards.spec.ts')
const GALLERY = resolve(__dirname, '../../../../gallery/main.tsx')

const specSource = readFileSync(SPEC, 'utf8')
const gallerySource = readFileSync(GALLERY, 'utf8')

describe('card coverage', () => {
  it('has an entry for every signal type, and no entry for a type that does not exist', () => {
    /**
     * The whole point. Adding a member to `SignalType` and shipping it without
     * touching this file is what the guard exists to prevent — TypeScript
     * catches the omission at compile time because the map is `Record<SignalType,
     * …>`, and this catches a stale entry left behind by a removal.
     */
    const registered = Object.keys(CONTENT_REGISTRY).sort()
    const covered = Object.keys(CARD_COVERAGE).sort()
    expect(covered).toEqual(registered)
  })

  it('gives every unmeasured type a reason, not a shrug', () => {
    const unreasoned = unmeasuredTypes().filter(u => u.reason.trim().length < 20)
    expect(
      unreasoned.map(u => u.type),
      'a type with no fixture must say why, in a sentence about that type',
    ).toEqual([])
  })

  it('never claims both a fixture and an excuse', () => {
    const both = (Object.keys(CARD_COVERAGE) as SignalType[])
      .filter(t => CARD_COVERAGE[t].slug && CARD_COVERAGE[t].reason)
    expect(both, 'a covered type does not need a reason').toEqual([])
  })

  it('names only fixtures the gallery actually renders', () => {
    /**
     * A slug that is not in the gallery is worse than no slug: it reports
     * coverage that does not exist. Matched against the gallery source rather
     * than by importing it, because `gallery/main.tsx` is a React entry that
     * mounts components and reaches for a DOM.
     */
    const missing = measuredTypes().filter(
      t => !gallerySource.includes(`slug: '${CARD_COVERAGE[t].slug}'`),
    )
    expect(
      missing.map(t => `${t} -> ${CARD_COVERAGE[t].slug}`),
      'slug named in CARD_COVERAGE but absent from gallery/main.tsx',
    ).toEqual([])
  })

  it('names only fixtures the phone suite measures', () => {
    /**
     * A gallery fixture nothing asserts about is a screenshot, not a contract.
     * `e2e/signal-cards.spec.ts` drives its layout rules from one `CARDS`
     * array; a slug outside it renders and is measured by nothing.
     */
    const cardsArray = /const CARDS = \[([\s\S]*?)\] as const/.exec(specSource)?.[1] ?? ''
    expect(cardsArray, 'could not find the CARDS array in signal-cards.spec.ts').not.toBe('')

    const missing = measuredTypes().filter(
      t => !cardsArray.includes(`'${CARD_COVERAGE[t].slug}'`),
    )
    expect(
      missing.map(t => `${t} -> ${CARD_COVERAGE[t].slug}`),
      'slug named in CARD_COVERAGE but not in the phone suite CARDS array',
    ).toEqual([])
  })

  it('reports the gap, so it cannot quietly widen', () => {
    /**
     * A ratchet, not a target. The number is allowed to fall and not to rise:
     * adding a type without a fixture fails here and the author must either
     * write one or move the ceiling deliberately, in a diff a reviewer sees.
     *
     * 17 is where this branch found it — 11 of 28 types measured.
     */
    const UNMEASURED_CEILING = 17
    const gap = unmeasuredTypes().length
    expect(
      gap,
      `${gap} signal types render in no measured fixture. Ceiling is ${UNMEASURED_CEILING}; ` +
      'add a gallery fixture and a CARDS entry rather than raising it.',
    ).toBeLessThanOrEqual(UNMEASURED_CEILING)
  })
})
