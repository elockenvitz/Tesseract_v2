import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'

/**
 * Close a prompt, from wherever the reader is.
 *
 * `PromptDetailView` has owned this write inline, which was fine while the
 * prompt's own view was the only place it could happen. The Ideas feed's
 * "Resolve" progression is a real transition performed WITHOUT opening
 * anything — that is what makes it a CTA rather than a second way to open the
 * prompt — so the write has to be callable from the feed too.
 *
 * The tag model is unchanged in this pass: status lives in `quick_thoughts.tags`
 * as `status:closed`, other tags are preserved, and the status tags already
 * present are stripped first so a row cannot end up claiming two states.
 * Promoting status to a column is a migration and is deliberately separate.
 */
export function usePromptResolve() {
  const qc = useQueryClient()

  return useMutation({
    mutationFn: async ({ promptId, tags }: { promptId: string; tags: string[] | null | undefined }) => {
      const kept = (tags ?? []).filter(t => !t.startsWith('status:'))
      const { error } = await supabase
        .from('quick_thoughts')
        .update({ tags: [...kept, 'status:closed'], updated_at: new Date().toISOString() } as never)
        .eq('id', promptId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      /*
       * The feed reads prompts through `ideas-feed`, and the prompt's own view
       * through its own key. Both are invalidated so a resolve from the feed
       * does not leave the detail showing the old state.
       */
      void qc.invalidateQueries({ queryKey: ['ideas-feed'] })
      void qc.invalidateQueries({ queryKey: ['prompt-detail'] })
      void qc.invalidateQueries({ queryKey: ['direct-open-prompt-count'] })
    },
  })
}
