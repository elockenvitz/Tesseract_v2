/**
 * TWO DESIGN DIRECTIONS for the Asset Workspace. Prototypes, not production.
 *
 * ── What these are ───────────────────────────────────────────────────────
 *
 * Rendered proposals, built so the composition can be judged on screen rather
 * than argued in prose. They use the real fixture figures the harness already
 * carries, so nothing here is a number that could not exist.
 *
 * They are NOT wired to hooks, they do not fetch, and they must never be
 * imported by the application. The point is to choose a direction; the chosen
 * one is then built out of the real components.
 *
 * ── Why these two ────────────────────────────────────────────────────────
 *
 * The brief rejected "another incremental card-and-spacing pass", so the two
 * directions differ in what the page fundamentally IS, not in how its cards
 * are arranged:
 *
 *   A — THE BRIEF.  One continuous editorial document. The security reads as
 *       a memo the system keeps current. No cards at all: a measure, a type
 *       hierarchy, and a margin rail that puts live figures beside the
 *       sentence they belong to. Actions appear inline, at the fact.
 *
 *   B — THE DESK.   A triage console. A persistent situation column that
 *       never scrolls away, driven by the workspace resolver, and a working
 *       pane that changes with what you select. Master–detail, not tabs.
 *
 * A optimises for UNDERSTANDING a name. B optimises for ACTING on one.
 */

import { useState } from 'react'

/* ─────────────────────────────────────────────────────── shared fixture ─── */

const F = {
  symbol: 'AAPL',
  company: 'Apple Inc.',
  price: 231.40,
  change: -1.24,
  asOf: 'Oct 10, 4:00 PM',
  rating: { value: 'Buy', count: 3, total: 5 },
  target: 268,
  upside: 15.8,
  bear: 168,
  bull: 296,
  down: -27.4,
  up: 27.9,
  skew: '1.0:1',
  books: [
    { name: 'Tech & Consumer Growth', weight: 2.55, mv: '$9.8m', pnl: '+22.9%' },
    { name: 'Core Income', weight: 0.84, mv: '$1.9m', pnl: '+12.8%' },
    { name: 'Special Opportunities', weight: null, mv: '$0.3m', pnl: '-3.6%' },
  ],
  pending: { action: 'Add', book: 'Tech & Consumer Growth', by: 'Priya Nair', note: 'Raising to target on the print.', age: '2d' },
  thesis: { who: 'Ana Bell', when: '28 Sep', text: 'Services mix is still being valued as hardware. The attach rate on the installed base has room before it is priced, and the replacement cycle has stopped mattering to the revenue line.' },
  differ: { who: 'Ana Bell', when: '28 Sep', text: 'Consensus treats the services take-rate as a policy variable that regulators will reset. We treat it as a contract term, which is why our 2028 services estimate sits 11% above the street.' },
  risk: { who: 'Tom Vega', when: '18 Sep', text: 'App Store remedies in the EU with a US equivalent would take 4-6% off services revenue, and the multiple would follow it down. China is the second: two thirds of the growth gap against our model is one country.' },
  memory: { recommended: 2, decided: 4, unfilled: 1, executed: 5, reviewed: 2, unobserved: 4 },
  contributors: [
    { name: 'Dana Rivera', covering: true, n: 2 },
    { name: 'Mia Lindqvist', covering: false, n: 2 },
    { name: 'Sam Okafor', covering: false, n: 2 },
    { name: 'Wei Chen', covering: false, n: 2 },
  ],
}

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/* ══════════════════════════════════════════════════ A — THE BRIEF ════════ */

/**
 * One document, one measure, a margin that carries the numbers.
 *
 * The argument runs as prose at a readable measure. Every live figure sits in
 * the right margin ALIGNED TO THE SENTENCE it bears on — exposure beside the
 * position paragraph, the ladder beside the valuation paragraph. That
 * alignment is the whole idea: it is what turns two records into one
 * relationship without a card drawing a box around them.
 *
 * Actions are inline and in the sentence. The pending request is not a tile;
 * it is a line of the document with Decide and Open beside it.
 */
