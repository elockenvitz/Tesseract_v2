/**
 * The access-request form contract: the names and the endpoint, in one place.
 *
 * ── Why these are not in `AccessRequestDialog.tsx` ───────────────────────
 *
 * A file that exports anything other than components breaks fast refresh, and
 * eslint's `react-refresh/only-export-components` rejects it. The same rule
 * already moved `FOOTER_LABELS` out of `LegalFooter`.
 *
 * It also happens to be the right shape regardless: two very different
 * consumers read this list. The dialog builds a POST body from it, and a test
 * compares it against the static declaration in
 * `public/forms/access-request.html`. Neither should have to import a React
 * component to learn a field name.
 *
 * ── The failure this exists to prevent ───────────────────────────────────
 *
 * Build-time form detection records only the fields declared in the static
 * markup. A field posted but not declared is dropped on arrival, and the
 * response is still 200: the visitor is thanked and the data is gone. So the
 * two lists have to agree, and something has to fail loudly when they do not.
 */

/** Must match the `name` attribute on the static form exactly. */
export const ACCESS_REQUEST_FORM_NAME = 'access-request'

/**
 * Every field posted, and the contract with the static form.
 *
 * `bot-field` is the spam honeypot, declared to the host as the honeypot name:
 * it renders off-screen and untabbable, a person never fills it, and a
 * submission carrying a value is discarded upstream rather than by us.
 */
export const ACCESS_REQUEST_FIELDS = [
  'bot-field',
  'topic',
  'name',
  'email',
  'firm',
  'role',
  'note',
] as const

/**
 * Where the POST goes.
 *
 * The site root, not the static form's own path: the form handler intercepts a
 * POST to any path in the deploy before the single-page rewrite runs, and the
 * root is the one path guaranteed to exist in every deploy.
 */
export const ACCESS_REQUEST_ENDPOINT = '/'

/** Which call to action opened the box, so a demo is distinguishable. */
export type AccessRequestTopic = 'demo' | 'partnership'
