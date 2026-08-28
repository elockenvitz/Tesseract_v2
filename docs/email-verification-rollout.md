# Email ownership verification — what changes, and the order it changes in

Turning `mailer_autoconfirm` off is one setting. Doing it without stranding
people is this document.

Everything below marked **verified** was measured against a live Supabase
project, not read from documentation. Staging was used for every experiment and
restored to its prior configuration afterwards; production configuration was
read and never written.

---

## 1. What the boundary is today

A platform admin creates an invitation and sends the link. To get in, the
recipient must present:

- **the token** — 122 bits of `gen_random_uuid()` that only ever travelled to
  the invited mailbox, and
- **the identity** — an authenticated session whose `auth.users.email` equals
  the invited address.

`accept_org_invite()` also checks `email_confirmed_at`. That check has been in
place since PR #213 and, until now, **has never refused anything**:
`mailer_autoconfirm` is on, so every identity is stamped at signup without
anyone opening an email.

So the honest statement of today's boundary is: *possession of a link sent to
the mailbox*, not *control of the mailbox*. Someone who obtains the link by any
other route — a forwarded email, a screenshot, a Slack paste, a shared laptop —
can sign up as the invited address and walk in, because signup is open and
autoconfirm stamps them as confirmed on the spot.

## 2. What the boundary becomes

Membership additionally requires a session, and Supabase will not issue a
session to an unconfirmed identity. **Verified (L2):** password sign-in for an
unconfirmed identity returns `400 email_not_confirmed` with no token. So an
unverified person does not merely fail at acceptance — they never reach the
application at all.

The three facts are then independent: the token proves the link reached them,
the address match proves they are the invitee, and the confirmation proves they
control the inbox.

---

## 3. The journey, and where it used to break

```
  /invite/:token
      ↓  create account
  signUp(emailRedirectTo = /invite/:token)     ← was missing entirely
      ↓  Supabase emails a confirmation link
  <project>/auth/v1/verify?...&redirect_to=…/invite/:token
      ↓  303
  /invite/:token#access_token=…&type=signup    ← detectSessionInUrl
      ↓  session established, email matches
  accept_org_invite(token)
      ↓
  /dashboard
```

Two things broke it, and both were silent:

**No `emailRedirectTo`.** Supabase falls back to the project's `site_url`. The
recipient arrives confirmed, signed in, and looking at a "no workspace" screen
with a perfectly good invitation they can no longer reach.

**A `sessionStorage`-only token stash.** `sessionStorage` is scoped to a *tab*.
A confirmation link opened from a mail client is a brand-new tab with a
brand-new, empty `sessionStorage` — so the fallback was absent from exactly the
one journey it existed to serve.

### The redirect allow-list is load-bearing, and fails silently

**Verified.** With `redirect_to` pointing at `https://<app>/invite/<token>`:

| project `uri_allow_list` | link the recipient receives |
|---|---|
| `https://<app>` only | `redirect_to=https://<app>` — **invitation lost** |
| `https://<app>`, `https://<app>/invite/*` | `redirect_to=https://<app>/invite/<token>` — correct |

The signup request returns `200` in both cases. Nothing errors, nothing logs.
The only symptom is a person who cannot get in.

---

## 4. How the token survives the round trip

Three carriers, deliberately redundant, because they fail in different places.

| carrier | covers | fails when |
|---|---|---|
| the URL path | refresh, history, re-opening the link | they navigate away |
| `emailRedirectTo` | **a different browser, a different device** | the allow-list lacks the entry |
| `localStorage` + `sessionStorage` | a mail client that rewrites the link | private mode, cleared storage |

`emailRedirectTo` is the load-bearing one — it is the only mechanism that works
when the mail is opened somewhere that has never seen this invitation. The
stash is the fallback, TTL-bounded to 24h (tracking `mailer_otp_exp`) and
cleared on acceptance and on any invitation that turns out to be unusable.

