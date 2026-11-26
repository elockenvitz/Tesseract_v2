/**
 * The terms acceptance control. GATED OFF, and designed to stay off safely.
 *
 * ── Read this before enabling it ─────────────────────────────────────────
 *
 * `isTermsAcceptanceEnabled()` is false today and returns false unless THREE
 * conditions hold at once: the flag is set, every acceptance-required document
 * is `approved`, and publication is on. Until then this component renders
 * `null` and no user is ever asked to accept anything.
 *
 * That is deliberate, and the reason is not caution. Showing this control
 * today would create a database record saying 28 users accepted a document no
 * lawyer has read. A record of consent to a draft is worse than no record,
 * because it looks like consent and would be relied on.
 *
 * ── What the design gets right, and what each choice rules out ───────────
 *
 *  1. **Unchecked.** No `defaultChecked`. A pre-ticked box is not an
 *     affirmative act and is the single most common reason a clickwrap is held
 *     unenforceable.
 *
 *  2. **The links are real and they open the documents.** A checkbox over a
 *     document the user cannot read is unenforceable in most jurisdictions,
 *     which is why `isTermsAcceptanceEnabled()` requires publication to be on
 *     rather than leaving it to a release checklist.
 *
 *  3. **It blocks.** The parent's submit is disabled until `accepted` is true
 *     AND the server write has succeeded. There is no "accept later".
 *
 *  4. **It fails closed.** A failed write shows an error and does NOT let the
 *     user continue. The tempting alternative -- let them in, write the record
 *     in the background -- produces a user who believes they accepted and no
 *     record that they did, which is the exact failure this exists to prevent.
 *
 *  5. **It does not bind an employer.** The text says the person is accepting
 *     on their own behalf as an authorised user. An individual ticking a box
 *     does not commit a regulated investment firm to a liability cap or an
 *     indemnity, and the schema deliberately cannot record that it did.
 *     Organisation-level commitment is a signed MSA.
 *
 *  6. **One checkbox, two documents, and nothing else bundled.** Both
 *     documents create obligations for the individual. The privacy policy is
 *     linked but NOT in the checkbox: it is a notice, and bundling a
 *     disclosure into an "I agree" misrepresents what it is. Nothing about
 *     marketing is in here at all.
 */

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertCircle } from 'lucide-react'
import {
  documentsRequiringAcceptance,
  legalPath,
  LEGAL_DOCUMENTS,
} from '../../legal/documents'
import { isTermsAcceptanceEnabled } from '../../legal/publication'
import { recordAcceptance } from '../../legal/acceptance'

export interface TermsAcceptanceProps {
  /** The organisation the user is acting in, or null at signup. */
  organizationId: string | null
  /**
   * Called with whether the user may proceed.
   *
   * True ONLY after every required document's acceptance has been written to
   * the server. The parent must use this to gate its submit; a parent that
   * ignores it defeats the whole component, which is why the test asserts the
   * callback is never called with true before a successful write.
   */
  onAcceptedChange: (accepted: boolean) => void
}

export function TermsAcceptance({ organizationId, onAcceptedChange }: TermsAcceptanceProps) {
  const enabled = isTermsAcceptanceEnabled()
  const [checked, setChecked] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The gate. Renders nothing at all rather than a disabled control: a greyed
   * out "I accept the terms" box tells a user that terms exist and that
   * something is broken, and both are worse than the box being absent while
   * the documents are in preparation.
   */
  if (!enabled) return null

  const documents = documentsRequiringAcceptance()
  const privacy = LEGAL_DOCUMENTS.find(d => d.id === 'privacy-policy')

  async function handleChange(next: boolean) {
    setError(null)
    setChecked(next)

    if (!next) {
      onAcceptedChange(false)
      return
    }

    setSaving(true)
    try {
      for (const document of documents) {
        const result = await recordAcceptance({ document, organizationId })
        if (!result.ok) {
          /*
           * Fail closed, loudly. The box is un-ticked so the state on screen
           * matches the state on the server -- leaving it ticked after a
           * failed write would show the user an acceptance that does not
           * exist.
           */
          setChecked(false)
          onAcceptedChange(false)
          setError(
            result.reason === 'not_authenticated'
              ? 'Your session has expired. Please sign in again.'
              : 'We could not record your acceptance. Please try again.',
          )
          return
        }
      }
      onAcceptedChange(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="terms-acceptance" className="space-y-2">
      <label className="flex cursor-pointer items-start gap-3 text-sm">
        <input
          type="checkbox"
          data-testid="terms-acceptance-checkbox"
          checked={checked}
          disabled={saving}
          onChange={e => void handleChange(e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-none rounded border-gray-300 text-gray-900 focus:ring-gray-900"
        />
        <span className="leading-relaxed text-gray-700 dark:text-gray-300">
          I have read and accept the{' '}
          {documents.map((doc, i) => (
            <span key={doc.id}>
              {i > 0 && (i === documents.length - 1 ? ' and the ' : ', ')}
              <Link
                to={legalPath(doc.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                {doc.title}
              </Link>
            </span>
          ))}
          , on my own behalf as an authorised user.
          {privacy && (
            <>
              {' '}
              Our{' '}
              <Link
                to={legalPath(privacy.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium underline"
              >
                {privacy.title}
              </Link>{' '}
              explains how we handle personal information.
            </>
          )}
        </span>
      </label>

      {saving && (
        <p className="pl-7 text-xs text-gray-500">Recording your acceptance…</p>
      )}

      {error && (
        <p
          role="alert"
          data-testid="terms-acceptance-error"
          className="flex items-start gap-2 pl-7 text-xs text-red-600"
        >
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />
          {error}
        </p>
      )}
    </div>
  )
}

export default TermsAcceptance
