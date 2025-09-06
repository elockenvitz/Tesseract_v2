import { useState, useRef, useEffect } from 'react'
import { ChevronDown } from 'lucide-react'
import { clsx } from 'clsx'

interface BadgeSelectProps {
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  variant?: 'default' | 'primary' | 'success' | 'warning' | 'error'
  size?: 'sm' | 'md'
  className?: string
}

export function BadgeSelect({ 
  value, 
  onChange, 
  options, 
  variant = 'default', 
  size = 'sm',
  className 
}: BadgeSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const baseClasses = 'inline-flex items-center font-medium rounded-full cursor-pointer transition-colors'
  
  const variants = {
    default: 'bg-gray-100 text-gray-800 hover:bg-gray-200',
    primary: 'bg-primary-100 text-primary-800 hover:bg-primary-200',
    success: 'bg-success-100 text-success-800 hover:bg-success-200',
    warning: 'bg-warning-100 text-warning-800 hover:bg-warning-200',
    error: 'bg-error-100 text-error-800 hover:bg-error-200',
  }
  
  const sizes = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  }

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleSelect = (optionValue: string) => {
    console.log('🔄 BadgeSelect handleSelect called:', { from: value, to: optionValue })
    onChange(optionValue)
    setIsOpen(false)
  }

  const currentOption = options.find(option => option.value === value)

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={clsx(
          baseClasses,
          variants[variant],
          sizes[size],
          className
        )}
      >
        {currentOption?.label || value}
        <ChevronDown className="ml-1 h-3 w-3" />
      </button>

      {isOpen && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50 min-w-[140px]">
          {options.map((option) => (
            <button
              key={option.value}
              onClick={() => handleSelect(option.value)}
              className={clsx(
                'w-full px-3 py-1.5 text-left text-xs hover:bg-gray-50 transition-colors block',
                option.value === value && 'bg-gray-100'
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}