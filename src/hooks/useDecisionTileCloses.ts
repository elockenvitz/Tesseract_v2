/**
 * Moved to `useTileCloses`, which every lens shares.
 *
 * Re-exported here rather than deleted because the Decisions suite mocks this
 * module path, and a lens's test fixture is not the thing to churn in the
 * pass that generalises a hook. New callers should import `useTileCloses`.
 */
export { useTileCloses, useDecisionTileCloses, type TileClose } from './useTileCloses'
