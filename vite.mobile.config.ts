import { defineConfig, mergeConfig } from 'vite'

import base from './vite.config'

/**
 * The dev server, shaped for viewing on a phone through a tunnel.
 *
 * ── The problem this exists to solve ──────────────────────────────────────
 *
 * Serving to a phone over plain HTTP on a LAN address looks like it works —
 * the page loads, the login form renders — and then signing in hangs forever
 * with no error.
 *
 * `http://192.168.1.161:5173` is not a SECURE CONTEXT. Browsers expose Web
 * Crypto (`window.crypto.subtle`) only on HTTPS origins and on localhost, and
 * Supabase's auth client needs it. Measured on the LAN origin:
 * `isSecureContext: false`, `crypto.subtle: undefined`. Nothing is
 * misconfigured and no request fails; a capability the auth client assumes is
 * simply absent, so it hangs rather than erroring.
 *
 * `localhost` is specifically exempt from that rule, which is exactly why this
 * never appears in desktop development and only surfaces the moment a phone
 * points at the machine.
 *
 * ── Why a tunnel rather than a self-signed certificate ────────────────────
 *
 * The obvious fix is HTTPS locally, via `@vitejs/plugin-basic-ssl`. It works
 * on desktop. iOS rejects it: Safari does not offer the usual "visit this
 * website anyway" escape for a self-signed certificate on a bare IP over
 * HTTP/2, and fails the handshake with "the network connection was lost" —
 * which reads like the server is down when it is answering fine.
 *
 * A Cloudflare quick tunnel gives a publicly trusted certificate on a real
 * hostname, so the phone treats it as any other website and the secure-context
 * problem disappears. It costs a hop through Cloudflare, which is worth
 * knowing about given local dev currently points at production data.
 *
 * ── `allowedHosts` ────────────────────────────────────────────────────────
 *
 * Vite rejects requests whose Host header it does not recognise, which is a
 * sensible default and exactly wrong here: the tunnel hostname is random and
 * changes every run. Opened deliberately, and only in this config — the
 * default `vite.config.ts` keeps the protection.
 */
/**
 * Log every request the phone makes, with its status and duration.
 *
 * A phone is a black box: there is no console to read and no network tab, so
 * "it isn't loading" is the entire bug report available. Cloudflare's tunnel
 * only logs FAILURES, which means a page that loads and then does nothing
 * produces no evidence at all on either side.
 *
 * This is the missing half — server-side truth about what was asked for, what
 * came back, and how long it took. Cheap enough to leave on: this config is
 * only ever used for looking at the app on a device.
 */

/**
 * Serve `netlify/functions/*` from the local dev and preview servers.
 *
 * ── The bug this exists to remove from phone QA ───────────────────────────
 *
 * `browser-client.getQuote` tries Alpha Vantage, then
 * `/.netlify/functions/quote`, then the Supabase `yahoo-chart-proxy`, then
 * Finnhub. In production the Netlify function is the path that works, and the
 * function's own header records why: the Supabase proxy returns 502 on every
 * call because Yahoo refuses that egress.
 *
 * A Vite preview serves `dist/` with an SPA catch-all, so on the QA tunnel
 * `/.netlify/functions/quote` returned **200 with `text/html`** — index.html.
 * `res.ok` was true, `res.json()` threw, the catch swallowed it, and the
 * working quote path was silently absent. That left Alpha Vantage as the only
 * source, and its free tier is 5 requests a minute against a `Promise.all`
 * fan-out over every laddered asset: measured, one symbol in five got a quote
 * and the first rate-limited response latched the client off Alpha Vantage for
 * the rest of the page.
 *
 * So which single Case-vs-Price card existed was decided by a network race,
 * and reloading re-rolled it. That is the "the tile was there, I refreshed, it
 * was gone" report — an artifact of the preview harness, not of the card.
 *
 * ── Why this and not `netlify dev` ────────────────────────────────────────
 *
 * `netlify-cli` is not a dependency of this repo and installing it to look at
 * a phone is a large tool for a small job. The functions are dependency-free
 * ESM with the v1 `export const handler` signature, so the whole adapter is
 * one middleware: build the `event` shape they expect, call the handler, write
 * its `statusCode`/`headers`/`body` back.
 *
 * LOCAL TOOLING ONLY. This file is the dev/preview config; it is not part of
 * `vite build` and nothing it does reaches a bundle. Production continues to
 * be served by real Netlify functions, and no application semantics change —
 * `getQuote` is untouched, `quote_unavailable` still suppresses, and a
 * function that fails here fails exactly as it would in production.
 */
