/**
 * archived-org-errors — Shared error mapper for archived-org trigger errors.
 *
 * The `enforce_org_not_archived` trigger raises:
 *   "Organization is archived — writes are disabled"
 *
 * This module detects that error and returns a user-friendly message.
 */

const ARCHIVED_ORG_PATTERN = /organization is archived/i

/** Returns true if the error originated from the archived-org trigger. */
export function isArchivedOrgError(error: unknown): boolean {
  if (!error) return false
  const msg =
    (error as any)?.message ||
    (error as any)?.details ||
    (error as any)?.hint ||
    String(error)
  return ARCHIVED_ORG_PATTERN.test(msg)
}

/**
 * Map a mutation error to a user-friendly string.
 * If the error is an archived-org trigger error, returns a standard message.
 * Otherwise returns the original error message.
 */
export function mapMutationError(error: unknown): string {
  if (isArchivedOrgError(error)) {
    return 'This organization is archived. Changes cannot be saved.'
  }
  return (error as any)?.message || 'An unexpected error occurred'
}
