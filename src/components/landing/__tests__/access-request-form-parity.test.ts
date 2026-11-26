/**
 * The static form declaration and the dialog's field list must agree.
 *
 * ── Why this test is the important one in this directory ─────────────────
 *
 * Build-time form detection parses the HTML files in a deploy and records
 * only the fields declared there. A field the dialog POSTs that the static
 * form does not declare is dropped on arrival, and the response is still a
 * 200. So the visitor sees "Request received", the submission appears in the
 * dashboard with the firm name missing, and nothing anywhere reports an
 * error. There is no runtime signal to notice.
 *
 * It is also a failure that cannot happen in local testing, because the
 * endpoint does not exist locally at all. Static parity is the only place the
 * mismatch can be observed before a prospect's details are silently lost.
 *
 * Both directions are checked, because both break:
 *
 *   - a field posted but not declared is dropped, as above;
 *   - a field declared but not posted means the form was changed in one place
 *     and the other was forgotten, which is the same editing mistake caught
 *     one step earlier.
 *
 * This reads the HTML as text rather than through a DOM. It is deployment
 * markup, not a component, and it is never rendered by the app.
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ACCESS_REQUEST_FIELDS,
  ACCESS_REQUEST_FORM_NAME,
} from '../access-request-contract'

const HTML_PATH = join(process.cwd(), 'public', 'forms', 'access-request.html')

const html = () => readFileSync(HTML_PATH, 'utf8')

/** Every `name="..."` inside the static form, in document order. */
function declaredFields(markup: string): string[] {
  const form = markup.match(/<form[\s\S]*?<\/form>/)?.[0] ?? ''
  const names: string[] = []
  for (const match of form.matchAll(/<(?:input|textarea|select)\b[^>]*\bname="([^"]+)"/g)) {
    names.push(match[1])
  }
  return names
}

describe('the static form declaration', () => {
  it('declares exactly the fields the dialog posts', () => {
    expect(declaredFields(html()).sort()).toEqual([...ACCESS_REQUEST_FIELDS].sort())
  })

  it('carries the form name the dialog posts under', () => {
    // The POST body's `form-name` has to match this attribute or the
    // submission is not attributed to any form and is rejected.
    expect(html()).toMatch(new RegExp(`<form[^>]*\\bname="${ACCESS_REQUEST_FORM_NAME}"`))
  })

  it('opts the form into host-side handling', () => {
    // Without this attribute the file is just an HTML page with a form in it:
    // nothing detects it, and every submission 404s on a real deploy while
    // every local test still passes.
    expect(html()).toMatch(/<form[^>]*\bdata-netlify="true"/)
  })

  it('names the honeypot field so the host discards bot submissions', () => {
    // Declaring the honeypot is what makes it work upstream. The field
    // rendering off-screen in the dialog only hides it from people.
    expect(html()).toMatch(/\bnetlify-honeypot="bot-field"/)
    expect(declaredFields(html())).toContain('bot-field')
  })

  it('keeps the declaration out of the rendered page and out of search', () => {
    expect(html()).toMatch(/<form[^>]*\bhidden\b/)
    expect(html()).toMatch(/<meta[^>]*name="robots"[^>]*content="noindex"/)
  })
})
