import type { Meta, StoryObj } from '@storybook/react'
import { ToastProvider, useToast } from '../Toast'
import { Button } from '../../ui/Button'

/**
 * Toast Notifications provide user feedback for actions.
 * They appear temporarily and auto-dismiss after a duration.
 *
 * ## Features
 * - Four variants: success, error, info, warning
 * - Auto-dismiss with configurable duration
 * - Keyboard accessible (Escape key closes)
 * - Screen reader compatible (ARIA live regions)
 * - Accessible close buttons
 * - Maximum toast limit (5 by default)
 */
const meta = {
  title: 'Common/Toast',
  component: ToastProvider,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Toast notification system with ARIA support and keyboard navigation.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof ToastProvider>

export default meta
type Story = StoryObj<typeof meta>

// Wrapper component to demonstrate toast usage
function ToastDemo({ variant }: { variant: 'success' | 'error' | 'info' | 'warning' }) {
  const toast = useToast()

  const handleClick = () => {
    switch (variant) {
      case 'success':
        toast.success('Success!', 'Your action completed successfully.')
        break
      case 'error':
        toast.error('Error occurred', 'Something went wrong. Please try again.')
        break
      case 'info':
        toast.info('Information', 'Here is some helpful information.')
        break
      case 'warning':
        toast.warning('Warning', 'Please review this action carefully.')
        break
    }
  }

  return (
    <div className="p-8">
      <Button onClick={handleClick}>
        Show {variant} toast
      </Button>
      <p className="mt-4 text-sm text-gray-600">
        Click the button to see a {variant} toast notification.
        <br />
        Press Escape to close any toast.
      </p>
    </div>
  )
}

/**
 * Success toasts indicate successful operations.
 * Default duration: 5 seconds
 */
export const Success: Story = {
  render: () => (
    <ToastProvider>
      <ToastDemo variant="success" />
    </ToastProvider>
  ),
}

/**
 * Error toasts indicate failed operations.
 * Default duration: 7 seconds (longer for important messages)
 */
export const Error: Story = {
  render: () => (
    <ToastProvider>
      <ToastDemo variant="error" />
    </ToastProvider>
  ),
}

/**
 * Info toasts provide helpful information.
 * Default duration: 5 seconds
 */
export const Info: Story = {
  render: () => (
    <ToastProvider>
      <ToastDemo variant="info" />
    </ToastProvider>
  ),
}

/**
 * Warning toasts indicate caution.
 * Default duration: 5 seconds
 */
export const Warning: Story = {
  render: () => (
    <ToastProvider>
      <ToastDemo variant="warning" />
    </ToastProvider>
  ),
}

/**
 * Multiple toasts can be displayed simultaneously.
 * Maximum: 5 toasts (oldest is removed when limit is reached)
 */
export const MultipleToasts: Story = {
  render: () => {
    function MultipleToastDemo() {
      const toast = useToast()

      const handleShowMultiple = () => {
        toast.success('First toast')
        setTimeout(() => toast.info('Second toast'), 300)
        setTimeout(() => toast.warning('Third toast'), 600)
        setTimeout(() => toast.error('Fourth toast'), 900)
      }

      return (
        <div className="p-8">
          <Button onClick={handleShowMultiple}>
            Show multiple toasts
          </Button>
          <p className="mt-4 text-sm text-gray-600">
            Click to see multiple toasts stacked vertically.
          </p>
        </div>
      )
    }

    return (
      <ToastProvider>
        <MultipleToastDemo />
      </ToastProvider>
    )
  },
}

/**
 * Custom duration can be specified for each toast.
 * Duration of 0 makes the toast permanent (manual close only).
 */
export const CustomDuration: Story = {
  render: () => {
    function CustomDurationDemo() {
      const { showToast } = useToast()

      return (
        <div className="p-8 space-y-4">
          <div>
            <Button onClick={() => showToast('info', 'Quick message', undefined, 2000)}>
              2 second toast
            </Button>
          </div>
          <div>
            <Button onClick={() => showToast('info', 'Normal message', undefined, 5000)}>
              5 second toast (default)
            </Button>
          </div>
          <div>
            <Button onClick={() => showToast('warning', 'Important message', 'This stays until closed', 0)}>
              Permanent toast
            </Button>
          </div>
          <p className="mt-4 text-sm text-gray-600">
            Try different durations. Permanent toasts must be closed manually.
          </p>
        </div>
      )
    }

    return (
      <ToastProvider>
        <CustomDurationDemo />
      </ToastProvider>
    )
  },
}

/**
 * Toasts with descriptions provide additional context.
 */
export const WithDescription: Story = {
  render: () => {
    function DescriptionDemo() {
      const toast = useToast()

      return (
        <div className="p-8">
          <Button onClick={() => toast.success(
            'Workflow saved',
            'Your workflow has been successfully saved and is now live.'
          )}>
            Show toast with description
          </Button>
        </div>
      )
    }

    return (
      <ToastProvider>
        <DescriptionDemo />
      </ToastProvider>
    )
  },
}