function DirectionA() {
  return (
    <div style={{ background: '#fbfbfa', minHeight: '100%', color: '#14161a' }}>
      {/* Identity: one line, quiet. The name is orientation, not a headline. */}
      <header style={{
        display: 'flex', alignItems: 'baseline', gap: 14,
        padding: '18px 56px 0', maxWidth: 1180, margin: '0 auto',
      }}>
        <span style={{ fontSize: 19, fontWeight: 650, letterSpacing: '-0.01em' }}>{F.symbol}</span>
        <span style={{ fontSize: 13, color: '#6b7280' }}>{F.company}</span>
        <span style={{ fontFamily: MONO, fontSize: 13 }}>{F.price.toFixed(2)}</span>
        <span style={{ fontFamily: MONO, fontSize: 12, color: '#b91c1c' }}>{F.change}%</span>
        <span style={{ fontSize: 11, color: '#9ca3af' }}>as of {F.asOf}</span>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: '#9ca3af' }}>
          Held in 3 books · covered by Dana Rivera
        </span>
      </header>

      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '0 56px 64px' }}>
        {/* The conclusion, as a sentence rather than a row of figures. */}
        <h1 style={{
          margin: '26px 0 0', fontSize: 27, lineHeight: 1.28, fontWeight: 600,
          letterSpacing: '-0.02em', maxWidth: '24ch',
        }}>
          We rate it <Mark>Buy</Mark> to <Mark>$268</Mark>, and own <Mark>2.55%</Mark> of
          the growth book against it.
        </h1>
        <p style={{ margin: '10px 0 0', fontSize: 12.5, color: '#6b7280', maxWidth: '62ch' }}>
          3 of 5 analysts rate it Buy. The target is 15.8% above spot, inside a
          framework that runs {F.bear} to {F.bull} — {F.down}% / +{F.up}%, about {F.skew}.
        </p>

        {/* The one thing waiting on a human, stated in the document. */}
        <ActionLine />

        <Rule />

        {/* The argument. Margin figures align to the paragraph they bear on. */}
        <Section
          kicker="Where we differ"
          by={`${F.differ.who} · ${F.differ.when}`}
          body={F.differ.text}
          margin={<Ladder />}
        />
        <Section
          kicker="The thesis"
          by={`${F.thesis.who} · ${F.thesis.when}`}
          body={F.thesis.text}
          margin={<Exposure />}
        />
        <Section
          kicker="What breaks it"
          by={`${F.risk.who} · ${F.risk.when}`}
          body={F.risk.text}
          margin={<Memory />}
        />

        <Rule />

        <div style={{ display: 'flex', gap: 40, alignItems: 'baseline', marginTop: 20 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9ca3af', width: 130 }}>
            Who has written
          </span>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5 }}>
            {F.contributors.map(c => (
              <span key={c.name} style={{ color: c.covering ? '#14161a' : '#6b7280' }}>
                {c.name}
                {c.covering && <em style={{ fontStyle: 'normal', fontSize: 10, color: '#b45309', marginLeft: 5 }}>covering</em>}
                <span style={{ fontFamily: MONO, fontSize: 11, color: '#9ca3af', marginLeft: 5 }}>{c.n}</span>
              </span>
            ))}
            <span style={{ color: '#9ca3af' }}>4 views on the thesis</span>
          </div>
        </div>
      </div>
    </div>
  )
}

const Mark = ({ children }: { children: React.ReactNode }) => (
  <span style={{ borderBottom: '2px solid #f59e0b', paddingBottom: 1 }}>{children}</span>
)

const Rule = () => (
  <div style={{ height: 1, background: '#e7e5e1', margin: '26px 0 0' }} />
)

