# Rotating an organization's BYOK provider key

## When to run this

Run it now, once, for every organization that had a key stored before
`20261110020000_sec_byok_key_into_vault.sql`. Those keys were readable by
**every active member** of the organization, not just admins, through a
`SECURITY DEFINER` RPC whose EXECUTE was granted to `authenticated`. The
migration moves them into Vault so the pilot does not break; it does not make
them safe. A key that was readable by a role that should never have seen it is
a compromised key, and the only remedy is a new key from the provider.

Run it again whenever:

- someone leaves an organization that uses BYOK;
- a key is pasted anywhere outside the Settings form (a ticket, a chat, a
  screenshot, a log);
- the provider reports usage the organization does not recognise.

## What you cannot do, and why

There is no way to read the stored key back out of Tesseract, by design. The
only reader is `resolve_org_ai_config(uuid)`, and its EXECUTE is granted to
`service_role` alone, which no browser and no signed-in user ever holds. So
rotation is **not** "copy the old key somewhere and compare." It is: mint a new
key at the provider, paste it into Tesseract, then revoke the old one at the
provider.

That order matters. Revoking first leaves the organization without AI between
the revoke and the paste.

## Procedure

1. **Mint the replacement at the provider.**
   Anthropic: <https://console.anthropic.com/settings/keys> -> Create Key.
   Name it so you can tell it apart from the key you are replacing, e.g.
   `tesseract-<org slug>-2026-11`. Copy it once; the console will not show it
   again.

2. **Paste it into Tesseract.**
   Sign in as an **organization admin** of that organization (not a platform
   admin acting from the ops portal, which has no path to this form).
   Settings -> AI -> paste into the API key field -> **Save and verify**.

   That button does three things in order: stores the key in Vault through
   `set_org_ai_api_key`, then sends one real question through the deployed
   `ai-chat` function, then reports whether the provider answered. If it
   reports success, the new key is live and the old key is no longer being
   used by Tesseract.

   If it reports a failure, **stop and do not revoke the old key.** The old
   key is still in Vault only if the store step itself failed; if the store
   succeeded and the provider call failed, the organization is already on the
   new key and the failure is upstream (wrong key, provider outage, no
   credit). Re-run step 1 if the key itself is suspect.

3. **Revoke the old key at the provider.**
   Back at the Anthropic console, delete the key you replaced. Do this only
   after step 2 reported success. Until you do, the compromised key still
   works for anyone who holds it.

4. **Confirm the organization is still being metered.**
   Ask one question in the app, then check that a row appeared:

   ```sql
   select created_at, model, provider, total_tokens, estimated_cost
   from public.ai_usage_log
   where organization_id = '<org id>'
   order by created_at desc
   limit 5;
   ```

   A new row with a non-zero `total_tokens` confirms the whole path: auth,
   key resolution out of Vault, the provider call, and cost attribution.

## Turning BYOK off for an organization

Clearing is a separate action from rotating. Settings -> AI -> Clear key calls
`clear_org_ai_api_key`, which deletes the Vault row, nulls the pointer, and
sets `byok_enabled = false`. The configuration row survives so the provider
and model choice are still there if the organization comes back. Clearing in
Tesseract does **not** revoke anything at the provider; do step 3 as well.

## Verifying the custody properties yourself

If you want to confirm the key really is unreadable rather than take this
document's word for it, `supabase/tests/ai-byok-key-vault.sql` asserts it
against the live database: a member cannot store a key, neither a member nor
an admin can execute the resolver, `anon` can do neither, the plaintext column
no longer exists, and `authenticated` cannot read `vault.decrypted_secrets`.
Run it with:

```
node scripts/security-suite.mjs ai-byok-key-vault <project ref>
```

It needs `SUPABASE_ACCESS_TOKEN` in the environment and prints one line per
assertion. The suite stores and destroys its own fake keys and prints no
secret values.
