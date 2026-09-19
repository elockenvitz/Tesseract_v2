/**
 * Which resolved notification destinations the shell will actually open.
 *
 * NotificationPane decides WHERE a notification goes. Layout's job is only to
 * carry the reader there and get the pane out of the way. Those two jobs used
 * to disagree: Layout's handler ended in `if (notification.type === 'asset')`,
 * so the note, list and price-target destinations the pane resolved were
 * silently dropped. The tap marked the row read and did nothing else — and on
 * a phone, where the pane is a full-height sheet rather than a 384px rail,
 * there was no visible effect at all to suggest anything had happened.
 *
 * This is the gate that used to name one type. It names none: anything the
 * pane resolved into a addressable target opens.
 */

/** The shape NotificationPane hands to `onNotificationClick`. */
export interface NotificationTarget {
  id?: unknown
  type?: unknown
  title?: unknown
  data?: unknown
}

/**
 * True when the shell can open this target as a tab.
 *
 * A target needs both a type and an id: the type chooses the surface, the id
 * says which record. Anything missing either is not addressable, and opening a
 * blank surface would be worse than the dead tap it replaces.
 */
export function isNavigableNotificationTarget(target: unknown): target is NotificationTarget {
  if (!target || typeof target !== 'object') return false
  const { id, type } = target as NotificationTarget
  return typeof type === 'string' && type.length > 0
    && typeof id === 'string' && id.length > 0
}