function ActionLine() {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 14, marginTop: 20,
      padding: '11px 14px', background: '#fff', border: '1px solid #e7e5e1',
      borderLeft: '3px solid #2563eb', borderRadius: 3,
    }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#2563eb' }}>
        Waiting on you
      </span>
      <span style={{ fontSize: 13.5 }}>
        <strong style={{ fontWeight: 600 }}>{F.pending.action}</strong> in {F.pending.book} — “{F.pending.note}”
      </span>
      <span style={{ fontSize: 11, color: '#9ca3af' }}>{F.pending.by} · {F.pending.age}</span>
      <span style={{ marginLeft: 'auto', display: 'flex', gap: 7 }}>
        <Btn primary>Decide</Btn>
        <Btn>Open request</Btn>
      </span>
    </div>
  )
}

function Btn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button style={{
      fontSize: 12, padding: '5px 11px', borderRadius: 3, cursor: 'pointer',
      border: primary ? '1px solid #2563eb' : '1px solid #d6d3cd',
      background: primary ? '#2563eb' : '#fff',
      color: primary ? '#fff' : '#374151',
    }}>{children}</button>
  )
}

function Section({ kicker, by, body, margin }: {
  kicker: string; by: string; body: string; margin: React.ReactNode
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 300px', gap: 48, marginTop: 26 }}>
      <div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9ca3af' }}>
            {kicker}
          </span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>{by}</span>
          <button style={{
            fontSize: 11, color: '#2563eb', background: 'none', border: 'none',
            cursor: 'pointer', padding: 0,
          }}>open full research →</button>
        </div>
        <p style={{ margin: '7px 0 0', fontSize: 15, lineHeight: 1.62, maxWidth: '66ch' }}>{body}</p>
      </div>
      {/* The margin: a live figure, beside the sentence it bears on. */}
      <div style={{ paddingTop: 18 }}>{margin}</div>
    </div>
  )
}

function MarginBox({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid #e7e5e1', paddingTop: 9 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9ca3af', marginBottom: 7 }}>
        {label}
      </div>
      {children}
    </div>
  )
}

function Ladder() {
  const lo = 150, hi = 310
  const at = (v: number) => ((v - lo) / (hi - lo)) * 100
  return (
    <MarginBox label="Valuation">
      <div style={{ position: 'relative', height: 30 }}>
        <div style={{ position: 'absolute', top: 13, left: 0, right: 0, height: 2, background: '#e7e5e1' }} />
        {[[F.bear, 'Bear'], [224, 'Base'], [F.bull, 'Bull']].map(([v, n]) => (
          <div key={n as string} style={{ position: 'absolute', left: `${at(v as number)}%`, top: 6 }}>
            <div style={{ width: 1, height: 16, background: '#b6b2aa' }} />
            <div style={{ fontSize: 9.5, color: '#9ca3af', marginTop: 2, transform: 'translateX(-50%)' }}>{n as string}</div>
          </div>
        ))}
        <div style={{ position: 'absolute', left: `${at(F.price)}%`, top: 2 }}>
          <div style={{ width: 2, height: 24, background: '#14161a' }} />
        </div>
        <div style={{ position: 'absolute', left: `${at(F.target)}%`, top: 2 }}>
          <div style={{ width: 2, height: 24, background: '#f59e0b' }} />
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontFamily: MONO, fontSize: 11, marginTop: 10 }}>
        <span>spot {F.price.toFixed(2)}</span>
        <span style={{ color: '#b45309' }}>target {F.target}</span>
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 5 }}>
        {F.down}% / +{F.up}% · reward-to-risk {F.skew}
      </div>
    </MarginBox>
  )
}

function Exposure() {
  return (
    <MarginBox label="What we own">
      {F.books.map(b => (
        <div key={b.name} style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 5 }}>
          <span style={{ fontSize: 12, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.name}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11.5, width: 46, textAlign: 'right' }}>
            {b.weight != null ? `${b.weight.toFixed(2)}%` : '—'}
          </span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: '#6b7280', width: 44, textAlign: 'right' }}>{b.mv}</span>
        </div>
      ))}
      <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 7 }}>
        Weights are each book's own; they are not summed.
      </div>
    </MarginBox>
  )
}

