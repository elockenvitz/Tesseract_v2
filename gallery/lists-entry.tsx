/**
 * Mount point for the Lists fixture gallery.
 *
 * A second page rather than a section appended to `main.tsx`: that one is the
 * phone card suite, whose gesture tests drive real pointer input at fixed
 * viewport coordinates, and Lists is a desktop surface that would need a
 * different width anyway.
 */
import { createRoot } from 'react-dom/client'
import '../src/index.css'
import { ListsGallery } from './lists'

createRoot(document.getElementById('root')!).render(<ListsGallery />)