**Is a token in `localStorage` a regression?** It is on the recipient's own
device, holding a value already sitting in their mailbox, their URL bar and
their browser history. It is not a credential: presenting it still requires a
session on a confirmed identity holding the invited address. The residual
exposure is that a later user of a shared browser could see an organization
name and an email address — the same thing the history entry already shows —
and the TTL plus the clear-on-terminal-state bound it.

**Open redirect.** The redirect URL is built from the running origin and a
token that has already been shape-checked against a UUID pattern; nothing a
caller supplies reaches the host half of the URL. Covered by test.

---

## 5. Production configuration required

None of this has been applied. It is what the rollout applies.

### A. Custom SMTP — **required, and the flip must not precede it**

**Verified.** With confirmation on and the default mailer:

- a third signup within an hour returns `429 over_email_send_rate_limit`, and
  **no user row is created** — the person cannot make an account at all;
- an address the mailer cannot deliver to returns `400 email_address_invalid`.

`rate_limit_email_sent` is **2 per hour, project-wide**. That is not a slow
pilot; it is a broken front door from the third invitee onward.

| setting | value | why |
|---|---|---|
| provider | Resend, Postmark, SES or similar | the default mailer is not a production sender |
| sender | `no-reply@<verified-domain>` | a `@gmail.com` sender fails DMARC and lands in spam |
| domain auth | SPF + DKIM (and DMARC) on the sending domain | required for deliverability at the funds we are inviting |
| `smtp_sender_name` | `Tesseract` | |
| `rate_limit_email_sent` | **≥ 100/hour** | 2 is the blocker above; 100 covers a cohort plus resends |
| `smtp_max_frequency` | 60s (unchanged) | matched by the UI's resend cooldown |

### B. Redirect allow-list

```
https://tesseract2025.netlify.app
https://tesseract2025.netlify.app/invite/*
http://localhost:5173
http://localhost:5173/invite/*
```

The `/invite/*` entries are the fix for §3. Add the localhost pair only if
local development against production auth is wanted; the deployed host pair is
mandatory.

### C. Site URL

`https://tesseract2025.netlify.app` — already correct.

### D. Confirmation email template

The current template is Supabase's stock copy ("Confirm your signup"). It
should say who is writing and what it is for, because the recipient was invited
by a person, not by a service:

> **Confirm your email to join Tesseract**
> You were invited to a Tesseract workspace. Confirm this address and we'll
> take you straight back to your invitation.
> [Confirm email address]({{ .ConfirmationURL }})

Not blocking, but do it in the same change — the stock template arriving from an
unfamiliar domain is what makes people report an invitation as phishing.

### E. Not changed, and deliberately

`disable_signup` stays `false`. It is what lets an invitee create their own
account from `/invite/:token`. It is much less dangerous after this change:
an unsolicited signup now cannot obtain a session without proving an inbox, and
still acquires no organization (suite check 9). Worth revisiting separately, not
here.

---

## 6. Existing pilots

**Verified against production, read-only:** 27 auth identities, **0**
unconfirmed. `mailer_autoconfirm` changes the behaviour of *new* signups and
email changes only — it does not revoke sessions and does not clear
`email_confirmed_at`. Nobody is signed out and nobody loses access.

The `email_confirmed_at` on those 27 was stamped by autoconfirm, not by anyone
opening an email, so it is not evidence of anything. That is why the frozen
`early_access_grandfathered_identities` set (24 rows) waives the confirmation
check for identities that predate enforcement — and why suite check 48 proves
the waiver is wired to acceptance rather than merely recorded in a table.

---

## 7. Rollout order

The order exists to avoid a window where an invitee is stranded. Each step is
safe to sit at indefinitely.

