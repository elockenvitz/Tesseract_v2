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
export type AccessRequestTopic = 'demo' | 'partnership' | 'access'

/* ─────────────────────────── where a request goes ───────────────────────── */

/**
 * The one place the contact variables are read.
 *
 * Two surfaces now need this decision, the landing page and the Early Access
 * notice on /signup, and the two disagreeing is how `/signup` came to be a
 * dead end in the first place: the landing page had a fallback and the notice
 * had `{ACCESS_REQUEST_EMAIL && ...}`, which rendered nothing.
 *
 *   1. `VITE_ACCESS_REQUEST_URL` wins: an external intake form. It exposes no
 *      address, filters spam, and returns structured answers. Links out.
 *   2. Otherwise the on-page box, which posts to the host's form handling.
 *      This is the live route and needs nothing configured.
 *
 * `VITE_ACCESS_REQUEST_EMAIL` is NOT a mode. A mailto asks a prospect to
 * compose a cold email from nothing, while the box asks five short questions.
 * It is the box's fallback if the POST fails, so an address reaches a visitor
 * only when they are already looking at an error.
 *
 * No address is ever guessed. `sales@tesseract.com` is hard-coded in
 * `AIConfigurationSection` and is not used here: that domain is not ours.
 */
const CONTACT_URL = import.meta.env.VITE_ACCESS_REQUEST_URL as string | undefined
const CONTACT_EMAIL = import.meta.env.VITE_ACCESS_REQUEST_EMAIL as string | undefined

export interface AccessRequestRoute {
  /** `form` links out to a configured intake form; `inline` opens the box. */
  mode: 'form' | 'inline'
  /** Set only in `form` mode. */
  url?: string
  /** The box's failure fallback, if one is configured. */
  fallbackEmail?: string
}

/**
 * Read once at module scope, as Vite inlines `import.meta.env` at build time.
 *
 * An empty string counts as unset, which is what makes a variable declared
 * blank in `.env.example` or left empty in the dashboard behave the same as
 * one that was never added.
 */
export const ACCESS_REQUEST_ROUTE: AccessRequestRoute = {
  mode: CONTACT_URL ? 'form' : 'inline',
  url: CONTACT_URL || undefined,
  fallbackEmail: CONTACT_EMAIL || undefined,
}
