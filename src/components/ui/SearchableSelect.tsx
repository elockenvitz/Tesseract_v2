// src/components/ui/SearchableSelect.tsx
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { ChevronDown, Search, X } from 'lucide-react'
import { clsx } from 'clsx'
import { Input } from './Input'

interface Option {
  value: string
  label: string
  [key: string]: any // Allow for additional properties like email, first_name, etc.
}

interface SearchableSelectProps {
  label?: string
  placeholder?: string
  options: Option[]
  value: Option | null
  onChange: (selectedOption: Option | null) => void
  className?: string
  disabled?: boolean
  loading?: boolean
  displayKey?: string // Key to display in the input when an option is selected (e.g., 'label', 'email')
  autocomplete?: string; // ADD THIS PROP
}

export function SearchableSelect({
  label,
  placeholder = 'Select an option...',
  options,
  value,
  onChange,
  className,
  disabled,
  loading,
  displayKey = 'label',
  autocomplete, // DESTRUCTURE THIS PROP
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const dropdownRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Sync internal search query with selected value's displayKey
  useEffect(() => {
    if (value) {
      setSearchQuery(value[displayKey] || value.label)
    } else {
      setSearchQuery('')
    }
  }, [value, displayKey])

  // Filter options based on search query
  const filteredOptions = useMemo(() => {
    if (!searchQuery) {
      return options
    }
    const lowerCaseQuery = searchQuery.toLowerCase()
    return options.filter(
      (option) =>
        option.label.toLowerCase().includes(lowerCaseQuery) ||
        (option.email && option.email.toLowerCase().includes(lowerCaseQuery)) || // Assuming email might be a search target
        (option.first_name && option.first_name.toLowerCase().includes(lowerCaseQuery)) ||
        (option.last_name && option.last_name.toLowerCase().includes(lowerCaseQuery))
    )
  }, [searchQuery, options])

  // Handle clicks outside to close the dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
        // If no value is selected, clear search query on blur
        if (!value) {
          setSearchQuery('')
        }
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [value])

  const handleSelectOption = (option: Option) => {
    onChange(option)
    setIsOpen(false)
    setSearchQuery(option[displayKey] || option.label) // Set input text to selected option's display value
  }

  const handleClearSelection = (e: React.MouseEvent) => {
    e.stopPropagation() // Prevent opening dropdown
    onChange(null)
    setSearchQuery('')
    setIsOpen(false)
    inputRef.current?.focus()
  }

  return (
    <div className={clsx('relative', className)} ref={dropdownRef}>
      <Input
        label={label}
        type="text"
        placeholder={placeholder}
        value={searchQuery}
        onChange={(e) => {
          setSearchQuery(e.target.value)
          setIsOpen(true)
          onChange(null) // Clear selected value when typing
        }}
        onFocus={() => setIsOpen(true)}
        disabled={disabled}
        loading={loading}
        ref={inputRef}
        autocomplete={autocomplete} // PASS autocomplete PROP TO Input
        rightAdornment={
          value ? (
            <button
              type="button"
              onClick={handleClearSelection}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-full"
              aria-label="Clear selection"
            >
              <X className="h-4 w-4" />
            </button>
          ) : (
            <ChevronDown className="h-4 w-4 text-gray-400" />
          )
        }
      />

      {isOpen && (searchQuery.length > 0 || filteredOptions.length > 0) && (
        <div className="absolute z-10 w-full bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-60 overflow-y-auto custom-scrollbar">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleSelectOption(option)}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 flex items-center space-x-2"
              >
                <Search className="h-4 w-4 text-gray-400" /> {/* Or a user icon */}
                <div>
                  <p className="font-medium">{option.label}</p>
                  {option.email && <p className="text-xs text-gray-500">{option.email}</p>}
                </div>
              </button>
            ))
          ) : (
            <div className="px-4 py-2 text-sm text-gray-500">No matching options</div>
          )}
        </div>
      )}
    </div>
  )
}
