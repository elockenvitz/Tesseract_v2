/**
 * Following a typed reference to the object itself.
 *
 * ── What was wrong ───────────────────────────────────────────────────────
 *
 * A conversation can carry four kinds of reference -- asset, portfolio,
 * theme, note -- because those are the four the tag table's CHECK constraint
 * accepts. Only the asset chip went anywhere. The other three were rendered
 * as plain text, which was honest but meant three quarters of the feature
 * stopped at "we remember what this is about".
 *
 * ── Not a router ─────────────────────────────────────────────────────────
 *
 * This application is a tab shell, not a URL space, and no destination here
 * is invented. Each descriptor below is the one the application's own
 * surfaces already dispatch:
 *
 *   asset      `openAsset` (`lib/desktop-asset/navigate`), the single
 *              contract every lens routes through.
 *   portfolio  `{ type: 'portfolio', data: { id, name } }`, as
 *              `PortfolioCommandCenter` sends it.
 *   theme      `{ type: 'theme', data: <the theme row> }`, which is what
 *              `ThemeTab` takes.
 *   note       `{ id: 'note-<entityType>-<entityId>', type: 'note',
 *              data: { id, entityType, entityId, entityName, ... } }`, as
 *              `NotesListPage` sends it. The synthetic tab id is NOT
 *              decoration: all notes on one entity share a tab, and passing
 *              a note's own uuid as the tab id makes a second tab for every
 *              note on the same name.
 *
 * ── Why a note needs resolving at all ────────────────────────────────────
 *
 * The tag stores a type and an id and nothing else. For an asset, a
 * portfolio and a theme the id IS the object. A note's id is not enough:
 * notes live in four tables (`asset_notes`, `portfolio_notes`,
 * `theme_notes`, `custom_notebook_notes`), the editor is chosen by which
 * entity owns the note, and the tab id is built from that entity. So the
 * note has to be looked up, and the lookup is what also answers the two
 * questions a chip cannot answer on its own: is it still there, and can
 * this reader still see it.
 *
 * ── Permission is the lookup, not a claim about it ────────────────────────
 *
 * Nothing here decides who may open what. Each probe runs as the reader
 * through PostgREST, so RLS answers it: a row that comes back is a row they
 * can read, and a row that does not is either gone or no longer theirs. The
 * chip is drawn as a link only for a reference that resolved, which is why
 * "can I click it" and "is it still there" are the same mechanism rather
 * than two that can disagree.
 *
 * A reference whose object has gone is not hidden. It stays on the
 * conversation, as text, saying so -- the thread really was about that
 * thing, and quietly dropping it would rewrite what the reader asked.
 */
import { openAsset } from '../desktop-asset/navigate'

export type ReferenceType = 'asset' | 'portfolio' | 'theme' | 'note'

/** The note tables, and the entity each one hangs off. */
export const NOTE_SOURCES = [
  { table: 'asset_notes', entityType: 'asset', fk: 'asset_id', join: 'assets(id, symbol, company_name)' },
  { table: 'portfolio_notes', entityType: 'portfolio', fk: 'portfolio_id', join: 'portfolios(id, name)' },
  { table: 'theme_notes', entityType: 'theme', fk: 'theme_id', join: 'themes(id, name)' },
] as const

export type NoteEntityType = typeof NOTE_SOURCES[number]['entityType']

/** A reference that resolved, with what the destination needs. */
export type ResolvedReference =
  | { type: 'asset'; id: string; label: string; symbol: string | null; companyName: string | null }
  | { type: 'portfolio'; id: string; label: string; row: Record<string, unknown> }
  | { type: 'theme'; id: string; label: string; row: Record<string, unknown> }
  | {
      type: 'note'
      id: string
      label: string
      entityType: NoteEntityType
      entityId: string
      entityName: string
      entityRow: Record<string, unknown> | null
    }

export const referenceKey = (t: { type: string; id: string }) => `${t.type}:${t.id}`

/** The four the tag table accepts, as a type guard. */
export function isReferenceType(value: unknown): value is ReferenceType {
  return value === 'asset' || value === 'portfolio' || value === 'theme' || value === 'note'
}

/**
 * A tab descriptor for the shell, or null for a reference that resolved to
 * something the shell has no destination for.
 *
 * Null is never the answer for the four types above; it exists so a future
 * fifth type cannot silently produce a descriptor the shell will not render.
 */
export function referenceTabFor(ref: ResolvedReference): Record<string, unknown> | null {
  switch (ref.type) {
    case 'portfolio':
      return {
        id: ref.id,
        title: ref.label,
        type: 'portfolio',
        /* The row, so `PortfolioTab` has the name and benchmark it draws
           without a second fetch; `id` and `name` are written explicitly
           because the tab merges `data` and a missing key would persist from
           whatever opened this tab last. */
        data: { ...ref.row, id: ref.id, name: ref.label },
      }
    case 'theme':
      return {
        id: ref.id,
        title: ref.label,
        type: 'theme',
        data: { ...ref.row, id: ref.id, name: ref.label },
      }
    case 'note':
      return {
        id: `note-${ref.entityType}-${ref.entityId}`,
        title: `Note - ${ref.entityName}`,
        type: 'note',
        data: {
          /* The specific note to open, inside the entity's shared tab. */
          id: ref.id,
          entityType: ref.entityType,
          entityId: ref.entityId,
          entityName: ref.entityName,
          ...(ref.entityType === 'asset'
            ? { assetId: ref.entityId, assetSymbol: ref.entityName, ...(ref.entityRow ? { assets: ref.entityRow } : {}) }
            : {}),
          ...(ref.entityType === 'portfolio'
            ? { portfolioId: ref.entityId, portfolioName: ref.entityName, ...(ref.entityRow ? { portfolios: ref.entityRow } : {}) }
            : {}),
          ...(ref.entityType === 'theme'
            ? { themeId: ref.entityId, themeName: ref.entityName, ...(ref.entityRow ? { themes: ref.entityRow } : {}) }
            : {}),
        },
      }
    case 'asset':
      /* Assets do not go through the generic channel. `openAsset` dispatches
         the descriptor AND the typed event, stamps a focus request id, and
         is the contract every other lens uses. Reproducing it here would be
         a second way to open an asset. */
      return null
  }
}

/**
 * Open a resolved reference. False when nothing was dispatched.
 *
 * The asset branch delegates; everything else goes on the shell's own tab
 * channel, which is the same event `openAsset` uses for its first dispatch.
 */
export function openReference(ref: ResolvedReference | null | undefined): boolean {
  if (!ref) return false
  if (typeof window === 'undefined') return false

  if (ref.type === 'asset') {
    return openAsset({
      assetId: ref.id,
      symbol: ref.symbol,
      companyName: ref.companyName,
      /* No `focus`: pressing a chip means "show me this", not "put me in a
         particular section of it", and sending one would move a reader who
         is already on that page. */
      origin: 'act-ai-context',
    })
  }

  const tab = referenceTabFor(ref)
  if (!tab) return false
  window.dispatchEvent(new CustomEvent('decision-engine-action', { detail: tab }))
  return true
}

/**
 * Why a chip is not a link, in the reader's words.
 *
 * Two different situations and they must not be blurred: a reference still
 * loading is not a reference that has gone.
 */
export function referenceUnavailableTitle(label: string, loading: boolean): string {
  return loading
    ? `Checking whether ${label} is still available`
    : `${label} is no longer available to you. It was part of this conversation.`
}
