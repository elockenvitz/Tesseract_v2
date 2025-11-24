import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '../Button'
import { Plus, Trash, Edit, Download } from 'lucide-react'

/**
 * Button component with multiple variants, sizes, and states.
 * Optimized with React.memo to prevent unnecessary re-renders.
 *
 * ## Features
 * - Multiple variants (primary, secondary, outline, ghost, danger, success)
 * - Three sizes (sm, md, lg)
 * - Loading state with spinner
 * - Disabled state
 * - Icon support
 * - Performance optimized with React.memo
 * - Full keyboard accessibility
 */
const meta = {
  title: 'UI/Button',
  component: Button,
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'Versatile button component with variants, sizes, and states. Performance optimized with React.memo.',
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success'],
      description: 'Visual variant of the button',
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
      description: 'Size of the button',
    },
    loading: {
      control: 'boolean',
      description: 'Shows loading spinner and disables button',
    },
    disabled: {
      control: 'boolean',
      description: 'Disables the button',
    },
  },
} satisfies Meta<typeof Button>

export default meta
type Story = StoryObj<typeof meta>

/**
 * Primary button for main actions.
 */
export const Primary: Story = {
  args: {
    children: 'Primary Button',
    variant: 'primary',
  },
}

/**
 * Secondary button for less important actions.
 */
export const Secondary: Story = {
  args: {
    children: 'Secondary Button',
    variant: 'secondary',
  },
}

/**
 * Outline button for subtle actions.
 */
export const Outline: Story = {
  args: {
    children: 'Outline Button',
    variant: 'outline',
  },
}

/**
 * Ghost button for minimal emphasis.
 */
export const Ghost: Story = {
  args: {
    children: 'Ghost Button',
    variant: 'ghost',
  },
}

/**
 * Danger button for destructive actions.
 */
export const Danger: Story = {
  args: {
    children: 'Delete Item',
    variant: 'danger',
  },
}

/**
 * Success button for positive actions.
 */
export const Success: Story = {
  args: {
    children: 'Save Changes',
    variant: 'success',
  },
}

/**
 * Small button for compact spaces.
 */
export const Small: Story = {
  args: {
    children: 'Small Button',
    size: 'sm',
  },
}

/**
 * Medium button (default size).
 */
export const Medium: Story = {
  args: {
    children: 'Medium Button',
    size: 'md',
  },
}

/**
 * Large button for emphasis.
 */
export const Large: Story = {
  args: {
    children: 'Large Button',
    size: 'lg',
  },
}

/**
 * Button with loading state.
 */
export const Loading: Story = {
  args: {
    children: 'Loading...',
    loading: true,
  },
}

/**
 * Disabled button.
 */
export const Disabled: Story = {
  args: {
    children: 'Disabled Button',
    disabled: true,
  },
}

/**
 * Button with leading icon.
 */
export const WithIcon: Story = {
  render: (args) => (
    <Button {...args}>
      <Plus className="w-4 h-4 mr-2" />
      Create Workflow
    </Button>
  ),
}

/**
 * Icon-only button (common pattern).
 */
export const IconOnly: Story = {
  render: (args) => (
    <Button {...args} aria-label="Delete">
      <Trash className="w-4 h-4" />
    </Button>
  ),
}

/**
 * All button variants side by side.
 */
export const AllVariants: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="success">Success</Button>
      </div>
      <div className="flex gap-4 items-center">
        <Button variant="primary" disabled>Primary</Button>
        <Button variant="secondary" disabled>Secondary</Button>
        <Button variant="outline" disabled>Outline</Button>
        <Button variant="ghost" disabled>Ghost</Button>
        <Button variant="danger" disabled>Danger</Button>
        <Button variant="success" disabled>Success</Button>
      </div>
    </div>
  ),
}

/**
 * All button sizes side by side.
 */
export const AllSizes: Story = {
  render: () => (
    <div className="flex gap-4 items-center">
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  ),
}

/**
 * Common button patterns with icons.
 */
export const CommonPatterns: Story = {
  render: () => (
    <div className="space-y-4">
      <div className="flex gap-4">
        <Button variant="primary">
          <Plus className="w-4 h-4 mr-2" />
          Create New
        </Button>
        <Button variant="secondary">
          <Edit className="w-4 h-4 mr-2" />
          Edit
        </Button>
        <Button variant="danger">
          <Trash className="w-4 h-4 mr-2" />
          Delete
        </Button>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Download
        </Button>
      </div>
    </div>
  ),
}

/**
 * Button group pattern.
 */
export const ButtonGroup: Story = {
  render: () => (
    <div className="flex gap-2">
      <Button variant="outline" size="sm">
        Cancel
      </Button>
      <Button variant="primary" size="sm">
        Save
      </Button>
    </div>
  ),
}
