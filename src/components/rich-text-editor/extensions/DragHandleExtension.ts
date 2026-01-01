import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let dragHandle: HTMLElement | null = null
    let dropLine: HTMLElement | null = null
    let currentNode: { pos: number; node: any; dom: HTMLElement } | null = null
    let isDragging = false
    let isHandleHovered = false
    let dropTargetPos: number | null = null
    let editorView: any = null

    const createHandle = () => {
      const el = document.createElement('div')
      el.className = 'editor-drag-handle'
      el.innerHTML = `<svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
        <circle cx="3.5" cy="2" r="1.2"/>
        <circle cx="8.5" cy="2" r="1.2"/>
        <circle cx="3.5" cy="6" r="1.2"/>
        <circle cx="8.5" cy="6" r="1.2"/>
        <circle cx="3.5" cy="10" r="1.2"/>
        <circle cx="8.5" cy="10" r="1.2"/>
      </svg>`
      return el
    }

    const createDropLine = () => {
      const el = document.createElement('div')
      el.className = 'editor-drop-line'
      return el
    }

    const getBlockAtY = (view: any, y: number) => {
      let closestBlock: { pos: number; dom: HTMLElement; top: number; bottom: number } | null = null
      let minDist = Infinity

      view.state.doc.forEach((node: any, pos: number) => {
        if (!node.isBlock) return

        try {
          const domAtPos = view.domAtPos(pos + 1)
          let blockDom = domAtPos.node as HTMLElement

          if (blockDom.nodeType === Node.TEXT_NODE) {
            blockDom = blockDom.parentElement as HTMLElement
          }

          while (blockDom && blockDom.parentElement !== view.dom) {
            blockDom = blockDom.parentElement as HTMLElement
          }

          if (!blockDom) return

          const rect = blockDom.getBoundingClientRect()
          const mid = rect.top + rect.height / 2
          const dist = Math.abs(y - mid)

          if (dist < minDist) {
            minDist = dist
            closestBlock = { pos, dom: blockDom, top: rect.top, bottom: rect.bottom }
          }
        } catch (e) {}
      })

      return closestBlock
    }

    const updateDropLine = (y: number) => {
      if (!editorView || !dropLine) return

      const block = getBlockAtY(editorView, y)
      if (!block) {
        dropLine.style.opacity = '0'
        dropTargetPos = null
        return
      }

      const contentArea = editorView.dom.closest('.editor-content') as HTMLElement
      if (!contentArea) return

      const contentRect = contentArea.getBoundingClientRect()
      const blockMid = (block.top + block.bottom) / 2

      // Insert before or after based on cursor position
      const insertBefore = y < blockMid
      const lineY = insertBefore
        ? block.top - contentRect.top + contentArea.scrollTop
        : block.bottom - contentRect.top + contentArea.scrollTop

      dropLine.style.top = `${lineY}px`
      dropLine.style.opacity = '1'

      // Calculate target position
      if (insertBefore) {
        dropTargetPos = block.pos
      } else {
        const node = editorView.state.doc.nodeAt(block.pos)
        dropTargetPos = node ? block.pos + node.nodeSize : block.pos
      }
    }

    // Global drag handlers for when cursor is outside ProseMirror
    const handleGlobalDragOver = (e: DragEvent) => {
      if (!isDragging) return
      e.preventDefault()
      updateDropLine(e.clientY)
    }

    const handleGlobalDrop = (e: DragEvent) => {
      if (!isDragging || !editorView) return

      e.preventDefault()
      isDragging = false

      if (dropLine) dropLine.style.opacity = '0'

      const posData = e.dataTransfer?.getData('text/plain')
      if (!posData || dropTargetPos === null) return

      const fromPos = parseInt(posData, 10)

      try {
        const { state, dispatch } = editorView
        const node = state.doc.nodeAt(fromPos)
        if (!node) return

        let targetPos = dropTargetPos

        if (targetPos === fromPos || targetPos === fromPos + node.nodeSize) {
          if (currentNode?.dom) {
            currentNode.dom.style.opacity = ''
          }
          return
        }

        const tr = state.tr
        tr.delete(fromPos, fromPos + node.nodeSize)

        if (targetPos > fromPos) {
          targetPos -= node.nodeSize
        }

        tr.insert(targetPos, node)
        dispatch(tr)

        if (currentNode?.dom) {
          currentNode.dom.style.opacity = ''
        }
      } catch (e) {
        console.error('Drop error:', e)
      }
    }

    const handleGlobalDragEnd = () => {
      isDragging = false
      if (dropLine) dropLine.style.opacity = '0'
      if (dragHandle) {
        dragHandle.style.opacity = '0'
        dragHandle.style.background = ''
      }
      if (currentNode?.dom) {
        currentNode.dom.style.opacity = ''
      }
    }

    return [
      new Plugin({
        key: new PluginKey('dragHandle'),
        view: (view) => {
          editorView = view
          dragHandle = createHandle()
          dropLine = createDropLine()

          const contentArea = view.dom.closest('.editor-content') || view.dom.parentElement
          if (contentArea) {
            (contentArea as HTMLElement).style.position = 'relative'
            contentArea.appendChild(dragHandle)
            contentArea.appendChild(dropLine)
          }

          // Add global listeners
          document.addEventListener('dragover', handleGlobalDragOver)
          document.addEventListener('drop', handleGlobalDrop)
          document.addEventListener('dragend', handleGlobalDragEnd)

          dragHandle.addEventListener('mouseenter', () => {
            isHandleHovered = true
            if (dragHandle) {
              dragHandle.style.opacity = '1'
              dragHandle.style.background = '#f1f5f9'
            }
          })

          dragHandle.addEventListener('mouseleave', () => {
            isHandleHovered = false
            if (dragHandle && !isDragging) {
              dragHandle.style.opacity = '0'
              dragHandle.style.background = ''
            }
          })

          dragHandle.setAttribute('draggable', 'true')

          dragHandle.addEventListener('dragstart', (e) => {
            if (!currentNode) {
              e.preventDefault()
              return
            }

            isDragging = true
            dragHandle!.style.opacity = '1'
            dragHandle!.style.background = '#e0e7ff'

            currentNode.dom.style.opacity = '0.4'

            e.dataTransfer!.effectAllowed = 'move'
            e.dataTransfer!.setData('text/plain', String(currentNode.pos))

            // Minimal drag image
            const ghost = document.createElement('div')
            ghost.style.cssText = `
              position: fixed; top: -100px; left: -100px;
              padding: 6px 12px;
              background: #4f46e5;
              color: white;
              font-size: 12px;
              font-weight: 500;
              border-radius: 4px;
              box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
              max-width: 200px;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
            `
            const text = currentNode.dom.textContent?.trim().slice(0, 30) || 'Block'
            ghost.textContent = text + (text.length >= 30 ? '...' : '')
            document.body.appendChild(ghost)
            e.dataTransfer!.setDragImage(ghost, 0, 0)
            requestAnimationFrame(() => ghost.remove())
          })

          dragHandle.addEventListener('dragend', handleGlobalDragEnd)

          return {
            destroy: () => {
              document.removeEventListener('dragover', handleGlobalDragOver)
              document.removeEventListener('drop', handleGlobalDrop)
              document.removeEventListener('dragend', handleGlobalDragEnd)
              dragHandle?.remove()
              dropLine?.remove()
              dragHandle = null
              dropLine = null
              editorView = null
            }
          }
        },
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (isDragging || isHandleHovered) return false

              const target = event.target as HTMLElement
              if (target.closest('.editor-drag-handle')) return false

              const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
              if (!pos) {
                if (dragHandle && !isHandleHovered) dragHandle.style.opacity = '0'
                currentNode = null
                return false
              }

              try {
                const $pos = view.state.doc.resolve(pos.pos)
                const blockPos = $pos.before(1)
                const blockNode = view.state.doc.nodeAt(blockPos)

                if (!blockNode) {
                  if (dragHandle && !isHandleHovered) dragHandle.style.opacity = '0'
                  currentNode = null
                  return false
                }

                const domAtPos = view.domAtPos(blockPos + 1)
                let blockDom = domAtPos.node as HTMLElement

                if (blockDom.nodeType === Node.TEXT_NODE) {
                  blockDom = blockDom.parentElement as HTMLElement
                }

                while (blockDom && blockDom.parentElement !== view.dom) {
                  blockDom = blockDom.parentElement as HTMLElement
                }

                if (!blockDom || !dragHandle) return false

                const contentArea = view.dom.closest('.editor-content') as HTMLElement
                if (!contentArea) return false

                const contentRect = contentArea.getBoundingClientRect()
                const blockRect = blockDom.getBoundingClientRect()

                dragHandle.style.left = '4px'
                dragHandle.style.top = `${blockRect.top - contentRect.top + contentArea.scrollTop + (blockRect.height / 2) - 10}px`
                dragHandle.style.opacity = '0.4'

                currentNode = { pos: blockPos, node: blockNode, dom: blockDom }
              } catch (e) {
                if (dragHandle && !isHandleHovered) dragHandle.style.opacity = '0'
                currentNode = null
              }

              return false
            }
          }
        }
      })
    ]
  }
})
