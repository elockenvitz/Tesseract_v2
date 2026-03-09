# Coverage: No-Owner Audit

**Date**: 2026-03-05
**Status**: Complete

## Product Truth

Coverage does NOT imply ownership. Multiple people covering the same asset for the same group is normal and expected. The Coverage UI must reflect a flat assignment model:

> X person(s) cover Y asset(s) for Z group(s)

There is no user-facing concept of: Owner, Default owner, Lead analyst, or Primary accountable person.

## Forbidden Terminology (User-Facing)

| Term | Status | Notes |
|------|--------|-------|
| Owner | Removed | Was column header, pills, kebab actions |
| Default owner | Removed | Was sublabel text |
| Lead analyst | Removed | Was modal toggle label |
| Set as owner | Removed | Was kebab action |
| Remove as owner | Removed | Was kebab action |
| Co-cover | Removed | Was pill label |
| Primary accountable | Never existed | Prevented |

## Internal-Only Concepts (Kept)

These exist for system routing only and are never surfaced to users:

| Concept | Where | Purpose |
|---------|-------|---------|
| `is_lead` (DB column) | `coverage_assignments.is_lead` | Tie-break flag for resolver |
| `resolvedRow` | `AssetCoverageGroup.resolvedRow` | Single row chosen by resolver for routing |
| `deriveResolverReason()` | `coverage-utils.ts` | Internal reason key (is_lead, primary, fallback) |
| `resolveCoverageForViewer()` | `resolveCoverage.ts` | Deterministic tie-break algorithm |
| `isLead` (add modal state) | `CoverageManager.tsx` | Maps to `is_lead` column, labeled "Primary routing" |

## Files Changed

### `src/lib/coverage/coverage-types.ts`
- Removed `OwnerDisplayState` type
- Removed `OwnerDisplay` interface
- Renamed `ListColumnId` `'owner'` to `'coveredBy'`
- Renamed `AssetCoverageGroup.defaultOwner` to `resolvedRow`
- Removed `ownerDisplay` field from resolved row
- Added `coveredByNames: string[]` field

### `src/lib/coverage/coverage-utils.ts`
- Removed `deriveOwnerDisplay()` function
- Renamed `deriveDefaultReason()` to `deriveResolverReason()` (internal)
- Updated `groupCoverageByAsset()` to produce `resolvedRow` + `coveredByNames`
- Removed `OwnerDisplay` import

### `src/lib/coverage/resolveCoverage.ts`
- Updated module doc comment to remove "default owner" language

### `src/components/coverage/views/CoverageListView.tsx`
- Column header: "Owner" to "Covered By"
- Column def key: `owner` to `coveredBy`
- Removed `onSetAsOwner` prop
- Removed `ownerCoverageIds` memo
- Parent row: shows `coveredByNames` (flat list of analyst names)
- Child rows: removed Owner/Co-cover pills, removed owner highlighting
- Kebab: removed "Set as owner" / "Remove as owner" actions
- Flat mode: removed `isOwnerRow` variable and "Owner" pill

### `src/components/coverage/CoverageManager.tsx`
- Column def: `owner` to `coveredBy` with label "Covered By"
- Removed `handleSetAsOwner` function
- Removed `onSetAsOwner` prop passthrough
- Removed `Star` and `deriveTargetKey` imports
- localStorage migration: `'owner'` maps to `'coveredBy'`
- Add modal toggle: "Set as Owner" to "Primary routing" (internal, only shown with enable_hierarchy)

## Verification

- `npx tsc --noEmit` passes with zero errors
- No user-facing strings contain "owner", "default", or "lead analyst"
- `is_lead` and resolver logic preserved as internal-only system routing
- localStorage migration chain: `visibility` -> `scope` -> `coversFor`, `defaultOwner` -> `owner` -> `coveredBy`
