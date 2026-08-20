/**
 * ErrorBoundary Component
 *
 * Catches React errors in child components and displays a fallback UI.
 * Prevents the entire app from crashing due to component errors.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react'
import * as Sentry from '@sentry/react'
import { AlertCircle, RefreshCw, Home } from 'lucide-react'
import { Button } from '../ui/Button'

interface ErrorBoundaryProps {
  children: ReactNode
  fallback?: ReactNode
  onReset?: () => void
  showDetails?: boolean
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  /** Feedback for the copy button — there is no other signal on a phone. */
  copied: boolean
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false,
    }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return {
      hasError: true,
      error,
    }
  }

  /**
   * The whole report, in one tap.
   *
   * Message, JS stack and component stack together: the first says what broke,
   * the second says where, and the third says which component was rendering.
   * Any one of them alone usually is not enough to find a crash.
   */
  handleCopy = () => {
    const { error, errorInfo } = this.state
    const report = [
      error?.message,
      error?.stack,
      errorInfo?.componentStack,
      `at ${new Date().toISOString()} on ${navigator.userAgent}`,
    ].filter(Boolean).join(String.fromCharCode(10, 10))
    void navigator.clipboard?.writeText(report)
      .then(() => this.setState({ copied: true }))
      .catch(() => { /* clipboard blocked; the text is on screen either way */ })
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error to console in development
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    this.setState({
      error,
      errorInfo,
    })

    // Report to Sentry with React's component stack attached so we can
    // see which component crashed (not just the JS stack). No-op when
    // Sentry isn't initialized (local dev without a DSN).
    Sentry.withScope((scope) => {
      scope.setContext('react', { componentStack: errorInfo.componentStack })
      Sentry.captureException(error)
    })
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    })

    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  handleGoHome = () => {
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      // Use custom fallback if provided
      if (this.props.fallback) {
        return this.props.fallback
      }

      // Default error UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4 dark:bg-gray-900">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 dark:bg-gray-800">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center">
                <AlertCircle className="w-8 h-8 text-red-600" />
              </div>
            </div>

            {/* Error Message */}
            <div className="text-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900 mb-2 dark:text-white">
                Oops! Something went wrong
              </h2>
              <p className="text-gray-600 dark:text-gray-400">
                We encountered an unexpected error. Don't worry, your data is safe.
              </p>
            </div>

            {/* The error itself, on the device that hit it.
                ── Why this is not gated behind a prop ─────────────────────────
                It was `this.props.showDetails`, and nothing in the app passed
                it — so every crash anywhere rendered "Oops! Something went
                wrong" and nothing else. On a desktop that is merely unhelpful;
                on a phone it is a dead end, because there is no console to open
                and no way to see what threw.
                Collapsed by default, so a reader who does not care is not shown
                a stack trace, and copyable in one tap because selecting text
                inside a <pre> on a touchscreen is its own ordeal. */}
            {this.state.error && (
              <details className="mb-6 rounded-lg border border-gray-200 bg-gray-50 p-4 dark:border-gray-700 dark:bg-gray-900">
                <summary className="cursor-pointer text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Technical details
                </summary>

                <p className="mt-3 font-mono text-xs text-gray-800 dark:text-gray-200">
                  {this.state.error.message}
                </p>

                {this.state.error.stack && (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-gray-600 dark:text-gray-400">
                    {this.state.error.stack}
                  </pre>
                )}

                {this.state.errorInfo?.componentStack && (
                  <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-gray-500 dark:text-gray-500">
                    {this.state.errorInfo.componentStack}
                  </pre>
                )}

                <button
                  type="button"
                  onClick={this.handleCopy}
                  className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700 dark:border-gray-600 dark:text-gray-200"
                >
                  {this.state.copied ? 'Copied' : 'Copy report'}
                </button>
              </details>
            )}

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3">
              <Button
                onClick={this.handleReset}
                className="flex-1 flex items-center justify-center"
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="outline"
                className="flex-1 flex items-center justify-center"
              >
                <Home className="w-4 h-4 mr-2" />
                Go Home
              </Button>
            </div>

            {/* Help Text */}
            <p className="text-xs text-gray-500 text-center mt-6 dark:text-gray-400">
              If this problem persists, please contact support.
            </p>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

/**
 * Hook-based wrapper for functional components
 * Usage: wrap your component tree with <ErrorBoundary>
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  return function WithErrorBoundaryWrapper(props: P) {
    return (
      <ErrorBoundary {...errorBoundaryProps}>
        <Component {...props} />
      </ErrorBoundary>
    )
  }
}
