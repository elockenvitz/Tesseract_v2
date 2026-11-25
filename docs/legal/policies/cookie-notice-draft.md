# Cookie and Local Storage Notice — DRAFT, NOT LEGAL REVIEWED

**Document id:** `cookie-notice` · **Version:** 0.1.0-draft ·
**Effective:** not in effect

> **Counsel-review draft. Not in effect, binds nobody, not approved.**

Operated by **[LEGAL ENTITY NAME]**.

---

## The short version

**Tesseract sets no cookies.** It uses browser local storage for two things:
keeping you signed in, and remembering how you have set the interface up.

There is no analytics, no advertising, no tracking pixel and no third-party
marketing technology anywhere in this product or on its website. So there is
nothing here to consent to, and there is no consent banner.

---

## How this was established

This is a factual document, not a template, and the method is given so it can
be re-checked:

| Check | Method | Result (2026-11-25) |
|---|---|---|
| Cookies set by the application | `grep` for `document.cookie` across `src/` and `supabase/functions/` | **no occurrences** |
| Cookies present in a live browser session | `document.cookie` read on the running site | **empty** |
| Third-party analytics, tag managers, pixels | `grep` for Google Analytics / GTM, Mixpanel, Segment, PostHog, Plausible, Fathom, Hotjar, Meta and LinkedIn pixels across `src/`, `index.html`, `netlify.toml` | **none present**. The only textual matches were the English word "plausible" in comments, `segment.` in chart code, and one commented-out `posthog.capture(...)` example line in `src/features/assets/actionLoop/actionLoopTelemetry.ts` — no analytics SDK is installed or loaded |
| Content Security Policy | `index.html` `connect-src` | permits only our own origin, Supabase, the AI providers, Alpha Vantage and Sentry. No analytics or ad domain is reachable even if code tried |
| Browser storage keys | enumerated in a live session and by `grep` | ~29 distinct key patterns, all first-party, listed below |
| Service workers | `navigator.serviceWorker.getRegistrations()` | none |

> **★ For counsel.** The conclusion "no consent banner is required" follows
> from there being no non-essential tracking, rather than from a judgement that
> consent law does not apply. If analytics or any marketing technology is ever
> added, this document and the consent position both change, and the
> engineering note below says so in the place a developer will see it.

---

## 1. Cookies

We set none.

If a cookie ever appears, it will be set by our hosting provider at the HTTP
layer rather than by the application. **Not independently verified:** whether
Netlify sets any cookie of its own on the production domain — this was checked
against the local development server, which does not run behind Netlify's edge.
It is listed as an open item below and must be checked on the real domain
before publication.

## 2. Browser local storage — strictly necessary

| Purpose | What is stored |
|---|---|
| **Authentication session** | The Supabase session token for your signed-in session, under a key Supabase manages. Without it you would be signed out on every page load. |
| **Single sign-on handshake** | Short-lived values used to complete an SSO redirect securely: `sso_state`, `sso_nonce`, `sso_code_verifier`, `sso_org_id`. These are a security control — they are what prevents an SSO response being replayed or substituted. |
| **Signed-in user cache** | `auth-user-cache`, a cached copy of your own account record so the interface can render before the network answers. |

These cannot be switched off while using the product, because the product
cannot function without them. In the common framing of consent law, they are
"strictly necessary".

## 3. Browser local storage — your interface preferences

Stored so the application looks the way you left it. Examples, not exhaustive:

- theme (`tesseract-theme-v2`), table density (`table-density`)
- which panels, groups and tree nodes you have collapsed
- your open tabs and their state
- recently viewed assets, recent hashtags and mentions, recent command-palette
  entries
- which onboarding or guidance steps you have completed or dismissed

**These keys can contain your user identifier and your organisation's
identifier as part of the key name**, so that two people sharing a browser
profile, or one person working across two organisations, do not overwrite each
other's settings. That is their purpose; it also means the identifiers are
present in your browser's storage.

Preferences are not transmitted to any third party. Clearing your browser
storage removes them, and the application will behave as though you were a new
visitor — you will be signed out, and your layout will reset.

## 4. What we do not do

- No analytics or audience measurement, first-party or third-party.
- No advertising, no remarketing, no conversion pixels, no cross-site tracking.
- No social media widgets or embedded third-party content on the marketing
  pages.
- No web fonts loaded from a third party — the site uses the fonts already on
  your device.
- No fingerprinting.
- No sale or sharing of personal information, in the sense those terms carry
  under US state privacy laws.

## 5. Error monitoring, which is not storage but belongs here

The application uses **Sentry** for error monitoring. It is not analytics and it
does not track you across sites, but it does send diagnostic data when
something goes wrong, and on an errored session it records a masked replay of
the page.

That is described properly in the
[privacy policy](./privacy-policy-draft.md), not here, because it is a
transmission to a third party rather than browser storage. It is mentioned here
only so that this document is not read as saying "nothing leaves your browser".

## 6. Your choices

Because everything above is either strictly necessary or your own saved
preferences, there is no consent choice to offer and no toggle that would do
anything.

You can clear or block local storage through your browser's settings. If you
block it for this site, you will not be able to stay signed in.

## 7. Changes

If we add any technology that is not strictly necessary — analytics in
particular — this notice will be updated **and** an appropriate consent
mechanism will be implemented before that technology runs. We will not ship a
banner whose toggles do not control real behaviour.

## 8. Contact

**[PRIVACY CONTACT EMAIL]**

---

## Engineering note — keep this document true

It is only useful while accurate, and it is the kind of document that rots
silently. Re-check it when you:

- add any third-party script, SDK, tag or pixel → this notice and the
  consent position both change
- add `document.cookie` anywhere → §1 becomes false
- add a storage key that holds anything beyond a preference or a session → §3
  needs amending
- change the CSP `connect-src` list → the fourth row of the method table

A notice that says "no tracking" while an analytics SDK is installed is a
misrepresentation, not a stale document.

## Open items before this can be published

1. Entity name and privacy contact email.
2. **Check the production domain for hosting-layer cookies** (Netlify edge).
   Only the local development server was checked.
3. Counsel's confirmation that "no non-essential technology, therefore no
   consent mechanism" is the right conclusion for the chosen governing law and
   for any jurisdiction where visitors are expected.
