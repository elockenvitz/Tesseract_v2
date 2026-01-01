import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { EditorView } from '@tiptap/pm/view'

const AIPromptPluginKey = new PluginKey('aiPrompt')

export interface AIPromptState {
  isActive: boolean
  promptStart: number // Position where the prompt text starts (after ".AI ")
  triggerStart: number // Position where ".AI" starts
  model: string | null
}

export interface AIPromptOptions {
  onSubmit?: (prompt: string, model: string | null) => Promise<string | null>
  onStateChange?: (isActive: boolean) => void
}

export const AIPromptExtension = Extension.create<AIPromptOptions>({
  name: 'aiPrompt',

  addOptions() {
    return {
      onSubmit: undefined,
      onStateChange: undefined,
    }
  },

  addStorage() {
    return {
      isActive: false,
      promptStart: 0,
      triggerStart: 0,
      model: null as string | null,
    }
  },

  addProseMirrorPlugins() {
    const extension = this

    return [
      new Plugin({
        key: AIPromptPluginKey,
        state: {
          init(_, state): AIPromptState {
            // Check initial state for AI prompt mode
            const doc = state.doc
            const selection = state.selection
            const pos = selection.from

            const $pos = doc.resolve(pos)
            const startOfNode = pos - $pos.parentOffset
            const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, '')

            const aiMatch = textBefore.match(/\.ai(\.([a-z0-9]+))?\s/i)

            if (aiMatch && aiMatch.index !== undefined) {
              const triggerStart = startOfNode + aiMatch.index
              const promptStart = triggerStart + aiMatch[0].length

              return {
                isActive: true,
                triggerStart,
                promptStart,
                model: aiMatch[2] || null,
              }
            }

            return {
              isActive: false,
              promptStart: 0,
              triggerStart: 0,
              model: null,
            }
          },
          apply(tr, oldState, _oldEditorState, newEditorState): AIPromptState {
            // Check if we should enter or exit AI prompt mode
            const doc = newEditorState.doc
            const selection = newEditorState.selection
            const pos = selection.from

            // Get text before cursor
            const $pos = doc.resolve(pos)
            const startOfNode = pos - $pos.parentOffset
            const textBefore = $pos.parent.textBetween(0, $pos.parentOffset, '')

            // Pattern: .AI or .AI.model followed by space (and optional text after)
            const aiMatch = textBefore.match(/\.ai(\.([a-z0-9]+))?\s/i)

            if (aiMatch && aiMatch.index !== undefined) {
              // Calculate absolute positions
              const triggerStart = startOfNode + aiMatch.index
              const promptStart = triggerStart + aiMatch[0].length

              return {
                isActive: true,
                triggerStart,
                promptStart,
                model: aiMatch[2] || null,
              }
            }

            return {
              isActive: false,
              promptStart: 0,
              triggerStart: 0,
              model: null,
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = this.getState(state) as AIPromptState
            if (!pluginState?.isActive) return DecorationSet.empty

            const decorations: Decoration[] = []
            const { triggerStart, promptStart } = pluginState
            const pos = state.selection.from

            // Decorate the .AI trigger
            if (triggerStart >= 0 && promptStart > triggerStart) {
              decorations.push(
                Decoration.inline(triggerStart, promptStart, {
                  class: 'ai-prompt-trigger',
                  style: 'color: #9333ea; font-weight: 500;'
                })
              )
            }

            // Decorate the prompt text
            if (promptStart >= 0 && pos > promptStart) {
              decorations.push(
                Decoration.inline(promptStart, pos, {
                  class: 'ai-prompt-text',
                  style: 'color: #9333ea; background-color: rgba(147, 51, 234, 0.1); border-radius: 2px;'
                })
              )
            }

            return DecorationSet.create(state.doc, decorations)
          },
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            const pluginState = this.getState(view.state) as AIPromptState

            if (!pluginState?.isActive) return false

            // Enter to submit
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()

              const { triggerStart, promptStart, model } = pluginState
              const pos = view.state.selection.from

              // Extract the prompt text
              const promptText = view.state.doc.textBetween(promptStart, pos, '')

              if (promptText.trim().length > 0 && extension.options.onSubmit) {
                // Delete the entire .AI command and prompt
                const tr = view.state.tr.delete(triggerStart, pos)
                view.dispatch(tr)

                // Show loading state and call the submit handler
                extension.options.onSubmit(promptText.trim(), model).then((result) => {
                  if (result) {
                    // Insert the AI-generated content
                    view.dispatch(view.state.tr.insertText(result))
                  }
                })
              }

              return true
            }

            // Escape to cancel
            if (event.key === 'Escape') {
              event.preventDefault()

              const { triggerStart } = pluginState
              const pos = view.state.selection.from

              // Delete the entire .AI command and prompt
              const tr = view.state.tr.delete(triggerStart, pos)
              view.dispatch(tr)

              return true
            }

            return false
          },
        },
        view() {
          return {
            update(view) {
              const pluginState = AIPromptPluginKey.getState(view.state) as AIPromptState
              const isActive = pluginState?.isActive || false

              // Update storage
              extension.storage.isActive = isActive
              extension.storage.promptStart = pluginState?.promptStart || 0
              extension.storage.triggerStart = pluginState?.triggerStart || 0
              extension.storage.model = pluginState?.model || null

              // Notify parent
              extension.options.onStateChange?.(isActive)
            },
          }
        },
      }),
    ]
  },
})

export default AIPromptExtension
