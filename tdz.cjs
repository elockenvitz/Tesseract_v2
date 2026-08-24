const fs=require('fs'),p='src/components/signals/SizeExplorer.tsx'
const raw=fs.readFileSync(p,'utf8'),crlf=raw.includes('\r\n');let s=raw.replace(/\r\n/g,'\n')
const a=`const pct = (v: number) => \`\${v.toFixed(1)}%\`
/** A difference between two weights is POINTS, never a percent of a percent. */
const pts = (v: number) => \`\${signed(v)} pts\`
/** The bare figure, for the left half of a "from → to" where the unit follows. */
const signed = (v: number) => \`\${v >= 0 ? '+' : '−'}\${Math.abs(v).toFixed(1)}\``
const b=`const pct = (v: number) => \`\${v.toFixed(1)}%\`
/**
 * The bare figure, for the left half of a "from → to" where the unit follows.
 *
 * Declared before \`pts\`, which uses it. Both are \`const\` arrows, so the
 * reference sits in the temporal dead zone at definition time — harmless here
 * because \`pts\` is only ever CALLED later, and exactly the shape that stops
 * being harmless the moment either becomes a module-scope initialiser.
 */
const signed = (v: number) => \`\${v >= 0 ? '+' : '−'}\${Math.abs(v).toFixed(1)}\`
/** A difference between two weights is POINTS, never a percent of a percent. */
const pts = (v: number) => \`\${signed(v)} pts\``
if(!s.includes(a)){console.log('MISS');process.exit(1)}
s=s.replace(a,b)
fs.writeFileSync(p,crlf?s.replace(/\n/g,'\r\n'):s);console.log('ok')
