import React from 'react'
import { diffWords } from 'diff'
import { clsx } from 'clsx'

interface DiffViewProps {
  oldText: string | null
  newText: string
  className?: string
}

export function DiffView({ oldText, newText, className }: DiffViewProps) {
  // If no old text, this is the first version - just show the new text
  if (!oldText) {
    return (
      <div className={clsx('text-gray-700 leading-relaxed', className)}>
        <span className="bg-green-100 text-green-800">{newText}</span>
      </div>
    )
  }

  const diff = diffWords(oldText, newText)

  return (
    <div className={clsx('leading-relaxed', className)}>
      {diff.map((part, index) => {
        if (part.added) {
          return (
            <span
              key={index}
              className="bg-green-100 text-green-800"
            >
              {part.value}
            </span>
          )
        }
        if (part.removed) {
          return (
            <span
              key={index}
              className="bg-red-100 text-red-800 line-through"
            >
              {part.value}
            </span>
          )
        }
        return (
          <span key={index} className="text-gray-700">
            {part.value}
          </span>
        )
      })}
    </div>
  )
}
