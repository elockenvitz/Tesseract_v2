import React from 'react'
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { IdeasWorkspace } from '../src/components/ideas-v2/IdeasWorkspace'

/**
 * The Ideas field at a real desktop width, on the app's own stylesheet.
 *
 * The workspace root is `h-full overflow-y-auto`, so it scrolls inside its
 * parent rather than growing the page. That is right in the app and wrong for
 * a screenshot: a full-page capture would stop at the fold and every row below
 * it would be unreachable. The harness gives it a tall container so the whole
 * field lays out at once. Nothing about the grid depends on the container's
 * height -- cards are placed from the top in rank order either way -- so the
 * first viewport still shows exactly what the app's first viewport shows.
 *
 * `?h=` overrides it, for checking that the real scrolling case still works.
 */
function Harness() {
  const h = new URLSearchParams(location.search).get('h') ?? '3000'
  return (
    <div style={{ height: `${Number(h)}px`, width: '100%' }} data-harness="ideas">
      <IdeasWorkspace />
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><Harness /></React.StrictMode>,
)
