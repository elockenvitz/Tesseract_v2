/**
 * Fixtures for the Our View summary surface.
 *
 * Shaped around the cases that are easy to get wrong, not the happy path:
 *
 *  - a field with FOUR analysts, so the "N views" flag and the "more in the
 *    individual views" overflow both appear;
 *  - a field whose prose is stored under an ALIAS of the section its template
 *    slug names (`key-risks` → `risks`), which the first draft would have
 *    missed entirely;
 *  - a contribution six months old, to show the stale treatment next to fresh
 *    ones rather than in isolation;
 *  - an ARCHIVED row and a MARKUP-ONLY row, neither of which may count as a
 *    contributor or produce a blank excerpt;
 *  - a row whose author profile never resolved, which must read "Unknown
 *    analyst" rather than leaving the firm apparently speaking unattributed;
 *  - one field in the template that nobody has written, which must not appear.
 */

import type { OurViewField } from '../src/components/asset/OurViewSummary'
import type { Contribution } from '../src/hooks/useContributions'

/** A template in the org's own order, matching what `AssetTab` derives. */
export const OUR_VIEW_FIELDS: OurViewField[] = [
  { slug: 'investment-thesis', label: 'Investment Thesis', sectionKeys: ['thesis'] },
  { slug: 'where-different', label: 'Where Our Thesis Differs', sectionKeys: ['where_different'] },
  { slug: 'key-risks', label: 'Key Risks', sectionKeys: ['risks_to_thesis', 'risks'] },
  { slug: 'key_catalysts', label: 'Key Catalysts', sectionKeys: ['catalysts', 'key_catalysts'] },
  { slug: 'business-model', label: 'Business Model', sectionKeys: ['business_model'] },
  // Nobody has written this one. It must not render an empty card.
  { slug: 'competitive-position', label: 'Competitive Position', sectionKeys: ['competitive_position'] },
]

const DAY = 86_400_000
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString()

const PEOPLE = {
  rivera: { id: 'u-rivera', first_name: 'Dana', last_name: 'Rivera' },
  okafor: { id: 'u-okafor', first_name: 'Sam', last_name: 'Okafor' },
  lindqvist: { id: 'u-lindqvist', first_name: 'Mia', last_name: 'Lindqvist' },
  chen: { id: 'u-chen', first_name: 'Wei', last_name: 'Chen' },
}

let seq = 0
function row(
  section: string,
  person: { id: string; first_name: string; last_name: string } | null,
  content: string,
  days: number,
  over: Partial<Contribution> = {},
): Contribution {
  seq += 1
  return {
    id: `c-${seq}`,
    asset_id: 'aapl',
    section,
    content,
    supporting_detail: null,
    attachments: null,
    created_by: person?.id ?? 'u-ghost',
    team_id: null,
    visibility: 'team',
    is_pinned: false,
    is_archived: false,
    pinned_by: null,
    pinned_at: null,
    archived_by: null,
    archived_at: null,
    sort_order: 0,
    created_at: ago(days + 2),
    updated_at: ago(days),
    user: person ? { ...person, full_name: `${person.first_name} ${person.last_name}` } : undefined,
    ...over,
  } as Contribution
}

export function ourViewContributions(variant: string | null): Contribution[] {
  if (variant === 'empty') return []

  if (variant === 'single') {
    /*
     * One analyst, one section. The point of this variant is the wording: with
     * a single contributor the surface must say "1 contributor", never imply
     * the firm has a position, and never flag disagreement.
     */
    return [row('thesis', PEOPLE.rivera,
      '<p>We own it for the installed base, not the product cycle. Replacement '
      + 'rates have been stable through two down cycles.</p>', 3)]
  }

  return [
    // Four views on the thesis — flag plus overflow.
    /*
     * Deliberately long — well past the 190-character excerpt budget, across
     * several sentences. Without one row like this the probe's "every excerpt
     * is one sentence-ish" check cannot fail, because no fixture would exceed
     * the budget even if the component stopped clipping at all. It is the row
     * that makes that assertion load-bearing.
     */
    row('thesis', PEOPLE.rivera,
      '<p>We own it for the installed base, not the product cycle. Replacement rates '
      + 'held through two down cycles, which is what makes the cash flow underwritable. '
      + 'The bear case has always been that the upgrade cadence lengthens, and it has '
      + 'lengthened, and the revenue line did not care, because the services attach rate '
      + 'rose faster than the hardware cadence fell. That trade has another three years '
      + 'in it on our numbers, and the market is still underwriting the hardware line.</p>', 2),
    row('thesis', PEOPLE.okafor,
      '<p>Services is the whole story now; hardware is a distribution cost. '
      + 'At 22x services-adjusted we are paying for durability we can see.</p>', 9),
    row('thesis', PEOPLE.lindqvist,
      '<p>I am less constructive. The install base is maturing and the services '
      + 'take-rate has regulatory risk the street is not pricing.</p>', 24),
    row('thesis', PEOPLE.chen,
      '<p>Neutral here. Good business, full price, no edge at this multiple.</p>', 61),

    // The variant view, from the covering analyst only.
    row('where_different', PEOPLE.rivera,
      '<p>Consensus treats the services take-rate as a policy variable. We treat it '
      + 'as a contract term, which is why our 2028 estimate is 11% above the street.</p>', 2),

    /*
     * Risk prose stored under `risks`, the ALIAS — the template field is
     * `key-risks`, whose first section key is `risks_to_thesis`. Reading only
     * the first key would hide this row and the firm would appear to have
     * written nothing about risk.
     */
    row('risks', PEOPLE.okafor,
      '<p>App Store remedies in the EU and a US equivalent would take 4-6% off '
      + 'services revenue, and the multiple would follow it down.</p>', 11),
    row('risks_to_thesis', PEOPLE.lindqvist,
      '<p>China. Two thirds of the growth gap versus our model is one country.</p>', 30),

    // Stale, to show the amber treatment next to fresh rows.
    row('catalysts', PEOPLE.chen,
      '<p>Watch the March quarter services disclosure; the segment split is the '
      + 'only thing that settles the take-rate argument.</p>', 201),

    // Author profile never resolved.
    row('business_model', null,
      '<p>Hardware acquires the customer, services monetises them, and the '
      + 'switching cost is the family, not the phone.</p>', 7),

    // Neither of these may count as a contributor.
    row('thesis', PEOPLE.chen, '<p>&nbsp;</p>', 1),
    row('where_different', PEOPLE.okafor,
      '<p>Superseded — see the 2026 note.</p>', 400, { is_archived: true }),
  ]
}
