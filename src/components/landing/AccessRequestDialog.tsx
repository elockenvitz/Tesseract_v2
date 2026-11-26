/**
 * AccessRequestDialog — the box a visitor fills in to ask for access.
 *
 * ── What this replaces, and why it was wrong ─────────────────────────────
 *
 * Every call to action on the landing page used to resolve to `/login` when
 * no intake URL and no mailbox were configured, which is the live state. So
 * a stranger who clicked "Request a demo" arrived at a password prompt.
 *
 * The comment above that fallback claimed `/login` was "a real page with a
 * real access-request path on it". It was not, in two separate ways:
 *
 *   1. The request-access affordance lives in `EarlyAccessNotice`, which
 *      renders on `/signup`, not `/login`.
 *   2. Even on `/signup` it is wrapped in `{ACCESS_REQUEST_EMAIL && ...}`,
 *      so with the variable unset it renders nothing at all.
 *
 * The test suite did not catch it because it asserted the link pointed at
 * `/login` and stopped there. A link to a page is not a route to an outcome,
 * and asserting the href proves only the first of those.
 *
 * ── Where a submission goes ──────────────────────────────────────────────
 *
 * The form posts to the host's own form handling: no database, no mailbox on
 * the page for scrapers to harvest, no third-party script, and no secret in
 * the bundle. Submissions arrive in the deploy dashboard and notify by email.
 *
 * Two consequences worth knowing before editing this file:
 *
 *   - The field names are a contract with `public/forms/access-request.html`.
 *     An undeclared field is dropped on arrival with a 200 response, so the
 *     visitor is thanked and the data is gone. `ACCESS_REQUEST_FIELDS` in
 *     `access-request-contract.ts` is the single source of truth, and a parity
 *     test fails if the static form and that list disagree.
 *   - The endpoint only exists on a real deploy. Locally the POST 404s, which
 *     is why failure is a first-class state here rather than an afterthought:
 *     the dialog keeps every value, says so plainly, and offers the mailbox as
 *     a way through if one is configured.
 *
 * ── What it deliberately does not do ─────────────────────────────────────
 *
 * It collects what a person would put on a business card and nothing else. No
 * IP address, no fingerprint, no analytics call, no tracking cookie. There is
 * no published privacy policy yet, so the only promise made here is the one
 * that is true of the code: what is typed is used to reply.
 */

import { useCallback, useId, useRef, useState } from 'react'
import { Check, Loader2, X } from 'lucide-react'
/* The modal behaviour: role, aria-modal, Escape, focus in, focus trap,
   focus restore and the scroll lock. See that file on why nothing existing
   could be adopted for it. */
import { Dialog } from '../ui/Dialog'
/* The field names, the form name and the endpoint. They live in their own
   module because exporting a constant from a component file breaks fast
   refresh, and because the parity test reads them without rendering React. */
import {
  ACCESS_REQUEST_ENDPOINT,
  ACCESS_REQUEST_FIELDS,
  ACCESS_REQUEST_FORM_NAME,
  type AccessRequestTopic,
} from './access-request-contract'

type Status = 'idle' | 'sending' | 'sent' | 'failed'

interface AccessRequestDialogProps {
  /** Which call to action opened it, so a demo request is distinguishable. */
  topic: AccessRequestTopic
  onClose: () => void
  /**
   * The configured mailbox, offered only if the POST fails. Undefined when no
   * mailbox is set, in which case no address is ever rendered: this component
   * does not read the environment and never guesses an address.
   */
  fallbackEmail?: string
  /**
   * Which page it is sitting on.
   *
   * `dark` is the landing page. `light` is the auth pages, which are a white
   * card on `bg-gray-50`, and `darkMode: 'class'` means a signed-out visitor
   * has no theme class, so there is no variant that covers both: a near-black
   * panel over the signup page reads as pasted in from somewhere else. The
   * structure, the copy and the submission are identical; only the surface
   * changes.
   */
  tone?: Tone
}

type Tone = 'dark' | 'light'

const HEADINGS: Record<AccessRequestTopic, { title: string; blurb: string }> = {
  demo: {
    title: 'Request a demo',
    blurb:
      'Thirty minutes on one security, start to finish. Tell us who you are and we will follow up to find a time.',
  },
  partnership: {
    title: 'Become a design partner',
    blurb:
      'A small number of investment teams are shaping how Tesseract reaches the institutional market. Tell us about your process and we will follow up.',
  },
  /* /signup, where the visitor arrived asking for an account rather than
     clicking a marketing CTA, so the ask is the account and not a meeting. */
  access: {
    title: 'Request access',
    blurb:
      'Tesseract is in Professional Early Access. Tell us who you are and we will follow up about an invitation.',
  },
}