const netlifyFunctions = {
  name: 'netlify-functions-local',
  configureServer(server: any) { mount(server) },
  configurePreviewServer(server: any) { mount(server) },
}

function mount(server: { middlewares: { use: (fn: unknown) => void } }) {
  server.middlewares.use(async (req: any, res: any, next: () => void) => {
    const url: string = req.url ?? ''
    if (!url.startsWith('/.netlify/functions/')) return next()

    const [path, query = ''] = url.split('?')
    const name = path.slice('/.netlify/functions/'.length)
    // A name is a file, not a path: no traversal out of the functions dir.
    if (!/^[a-z0-9-]+$/i.test(name)) {
      res.statusCode = 400
      res.end('bad function name')
      return
    }

    try {
      const mod = await import(`./netlify/functions/${name}.mjs`)
      const handler = mod.handler ?? mod.default
      if (typeof handler !== 'function') throw new Error(`${name} exports no handler`)

      const params = Object.fromEntries(new URLSearchParams(query))
      const result = await handler({
        httpMethod: req.method,
        queryStringParameters: params,
        headers: req.headers,
        body: null,
      })

      res.statusCode = result?.statusCode ?? 500
      for (const [k, v] of Object.entries(result?.headers ?? {})) {
        res.setHeader(k, v as string)
      }
      res.end(result?.body ?? '')
    } catch (e) {
      // Never fall through to the SPA. A 502 is a failure the client already
      // knows how to read; index.html with a 200 is the well-formed wrong
      // answer this whole adapter exists to stop serving.
      console.error(`[netlify-local] ${name} failed:`, e)
      res.statusCode = 502
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ error: 'local function failed' }))
    }
  })
}

const requestLog = {
  name: 'mobile-request-log',
  configurePreviewServer(server: { middlewares: { use: (fn: unknown) => void } }) {
    server.middlewares.use((req: any, res: any, next: () => void) => {
      const t0 = Date.now()
      res.on('finish', () => {
        const ms = Date.now() - t0
        // Assets are noise; the document and the API calls are the story.
        if (/\.(png|svg|ico|woff2?|css)$/.test(req.url ?? '')) return
        console.log(`[req] ${res.statusCode} ${String(ms).padStart(5)}ms ${req.method} ${req.url}`)
      })
      next()
    })
  },
}

export default defineConfig(async env => mergeConfig(
  // The base config is a FUNCTION (it branches on mode), and `mergeConfig`
  // refuses a callback — "Cannot merge config in form of callback" — so it is
  // resolved for this environment first.
  typeof base === 'function' ? await base(env) : base,
  {
    server: {
      // `0.0.0.0` explicitly: `--host` alone bound IPv6 only on this machine,
      // and a phone reaching the IPv4 address found nothing listening.
      host: '0.0.0.0',
      port: 5173,
      // Fail loudly rather than drifting to 5174, which would silently land
      // outside both the firewall rule and the tunnel.
      strictPort: true,
      // The tunnel's hostname is random per run. See the header.
      allowedHosts: true,
      /**
       * Hot reload has to be told it is behind TLS.
       *
       * The page is served over `https://…trycloudflare.com`, so the browser
       * refuses a plain `ws://` HMR socket as mixed content. Without this the
       * app loads and then never updates, which looks like the dev server has
       * died rather than like a blocked socket.
       */
      hmr: { protocol: 'wss', clientPort: 443 },
    },
    plugins: [netlifyFunctions, requestLog],
    preview: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      allowedHosts: true,
    },
  },
))
