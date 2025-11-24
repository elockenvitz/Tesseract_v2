import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState, NoResultsFound, NoDataAvailable } from '../EmptyState'
import { FileX, Search, Plus, Download } from 'lucide-react'
import { useState } from 'react'

/**
 * EmptyState components display helpful messages when there's no data.
 * They guide users on what to do next with clear call-to-action buttons.
 *
 * ## Features
 * - Icon or custom illustration support
 * - Primary and secondary action buttons
 * - Compact mode for smaller spaces
 * - ARIA status role for screen readers
 * - Accessible button labels
 */
const meta = {
  title: 'Common/EmptyState',
  component: EmptyState,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Displays helpful empty states with call-to-action buttons. Fully accessible with ARIA attributes.',
      },
    },
  },
  tags: ['autodocs'],
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Basic empty state with icon, title, and description.
 */
export const Basic: Story = {
  args: {
    icon: FileX,
    title: 'No workflows yet',
    description: 'Get started by creating your first workflow.',
  },
}

/**
 * Empty state with a primary action button.
 */
export const WithAction: Story = {
  args: {
    icon: FileX,
    title: 'No workflows yet',
    description: 'Create your first workflow to get started.',
    action: {
      label: 'Create Workflow',
      onClick: () => alert('Create clicked'),
      icon: Plus,
    },
  },
}

/**
 * Empty state with both primary and secondary actions.
 */
export const WithSecondaryAction: Story = {
  args: {
    icon: FileX,
    title: 'No workflows yet',
    description: 'Create your first workflow or import an existing one.',
    action: {
      label: 'Create Workflow',
      onClick: () => alert('Create clicked'),
      icon: Plus,
    },
    secondaryAction: {
      label: 'Import Workflow',
      onClick: () => alert('Import clicked'),
    },
  },
}

/**
 * Compact mode for smaller spaces or inline use.
 */
export const Compact: Story = {
  args: {
    icon: Search,
    title: 'No results',
    description: 'Try adjusting your search or filters.',
    compact: true,
  },
}

/**
 * Empty state with custom illustration instead of icon.
 */
export const WithIllustration: Story = {
  args: {
    illustration: (
      <svg
        width="200"
        height="200"
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle cx="100" cy="100" r="80" fill="#E5E7EB" />
        <circle cx="100" cy="100" r="60" fill="#9CA3AF" />
        <circle cx="100" cy="100" r="40" fill="#6B7280" />
      </svg>
    ),
    title: 'No data available',
    description: 'Check back later for updates.',
  },
}

/**
 * Interactive example showing empty state in a workflow list.
 */
export const InteractiveExample: Story = {
  render: () => {
    function WorkflowListExample() {
      const [workflows, setWorkflows] = useState<Array<{ id: string; name: string }>>([])

      const addWorkflow = () => {
        const newWorkflow = {
          id: Math.random().toString(36).substr(2, 9),
          name: `Workflow ${workflows.length + 1}`,
        }
        setWorkflows([...workflows, newWorkflow])
      }

      const clearWorkflows = () => {
        setWorkflows([])
      }

      if (workflows.length === 0) {
        return (
          <EmptyState
            icon={FileX}
            title="No workflows yet"
            description="Create your first workflow to get started with task automation."
            action={{
              label: 'Create Workflow',
              onClick: addWorkflow,
              icon: Plus,
            }}
            secondaryAction={{
              label: 'View Tutorial',
              onClick: () => alert('Tutorial opened'),
            }}
          />
        )
      }

      return (
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h3 className="font-semibold">Workflows ({workflows.length})</h3>
            <div className="space-x-2">
              <button
                onClick={addWorkflow}
                className="px-3 py-1 bg-blue-600 text-white rounded text-sm"
              >
                Add More
              </button>
              <button
                onClick={clearWorkflows}
                className="px-3 py-1 bg-gray-200 rounded text-sm"
              >
                Clear All
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className="p-3 bg-white border border-gray-200 rounded-lg"
              >
                {workflow.name}
              </div>
            ))}
          </div>
        </div>
      )
    }

    return (
      <div className="w-[600px] p-8 bg-gray-50 rounded-lg">
        <WorkflowListExample />
      </div>
    )
  },
}

/**
 * Simple empty state for search results.
 */
export const NoResults: Story = {
  render: () => (
    <div className="w-[600px] p-8">
      <NoResultsFound message="No workflows match your search" />
    </div>
  ),
}

/**
 * Simple empty state for unavailable data.
 */
export const NoData: Story = {
  render: () => (
    <div className="w-[600px] p-8">
      <NoDataAvailable message="No data to display" />
    </div>
  ),
}

/**
 * Compact simple empty state.
 */
export const NoDataCompact: Story = {
  render: () => (
    <div className="w-[600px] p-4">
      <NoDataAvailable message="No items found" compact={true} />
    </div>
  ),
}
