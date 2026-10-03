/**
 * Supabase Storage bucket names.
 *
 * All of these buckets are PRIVATE. Nothing in this product serves a storage
 * object through a public URL, so `getPublicUrl` is never the right call —
 * it returns a well-formed URL that 400s, and if a bucket were ever flipped
 * to public it would become a permanent unauthenticated link. Resolve access
 * with `useSignedUrl` / `fetchSignedUrl` from `./signed-url` instead.
 *
 * What the database stores for an object is its bucket and PATH. That pair is
 * the object's stable identity and the only safe cache key; a signed URL is a
 * temporary credential derived from it.
 */

/** Organization branding — logos used by templates and exports. */
export const ORG_LOGO_BUCKET = 'template-branding'

/** Screenshots captured into notes. */
export const CAPTURES_BUCKET = 'captures'

/** Workflow template documents. */
export const WORKFLOW_TEMPLATES_BUCKET = 'workflow-templates'

/**
 * The storage path for a `workflow_templates.file_url` value.
 *
 * That column holds a path now. It briefly held a `getPublicUrl` result, which
 * was broken on a private bucket; production has no such rows (the table and
 * the bucket were both empty when this changed), but staging carries no
 * migration ledger, so a URL-shaped value is tolerated rather than trusted.
 * The two-segment reconstruction is the same one the delete path always used.
 */
export function workflowTemplatePath(stored: string): string {
  if (!stored.startsWith('http')) return stored
  return stored.split('/').slice(-2).join('/')
}
