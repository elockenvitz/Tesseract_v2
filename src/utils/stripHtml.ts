/**
 * Strip HTML tags from a string for plain text preview
 * Excludes file attachments, images, and other embedded media
 */
export function stripHtml(html: string): string {
  if (!html) return ''

  // Try DOMParser first (more accurate)
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')

      // Remove file attachments and other embedded elements that shouldn't count as text
      const elementsToRemove = doc.querySelectorAll(
        '[data-type="file-attachment"], [data-type="inline-event"], [data-type="inline-task"], ' +
        'img, video, audio, iframe, object, embed, svg, canvas, script, style'
      )
      elementsToRemove.forEach(el => el.remove())

      // Add spaces after block elements so text doesn't concatenate
      const blockElements = doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, br, hr')
      blockElements.forEach(el => {
        // Insert a space text node after each block element
        el.insertAdjacentText('afterend', ' ')
      })

      // Get text content
      const text = doc.body.textContent || ''

      // Collapse multiple spaces and trim
      return text.replace(/\s+/g, ' ').trim()
    } catch {
      // Fall through to regex
    }
  }

  // Fallback: regex-based stripping
  // First remove file attachments and embedded content
  let cleaned = html
    .replace(/<div[^>]*data-type="file-attachment"[^>]*>[\s\S]*?<\/div>/gi, '')  // Remove file attachments
    .replace(/<div[^>]*data-type="inline-event"[^>]*>[\s\S]*?<\/div>/gi, '')    // Remove inline events
    .replace(/<div[^>]*data-type="inline-task"[^>]*>[\s\S]*?<\/div>/gi, '')     // Remove inline tasks
    .replace(/<img[^>]*>/gi, '')     // Remove images
    .replace(/<video[^>]*>[\s\S]*?<\/video>/gi, '')  // Remove videos
    .replace(/<audio[^>]*>[\s\S]*?<\/audio>/gi, '')  // Remove audio
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, '')      // Remove SVGs
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')  // Remove styles
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '') // Remove scripts

  // Now strip remaining HTML
  return cleaned
    .replace(/<\/(p|div|h[1-6]|li|tr|blockquote)>/gi, ' ')  // Add space after closing block tags
    .replace(/<(br|hr)\s*\/?>/gi, ' ')  // Add space for line breaks
    .replace(/<[^>]*>/g, '')   // Remove remaining tags
    .replace(/&nbsp;/g, ' ')   // Replace &nbsp;
    .replace(/&amp;/g, '&')    // Replace &amp;
    .replace(/&lt;/g, '<')     // Replace &lt;
    .replace(/&gt;/g, '>')     // Replace &gt;
    .replace(/&quot;/g, '"')   // Replace &quot;
    .replace(/&#39;/g, "'")    // Replace &#39;
    .replace(/\s+/g, ' ')      // Collapse multiple spaces
    .trim()
}

/**
 * Get a preview of content with HTML stripped, truncated to max length
 * Only shows the first paragraph/line for cleaner previews
 */
export function getContentPreview(html: string, maxLength: number = 80): string {
  if (!html) return ''

  // Extract just the first paragraph's text
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html')

      // Add spaces after block elements so text doesn't concatenate
      const blockElements = doc.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, tr, blockquote, br, hr')
      blockElements.forEach(el => {
        el.insertAdjacentText('afterend', ' ')
      })

      // Get the first block element or just the first text content
      const firstBlock = doc.body.querySelector('p, div, h1, h2, h3, h4, h5, h6, li')
      const text = (firstBlock?.textContent || doc.body.textContent || '')
        .replace(/\s+/g, ' ')
        .trim()

      if (text.length <= maxLength) return text
      return text.substring(0, maxLength).trim() + '...'
    } catch {
      // Fall through
    }
  }

  // Fallback: get text before first closing block tag
  const firstParagraph = html
    .replace(/<\/(p|div|h[1-6]|li|blockquote)>[\s\S]*/i, '')  // Remove everything after first block
    .replace(/<[^>]*>/g, '')  // Strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()

  if (firstParagraph.length <= maxLength) return firstParagraph
  return firstParagraph.substring(0, maxLength).trim() + '...'
}
