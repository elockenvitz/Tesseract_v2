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
    <div className="p-6">
      {/* No Models Available Message */}
      <Card className="text-center">
        <div className="py-8">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Bot className="h-8 w-8 text-gray-400" />
          </div>
          
          <h3 className="text-lg font-medium text-gray-900 mb-2">
            Models Not Available
          </h3>
          
          <p className="text-gray-600 mb-6 max-w-sm mx-auto">
            AI model integrations are not currently activated for your account. 
            Contact your administrator to enable AI assistance features.
          </p>
          
          <div className="flex items-center justify-center space-x-2 text-sm text-gray-500 bg-gray-50 rounded-lg p-3 mb-6">
            <AlertCircle className="h-4 w-4 text-warning-500" />
            <span>Administrator approval required</span>
          </div>
          
          <Button variant="outline" size="sm">
            <Mail className="h-4 w-4 mr-2" />
            Contact Administrator
          </Button>
        </div>
      </Card>

      {/* Future AI Models Preview */}
      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-700 mb-3">Available AI Models (When Activated)</h4>
        <div className="space-y-3">
          {[
            { name: 'Claude Sonnet 4', description: 'Advanced reasoning and analysis', status: 'pending' },
            { name: 'GPT-4 Turbo', description: 'General purpose AI assistant', status: 'pending' },
            { name: 'Gemini Pro', description: 'Google\'s multimodal AI', status: 'pending' }
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