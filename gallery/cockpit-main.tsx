/**
 * A page of its own, not a section of the card gallery.
 *
 * The cockpit's whole claim is about what fits in a viewport, so it has to be
 * the only thing in one. Appending it to `main.tsx` would also move every
 * gesture test's pointer target, which that file's own comments warn about
 * three separate times.
 */
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { CockpitGallery } from './cockpit'

createRoot(document.getElementById('root')!).render(<CockpitGallery />)
