import { useState } from 'react'
import { History, ArrowLeft } from 'lucide-react'
import { Card } from './Card'
import { Badge } from './Badge'
import { EditableField } from './EditableField'
import { TimeHorizonSelector } from './TimeHorizonSelector'
import { CaseHistory } from './CaseHistory'
import { clsx } from 'clsx'

interface CaseCardProps {
  caseType: 'bull' | 'base' | 'bear'
  priceTarget: any
  onPriceTargetSave: (type: 'bull' | 'base' | 'bear', field: string, value: string) => Promise<void>
}

export function CaseCard({ caseType, priceTarget, onPriceTargetSave }: CaseCardProps) {
  const [showHistory, setShowHistory] = useState(false)

  const getCaseVariant = (type: string) => {
    switch (type) {
      case 'bull': return 'success'
      case 'base': return 'warning'
      case 'bear': return 'error'
      default: return 'default'
    }
  }

  const getCaseLabel = (type: string) => {
    return `${type.charAt(0).toUpperCase() + type.slice(1)} Case`
  }

  return (
    <Card padding="none" className="relative overflow-hidden">
      <div className={clsx(
        "transition-transform duration-500 ease-in-out",
        showHistory ? "transform -translate-x-full" : "transform translate-x-0"
      )}>
        {/* Front Side - Price Target Form */}
        <div className="p-4">
          <div className="text-center">
            <div className="flex items-center justify-between mb-4">
              <Badge variant={getCaseVariant(caseType)} size="sm">
                {getCaseLabel(caseType)}
              </Badge>
              <button
                onClick={() => setShowHistory(true)}
                className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
                title={`View ${caseType} case history`}
              >
                <History className="h-4 w-4" />
              </button>
            </div>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Price Target</label>
                <EditableField
                  value={priceTarget?.price || ''}
                  onSave={(value) => onPriceTargetSave(caseType, 'price', value)}
                  placeholder="Set price"
                  type="number"
                  prefix="$"
                  displayClassName="text-2xl font-bold text-gray-900 text-center"
                  inputClassName="text-2xl font-bold text-gray-900 text-center"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Time Horizon</label>
                <TimeHorizonSelector
                  value={priceTarget?.timeframe || ''}
                  onSave={(value) => onPriceTargetSave(caseType, 'timeframe', value)}
                  displayClassName="text-sm text-gray-500 text-center"
                />
              </div>
              
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reasoning</label>
                <EditableField
                  value={priceTarget?.reasoning || ''}
                  onSave={(value) => onPriceTargetSave(caseType, 'reasoning', value)}
                  placeholder="Add reasoning..."
                  displayClassName="text-xs text-gray-600 text-center min-h-[40px] flex items-center justify-center"
                  inputClassName="text-xs text-gray-600 text-center min-h-[40px]"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Back Side - History */}
      <div className={clsx(
        "absolute inset-0 transition-transform duration-500 ease-in-out",
        showHistory ? "transform translate-x-0" : "transform translate-x-full"
      )}>
        <div className="h-full flex flex-col">
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <div className="flex items-center space-x-2">
              <Badge variant={getCaseVariant(caseType)} size="sm">
                {getCaseLabel(caseType)}
              </Badge>
              <span className="text-sm font-medium text-gray-700">History</span>
            </div>
            <button
              onClick={() => setShowHistory(false)}
              className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              title="Back to price target"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
          </div>
          
          <div className="flex-1 overflow-hidden">
            <CaseHistory
              priceTargetId={priceTarget?.id || ''}
              caseType={caseType}
            />
          </div>
        </div>
      </div>
    </Card>
  )
}