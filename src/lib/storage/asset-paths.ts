/**
 * Org-scoped paths for the shared `assets` storage bucket.
 *
 * Every object in this bucket lives under `<organization_id>/…`. That first
 * segment is the tenant boundary: the storage RLS policy matches it against
 * `current_org_id()`, exactly the way the database policies work. Nothing
 * else in the path is trusted for access control.
 *
 * This exists because the historical paths could not be scoped. They started
 * with either a literal (`models/`, `documents/`, `attachments/`) or an
 * `assets.id` — and `assets` is the shared security master, deliberately
 * global with no organization_id (see scripts/tenant-boundary-lint.mjs).
 * Two firms researching the same ticker share that row, so an asset id says
 * nothing about who may read the file. The org has to be in the path itself.
 *
 * Call sites must go through {@link assetsPath} rather than interpolating
 * their own strings, so the invariant is enforced in one place and the
 * backfill has a single definition of "correct" to check against.
 */

export const ASSETS_BUCKET = 'assets'

/**
 * Thrown when a path is built without an org. Deliberately loud: silently
 * writing to an unscoped path would produce an object that no policy grants
 * access to, so the upload would appear to succeed and the file would be
 * unreadable forever after.
 */
export class MissingOrgScopeError extends Error {
  constructor(context: string) {
    super(
      `Cannot build an assets-bucket path without an organization id (${context}). ` +
      `The caller must wait for OrganizationContext to resolve currentOrgId before uploading.`
    )
    this.name = 'MissingOrgScopeError'
  }
}

/**
 * Strip path separators from a single segment.
 *
 * Several call sites interpolate a user-supplied `file.name` directly. A name
 * containing a slash would silently create extra nesting; it stays inside the
 * org prefix so it is not a security problem, but it makes paths unpredictable
 * for the backfill and for anything that later parses them.
 */
function sanitizeSegment(segment: string): string {
  return segment.replace(/[/\\]+/g, '_')
}

/**
 * Build an org-scoped path into the `assets` bucket.
 *
 * @example
 *   assetsPath(currentOrgId, 'models', assetId, `${Date.now()}_${id}.xlsx`)
 *   // => '9f3c…/models/1b2a…/1755123456_x7k.xlsx'
 */
export function assetsPath(
  orgId: string | null | undefined,
  ...segments: Array<string | number>
): string {
  if (!orgId) throw new MissingOrgScopeError(segments.join('/') || '<no segments>')

  const tail = segments
    .map(s => sanitizeSegment(String(s)))
    .filter(s => s.length > 0)

  return [orgId, ...tail].join('/')
}

/** The org a path belongs to, or null if it predates org scoping. */
export function orgOfAssetsPath(path: string): string | null {
  const first = path.split('/')[0]
  return UUID_RE.test(first) ? first : null
}

/**
 * Whether a path carries an org prefix.
 *
 * Used by the backfill to tell migrated objects from legacy ones. The check is
 * "first segment is a UUID" rather than a lookup: every legacy prefix in use
 * was either a literal word (`models`, `documents`, `references`, `notes`,
 * `attachments`, `model-templates`) or an `assets.id`. Asset ids ARE uuids,
 * so this predicate alone cannot separate a legacy checklist-evidence path
 * (`<assetId>/<workflowId>/…`) from a migrated one — the backfill resolves
 * those by looking the path up in the table that references it, not by shape.
 */
export function isOrgScopedAssetsPath(path: string): boolean {
  return orgOfAssetsPath(path) !== null
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
