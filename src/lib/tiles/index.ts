/**
 * Tile presentation foundations.
 *
 * The smallest contract that lets one investment finding be drawn differently
 * on different surfaces without the finding itself changing: what question the
 * picture answers, how much room the page gave it, and which object it is
 * about. No engine, no registry, no rules, no components.
 *
 * Nothing in the running app imports this yet. It is a seam with tests, and
 * the surfaces adopt it one at a time — see the integration notes on the
 * stage report.
 */

export type {
  VisualIntent,
  TileRole,
  TileDensity,
  TileSurface,
  TileSubject,
  TilePresentationRequest,
  TilePresentation,
} from './presentation'

export {
  densityForRole,
  intentNeedsWidth,
  resolveTilePresentation,
} from './presentation'

export type { IdeaVisualKindLike } from './vocabularies'

export {
  intentFromExploreVisual,
  intentFromEvidenceKind,
  intentFromTodayArchetype,
  intentFromIdeaVisualKind,
  roleFromExploreCardSize,
  roleFromIdeaDensity,
  roleFromDesktopTileSize,
  visualSizeForDensity,
} from './vocabularies'
