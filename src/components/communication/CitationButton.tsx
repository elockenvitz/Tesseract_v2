import { Quote } from 'lucide-react'
import { clsx } from 'clsx'

interface CitationButtonProps {
  onCite: (content: string, fieldName?: string) => void
  content: string
  fieldName?: string
  className?: string
}

export function CitationButton({ onCite, content, fieldName, className }: CitationButtonProps) {
  const handleCite = () => {
    onCite(content, fieldName)
  }

  return (
    <button
      onClick={handleCite}
      className={clsx(
        'inline-flex items-center px-2 py-1 text-xs text-gray-500 hover:text-primary-600 hover:bg-primary-50 rounded transition-colors',
        className
      )}
      title={`Cite ${fieldName ? `${fieldName} content` : 'this content'} in discussion`}
    >
      <Quote className="h-3 w-3 mr-1" />
      Cite
    </button>
  )
}