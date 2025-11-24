# Component Usage Guide

This guide demonstrates how to use the new common components throughout the application.

## Table of Contents
1. [Error Handling](#error-handling)
2. [Toast Notifications](#toast-notifications)
3. [Loading States](#loading-states)
4. [Empty States](#empty-states)
5. [Query Error Display](#query-error-display)

---

## Error Handling

### ErrorBoundary

The `ErrorBoundary` component catches React errors in child component trees and displays a fallback UI.

#### Already Integrated in App.tsx

```typescript
// src/App.tsx
import { ErrorBoundary, ToastProvider } from './components/common'

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <ToastProvider>
            <Router>
              <AppRoutes />
            </Router>
          </ToastProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  )
}
```

#### Using withErrorBoundary HOC

You can wrap individual components with error boundaries:

```typescript
import { withErrorBoundary } from './components/common'

const MyComponent = () => {
  // component code
}

export default withErrorBoundary(MyComponent, {
  fallback: <div>Custom error message</div>
})
```

---

## Toast Notifications

### useToast Hook

Use the `useToast` hook to show toast notifications for user feedback.

```typescript
import { useToast } from '../components/common'

function MyComponent() {
  const { success, error, info, warning } = useToast()

  const handleSuccess = () => {
    success('Operation completed!', 'Your workflow has been saved.')
  }

  const handleError = () => {
    error('Failed to save', 'Please try again later.')
  }

  const handleInfo = () => {
    info('Processing...', 'Your request is being handled.')
  }

  const handleWarning = () => {
    warning('Warning', 'This action cannot be undone.')
  }

  return (
    <button onClick={handleSuccess}>Save Workflow</button>
  )
}
```

### Toast Types

- `success(message, description?, duration?)` - Green success toast
- `error(message, description?, duration?)` - Red error toast
- `info(message, description?, duration?)` - Blue informational toast
- `warning(message, description?, duration?)` - Yellow warning toast

### Custom Duration

```typescript
// Show toast for 10 seconds instead of default 5
success('Saved!', 'Your changes have been saved.', 10000)

// Show toast permanently (must be manually closed)
error('Critical Error', 'Please contact support.', 0)
```

---

## Loading States

### Skeleton Components

Use skeleton components to show loading states while data is being fetched.

#### Basic Skeleton

```typescript
import { Skeleton } from '../components/common'

function MyComponent() {
  const { data, isLoading } = useQuery(...)

  if (isLoading) {
    return <Skeleton className="h-10 w-full" />
  }

  return <div>{data}</div>
}
```

#### Card Skeleton

```typescript
import { CardSkeleton } from '../components/common'

function WorkflowList() {
  const { data, isLoading } = useQuery(...)

  if (isLoading) {
    return <CardSkeleton count={3} />
  }

  return data.map(workflow => <WorkflowCard key={workflow.id} {...workflow} />)
}
```

#### Table Skeleton

```typescript
import { TableSkeleton } from '../components/common'

function DataTable() {
  const { data, isLoading } = useQuery(...)

  if (isLoading) {
    return <TableSkeleton rows={10} columns={5} />
  }

  return <table>...</table>
}
```

#### List Skeleton

```typescript
import { ListSkeleton } from '../components/common'

function AssetList() {
  const { data, isLoading } = useQuery(...)

  if (isLoading) {
    return <ListSkeleton count={8} />
  }

  return data.map(asset => <AssetItem key={asset.id} {...asset} />)
}
```

#### Workflow-Specific Skeletons

```typescript
import {
  WorkflowOverviewSkeleton,
  WorkflowStagesSkeleton,
  WorkflowBranchesSkeleton,
  SidebarSkeleton
} from '../components/common'

// For Overview tab
if (isLoading) return <WorkflowOverviewSkeleton />

// For Stages tab
if (isLoading) return <WorkflowStagesSkeleton count={3} />

// For Branches tab
if (isLoading) return <WorkflowBranchesSkeleton />

// For Sidebar
if (isLoading) return <SidebarSkeleton />
```

---

## Empty States

### EmptyState Component

Use the `EmptyState` component to show helpful messages when there's no data.

#### Basic Empty State

```typescript
import { EmptyState } from '../components/common'
import { FileX } from 'lucide-react'

function WorkflowList() {
  const { data } = useQuery(...)

  if (data.length === 0) {
    return (
      <EmptyState
        icon={FileX}
        title="No workflows yet"
        description="Create your first workflow to get started"
        action={{
          label: 'Create Workflow',
          onClick: () => setShowCreateModal(true),
          icon: Plus
        }}
        secondaryAction={{
          label: 'View Tutorial',
          onClick: () => openTutorial()
        }}
      />
    )
  }

  return data.map(workflow => <WorkflowCard key={workflow.id} {...workflow} />)
}
```

#### Empty State with Custom Illustration

```typescript
<EmptyState
  illustration={<CustomSVG />}
  title="No results found"
  description="Try adjusting your search or filters"
  compact={false}
/>
```

#### Compact Empty State

```typescript
<EmptyState
  icon={Search}
  title="No results"
  description="Try a different search term"
  compact={true}
/>
```

#### Simple Empty States

```typescript
import { NoResultsFound, NoDataAvailable } from '../components/common'

// For search results
if (searchResults.length === 0) {
  return <NoResultsFound message="No workflows match your search" />
}

// For general empty data
if (!data) {
  return <NoDataAvailable message="No data to display" compact={true} />
}
```

---

## Query Error Display

### QueryErrorDisplay Component

Use the `QueryErrorDisplay` component to show React Query errors with retry functionality.

#### Basic Usage

```typescript
import { QueryErrorDisplay } from '../components/common'

function WorkflowList() {
  const { data, isLoading, error, refetch } = useQuery(...)

  if (error) {
    return (
      <QueryErrorDisplay
        error={error}
        onRetry={refetch}
        title="Failed to load workflows"
      />
    )
  }

  // ... rest of component
}
```

#### Compact Error Display

```typescript
<QueryErrorDisplay
  error={error}
  onRetry={refetch}
  compact={true}
/>
```

#### Custom Error Message

```typescript
<QueryErrorDisplay
  error={error}
  onRetry={refetch}
  title="Network Error"
  message="Unable to connect to the server. Please check your connection."
/>
```

#### Inline Error (for forms)

```typescript
import { InlineError } from '../components/common'

function FormField() {
  const [error, setError] = useState<string | null>(null)

  return (
    <div>
      <input type="text" />
      {error && <InlineError message={error} />}
    </div>
  )
}
```

---

## Complete Example: Tab Component

Here's a complete example showing how to use all components together in a tab component:

```typescript
import React from 'react'
import { useQuery } from '@tanstack/react-query'
import { FileX, Plus } from 'lucide-react'
import {
  QueryErrorDisplay,
  EmptyState,
  ListSkeleton,
  useToast
} from '../components/common'

export function MyTab({ workflowId }: { workflowId: string }) {
  const { success, error: showError } = useToast()

  const {
    data,
    isLoading,
    error,
    refetch
  } = useQuery({
    queryKey: ['workflow-data', workflowId],
    queryFn: async () => {
      const response = await fetchWorkflowData(workflowId)
      return response
    }
  })

  const handleCreate = async () => {
    try {
      await createItem()
      success('Created!', 'Your item has been created successfully.')
      refetch()
    } catch (err) {
      showError('Failed to create', 'Please try again.')
    }
  }

  // Loading state
  if (isLoading) {
    return <ListSkeleton count={5} />
  }

  // Error state
  if (error) {
    return (
      <QueryErrorDisplay
        error={error}
        onRetry={refetch}
        title="Failed to load data"
      />
    )
  }

  // Empty state
  if (data.length === 0) {
    return (
      <EmptyState
        icon={FileX}
        title="No items yet"
        description="Create your first item to get started"
        action={{
          label: 'Create Item',
          onClick: handleCreate,
          icon: Plus
        }}
      />
    )
  }

  // Success state - render data
  return (
    <div className="space-y-4">
      {data.map(item => (
        <ItemCard key={item.id} {...item} />
      ))}
    </div>
  )
}
```

---

## Best Practices

### 1. Consistent Error Handling

Always use `QueryErrorDisplay` for React Query errors and `useToast` for operation feedback:

```typescript
const mutation = useMutation({
  mutationFn: updateWorkflow,
  onSuccess: () => {
    success('Saved!', 'Your changes have been saved.')
  },
  onError: (err) => {
    error('Failed to save', err.message)
  }
})
```

### 2. Loading States First

Always show loading states before checking for errors or empty data:

```typescript
if (isLoading) return <Skeleton />
if (error) return <QueryErrorDisplay />
if (!data.length) return <EmptyState />
return <YourComponent />
```

### 3. Contextual Empty States

Provide helpful actions in empty states to guide users:

```typescript
<EmptyState
  title="No workflows yet"
  action={{
    label: 'Create Workflow',
    onClick: handleCreate
  }}
  secondaryAction={{
    label: 'Import Workflow',
    onClick: handleImport
  }}
/>
```

### 4. Toast Timing

Use appropriate durations for different message types:

```typescript
success('Quick action done!', undefined, 3000)  // 3 seconds
info('Processing...', undefined, 5000)          // 5 seconds (default)
warning('Important notice', undefined, 8000)     // 8 seconds
error('Critical error', undefined, 0)            // Permanent (manual close)
```

---

## Migration Guide

To migrate existing components to use the new common components:

### Step 1: Replace Loading Spinners

**Before:**
```typescript
if (isLoading) {
  return <div className="animate-spin">Loading...</div>
}
```

**After:**
```typescript
if (isLoading) {
  return <ListSkeleton count={5} />
}
```

### Step 2: Replace Error Messages

**Before:**
```typescript
if (error) {
  return <div className="text-red-600">{error.message}</div>
}
```

**After:**
```typescript
if (error) {
  return <QueryErrorDisplay error={error} onRetry={refetch} />
}
```

### Step 3: Replace Empty Messages

**Before:**
```typescript
if (data.length === 0) {
  return <div>No data</div>
}
```

**After:**
```typescript
if (data.length === 0) {
  return (
    <EmptyState
      icon={FileX}
      title="No data yet"
      description="Create something to get started"
      action={{ label: 'Create', onClick: handleCreate }}
    />
  )
}
```

### Step 4: Replace Alert/Console Messages

**Before:**
```typescript
alert('Workflow saved!')
console.log('Error:', error)
```

**After:**
```typescript
const { success, error } = useToast()
success('Workflow saved!')
error('Failed to save', err.message)
```

---

## Component Props Reference

### EmptyState

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| icon | LucideIcon | No | Icon to display |
| title | string | Yes | Main heading |
| description | string | Yes | Descriptive text |
| action | ActionObject | No | Primary action button |
| secondaryAction | ActionObject | No | Secondary action button |
| illustration | ReactNode | No | Custom illustration |
| compact | boolean | No | Compact mode (default: false) |

### QueryErrorDisplay

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| error | Error | Yes | Error object |
| onRetry | () => void | No | Retry callback |
| title | string | No | Error title |
| message | string | No | Custom error message |
| compact | boolean | No | Compact mode (default: false) |

### Toast Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| success | (message, description?, duration?) | Show success toast |
| error | (message, description?, duration?) | Show error toast |
| info | (message, description?, duration?) | Show info toast |
| warning | (message, description?, duration?) | Show warning toast |
| showToast | (type, message, description?, duration?) | Generic toast method |

---

## Additional Resources

- [ErrorBoundary Source](./src/components/common/ErrorBoundary.tsx)
- [Toast Source](./src/components/common/Toast.tsx)
- [LoadingSkeleton Source](./src/components/common/LoadingSkeleton.tsx)
- [EmptyState Source](./src/components/common/EmptyState.tsx)
- [QueryErrorDisplay Source](./src/components/common/QueryErrorDisplay.tsx)