function Memory() {
  const m = F.memory
  return (
    <MarginBox label="What we did">
      <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
        {[['Rec', m.recommended], ['Dec', m.decided], ['Exec', m.executed], ['Rev', m.reviewed]].map(([l, n], i) => (
          <div key={l as string} style={{ flex: n as number, minWidth: 26 }}>
            <div style={{ height: 4, background: ['#c7d2fe', '#a7f3d0', '#86efac', '#ddd6fe'][i], borderRadius: 1 }} />
            <div style={{ fontSize: 9.5, color: '#9ca3af', marginTop: 4 }}>{l as string} {n as number}</div>
          </div>
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#b45309', lineHeight: 1.45 }}>
        {m.unobserved} of {m.executed} executions are not evidenced by an observed fill.
      </div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 4 }}>1 committed, not yet executed.</div>
    </MarginBox>
  )
}

/* ══════════════════════════════════════════════════ B — THE DESK ═════════ */

type Pane = 'situation' | 'decision' | 'research' | 'position'

/**
 * A triage console: a situation column that never scrolls away, and a working
 * pane that changes with what you select.
 *
 * The left column is the workspace resolver's output, ranked. It is the only
 * navigation — tabs are gone, because a tab asks you to know where to look
 * and this tells you. Selecting an item loads its context on the right with
 * the actions for THAT item, so context and action are never on different
 * screens.
 */
function DirectionB() {
  const [pane, setPane] = useState<Pane>('decision')

  return (
    <div style={{ display: 'flex', height: '100%', background: '#0f1115', color: '#e6e8ec' }}>
      {/* ── The situation column ── */}
      <aside style={{ width: 352, borderRight: '1px solid #20242c', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '15px 18px 12px', borderBottom: '1px solid #20242c' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
            <span style={{ fontSize: 17, fontWeight: 650 }}>{F.symbol}</span>
            <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{F.price.toFixed(2)}</span>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#f87171' }}>{F.change}%</span>
          </div>
          <div style={{ fontSize: 11.5, color: '#8b93a1', marginTop: 2 }}>{F.company}</div>
          <div style={{
            marginTop: 11, fontSize: 10.5, letterSpacing: '0.08em',
            textTransform: 'uppercase', color: '#60a5fa',
          }}>
            A decision is waiting
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto' }}>
          <SitItem
            tone="#3b82f6" active={pane === 'decision'} onClick={() => setPane('decision')}
            title={`${F.pending.action} in ${F.pending.book}`}
            meta={`${F.pending.by} · ${F.pending.age} · awaiting a decision`}
            action="Decide"
          />
          <SitItem
            tone="#f59e0b" active={false} onClick={() => setPane('research')}
            title="Rated Buy by 3 of 5, with a pending add"
            meta="asset_ratings · decision_requests"
          />
          <SitItem
            tone="#6b7280" active={false} onClick={() => setPane('research')}
            title="4 of 5 executions not evidenced by a fill"
            meta="portfolio_trade_events"
          />
          <SitItem
            tone="#6b7280" active={pane === 'position'} onClick={() => setPane('position')}
            title="Held in 3 books · 2.55% largest"
            meta="portfolio_holdings · at book price"
          />
        </div>

        <div style={{ borderTop: '1px solid #20242c', padding: '10px 18px', display: 'flex', gap: 14 }}>
          {(['research', 'position', 'situation'] as Pane[]).map(p => (
            <button key={p} onClick={() => setPane(p)} style={{
              background: 'none', border: 'none', cursor: 'pointer', padding: 0,
              fontSize: 11.5, color: pane === p ? '#e6e8ec' : '#6b7280',
            }}>
              {p === 'situation' ? 'Lists' : p === 'research' ? 'Research' : 'Exposure'}
            </button>
          ))}
        </div>
      </aside>

      {/* ── The working pane ── */}
      <main style={{ flex: 1, overflow: 'auto', padding: '20px 26px' }}>
        {pane === 'decision' && <DeskDecision />}
        {pane === 'research' && <DeskResearch />}
        {(pane === 'position' || pane === 'situation') && <DeskPosition />}
      </main>
    </div>
  )
}

function SitItem({ tone, title, meta, action, active, onClick }: {
  tone: string; title: string; meta: string; action?: string; active: boolean; onClick: () => void
}) {
  return (
    <button onClick={onClick} style={{
      display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer',
      background: active ? '#171b22' : 'transparent',
      borderLeft: `2px solid ${active ? tone : 'transparent'}`,
      borderTop: 'none', borderRight: 'none', borderBottom: '1px solid #181c23',
      padding: '11px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 5, height: 5, borderRadius: 9, background: tone }} />
        <span style={{ fontSize: 12.5, color: '#e6e8ec', lineHeight: 1.35 }}>{title}</span>
      </div>
      <div style={{ fontSize: 10.5, color: '#6b7280', marginTop: 4, marginLeft: 12 }}>{meta}</div>
      {action && (
        <span style={{
          display: 'inline-block', marginTop: 8, marginLeft: 12, fontSize: 11,
          padding: '3px 9px', borderRadius: 3, background: '#1d4ed8', color: '#fff',
        }}>{action}</span>
      )}
    </button>
  )
}

const DeskH = ({ children }: { children: React.ReactNode }) => (
  <div style={{ fontSize: 10.5, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#6b7280', marginBottom: 9 }}>
    {children}
  </div>
)

function DeskDecision() {
  return (
    <div style={{ maxWidth: 900 }}>
      <DeskH>The request</DeskH>
      <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.01em' }}>
        {F.pending.action} {F.symbol} in {F.pending.book}
      </div>
      <div style={{ fontSize: 12.5, color: '#8b93a1', marginTop: 5 }}>
        {F.pending.by} · {F.pending.age} ago · “{F.pending.note}”
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 15 }}>
        <DeskBtn primary>Approve</DeskBtn>
        <DeskBtn>Approve at half</DeskBtn>
        <DeskBtn>Decline</DeskBtn>
        <DeskBtn>Defer</DeskBtn>
      </div>

      {/* Everything a PM needs to answer it, on the same screen. */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 26, marginTop: 28 }}>
        <div>
          <DeskH>Against our view</DeskH>
          <Kv k="Our rating" v={`${F.rating.value} · ${F.rating.count} of ${F.rating.total}`} />
          <Kv k="Target" v={`$${F.target} · +${F.upside}% to spot`} />
          <Kv k="Framework" v={`${F.bear} – ${F.bull} · ${F.skew}`} />
          <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 9, lineHeight: 1.5 }}>
            Mia Lindqvist rates it Hold and Wei Chen Sell. The request increases
            a position two of five analysts would not add to.
          </div>
        </div>
        <div>
          <DeskH>Against the book</DeskH>
          {F.books.map(b => (
            <Kv key={b.name} k={b.name} v={b.weight != null ? `${b.weight.toFixed(2)}%  ${b.mv}` : `—  ${b.mv}`} />
          ))}
          <div style={{ fontSize: 11.5, color: '#8b93a1', marginTop: 9, lineHeight: 1.5 }}>
            An add here takes the growth book from 2.55% toward the 3.00%
            single-name guideline.
          </div>
        </div>
      </div>

      <div style={{ marginTop: 28 }}>
        <DeskH>What happened last time</DeskH>
        {[
          ['2 Jun', 'Add +45bps, +12,000 shs', 'verified'],
          ['28 May', 'Trim −20bps, −5,500 shs', 'assumed'],
          ['20 Jul', 'Reviewed — good: sized correctly, entry early', ''],
        ].map(([d, t, p]) => (
          <div key={d} style={{ display: 'flex', gap: 14, padding: '7px 0', borderBottom: '1px solid #181c23' }}>
            <span style={{ fontFamily: MONO, fontSize: 11, color: '#6b7280', width: 54 }}>{d}</span>
            <span style={{ fontSize: 12.5, flex: 1 }}>{t}</span>
            {p && (
              <span style={{
                fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
                color: p === 'verified' ? '#34d399' : '#fbbf24',
              }}>{p}</span>
            )}
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: '#fbbf24', marginTop: 9 }}>
          {F.memory.unobserved} of {F.memory.executed} executions are not evidenced by an observed fill.
        </div>
      </div>
    </div>
  )
}

function DeskResearch() {
  return (
    <div style={{ maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 4 }}>
        <span style={{ fontSize: 17, fontWeight: 600 }}>Ana Bell's research</span>
        <span style={{ fontSize: 11.5, color: '#6b7280' }}>covering · updated 28 Sep</span>
        <select style={{
          marginLeft: 'auto', background: '#171b22', color: '#e6e8ec',
          border: '1px solid #262b34', borderRadius: 3, fontSize: 11.5, padding: '4px 8px',
        }}>
          <option>Ana Bell (covering)</option>
          <option>Tom Vega</option>
          <option>Firm valuation</option>
        </select>
      </div>
      <div style={{ fontSize: 11.5, color: '#6b7280', marginBottom: 18 }}>
        The full document, unchanged — sections, ratings, scenarios, charts and editing.
      </div>
      {[['Investment thesis', F.thesis.text], ['Where our thesis differs', F.differ.text], ['Risks to the thesis', F.risk.text]].map(([h, b]) => (
        <div key={h} style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 5 }}>{h}</div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: '#c3c8d1', maxWidth: '68ch' }}>{b}</p>
        </div>
      ))}
    </div>
  )
}

