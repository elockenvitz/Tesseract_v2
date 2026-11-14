/**
 * The canonical Asset object — desktop.
 *
 * Asset is one of three deep objects (with Idea and Decision). Research and
 * Portfolio are lenses that FIND an asset; this is where the work happens.
 */

export type { AssetFocus, AssetSectionTarget, OpenAssetRequest } from './navigate'
export {
  openAsset, subscribeToOpenAsset, assetTabFor, OPEN_ASSET_EVENT,
  ORIGIN_NAME, issueTitle, issueDetail,
  ASSET_FOCUSES, asAssetFocus,
  ASSET_SECTION_TARGETS, isAssetSectionTarget,
} from './navigate'
export type { ReturnTarget, ReturnHost, ReturnTabData } from './return-to'
export {
  ACTIVATE_TAB_EVENT, activateTab, subscribeToActivateTab,
  returnTargetFrom, returnTabData, returnTabPatch, readReturnTarget, returnLabelFor,
} from './return-to'
