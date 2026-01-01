import React, { useState, useRef, useEffect } from 'react'
import { Plus, Upload, Link2, ChevronDown, FileSpreadsheet } from 'lucide-react'
import { Button } from '../ui/Button'
import clsx from 'clsx'

interface AddModelDropdownProps {
  onUploadModel: (file: File) => void
  onLinkExternal: () => void
  disabled?: boolean
  className?: string
}

const acceptedFileTypes = [
  '.xlsx', '.xls', '.xlsm', '.csv', '.numbers',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
  'text/csv'
].join(',')

export function AddModelDropdown({
  onUploadModel,
  onLinkExternal,
  disabled = false,
  className
}: AddModelDropdownProps) {
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
      onUploadModel(file)
      setIsOpen(false)
    }
    // Reset input so same file can be selected again
    e.target.value = ''
  }

  const menuItems = [
    {
      icon: Upload,
      label: 'Upload Model',
      description: 'Excel, CSV files',
      onClick: () => {
        fileInputRef.current?.click()
      }
    },
    {
      icon: Link2,
      label: 'Link External',
      description: 'Google Sheets, Airtable, etc.',
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
        Add Model
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
