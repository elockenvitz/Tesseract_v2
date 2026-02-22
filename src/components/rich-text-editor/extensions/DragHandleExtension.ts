import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let dragHandle: HTMLElement | null = null
    let dropLine: HTMLElement | null = null
    let currentNode: { pos: number; node: any; dom: HTMLElement } | null = null
    let isDragging = false
    let dropTargetPos: number | null = null
    let editorView: any = null
    // Resolved lazily — initial contentArea may be a temp element before EditorContent mounts
    let resolvedContentArea: HTMLElement | null = null

    const createHandle = () => {
      const el = document.createElement('div')
      el.className = 'editor-drag-handle'
      el.innerHTML = `<svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
        <circle cx="4" cy="2.5" r="1.3"/>
        <circle cx="10" cy="2.5" r="1.3"/>
        <circle cx="4" cy="7" r="1.3"/>
        <circle cx="10" cy="7" r="1.3"/>
        <circle cx="4" cy="11.5" r="1.3"/>
        <circle cx="10" cy="11.5" r="1.3"/>
      </svg>`
      return el
    }

    const createDropLine = () => {
      const el = document.createElement('div')
      el.className = 'editor-drop-line'
      return el
    }

    // Dynamically resolve the content area — handles the case where
    // view.dom is reparented by EditorContent after plugin init
    const getContentArea = (): HTMLElement | null => {
      if (!editorView?.dom) return null
      // After EditorContent mounts, view.dom is inside .editor-content
      const area = (editorView.dom.closest('.editor-content') || editorView.dom.parentElement) as HTMLElement | null
      if (area && area !== resolvedContentArea) {
        resolvedContentArea = area
        area.style.position = 'relative'
        // Re-append elements to the correct parent if needed
        if (dragHandle && dragHandle.parentElement !== area) {
          area.appendChild(dragHandle)
        }
        if (dropLine && dropLine.parentElement !== area) {
          area.appendChild(dropLine)
        }
      }
      return resolvedContentArea
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

    const showHandle = (mouseY: number) => {
      if (!editorView || !dragHandle) return
      const contentArea = getContentArea()
      if (!contentArea) return

      const block = getBlockAtY(editorView, mouseY)
      if (!block) {
        dragHandle.style.opacity = '0'
        dragHandle.style.pointerEvents = 'none'
        currentNode = null
        return
      }

      try {
        const blockNode = editorView.state.doc.nodeAt(block.pos)
        if (!blockNode) {
          dragHandle.style.opacity = '0'
          dragHandle.style.pointerEvents = 'none'
          currentNode = null
          return
        }

        const contentRect = contentArea.getBoundingClientRect()
        const blockRect = block.dom.getBoundingClientRect()

        dragHandle.style.left = '2px'
        dragHandle.style.top = `${blockRect.top - contentRect.top + contentArea.scrollTop + (blockRect.height / 2) - 12}px`
        dragHandle.style.pointerEvents = 'auto'

        if (dragHandle.style.opacity !== '1') {
          dragHandle.style.opacity = '0.6'
        }

        currentNode = { pos: block.pos, node: blockNode, dom: block.dom }
      } catch (e) {
        dragHandle.style.opacity = '0'
        dragHandle.style.pointerEvents = 'none'
        currentNode = null
      }
    }

    const hideHandle = () => {
      if (isDragging) return
      if (dragHandle) {
        dragHandle.style.opacity = '0'
        dragHandle.style.background = ''
        dragHandle.style.pointerEvents = 'none'
      }
      currentNode = null
    }

    const updateDropLine = (y: number) => {
      if (!editorView || !dropLine) return
      const contentArea = getContentArea()
      if (!contentArea) return

      const block = getBlockAtY(editorView, y)
      if (!block) {
        dropLine.style.opacity = '0'
        dropTargetPos = null
        return
      }

      const contentRect = contentArea.getBoundingClientRect()
      const blockMid = (block.top + block.bottom) / 2

      const insertBefore = y < blockMid
      const lineY = insertBefore
        ? block.top - contentRect.top + contentArea.scrollTop
        : block.bottom - contentRect.top + contentArea.scrollTop

      dropLine.style.top = `${lineY}px`
      dropLine.style.opacity = '1'

      if (insertBefore) {
        dropTargetPos = block.pos
      } else {
        const node = editorView.state.doc.nodeAt(block.pos)
        dropTargetPos = node ? block.pos + node.nodeSize : block.pos
      }
    }

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
          if (currentNode?.dom) currentNode.dom.style.opacity = ''
          return
        }

        const tr = state.tr
        tr.delete(fromPos, fromPos + node.nodeSize)

        if (targetPos > fromPos) targetPos -= node.nodeSize

        tr.insert(targetPos, node)
        dispatch(tr)

        if (currentNode?.dom) currentNode.dom.style.opacity = ''
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
        dragHandle.style.pointerEvents = 'none'
      }
      if (currentNode?.dom) currentNode.dom.style.opacity = ''
    }

    // Document-level mousemove — dynamically resolves contentArea bounds
    const handleDocMouseMove = (e: MouseEvent) => {
      if (isDragging || !editorView || !dragHandle) return

      const contentArea = getContentArea()
      if (!contentArea) return

      const rect = contentArea.getBoundingClientRect()
      const inGutter =
        e.clientX >= rect.left - 4 &&
        e.clientX <= rect.left + 28 &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom

      if (inGutter) {
        showHandle(e.clientY)
      } else {
        hideHandle()
      }
    }

    return [
      new Plugin({
        key: new PluginKey('dragHandle'),
        view: (view) => {
          editorView = view
          dragHandle = createHandle()
          dropLine = createDropLine()

          // Try to append immediately — elements will be re-appended
          // to the correct parent lazily via getContentArea() if needed
          const initialParent = (view.dom.closest('.editor-content') || view.dom.parentElement) as HTMLElement
          if (initialParent) {
            initialParent.style.position = 'relative'
            initialParent.appendChild(dragHandle)
            initialParent.appendChild(dropLine)
            resolvedContentArea = initialParent
          }

          // Document-level listener — always fires regardless of DOM nesting/reparenting
          document.addEventListener('mousemove', handleDocMouseMove)
          document.addEventListener('dragover', handleGlobalDragOver)
          document.addEventListener('drop', handleGlobalDrop)
          document.addEventListener('dragend', handleGlobalDragEnd)

          // Handle hover highlight on the drag handle itself
          dragHandle.addEventListener('mouseenter', () => {
            if (dragHandle) {
              dragHandle.style.opacity = '1'
              dragHandle.style.background = '#f1f5f9'
            }
          })

          dragHandle.addEventListener('mouseleave', () => {
            if (dragHandle && !isDragging) {
              dragHandle.style.opacity = '0.6'
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

            const ghost = document.createElement('div')
            ghost.style.cssText = `
              position: fixed; top: -100px; left: -100px;
              padding: 6px 12px; background: #4f46e5; color: white;
              font-size: 12px; font-weight: 500; border-radius: 4px;
              box-shadow: 0 2px 8px rgba(79, 70, 229, 0.4);
              max-width: 200px; white-space: nowrap;
              overflow: hidden; text-overflow: ellipsis;
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
              document.removeEventListener('mousemove', handleDocMouseMove)
              document.removeEventListener('dragover', handleGlobalDragOver)
              document.removeEventListener('drop', handleGlobalDrop)
              document.removeEventListener('dragend', handleGlobalDragEnd)
              dragHandle?.remove()
              dropLine?.remove()
              dragHandle = null
              dropLine = null
              editorView = null
              resolvedContentArea = null
            }
          }
        }
      })
    ]
  }
})
