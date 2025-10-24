import React from 'react'
import { Bot, Minimize2, Maximize2, X, AlertCircle, Mail } from 'lucide-react'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { clsx } from 'clsx'

interface AISectionProps {
  isOpen: boolean
  onToggle: () => void
  isFullscreen: boolean
  onToggleFullscreen: () => void
}

export function AISection({
  isOpen,
  onToggle,
  isFullscreen,
  onToggleFullscreen
}: AISectionProps) {
  return (
    <div className="p-6 overflow-y-auto h-full">
      {/* No Models Available Message */}
      <Card className="text-center">
        <div className="py-3">
          <div className="w-10 h-10 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-2">
            <Bot className="h-5 w-5 text-gray-400" />
          </div>

          <h3 className="text-sm font-medium text-gray-900 mb-1">
            Models Not Available
          </h3>

          <p className="text-xs text-gray-600 mb-3 max-w-sm mx-auto">
            AI model integrations are not currently activated. Contact your administrator.
          </p>

          <div className="flex items-center justify-center space-x-1.5 text-xs text-gray-500 bg-gray-50 rounded p-1.5 mb-3">
            <AlertCircle className="h-3 w-3 text-warning-500" />
            <span>Admin approval required</span>
          </div>

          <Button variant="outline" size="sm" className="text-xs px-3 py-1">
            <Mail className="h-3 w-3 mr-1.5" />
            Contact Admin
          </Button>
        </div>
      </Card>

      {/* Future AI Models Preview */}
      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Available AI Models (When Activated)</h4>
        <div className="space-y-3">
          {[
            { name: 'GPT-4', description: 'OpenAI\'s most capable model', status: 'pending' },
            { name: 'GPT-4 Turbo', description: 'Faster GPT-4 with extended context', status: 'pending' },
            { name: 'Claude 3 Opus', description: 'Most powerful Claude model', status: 'pending' },
            { name: 'Claude 3 Sonnet', description: 'Balanced Claude model', status: 'pending' },
            { name: 'Gemini Pro', description: 'Google\'s multimodal AI', status: 'pending' },
            { name: 'Gemini Ultra', description: 'Google\'s most advanced model', status: 'pending' }
          ].map((model) => (
            <div key={model.name} className="flex items-center justify-between p-3 border border-gray-200 rounded-lg opacity-50">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <Bot className="h-4 w-4 text-white" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">{model.name}</p>
                  <p className="text-xs text-gray-500">{model.description}</p>
                </div>
              </div>
              <div className="text-xs text-gray-400 bg-gray-100 px-2 py-1 rounded">
                Pending Activation
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}