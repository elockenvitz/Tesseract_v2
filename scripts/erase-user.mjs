#!/usr/bin/env node
/**
 * Erase one person's personal data.
 *
 * Two steps that must happen in this order:
 *   1. erase_user_personal_data() — the public schema: preferences, saved
 *      views, notifications, AI history, and the identity on the users row
 *   2. auth.admin.deleteUser()    — the login itself
 *
 * Order matters. Deleting the auth identity first can cascade or orphan the
 * public.users row depending on how the project is wired, and then step 1 has
 * nothing to anonymise — leaving the person's name attached to their authored
 * records with no way left to reach it.
 *
 * What this does NOT delete is the work they authored: notes, theses, ratings,
 * trade decisions. Those are the customer firm's business records, and for an
 * SEC-registered adviser, records it is required to retain. They stay,
 * attributed to "Former user". This is exactly what the privacy policy
 * describes — if you change one, change the other.
 *
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     node scripts/erase-user.mjs --email=someone@firm.com
 *
 *   ... --email=someone@firm.com --confirm=someone@firm.com --apply
 */

import { createClient } from '@supabase/supabase-js'

const arg = n => (process.argv.find(a => a.startsWith(`--${n}=`)) || '').split('=').slice(1).join('=')
const EMAIL = arg('email')
const CONFIRM = arg('confirm')
const APPLY = process.argv.includes('--apply')

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.')
  process.exit(1)
}
if (!EMAIL) {
  console.error('Usage: --email=<address> [--confirm=<address> --apply]')
  process.exit(1)
}

const db = createClient(url, key, { auth: { persistSession: false } })

async function main() {
  const { data: user, error } = await db
    .from('users').select('id, email, full_name, first_name, last_name').eq('email', EMAIL).maybeSingle()

  if (error) { console.error('Lookup failed:', error.message); process.exit(1) }
  if (!user) { console.error(`No user with email ${EMAIL}`); process.exit(1) }

  const { data: memberships } = await db
    .from('organization_memberships')
    .select('organization_id, status, organizations(name)')
    .eq('user_id', user.id)

  console.log(`${APPLY ? 'ERASE' : 'DRY RUN'} — ${user.email} (${user.id})`)
  const displayName = user.full_name || [user.first_name, user.last_name].filter(Boolean).join(' ') || '—'
  console.log(`  name: ${displayName}`)
  console.log(`  organizations: ${(memberships ?? []).map(m => `${m.organizations?.name ?? '?'} [${m.status}]`).join(', ') || 'none'}`)
  console.log(`
  Will erase : preferences, saved views, layouts, bookmarks, notifications,
               AI prompt history, calendar connections, and the name/email on
               the users row.
  Will keep  : everything they authored — notes, theses, ratings, trade
               decisions — as the organization's business records, attributed
               to "Former user".`)

  if (!APPLY) {
    console.log('\nDry run — nothing changed. Re-run with --confirm=<email> --apply.')
    return
  }
  if (CONFIRM !== EMAIL) {
    console.error(`\nRefusing: --confirm must be exactly "${EMAIL}". This is irreversible.`)
    process.exit(2)
  }

  const { data: result, error: rpcErr } = await db.rpc('erase_user_personal_data', { p_user_id: user.id })
  if (rpcErr) { console.error('Erasure RPC failed:', rpcErr.message); process.exit(1) }
  console.log('\npersonal data erased:', JSON.stringify(result?.rows_deleted ?? {}, null, 2))

  const { error: authErr } = await db.auth.admin.deleteUser(user.id)
  if (authErr) {
    // Not fatal, but it must be said plainly: the person can no longer be
    // identified in the product, yet the login still exists.
    console.error(`\n!! auth identity NOT deleted: ${authErr.message}`)
    console.error('   Personal data is erased but the login remains. Remove it manually.')
    process.exit(1)
  }
  console.log('auth identity deleted.')
  console.log('\nDone. Authored records retained and attributed to "Former user".')
}

main().catch(err => { console.error(err); process.exit(1) })