/** Everything that differs between the two surfaces, and nothing else. */
const TONES: Record<Tone, {
  overlay: string
  panel: string
  title: string
  blurb: string
  label: string
  field: string
  close: string
  cancel: string
  sentIcon: string
  sentCheck: string
  sentTitle: string
  sentBlurb: string
  done: string
  invalid: string
  failed: string
}> = {
  dark: {
    overlay: 'fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-[#050710]/80 p-4 backdrop-blur-sm sm:items-center',
    panel: 'relative w-full max-w-lg rounded-2xl bg-[#0a0d18] p-6 shadow-2xl shadow-black/60 ring-1 ring-inset ring-white/10 focus:outline-none sm:p-8',
    title: 'pr-8 text-xl font-semibold tracking-[-0.01em] text-white',
    blurb: 'mt-2.5 text-sm leading-relaxed text-slate-400',
    label: 'block text-xs font-medium uppercase tracking-wider text-slate-400',
    field: 'w-full rounded-lg border-0 bg-white/[0.04] px-3.5 py-2.5 text-sm text-white shadow-inner shadow-black/20 ring-1 ring-inset ring-white/10 transition-colors placeholder:text-slate-500 hover:ring-white/20 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-400 disabled:opacity-60',
    /* h-10 w-10, not p-1.5. Measured at 390 CSS pixels in a browser: padding
       around a 16px icon gave a 28x28 tap target, against 40 for every other
       control in the panel. A thumb misses it. */
    close: 'absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-white/5 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
    cancel: 'rounded-lg px-4 py-2.5 text-sm font-semibold text-slate-300 transition-colors hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
    sentIcon: 'mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-500/15 ring-1 ring-inset ring-primary-400/30',
    sentCheck: 'h-5 w-5 text-primary-300',
    sentTitle: 'mt-5 text-xl font-semibold text-white',
    sentBlurb: 'mx-auto mt-3 max-w-[40ch] text-sm leading-relaxed text-slate-400',
    done: 'mt-7 text-sm font-semibold text-primary-300 hover:text-primary-200',
    invalid: 'text-sm text-amber-300',
    failed: 'rounded-lg bg-amber-400/10 p-3 text-sm leading-relaxed text-amber-200 ring-1 ring-inset ring-amber-400/20',
  },
  light: {
    overlay: 'fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto bg-gray-900/50 p-4 sm:items-center',
    panel: 'relative w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl ring-1 ring-inset ring-gray-200 focus:outline-none sm:p-8',
    title: 'pr-8 text-xl font-semibold tracking-[-0.01em] text-gray-900',
    blurb: 'mt-2.5 text-sm leading-relaxed text-gray-600',
    label: 'block text-xs font-medium uppercase tracking-wider text-gray-500',
    field: 'w-full rounded-lg border-0 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 ring-1 ring-inset ring-gray-300 transition-colors placeholder:text-gray-400 hover:ring-gray-400 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary-500 disabled:opacity-60',
    close: 'absolute right-3 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
    cancel: 'rounded-lg px-4 py-2.5 text-sm font-semibold text-gray-600 transition-colors hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500',
    sentIcon: 'mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary-50 ring-1 ring-inset ring-primary-200',
    sentCheck: 'h-5 w-5 text-primary-600',
    sentTitle: 'mt-5 text-xl font-semibold text-gray-900',
    sentBlurb: 'mx-auto mt-3 max-w-[40ch] text-sm leading-relaxed text-gray-600',
    done: 'mt-7 text-sm font-semibold text-primary-600 hover:text-primary-700',
    invalid: 'text-sm text-amber-700',
    failed: 'rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-800 ring-1 ring-inset ring-amber-200',
  },
}

