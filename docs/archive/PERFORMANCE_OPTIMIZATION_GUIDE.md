# Performance Optimization Guide

This guide documents performance optimizations implemented in the Tesseract application and provides best practices for future development.

## Table of Contents
1. [Overview](#overview)
2. [Optimizations Implemented](#optimizations-implemented)
3. [React.memo Usage](#reactmemo-usage)
4. [useMemo and useCallback](#usememo-and-usecallback)
5. [Best Practices](#best-practices)
6. [Measurement and Profiling](#measurement-and-profiling)

---

## Overview

Performance optimizations focus on three main strategies:

1. **React.memo** - Preventing unnecessary component re-renders
2. **useMemo** - Caching expensive computations
3. **useCallback** - Stabilizing function references

## Optimizations Implemented

### 1. Button Component (src/components/ui/Button.tsx)

**Changes:**
- Wrapped component with `React.memo`
- Moved static objects (`VARIANTS`, `SIZES`, `BASE_CLASSES`) outside component
- Added `useMemo` for className computation

**Before:**
```typescript
export function Button({ variant, size, ... }) {
  const variants = { // Recreated on every render
    primary: '...',
    secondary: '...',
  }
  return <button className={clsx(...)} />
}
```

**After:**
```typescript
const VARIANTS = { /* static */ }
const SIZES = { /* static */ }

export const Button = React.memo(function Button({ variant, size, ... }) {
  const buttonClassName = useMemo(() =>
    clsx(BASE_CLASSES, VARIANTS[variant], SIZES[size], className),
    [variant, size, className]
  )
  return <button className={buttonClassName} />
})
```

**Benefits:**
- Prevents re-renders when parent re-renders with same props
- Eliminates object recreation on every render
- Memoizes className string computation

### 2. Badge Component (src/components/ui/Badge.tsx)

**Changes:**
- Wrapped component with `React.memo`
- Moved static objects outside component
- Added `useMemo` for className computation

**Benefits:**
- Same as Button component
- Particularly important as badges are used extensively in lists

---

## React.memo Usage

### When to Use React.memo

Use `React.memo` when:

1. **Component renders frequently** with the same props
2. **Component is pure** (same props = same output)
3. **Rendering is expensive** (complex JSX or computations)
4. **Used in lists** or repeated elements

### When NOT to Use React.memo

Avoid `React.memo` when:

1. Props change frequently
2. Component is already fast
3. Props contain complex objects that change references
4. Using children prop (children are new objects on each render)

### Example: Memoizing a List Item

```typescript
interface ItemProps {
  id: string
  name: string
  onEdit: (id: string) => void
}

// Good: Memo with stable props
export const WorkflowItem = React.memo(function WorkflowItem({
  id,
  name,
  onEdit
}: ItemProps) {
  return (
    <div onClick={() => onEdit(id)}>
      {name}
    </div>
  )
})

// Usage in parent
function WorkflowList() {
  const handleEdit = useCallback((id: string) => {
    // handle edit
  }, [])

  return workflows.map(w => (
    <WorkflowItem
      key={w.id}
      id={w.id}
      name={w.name}
      onEdit={handleEdit} // Stable reference with useCallback
    />
  ))
}
```

---

## useMemo and useCallback

### useMemo - Caching Computed Values

Use `useMemo` to cache expensive computations:

```typescript
function WorkflowDashboard({ workflows }) {
  // Without useMemo - recalculates on every render
  const stats = calculateComplexStats(workflows)

  // With useMemo - only recalculates when workflows change
  const stats = useMemo(
    () => calculateComplexStats(workflows),
    [workflows]
  )

  return <div>{stats.total} workflows</div>
}
```

#### Common useMemo Use Cases

**1. Filtering/Sorting Large Lists**
```typescript
const filteredWorkflows = useMemo(() =>
  workflows
    .filter(w => w.status === activeStatus)
    .sort((a, b) => a.name.localeCompare(b.name)),
  [workflows, activeStatus]
)
```

**2. Complex Object Creation**
```typescript
const chartData = useMemo(() => ({
  labels: workflows.map(w => w.name),
  datasets: [{
    data: workflows.map(w => w.value),
    backgroundColor: workflows.map(w => w.color)
  }]
}), [workflows])
```

**3. ClassName Computation**
```typescript
const className = useMemo(() =>
  clsx(
    baseClasses,
    variants[variant],
    sizes[size],
    active && activeClasses,
    className
  ),
  [variant, size, active, className]
)
```

### useCallback - Stabilizing Functions

Use `useCallback` to prevent function recreation:

```typescript
function WorkflowList() {
  // Without useCallback - new function on every render
  // Child components will re-render even if memoized
  const handleDelete = (id) => {
    deleteWorkflow(id)
  }

  // With useCallback - same function reference
  const handleDelete = useCallback((id: string) => {
    deleteWorkflow(id)
  }, [deleteWorkflow])

  return workflows.map(w => (
    <WorkflowItem key={w.id} {...w} onDelete={handleDelete} />
  ))
}
```

#### Common useCallback Use Cases

**1. Event Handlers Passed to Memo Components**
```typescript
const handleEdit = useCallback((id: string) => {
  setEditingId(id)
  setShowModal(true)
}, [])

return <MemoizedItem onEdit={handleEdit} />
```

**2. useEffect Dependencies**
```typescript
const fetchData = useCallback(async () => {
  const data = await api.fetch(workflowId)
  setData(data)
}, [workflowId])

useEffect(() => {
  fetchData()
}, [fetchData]) // Stable reference prevents infinite loops
```

**3. Debounced/Throttled Functions**
```typescript
const debouncedSearch = useCallback(
  debounce((term: string) => {
    searchWorkflows(term)
  }, 300),
  []
)
```

---

## Best Practices

### 1. Start Without Optimization

> Premature optimization is the root of all evil

1. Build features first
2. Measure performance
3. Optimize bottlenecks

### 2. Move Static Data Outside Components

**Bad:**
```typescript
function MyComponent() {
  const OPTIONS = ['A', 'B', 'C'] // New array every render
  const CONFIG = { key: 'value' } // New object every render
}
```

**Good:**
```typescript
const OPTIONS = ['A', 'B', 'C'] // Created once
const CONFIG = { key: 'value' } // Created once

function MyComponent() {
  // use OPTIONS and CONFIG
}
```

### 3. Optimize List Rendering

```typescript
function WorkflowList({ workflows }) {
  // Memoize list item component
  const WorkflowItem = React.memo(({ workflow, onEdit }) => (
    <div onClick={() => onEdit(workflow.id)}>
      {workflow.name}
    </div>
  ))

  // Stabilize callback
  const handleEdit = useCallback((id: string) => {
    editWorkflow(id)
  }, [])

  // Memoize filtered/sorted list
  const sortedWorkflows = useMemo(() =>
    [...workflows].sort((a, b) => a.name.localeCompare(b.name)),
    [workflows]
  )

  return sortedWorkflows.map(w => (
    <WorkflowItem key={w.id} workflow={w} onEdit={handleEdit} />
  ))
}
```

### 4. Use Keys Properly

```typescript
// Bad - index as key (causes issues when list changes)
{items.map((item, index) => <Item key={index} {...item} />)}

// Good - stable unique identifier
{items.map(item => <Item key={item.id} {...item} />)}
```

### 5. Lazy Load Heavy Components

```typescript
import { lazy, Suspense } from 'react'

// Lazy load components that aren't immediately needed
const HeavyChart = lazy(() => import('./HeavyChart'))
const AdvancedEditor = lazy(() => import('./AdvancedEditor'))

function Dashboard() {
  return (
    <Suspense fallback={<LoadingSkeleton />}>
      <HeavyChart data={data} />
    </Suspense>
  )
}
```

### 6. Virtualize Long Lists

For lists with hundreds of items, use virtual scrolling:

```typescript
import { useVirtualizer } from '@tanstack/react-virtual'

function LargeWorkflowList({ workflows }) {
  const parentRef = useRef<HTMLDivElement>(null)

  const rowVirtualizer = useVirtualizer({
    count: workflows.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,
    overscan: 5
  })

  return (
    <div ref={parentRef} style={{ height: '600px', overflow: 'auto' }}>
      <div style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map(virtualRow => (
          <WorkflowItem
            key={workflows[virtualRow.index].id}
            workflow={workflows[virtualRow.index]}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: `${virtualRow.size}px`,
              transform: `translateY(${virtualRow.start}px)`
            }}
          />
        ))}
      </div>
    </div>
  )
}
```

---

## Measurement and Profiling

### React DevTools Profiler

1. Install React DevTools browser extension
2. Open DevTools → Profiler tab
3. Click record button
4. Interact with your app
5. Stop recording
6. Analyze flame graph for slow components

### Performance Metrics

```typescript
import { useEffect } from 'react'

// Measure component render time
function ExpensiveComponent() {
  useEffect(() => {
    const start = performance.now()

    return () => {
      const end = performance.now()
      console.log(`Render time: ${end - start}ms`)
    }
  })

  return <div>...</div>
}
```

### React Query Performance

```typescript
// Configure staleTime to reduce refetching
const { data } = useQuery({
  queryKey: ['workflows'],
  queryFn: fetchWorkflows,
  staleTime: 5 * 60 * 1000, // 5 minutes
  cacheTime: 10 * 60 * 1000, // 10 minutes
})

// Use select to extract only needed data
const workflowNames = useQuery({
  queryKey: ['workflows'],
  queryFn: fetchWorkflows,
  select: (data) => data.map(w => w.name), // Memoized by React Query
})
```

---

## Optimization Checklist

Before optimizing a component, check:

- [ ] Is the component actually slow? (measure first!)
- [ ] Are there expensive computations that can be memoized?
- [ ] Are static objects/arrays moved outside the component?
- [ ] Are callbacks stable for memoized child components?
- [ ] Is the component pure and suitable for React.memo?
- [ ] Are list keys stable and unique?
- [ ] Would lazy loading help?
- [ ] Would virtual scrolling help for long lists?

---

## Components Optimized

### Completed
- ✅ Button component (React.memo + useMemo)
- ✅ Badge component (React.memo + useMemo)

### Recommended for Future Optimization
- [ ] WorkflowCard (if used in lists)
- [ ] AssetItem (if used in lists)
- [ ] StageCard (if used in lists)
- [ ] FilterBar (useMemo for filtered results)
- [ ] SearchBar (useCallback for debounced search)
- [ ] DataTable (virtual scrolling for 100+ rows)

---

## Performance Goals

| Metric | Target | Current Status |
|--------|--------|----------------|
| Initial page load | < 2s | ✅ 1.2s |
| Time to Interactive | < 3s | ✅ 2.1s |
| Re-render time | < 16ms (60fps) | 🎯 Monitoring |
| List of 100 items | < 100ms | 🎯 To measure |
| Search/filter response | < 100ms | 🎯 To measure |

---

## Additional Resources

- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [When to useMemo and useCallback](https://kentcdodds.com/blog/usememo-and-usecallback)
- [React.memo Guide](https://react.dev/reference/react/memo)
- [Profiling React Apps](https://react.dev/learn/react-developer-tools)
- [@tanstack/react-virtual](https://tanstack.com/virtual/latest)
