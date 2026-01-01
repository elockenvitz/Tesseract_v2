import React, { useState, useRef, useEffect } from 'react'
import { Plus, FileText, Upload, Link2, ChevronDown } from 'lucide-react'
import { Button } from '../ui/Button'
import clsx from 'clsx'

interface AddNoteDropdownProps {
  onCreateNote: () => void
  onUploadDocument: (file: File) => void
  onLinkExternal: () => void
  disabled?: boolean
  className?: string
}

const acceptedFileTypes = [
  '.doc', '.docx', '.pdf', '.txt', '.rtf', '.md',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/pdf',
  'text/plain',
  'text/markdown'
].join(',')

export function AddNoteDropdown({
  onCreateNote,
  onUploadDocument,
  onLinkExternal,
  disabled = false,
  className
}: AddNoteDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      onUploadDocument(file)
      setIsOpen(false)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  const menuItems = [
    {
      icon: FileText,
      label: 'Create New Note',
      description: 'Write a note in the editor',
      onClick: () => {
        onCreateNote()
        setIsOpen(false)
      }
    },
    {
      icon: Upload,
      label: 'Upload Document',
      description: 'Word, PDF, text files',
      onClick: () => {
        fileInputRef.current?.click()
      }
    },
    {
      icon: Link2,
      label: 'Link External',
      description: 'Google Docs, Notion, etc.',
      onClick: () => {
        onLinkExternal()
        setIsOpen(false)
      }
    }
  ]

  return (
    <div ref={dropdownRef} className={clsx('relative', className)}>
      <Button
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        disabled={disabled}
        className="gap-1"
      >
        <Plus className="h-4 w-4" />
        Add Note
        <ChevronDown className={clsx('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={acceptedFileTypes}
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Dropdown menu */}
      {isOpen && (
        <div className="absolute right-0 mt-1 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50">
          {menuItems.map((item, index) => (
            <button
              key={index}
              onClick={item.onClick}
              className="w-full px-4 py-2.5 flex items-start gap-3 hover:bg-gray-50 transition-colors text-left"
            >
              <item.icon className="h-5 w-5 text-gray-500 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-medium text-sm text-gray-900">{item.label}</div>
                <div className="text-xs text-gray-500">{item.description}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
