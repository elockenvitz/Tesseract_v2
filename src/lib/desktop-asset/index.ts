/**
 * The canonical Asset object — desktop.
 *
 * Asset is one of three deep objects (with Idea and Decision). Research and
 * Portfolio are lenses that FIND an asset; this is where the work happens.
 */

export type { AssetFocus, OpenAssetRequest } from './navigate'
export {
  openAsset, subscribeToOpenAsset, assetTabFor, OPEN_ASSET_EVENT,
  ORIGIN_NAME, issueTitle, issueDetail,
} from './navigate'
