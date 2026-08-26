#!/usr/bin/env node
/**
 * A public HTTPS hostname for the local mobile dev server.
 *
 * ── Why a tunnel is needed at all ─────────────────────────────────────────
 *
 * `npm run dev:mobile` prints a LAN URL and that is the fast path — but it is
 * `http://192.168.x.x`, and browsers only expose `window.crypto.subtle` on a
 * secure context. `localhost` is exempt; a bare LAN IP is not. Supabase auth
 * needs SubtleCrypto, so signing in over the LAN URL hangs forever with no
 * error anywhere: the page loads, the form submits, nothing happens.
 *
 * A self-signed certificate does not fix it. iOS refuses to offer the usual
 * "visit this website anyway" escape for one on a bare IP, and fails the
 * handshake with "the network connection was lost" — which reads like the
 * server is down while it is answering fine. That is why
 * `@vitejs/plugin-basic-ssl` is not in this project (it was, briefly, and it
 * broke `npm ci` because it wants a newer Vite than this repo pins).
 *
 * A Cloudflare quick tunnel gives a publicly trusted certificate on a real
 * hostname, so the phone treats it as any other website and the secure-context
 * problem disappears.
 *
 * ── What this costs ───────────────────────────────────────────────────────
 *
 * A hop through Cloudflare, and `.env.local` currently points at PRODUCTION.
 * The hostname is random and unlisted, but it is public while it is up. Stop it
 * when you are done — Ctrl-C here is enough.
 *
 * ── Why a script rather than a line in the README ─────────────────────────
 *
 * It was run by hand, the URL was pasted into a chat, and the next session had
 * no idea which of three dead hostnames had been the live one. A quick tunnel
 * mints a NEW hostname every run, so the URL is only ever knowable at start-up
 * — which makes printing it clearly the whole job.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'

const PORT = process.argv[2] ?? '5173'

/**
 * Where cloudflared actually is.
 *
 * It is not on PATH on this machine — the winget install drops it in Program
 * Files and does not amend PATH — so `spawn('cloudflared')` fails with ENOENT
 * and the error says only that the file was not found, naming nothing.
 */
const CANDIDATES = [
  process.env.CLOUDFLARED,
  'C:/Program Files (x86)/cloudflared/cloudflared.exe',
  'C:/Program Files/cloudflared/cloudflared.exe',
  '/usr/local/bin/cloudflared',
  '/opt/homebrew/bin/cloudflared',
].filter(Boolean)

const bin = CANDIDATES.find(p => existsSync(p)) ?? 'cloudflared'

const target = `http://localhost:${PORT}`
console.log(`\n  tunnelling ${target}`)
console.log(`  using ${bin}\n`)

/**
 * IPv4 to the edge, because IPv6 to it does not work from here.
 *
 * Minting a quick tunnel is a POST to `api.trycloudflare.com`, and cloudflared
 * resolves that to an IPv6 address by preference. On this network that dial is
 * reset mid-handshake — "an existing connection was forcibly closed" — while the
 * identical request over IPv4 answers in under a second. Three runs in a row
 * failed that way before the address family in the error message gave it away,
 * and the failure looks exactly like Cloudflare being down.
 *
 * `--edge-ip-version 4` pins both the API call and the edge connection to IPv4.
 * Override with CLOUDFLARED_EDGE_IP=6 (or `auto`) on a network where v6 is the
 * working path.
 */
const edgeIpVersion = process.env.CLOUDFLARED_EDGE_IP ?? '4'

const child = spawn(
  bin,
  ['tunnel', '--edge-ip-version', edgeIpVersion, '--url', target],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

child.on('error', err => {
  console.error(`\n  could not start cloudflared: ${err.message}`)
  console.error('  install it, or set CLOUDFLARED to its full path.\n')
  process.exit(1)
})

let announced = false
const watch = (chunk) => {
  const text = String(chunk)
  // cloudflared prints the hostname once, inside a box of ASCII art, on
  // stderr. Matching the URL itself rather than the surrounding decoration,
  // which has changed shape between releases.
  //
  // `api.` is excluded because it is not a tunnel. It is the endpoint
  // cloudflared POSTs to in order to MINT one, and it appears in the failure
  // line when that request times out — so a run that got no tunnel at all
  // still printed a confident box containing `https://api.trycloudflare.com`,
  // which is a real host that answers and serves nothing. The announcement has
  // one job; announcing a hostname on the failure path is worse than silence.
  const url = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i)?.[0]
  if (url && !/^https:\/\/api\./i.test(url) && !announced) {
    announced = true
    console.log('\n  ┌───────────────────────────────────────────────────────')
    console.log(`  │  ${url}`)
    console.log('  │  open this on the phone — it is HTTPS, so login works')
    console.log('  └───────────────────────────────────────────────────────\n')
  }
  // Everything else stays visible: a tunnel that fails to connect says so here
  // and nowhere else, and swallowing it is how "it isn't loading" becomes the
  // entire bug report.
  process.stderr.write(chunk)
}
child.stdout.on('data', watch)
child.stderr.on('data', watch)

const stop = () => { child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', code => process.exit(code ?? 0))
