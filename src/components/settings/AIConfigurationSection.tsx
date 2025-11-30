import { useState, useEffect } from 'react'
import {
  Bot,
  Key,
  Check,
  AlertCircle,
  Eye,
  EyeOff,
  Loader2,
  ExternalLink,
  Info,
  Sparkles,
  Shield,
  Zap,
  Mail,
  ChevronDown,
  ChevronRight
} from 'lucide-react'
import { useAIConfig, AI_PROVIDERS, type AIProvider } from '../../hooks/useAIConfig'
import { Card } from '../ui/Card'
import { Button } from '../ui/Button'
import { clsx } from 'clsx'

// Provider info with API key URLs
const PROVIDER_INFO: Record<AIProvider, { url: string; urlLabel: string }> = {
  anthropic: { url: 'https://console.anthropic.com/', urlLabel: 'console.anthropic.com' },
  openai: { url: 'https://platform.openai.com/api-keys', urlLabel: 'platform.openai.com' },
  google: { url: 'https://aistudio.google.com/app/apikey', urlLabel: 'aistudio.google.com' },
  perplexity: { url: 'https://www.perplexity.ai/settings/api', urlLabel: 'perplexity.ai/settings/api' },
}

export function AIConfigurationSection() {
  const {
    userConfig,
    effectiveConfig,
    isLoading,
    updateConfig,
    isUpdating,
    testApiKeyAsync,
    isTesting,
    testError,
    testSuccess,
    clearApiKey,
    isClearing,
  } = useAIConfig()

  // Local form state
  const [provider, setProvider] = useState<AIProvider>('anthropic')
  const [apiKey, setApiKey] = useState('')
  const [showApiKey, setShowApiKey] = useState(false)

  // Collapsible sections - Platform expanded by default, BYOK collapsed
  const [platformExpanded, setPlatformExpanded] = useState(true)
  const [byokExpanded, setByokExpanded] = useState(false)

  // Initialize from user config
  useEffect(() => {
    if (userConfig) {
      setProvider(userConfig.byok_provider || 'anthropic')
    }
  }, [userConfig])

  const handleTestConnection = async () => {
    if (!apiKey) return

    try {
      await testApiKeyAsync({ provider, apiKey })
    } catch (e) {
      // Error handled by mutation
    }
  }

  const handleSave = async () => {
    updateConfig({
      byok_provider: provider,
      byok_api_key: apiKey || undefined,
      byok_enabled: !!apiKey,
    })
    setApiKey('') // Clear the input after saving
  }

  const handleDisconnect = () => {
    clearApiKey()
    setApiKey('')
  }

  if (isLoading) {
    return (
      <Card>
        <div className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      </Card>
    )
  }

  const isPlatformEnabled = effectiveConfig.isPlatformEnabled
  const isConfigured = effectiveConfig.isConfigured && effectiveConfig.mode === 'byok'

  return (
    <Card>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <div className="flex items-center space-x-2">
            <Sparkles className="h-5 w-5 text-primary-500" />
            <h3 className="text-lg font-medium text-gray-900 dark:text-white">AI Configuration</h3>
          </div>
          <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
            Configure AI-powered features for investment analysis
          </p>
        </div>

        {/* Platform AI Section - Collapsible */}
        <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {/* Collapsible Header */}
          <button
            onClick={() => setPlatformExpanded(!platformExpanded)}
            className={clsx(
              'w-full p-4 flex items-center justify-between transition-colors',
              isPlatformEnabled
                ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
                : 'bg-gradient-to-r from-primary-50 to-purple-50 dark:from-primary-900/20 dark:to-purple-900/20 hover:from-primary-100 hover:to-purple-100 dark:hover:from-primary-900/30 dark:hover:to-purple-900/30'
            )}
          >
            <div className="flex items-center space-x-3">
              <div className={clsx(
                'p-2 rounded-lg',
                isPlatformEnabled ? 'bg-green-100 dark:bg-green-800' : 'bg-white dark:bg-gray-800 shadow-sm'
              )}>
                <Bot className={clsx(
                  'h-5 w-5',
                  isPlatformEnabled ? 'text-green-600 dark:text-green-400' : 'text-primary-500'
                )} />
              </div>
              <div className="text-left">
                <div className="flex items-center space-x-2">
                  <h4 className="text-sm font-medium text-gray-900 dark:text-white">Platform AI</h4>
                  <span className={clsx(
                    'px-2 py-0.5 text-xs font-medium rounded-full',
                    isPlatformEnabled
                      ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300'
                      : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                  )}>
                    {isPlatformEnabled ? 'Active' : 'Inactive'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Managed AI with compliance monitoring
                </p>
              </div>
            </div>
            {platformExpanded ? (
              <ChevronDown className="h-5 w-5 text-gray-400" />
            ) : (
              <ChevronRight className="h-5 w-5 text-gray-400" />
            )}
          </button>

          {/* Collapsible Content */}
          {platformExpanded && (
            <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
              {isPlatformEnabled ? (
                <p className="text-sm text-gray-700 dark:text-gray-300">
                  AI features are included with your subscription. No additional setup required.
                </p>
              ) : (
                <>
                  <p className="text-sm text-gray-700 dark:text-gray-300 mb-4">
                    Platform AI provides managed AI capabilities through your Tesseract subscription, eliminating the need for separate API keys while enabling organizational oversight.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
                    <div className="flex items-start space-x-2">
                      <Shield className="h-4 w-4 text-primary-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-900 dark:text-white">Compliance Monitoring</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Full audit trail for regulatory requirements</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Zap className="h-4 w-4 text-primary-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-900 dark:text-white">No Setup Required</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Instant access without API keys</p>
                      </div>
                    </div>
                    <div className="flex items-start space-x-2">
                      <Bot className="h-4 w-4 text-primary-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-medium text-gray-900 dark:text-white">Premium Models</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">Latest Claude and GPT models</p>
                      </div>
                    </div>
                  </div>

                  {/* Pricing Tiers */}
                  <div className="bg-gray-50 dark:bg-gray-900/50 rounded-lg p-4 mb-4">
                    <h5 className="text-xs font-semibold text-gray-900 dark:text-white mb-3 uppercase tracking-wide">Platform AI Pricing</h5>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">Starter</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">~250 AI requests/month</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">$29/mo</p>
                      </div>
                      <div className="flex items-center justify-between py-2 border-b border-gray-200 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">Professional</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">~1,000 AI requests/month</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">$79/mo</p>
                      </div>
                      <div className="flex items-center justify-between py-2">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">Enterprise</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Unlimited + dedicated support</p>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 dark:text-white">Custom</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2 italic">
                      * Request estimates based on typical usage patterns. Actual capacity may vary.
                    </p>
                  </div>

                  {/* CTA */}
                  <div className="flex items-center space-x-3">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => window.location.href = 'mailto:sales@tesseract.com?subject=Platform AI Inquiry'}
                    >
                      <Mail className="h-4 w-4 mr-2" />
                      Contact Sales
                    </Button>
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      Or use your own API key below
                    </span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* BYOK Section - Collapsible */}
        {!isPlatformEnabled && effectiveConfig.allowByok && (
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
            {/* Collapsible Header */}
            <button
              onClick={() => setByokExpanded(!byokExpanded)}
              className={clsx(
                'w-full p-4 flex items-center justify-between transition-colors',
                isConfigured
                  ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
                  : 'bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
              )}
            >
              <div className="flex items-center space-x-3">
                <div className={clsx(
                  'p-2 rounded-lg',
                  isConfigured ? 'bg-green-100 dark:bg-green-800' : 'bg-white dark:bg-gray-700 shadow-sm'
                )}>
                  <Key className={clsx(
                    'h-5 w-5',
                    isConfigured ? 'text-green-600 dark:text-green-400' : 'text-gray-500'
                  )} />
                </div>
                <div className="text-left">
                  <div className="flex items-center space-x-2">
                    <h4 className="text-sm font-medium text-gray-900 dark:text-white">Bring Your Own Key (BYOK)</h4>
                    <span className={clsx(
                      'px-2 py-0.5 text-xs font-medium rounded-full',
                      isConfigured
                        ? 'bg-green-100 text-green-700 dark:bg-green-800 dark:text-green-300'
                        : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-400'
                    )}>
                      {isConfigured ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                    {isConfigured
                      ? `Connected to ${AI_PROVIDERS.find(p => p.id === userConfig?.byok_provider)?.name || 'provider'}`
                      : 'Use your own API key from any provider'}
                  </p>
                </div>
              </div>
              {byokExpanded ? (
                <ChevronDown className="h-5 w-5 text-gray-400" />
              ) : (
                <ChevronRight className="h-5 w-5 text-gray-400" />
              )}
            </button>

            {/* Collapsible Content */}
            {byokExpanded && (
              <div className="p-4 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
                {/* Connection Status */}
                {isConfigured && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                        <span className="text-sm font-medium text-green-700 dark:text-green-300">
                          Connected to {AI_PROVIDERS.find(p => p.id === userConfig?.byok_provider)?.name}
                        </span>
                      </div>
                      <button
                        onClick={handleDisconnect}
                        disabled={isClearing}
                        className="text-sm text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        {isClearing ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    </div>
                    <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                      Model: {userConfig?.byok_model}
                    </p>
                  </div>
                )}

                {/* Provider Selection */}
                <div className="space-y-3 mb-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    AI Provider
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {AI_PROVIDERS.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => setProvider(p.id)}
                        className={clsx(
                          'p-3 rounded-lg border text-left transition-all',
                          provider === p.id
                            ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20'
                            : 'border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600'
                        )}
                      >
                        <div className="flex items-center space-x-2">
                          <div className={clsx('w-8 h-8 bg-gradient-to-br rounded-lg flex items-center justify-center', p.color)}>
                            <span className="text-white text-xs font-bold">{p.name.charAt(0)}</span>
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{p.description}</p>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* API Key Input */}
                <div className="space-y-2 mb-4">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    API Key
                  </label>
                  <div className="relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={isConfigured ? '••••••••••••••••' : 'Enter your API key...'}
                      className="w-full px-3 py-2 pr-20 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-gray-800 dark:border-gray-600 dark:text-white"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center space-x-1">
                      <button
                        type="button"
                        onClick={() => setShowApiKey(!showApiKey)}
                        className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                      >
                        {showApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center flex-wrap">
                    <Info className="h-3 w-3 mr-1" />
                    Get your API key from{' '}
                    <a
                      href={PROVIDER_INFO[provider].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary-600 hover:underline ml-1 flex items-center"
                    >
                      {PROVIDER_INFO[provider].urlLabel}
                      <ExternalLink className="h-3 w-3 ml-0.5" />
                    </a>
                  </p>
                </div>

                {/* Test Result */}
                {testError && (
                  <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg dark:bg-red-900/20 dark:border-red-800">
                    <div className="flex items-center space-x-2">
                      <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                      <span className="text-sm text-red-700 dark:text-red-300">
                        {testError.message || 'Failed to connect. Please check your API key.'}
                      </span>
                    </div>
                  </div>
                )}

                {testSuccess && (
                  <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg dark:bg-green-900/20 dark:border-green-800">
                    <div className="flex items-center space-x-2">
                      <Check className="h-4 w-4 text-green-600 dark:text-green-400" />
                      <span className="text-sm text-green-700 dark:text-green-300">
                        Connection successful! Your API key is valid.
                      </span>
                    </div>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center space-x-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestConnection}
                    disabled={!apiKey || isTesting}
                  >
                    {isTesting ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Testing...
                      </>
                    ) : (
                      'Test Connection'
                    )}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    disabled={!apiKey || isUpdating}
                  >
                    {isUpdating ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Key className="h-4 w-4 mr-2" />
                        Save API Key
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Data & Privacy Notice */}
        <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg dark:bg-blue-900/20 dark:border-blue-800">
          <div className="flex items-start space-x-3">
            <Info className="h-5 w-5 text-blue-500 mt-0.5" />
            <div>
              <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300">
                Data & Privacy
              </h4>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                Your data is sent to the AI provider for inference only. API data is not used to train models.
                Data is retained for up to 30 days for safety review, then deleted.
              </p>
              <a
                href="https://docs.anthropic.com/en/docs/data-privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-blue-600 hover:underline mt-2 inline-flex items-center"
              >
                Learn more about AI data policies
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
