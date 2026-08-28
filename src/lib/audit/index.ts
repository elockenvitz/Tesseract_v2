/**
 * Audit System
 *
 * Unified audit logging for institutional-grade auditability.
 */

// Types
export * from './types'

// Service
export {
  emitAuditEvent,
  checkIdempotency,
  queryAuditEvents,
  getEntityAuditEvents,
  getEntityTreeAuditEvents,
  getChangedFields,
  createStateSnapshot,
  formatAuditEventSummary,
} from './audit-service'

// Checksum
//
// Deliberately absent. `./checksum.ts` was deleted with Security Release B.
//
// It computed an UNKEYED SHA-256 in the browser over fields the caller also
// chose, from a recipe committed to this repository — so anyone able to forge a
// row could compute its checksum, and it detected nothing an attacker would
// fail to do. `verifyChecksum` was exported and never called, and a second
// writer put `${userId}-${entityId}-${Date.now()}` in the same column, so the
// value did not even mean one thing.
//
// audit_events.checksum still exists and is now computed server-side inside
// record_audit_event(). It is LEGACY and NON-AUTHORITATIVE: treat it as a
// consistency marker, never as tamper evidence. The security properties of the
// audit trail are trusted server-side attribution, tenant-scoped reads, and
// append-only rows — see docs/security/release-b.md §6.