| # | step | why here | rollback |
|---|---|---|---|
| **A** | Deploy this branch | Works under autoconfirm on *and* off (e2e covers both). `emailRedirectTo` is inert while autoconfirm is on — no email is sent. Nothing observable changes. | revert the deploy |
| **B** | Add the `/invite/*` allow-list entries | Must precede any email being sent, or confirmations point at the site root. Inert while autoconfirm is on. | remove the entries |
| **C** | Configure custom SMTP, verify the sending domain | Must precede the flip: §5A shows the default mailer breaks signup outright. | clear SMTP (back to default mailer) |
| **D** | Raise `rate_limit_email_sent` to ≥100 | Same reason. Separate step because it is a separate failure (429, not a bad address). | lower it |
| **E** | Send yourself a real test invitation, end to end | The first real email. Confirms deliverability, sender reputation, template, and that the link returns to `/invite/:token`. **Do not proceed if the mail lands in spam.** | — |
| **F** | `mailer_autoconfirm = false` | Everything it depends on is now in place. | set it back to `true` — see below |
| **G** | Verify | See below. | |

**Steps A–E change nothing observable for anyone.** The boundary moves at F, and
only at F.

### Step F takes time to land

**Verified:** the Management API accepts the change and reads it back
immediately, while the running auth service continues to autoconfirm for
several seconds (~6–7s observed on staging). During that window the dashboard
says verification is on and it is not.

Poll the running service, not the dashboard:

```
GET https://<ref>.supabase.co/auth/v1/settings   (apikey: anon)
  → { "mailer_autoconfirm": false, ... }
```

### Step G — production verification

1. `GET /auth/v1/settings` reports `mailer_autoconfirm: false`.
2. Create a real invitation to an address you control; complete the whole
   journey in a browser that has never seen the app, and again on a phone.
3. Confirm the email arrives in the inbox, not spam, from the verified domain.
4. Re-run the entry-security suite against production:
   `node scripts/invite-security-test.mjs <prod-ref>` — 47/47.
5. Confirm an existing pilot signs in normally.
6. `select count(*) from auth.users where email_confirmed_at is null` → expect
   only genuinely-pending new signups.

### Rollback

Set `mailer_autoconfirm = true` (poll `/auth/v1/settings` to confirm it landed).
That restores the previous boundary immediately and strands nobody: identities
confirmed while it was off stay confirmed, and identities awaiting confirmation
become able to sign in. The frontend, the allow-list and SMTP can all stay —
they are inert under autoconfirm — so rollback is one setting, not a redeploy.

Steps B, C and D roll back independently and are individually harmless.

---

## 8. Remaining risks

**Deliverability is the real one.** Every risk left is a mail risk, and mail is
the part we do not control. A confirmation that lands in a fund's quarantine is
indistinguishable, to the invitee, from a broken product. Step E exists to find
this before a pilot does; a warmed sending domain and DMARC alignment are what
reduce it.

**Corporate link scanners.** Some security gateways fetch every URL in an
inbound mail. A scanner that follows the confirmation link consumes it —
single-use — and the recipient then clicks a dead link. The resend button is the
mitigation, and the reason it is prominent rather than tucked away. If a pilot
reports this, the durable fix is an OTP code instead of a link.

**Rate limit under a burst.** 100/hour covers a normal cohort. Onboarding a
large fund in one sitting, with resends, could still touch it. Watch the first
real cohort rather than guessing the number now.

**Open signup remains.** Anyone can still create an account; they simply cannot
reach a workspace. Tightening it is a separate decision (§5E).

**`localStorage` on a shared browser.** Bounded by the 24h TTL and cleared on
terminal states, and it discloses nothing the browser history does not. Noted,
not mitigated further.

---

## 9. Evidence

| claim | where it is proven |
|---|---|
| unconfirmed identity cannot accept; confirming is what changes the answer | suite check 44 |
| correct address without the token acquires nothing | suite check 45 |
| the token then works for that same person | suite check 46 |
| replay is idempotent and errorless | suite check 47 |
| a grandfathered pilot is not locked out | suite check 48 |
| the page asks for the right `emailRedirectTo` | `e2e/invite-entry.spec.ts` |
| the token survives into a new tab | `e2e/invite-entry.spec.ts` |
| the stash survives a mail client, a TTL, a broken storage | `src/lib/__tests__/invites.test.ts` |
| the whole journey, live, with verification on | `L1`–`L10`, §Staging results in the PR |
