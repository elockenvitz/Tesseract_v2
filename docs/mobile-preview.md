# Seeing mobile changes without a deploy

Deploy previews were the default way to look at a card on a phone, and they are
the most expensive way. Every push to every branch ran two guards and a Vite
build of an 8MB bundle with a 7GB heap, to produce a URL that shows the same
thing your laptop is already serving.

## The fast path

```
npm run dev:mobile
```

Vite prints two URLs. Take the **Network** one — `http://192.168.x.x:5173` —
and open it on the phone. Both devices need to be on the same Wi-Fi.

This is better than a preview in every way that matters here:

- **Real data.** `.env.local` is loaded, so it is your Supabase, your org, your
  holdings. A preview build uses the same credentials and takes minutes to get
  there.
- **Hot reload.** Save a file and the phone updates. No commit, no push, no
  wait.
- **No build.** Nothing is bundled, minified or uploaded.

First run on Windows will raise a firewall prompt — allow it on **private**
networks. Without that the phone gets a connection refused and it looks like
the URL is wrong.

## When you need to log in

The LAN URL is `http://192.168.x.x`, and browsers only expose
`window.crypto.subtle` on a secure context. `localhost` is exempt; a bare LAN
IP is not. Supabase auth needs SubtleCrypto, so **signing in over the LAN URL
hangs forever with no error anywhere** — the page loads, the form submits,
nothing happens.

Leave `npm run dev:mobile` running and add, in a second terminal:

```
npm run tunnel:mobile
```

It prints a public HTTPS hostname. Open that on the phone instead:

```
  ┌───────────────────────────────────────────────────────
  │  https://fleece-visibility-pmc-buck.trycloudflare.com
  │  open this on the phone — it is HTTPS, so login works
  └───────────────────────────────────────────────────────
```

**The hostname is new every run.** A Cloudflare quick tunnel mints a random one
at start-up, so there is no stable URL to bookmark — read it from the terminal
each time.

Two things worth knowing:

- **It is public while it is up.** Unlisted and random, but public, and
  `.env.local` currently points at production. Ctrl-C when you are done.
- **A self-signed certificate does not work instead.** iOS refuses to offer the
  usual "visit this website anyway" escape for one on a bare IP and fails the
  handshake with "the network connection was lost", which reads like the server
  is down while it is answering fine. `@vitejs/plugin-basic-ssl` was tried and
  removed; it also wants a newer Vite than this repo pins, which broke
  `npm ci` and with it the Netlify build.

If `cloudflared` is not on your PATH the script looks in the usual install
locations; set `CLOUDFLARED` to its full path if it still cannot find it.

## Card layout only

```
npm run gallery:mobile
```

The gallery at phone width, on the same LAN URL. Use this for layout,
clipping, and anything geometric: it renders every card kind from fixtures, so
you can see a card type your own book does not currently produce. It has no
Supabase and no live data by design — see `scripts/gallery-purity.mjs`.

## When you genuinely need a deploy

Put `[preview]` anywhere in the commit message:

```
git commit -m "fix(cards): tighten the target row [preview]"
```

That commit builds and gets a preview URL. Everything else on a branch skips.
`main` always builds.

Reach for this when the LAN path cannot answer the question:

- sharing with somebody not on your network
- a device you cannot put on the Wi-Fi
- anything that needs a real HTTPS origin

The marker is per-commit rather than per-branch on purpose: you want the
preview for the one commit you are about to share, not for every commit on a
branch that happens to be named a certain way.

## What still runs

Skipping a build does not skip any check. `ci.yml` runs the unit tests, the
card typecheck and the layout suite on every push regardless — those are
required status checks and they block the merge, which is a strictly earlier
gate than blocking the deploy. The Netlify build was never the thing keeping
main correct.