function DeskPosition() {
  return (
    <div style={{ maxWidth: 900 }}>
      <DeskH>Exposure · at book price, as of 10 Oct</DeskH>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
        <thead>
          <tr style={{ color: '#6b7280', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {['Book', 'Weight', 'Market value', 'Unrealised'].map((h, i) => (
              <th key={h} style={{ textAlign: i ? 'right' : 'left', padding: '0 0 8px', fontWeight: 500 }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {F.books.map(b => (
            <tr key={b.name} style={{ borderTop: '1px solid #181c23' }}>
              <td style={{ padding: '9px 0' }}>{b.name}</td>
              <td style={{ textAlign: 'right', fontFamily: MONO }}>{b.weight != null ? `${b.weight.toFixed(2)}%` : '—'}</td>
              <td style={{ textAlign: 'right', fontFamily: MONO }}>{b.mv}</td>
              <td style={{ textAlign: 'right', fontFamily: MONO, color: b.pnl.startsWith('-') ? '#f87171' : '#34d399' }}>{b.pnl}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 10 }}>
        Each weight is against its own book's market value. They are not summed.
      </div>
    </div>
  )
}

function Kv({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, padding: '5px 0', borderBottom: '1px solid #181c23' }}>
      <span style={{ fontSize: 12, color: '#8b93a1' }}>{k}</span>
      <span style={{ fontSize: 12, fontFamily: MONO }}>{v}</span>
    </div>
  )
}

function DeskBtn({ children, primary }: { children: React.ReactNode; primary?: boolean }) {
  return (
    <button style={{
      fontSize: 12, padding: '6px 13px', borderRadius: 3, cursor: 'pointer',
      border: `1px solid ${primary ? '#1d4ed8' : '#2b313b'}`,
      background: primary ? '#1d4ed8' : 'transparent',
      color: primary ? '#fff' : '#c3c8d1',
    }}>{children}</button>
  )
}

/* ═══════════════════════════════════════════════════════════ mobile ═════ */

/** A at 390px: the same document, one column, margin figures inlined. */
function MobileA() {
  return (
    <div style={{ background: '#fbfbfa', minHeight: '100%', color: '#14161a', padding: '16px 18px 40px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
        <span style={{ fontSize: 17, fontWeight: 650 }}>{F.symbol}</span>
        <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{F.price.toFixed(2)}</span>
        <span style={{ fontFamily: MONO, fontSize: 11, color: '#b91c1c' }}>{F.change}%</span>
      </div>
      <h1 style={{ margin: '14px 0 0', fontSize: 20, lineHeight: 1.3, fontWeight: 600, letterSpacing: '-0.01em' }}>
        We rate it <Mark>Buy</Mark> to <Mark>$268</Mark>, and own <Mark>2.55%</Mark> against it.
      </h1>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#6b7280' }}>
        3 of 5 analysts · {F.down}% / +{F.up}% · {F.skew}
      </p>
      <div style={{
        marginTop: 14, padding: '10px 12px', background: '#fff',
        border: '1px solid #e7e5e1', borderLeft: '3px solid #2563eb', borderRadius: 3,
      }}>
        <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#2563eb' }}>
          Waiting on you
        </div>
        <div style={{ fontSize: 13.5, marginTop: 3 }}>{F.pending.action} in {F.pending.book}</div>
        <div style={{ display: 'flex', gap: 7, marginTop: 9 }}><Btn primary>Decide</Btn><Btn>Open</Btn></div>
      </div>
      {[['Where we differ', F.differ], ['The thesis', F.thesis], ['What breaks it', F.risk]].map(([k, s]: any) => (
        <div key={k} style={{ marginTop: 20, borderTop: '1px solid #e7e5e1', paddingTop: 12 }}>
          <div style={{ fontSize: 10, letterSpacing: '0.09em', textTransform: 'uppercase', color: '#9ca3af' }}>{k}</div>
          <div style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 2 }}>{s.who} · {s.when}</div>
          <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.55 }}>{s.text}</p>
        </div>
      ))}
      <div style={{ marginTop: 20, borderTop: '1px solid #e7e5e1', paddingTop: 12 }}><Ladder /></div>
      <div style={{ marginTop: 16 }}><Exposure /></div>
    </div>
  )
}

/** B at 390px: the situation column IS the phone; detail is a push. */
function MobileB() {
  const [open, setOpen] = useState(false)
  if (open) {
    return (
      <div style={{ background: '#0f1115', color: '#e6e8ec', minHeight: '100%', padding: '14px 16px 40px' }}>
        <button onClick={() => setOpen(false)} style={{
          background: 'none', border: 'none', color: '#60a5fa', fontSize: 12, padding: 0, cursor: 'pointer',
        }}>← {F.symbol}</button>
        <div style={{ marginTop: 12 }}><DeskDecision /></div>
      </div>
    )
  }
  return (
    <div style={{ background: '#0f1115', color: '#e6e8ec', minHeight: '100%' }}>
      <div style={{ padding: '15px 16px 12px', borderBottom: '1px solid #20242c' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 9 }}>
          <span style={{ fontSize: 17, fontWeight: 650 }}>{F.symbol}</span>
          <span style={{ fontFamily: MONO, fontSize: 12.5 }}>{F.price.toFixed(2)}</span>
          <span style={{ fontFamily: MONO, fontSize: 11, color: '#f87171' }}>{F.change}%</span>
        </div>
        <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#60a5fa', marginTop: 9 }}>
          A decision is waiting
        </div>
      </div>
      <SitItem tone="#3b82f6" active onClick={() => setOpen(true)}
        title={`${F.pending.action} in ${F.pending.book}`}
        meta={`${F.pending.by} · ${F.pending.age}`} action="Decide" />
      <SitItem tone="#f59e0b" active={false} onClick={() => setOpen(true)}
        title="Rated Buy by 3 of 5, with a pending add" meta="asset_ratings · decision_requests" />
      <SitItem tone="#6b7280" active={false} onClick={() => setOpen(true)}
        title="4 of 5 executions not evidenced by a fill" meta="portfolio_trade_events" />
      <SitItem tone="#6b7280" active={false} onClick={() => setOpen(true)}
        title="Held in 3 books · 2.55% largest" meta="portfolio_holdings" />
    </div>
  )
}

/* ═════════════════════════════════════════════════════════════ entry ════ */

export function DesignDirections({ dir, mobile }: { dir: 'a' | 'b'; mobile: boolean }) {
  if (mobile) return dir === 'a' ? <MobileA /> : <MobileB />
  return dir === 'a' ? <DirectionA /> : <DirectionB />
}
