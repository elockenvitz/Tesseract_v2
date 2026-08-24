const fs=require('fs'),p='src/lib/signals/builders/__tests__/quote-unavailable.test.ts'
const raw=fs.readFileSync(p,'utf8'),crlf=raw.includes('\r\n');let s=raw.replace(/\r\n/g,'\n')
const a=`describe('quote unavailable, end to end', () => {`
const b=`/**
 * Long enough for the client's real rate-limit backoff.
 *
 * These drive \`BrowserFinancialService\` rather than a stub — which is the point
 * of the file — and it sleeps \`API_CALL_DELAY\` (1s) between provider attempts
 * with real timers. Four providers is four seconds of deliberate waiting
 * against Vitest's 5s default, so the file passed alone and timed out inside
 * the full guard, where 53 files compete for the event loop. That is a flake
 * about scheduling, not about quotes.
 *
 * Raised rather than faked: the sleep is part of what these tests exercise, and
 * swapping in fake timers here would mean the "every provider fails" path was
 * no longer the one being measured.
 */
const BACKOFF_BUDGET_MS = 30_000

describe('quote unavailable, end to end', { timeout: BACKOFF_BUDGET_MS }, () => {`
if(!s.includes(a)){console.log('MISS');process.exit(1)}
s=s.replace(a,b)
fs.writeFileSync(p,crlf?s.replace(/\n/g,'\r\n'):s);console.log('ok')
