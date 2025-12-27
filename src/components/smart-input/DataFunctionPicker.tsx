import React, { useState } from 'react'
import {
  DollarSign,
  TrendingUp,
  BarChart3,
  PieChart,
  Calculator,
  Percent,
  Camera,
  Radio
} from 'lucide-react'
import { clsx } from 'clsx'
import { DataFunctionType, DATA_FUNCTIONS } from './types'

interface DataFunctionPickerProps {
  query: string
  assetContext: { id: string; symbol: string }
  onSelect: (dataType: DataFunctionType, mode: 'snapshot' | 'live', value?: string) => void
  onClose: () => void
}

const ICONS: Record<DataFunctionType, React.ElementType> = {
  price: DollarSign,
  change: TrendingUp,
  volume: BarChart3,
  marketcap: PieChart,
  pe_ratio: Calculator,
  dividend_yield: Percent
}

export function DataFunctionPicker({
  query,
  assetContext,
  onSelect,
  onClose
}: DataFunctionPickerProps) {
  const [selectedType, setSelectedType] = useState<DataFunctionType | null>(null)
  const [mode, setMode] = useState<'snapshot' | 'live'>('snapshot')

  // Filter functions based on query
  const filteredFunctions = DATA_FUNCTIONS.filter(f =>
    f.type.includes(query.toLowerCase()) ||
    f.label.toLowerCase().includes(query.toLowerCase())
  )

  // If only one match or specific type mentioned, select it
  const directMatch = DATA_FUNCTIONS.find(f => query.toLowerCase() === f.type)

  const handleSelectType = (type: DataFunctionType) => {
    setSelectedType(type)
  }

  const handleConfirm = () => {
    if (selectedType) {
      // In a real implementation, fetch current value for snapshot mode
      const mockValue = selectedType === 'price' ? '$185.50' :
                       selectedType === 'change' ? '+2.5%' :
                       selectedType === 'volume' ? '45.2M' :
                       selectedType === 'marketcap' ? '$2.85T' :
                       selectedType === 'pe_ratio' ? '28.5' :
                       '0.5%'

      onSelect(selectedType, mode, mode === 'snapshot' ? mockValue : undefined)
    }
  }

  // Show type selection
  if (!selectedType && !directMatch) {
    return (
      <div className="p-2">
        <div className="text-xs font-medium text-gray-500 mb-2 px-2">
          Insert data for {assetContext.symbol}
        </div>
        <div className="space-y-1">
          {filteredFunctions.map(func => {
            const Icon = ICONS[func.type]
            return (
              <button
                key={func.type}
                type="button"
                onClick={() => handleSelectType(func.type)}
                className="w-full flex items-center px-3 py-2 text-left hover:bg-gray-50 rounded-lg transition-colors"
              >
                <Icon className="w-4 h-4 mr-3 text-gray-500" />
                <span className="font-medium text-gray-900">{func.label}</span>
              </button>
            )
          })}
        </div>
      </div>
    )
  }

  // Show mode selection
  const typeToUse = selectedType || directMatch?.type
  if (!typeToUse) return null

  const funcInfo = DATA_FUNCTIONS.find(f => f.type === typeToUse)!
  const Icon = ICONS[typeToUse]

  return (
    <div className="p-3">
      <div className="flex items-center mb-3">
        <Icon className="w-5 h-5 mr-2 text-gray-600" />
        <span className="font-medium text-gray-900">{funcInfo.label}</span>
        <span className="ml-2 text-sm text-gray-500">for {assetContext.symbol}</span>
      </div>

      <div className="text-xs font-medium text-gray-500 mb-2">Choose insert mode:</div>

      <div className="space-y-2 mb-4">
        <button
          type="button"
          onClick={() => setMode('snapshot')}
          className={clsx(
            'w-full flex items-center p-3 rounded-lg border-2 transition-colors text-left',
            mode === 'snapshot'
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <Camera className={clsx(
            'w-5 h-5 mr-3',
            mode === 'snapshot' ? 'text-primary-600' : 'text-gray-400'
          )} />
          <div>
            <div className="font-medium text-gray-900">Snapshot</div>
            <div className="text-xs text-gray-500">
              Capture current value (won't change)
            </div>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setMode('live')}
          className={clsx(
            'w-full flex items-center p-3 rounded-lg border-2 transition-colors text-left',
            mode === 'live'
              ? 'border-primary-500 bg-primary-50'
              : 'border-gray-200 hover:border-gray-300'
          )}
        >
          <Radio className={clsx(
            'w-5 h-5 mr-3',
            mode === 'live' ? 'text-primary-600' : 'text-gray-400'
          )} />
          <div>
            <div className="font-medium text-gray-900">Live</div>
            <div className="text-xs text-gray-500">
              Dynamic value that updates in real-time
            </div>
          </div>
        </button>
      </div>

      <div className="flex justify-end space-x-2">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          className="px-3 py-1.5 text-sm font-medium text-white bg-primary-600 hover:bg-primary-700 rounded"
        >
          Insert
        </button>
      </div>
    </div>
  )
}