export function AccessRequestDialog({
  topic, onClose, fallbackEmail, tone = 'dark',
}: AccessRequestDialogProps) {
  const [status, setStatus] = useState<Status>('idle')
  const [invalid, setInvalid] = useState<string[]>([])
  const [values, setValues] = useState({
    'bot-field': '',
    topic,
    name: '',
    email: '',
    firm: '',
    role: '',
    note: '',
  })

  const titleId = useId()
  const blurbId = useId()
  /* Focus goes to the first field, not the first focusable element, which is
     the close button in the corner. The primitive takes the ref rather than
     guessing. */
  const firstFieldRef = useRef<HTMLInputElement>(null)

  const set = (field: string) => (event: { target: { value: string } }) =>
    setValues(previous => ({ ...previous, [field]: event.target.value }))

  const submit = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault()

      /*
       * Validated here rather than left to `required` and `type="email"`.
       * Native constraint validation is not implemented in jsdom, so a test
       * can submit an empty form and watch it "succeed", which makes the
       * browser the only place the rule exists. Two fields, checked in code.
       */
      const missing = [
        ...(values.name.trim() ? [] : ['name']),
        ...(/.+@.+\..+/.test(values.email.trim()) ? [] : ['email']),
      ]
      setInvalid(missing)
      if (missing.length) return

      setStatus('sending')
      const body = new URLSearchParams()
      body.set('form-name', ACCESS_REQUEST_FORM_NAME)
      for (const field of ACCESS_REQUEST_FIELDS) {
        body.set(field, (values as Record<string, string>)[field] ?? '')
      }

      try {
        const response = await fetch(ACCESS_REQUEST_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
        })
        setStatus(response.ok ? 'sent' : 'failed')
      } catch {
        setStatus('failed')
      }
    },
    [values],
  )

  const heading = HEADINGS[topic]
  const sending = status === 'sending'
  const t = TONES[tone]

  return (
    <Dialog
      labelledBy={titleId}
      describedBy={blurbId}
      onClose={onClose}
      initialFocusRef={firstFieldRef}
      overlayClassName={t.overlay}
      panelClassName={t.panel}
      data-testid="access-request-dialog"
    >
      <>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className={t.close}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>

        {status === 'sent' ? (
          <div className="py-4 text-center" data-testid="access-request-sent">
            <div className={t.sentIcon}>
              <Check className={t.sentCheck} aria-hidden="true" />
            </div>
            <h2 id={titleId} className={t.sentTitle}>
              Request received
            </h2>
            <p id={blurbId} className={t.sentBlurb}>
              Thank you. We will follow up at the address you gave us.
            </p>
            {/* "Done", not "Close". The corner control is already named
                Close, and two buttons with the same accessible name in one
                dialog is read out twice with nothing to tell them apart.
                Verified in a browser: the success panel had exactly that. */}
            <button type="button" onClick={onClose} className={t.done}>
              Done
            </button>
          </div>
        ) : (
          <>
            <h2 id={titleId} className={t.title}>
              {heading.title}
            </h2>
            <p id={blurbId} className={t.blurb}>
              {heading.blurb}
            </p>

            <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
              {/* The honeypot. Off-screen rather than display:none, because a
                  field that is not laid out at all is the pattern the cruder
                  bots already skip. Untabbable and hidden from the a11y tree,
                  so it is invisible to a person using either a mouse or a
                  screen reader. */}
              <div className="pointer-events-none absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden" aria-hidden="true">
                <label htmlFor={`${titleId}-bot`}>Leave this field empty</label>
                <input
                  id={`${titleId}-bot`}
                  name="bot-field"
                  tabIndex={-1}
                  value={values['bot-field']}
                  onChange={set('bot-field')}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor={`${titleId}-name`} className={t.label}>
                    Name
                  </label>
                  <input
                    ref={firstFieldRef}
                    id={`${titleId}-name`}
                    name="name"
                    autoComplete="name"
                    disabled={sending}
                    aria-invalid={invalid.includes('name') || undefined}
                    value={values.name}
                    onChange={set('name')}
                    className={`mt-1.5 ${t.field}`}
                  />
                </div>
                <div>
                  <label htmlFor={`${titleId}-email`} className={t.label}>
                    Work email
                  </label>
                  <input
                    id={`${titleId}-email`}
                    name="email"
                    type="email"
                    autoComplete="email"
                    disabled={sending}
                    aria-invalid={invalid.includes('email') || undefined}
                    value={values.email}
                    onChange={set('email')}
                    className={`mt-1.5 ${t.field}`}
                  />
                </div>
                <div>
                  <label htmlFor={`${titleId}-firm`} className={t.label}>
                    Firm
                  </label>
                  <input
                    id={`${titleId}-firm`}
                    name="firm"
                    autoComplete="organization"
                    disabled={sending}
                    value={values.firm}
                    onChange={set('firm')}
                    className={`mt-1.5 ${t.field}`}
                  />
                </div>
                <div>
                  <label htmlFor={`${titleId}-role`} className={t.label}>
                    Role
                  </label>
                  <input
                    id={`${titleId}-role`}
                    name="role"
                    autoComplete="organization-title"
                    disabled={sending}
                    value={values.role}
                    onChange={set('role')}
                    className={`mt-1.5 ${t.field}`}
                  />
                </div>
              </div>

              <div>
                <label htmlFor={`${titleId}-note`} className={t.label}>
                  Anything we should know
                </label>
                <textarea
                  id={`${titleId}-note`}
                  name="note"
                  rows={3}
                  disabled={sending}
                  value={values.note}
                  onChange={set('note')}
                  className={`mt-1.5 resize-none ${t.field}`}
                />
              </div>

              {invalid.length > 0 && (
                <p role="alert" className={t.invalid} data-testid="access-request-invalid">
                  {invalid.includes('name') && invalid.includes('email')
                    ? 'Please add your name and a work email so we can reply.'
                    : invalid.includes('name')
                      ? 'Please add your name.'
                      : 'Please add a work email we can reply to.'}
                </p>
              )}

              {status === 'failed' && (
                <div role="alert" className={t.failed} data-testid="access-request-failed">
                  <p>That did not send. Nothing has been lost, so you can try again.</p>
                  {fallbackEmail && (
                    <p className="mt-1.5">
                      If it keeps failing, write to{' '}
                      <a href={`mailto:${fallbackEmail}?subject=${encodeURIComponent(heading.title)}`} className="font-medium underline">
                        {fallbackEmail}
                      </a>{' '}
                      instead.
                    </p>
                  )}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={sending}
                  className={t.cancel}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={sending}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary-950/50 transition-colors hover:bg-primary-500 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400 disabled:opacity-60"
                >
                  {sending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  {sending ? 'Sending' : status === 'failed' ? 'Try again' : 'Send request'}
                </button>
              </div>
            </form>
          </>
        )}
      </>
    </Dialog>
  )
}

export default AccessRequestDialog
