# Virtual Scrolling Guide

This guide explains how to use the VirtualList and VirtualGrid components for rendering large lists efficiently.

## Table of Contents
1. [Overview](#overview)
2. [When to Use Virtual Scrolling](#when-to-use-virtual-scrolling)
3. [VirtualList Component](#virtuallist-component)
4. [VirtualGrid Component](#virtualgrid-component)
5. [useVirtualList Hook](#usevirtuallist-hook)
6. [Best Practices](#best-practices)
7. [Performance Tips](#performance-tips)
8. [Examples](#examples)

---

## Overview

Virtual scrolling is a technique that renders only the items visible in the viewport, dramatically improving performance for large lists. Instead of rendering thousands of items, only ~10-20 are rendered at any given time.

### Benefits

- **Faster initial render** - Only visible items are rendered
- **Lower memory usage** - Fewer DOM nodes
- **Smooth scrolling** - Constant performance regardless of list size
- **Better UX** - No lag or stuttering with large datasets

### When NOT to Use

- Lists with fewer than 50 items (overhead not worth it)
- Items with highly variable/unpredictable heights
- When you need all items in the DOM (e.g., for browser search)

---

## When to Use Virtual Scrolling

Use virtual scrolling when:

1. **List has 100+ items** - Performance benefits become significant
2. **Items have consistent height** - Or can be estimated accurately
3. **Scrolling performance matters** - User will be scrolling frequently
4. **Memory is a concern** - Reducing DOM nodes is important

Common use cases:
- Workflow lists with hundreds of items
- Asset lists with large datasets
- Search results with many matches
- Activity feeds or logs
- Large data tables

---

## VirtualList Component

The `VirtualList` component renders a vertical list with virtual scrolling.

### Basic Usage

```typescript
import { VirtualList } from '../components/common'

function WorkflowList({ workflows }) {
  return (
    <VirtualList
      items={workflows}
      height={600}
      estimateSize={80}
      renderItem={(workflow, index) => (
        <WorkflowCard workflow={workflow} />
      )}
      getItemKey={(workflow) => workflow.id}
    />
  )
}
```

### Props

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| items | T[] | Yes | Array of items to render |
| height | number \| string | Yes | Height of scrollable container |
| estimateSize | number | Yes | Estimated height of each item (px) |
| renderItem | (item, index) => ReactElement | Yes | Render function for each item |
| getItemKey | (item, index) => string \| number | No | Key extractor (defaults to index) |
| overscan | number | No | Items to render outside viewport (default: 5) |
| className | string | No | Container className |
| emptyState | ReactElement | No | Component to show when list is empty |
| loadingState | ReactElement | No | Component to show while loading |
| isLoading | boolean | No | Is the list currently loading? |

### Complete Example

```typescript
import { VirtualList, EmptyState, ListSkeleton } from '../components/common'
import { FileX } from 'lucide-react'

function WorkflowList() {
  const { data: workflows, isLoading } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows
  })

  return (
    <VirtualList
      items={workflows || []}
      height="calc(100vh - 200px)"
      estimateSize={120}
      renderItem={(workflow, index) => (
        <div className="p-4 border-b border-gray-200 hover:bg-gray-50">
          <h3 className="font-semibold">{workflow.name}</h3>
          <p className="text-sm text-gray-600">{workflow.description}</p>
          <div className="flex gap-2 mt-2">
            <Badge variant="primary">{workflow.status}</Badge>
            <Badge variant="gray">{workflow.stage}</Badge>
          </div>
        </div>
      )}
      getItemKey={(workflow) => workflow.id}
      overscan={10}
      className="border border-gray-200 rounded-lg"
      isLoading={isLoading}
      loadingState={<ListSkeleton count={5} />}
      emptyState={
        <EmptyState
          icon={FileX}
          title="No workflows found"
          description="Create your first workflow to get started"
        />
      }
    />
  )
}
```

---

## VirtualGrid Component

The `VirtualGrid` component renders a grid layout with virtual scrolling.

### Basic Usage

```typescript
import { VirtualGrid } from '../components/common'

function AssetGrid({ assets }) {
  return (
    <VirtualGrid
      items={assets}
      height={600}
      estimateSize={200}
      columns={3}
      renderItem={(asset, index) => (
        <AssetCard asset={asset} />
      )}
      getItemKey={(asset) => asset.id}
    />
  )
}
```

### Props

All props from `VirtualList` plus:

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| columns | number | Yes | Number of columns in grid |
| gap | number | No | Gap between items (px, default: 16) |

### Complete Example

```typescript
import { VirtualGrid, EmptyState, CardSkeleton } from '../components/common'
import { Image } from 'lucide-react'

function AssetGallery() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['assets'],
    queryFn: fetchAssets
  })

  return (
    <VirtualGrid
      items={assets || []}
      height="calc(100vh - 150px)"
      estimateSize={280}
      columns={4}
      gap={20}
      renderItem={(asset, index) => (
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow">
          <img
            src={asset.thumbnail}
            alt={asset.name}
            className="w-full h-48 object-cover"
          />
          <div className="p-4">
            <h4 className="font-medium truncate">{asset.name}</h4>
            <p className="text-sm text-gray-500">{asset.type}</p>
          </div>
        </div>
      )}
      getItemKey={(asset) => asset.id}
      overscan={8}
      className="p-4"
      isLoading={isLoading}
      loadingState={
        <div className="grid grid-cols-4 gap-4 p-4">
          <CardSkeleton count={8} />
        </div>
      }
      emptyState={
        <EmptyState
          icon={Image}
          title="No assets found"
          description="Upload your first asset"
        />
      }
    />
  )
}
```

---

## useVirtualList Hook

For advanced use cases, use the `useVirtualList` hook for manual control.

### Basic Usage

```typescript
import { useVirtualList } from '../components/common'

function CustomList({ items }) {
  const { parentRef, virtualizer, virtualItems, totalSize } = useVirtualList(
    items,
    {
      estimateSize: () => 60,
      overscan: 5
    }
  )

  return (
    <div ref={parentRef} style={{ height: 400, overflow: 'auto' }}>
      <div style={{ height: `${totalSize}px`, position: 'relative' }}>
        {virtualItems.map((virtualItem) => (
          <div
            key={virtualItem.index}
            data-index={virtualItem.index}
            ref={virtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualItem.start}px)`
            }}
          >
            {items[virtualItem.index].name}
          </div>
        ))}
      </div>
    </div>
  )
}
```

### Return Value

| Property | Type | Description |
|----------|------|-------------|
| parentRef | RefObject | Ref for scrollable container |
| virtualizer | Virtualizer | Virtualizer instance |
| virtualItems | VirtualItem[] | Currently visible items |
| totalSize | number | Total height of all items |

---

## Best Practices

### 1. Provide Accurate Height Estimates

```typescript
// Bad - wildly inaccurate
<VirtualList estimateSize={50} /> // Actual height: 200px

// Good - close estimate
<VirtualList estimateSize={180} /> // Actual height: 200px

// Best - measure dynamically
const estimateSize = useMemo(() => {
  // Calculate based on content
  return baseHeight + (hasImage ? 150 : 0)
}, [hasImage])
```

### 2. Use Stable Keys

```typescript
// Bad - index as key (breaks on reorder)
getItemKey={(item, index) => index}

// Good - unique ID
getItemKey={(item) => item.id}

// Good - composite key
getItemKey={(item) => `${item.type}-${item.id}`}
```

### 3. Memoize Render Function

```typescript
// Bad - new function every render
renderItem={(item) => <ItemCard item={item} onClick={handleClick} />}

// Good - memoized callback
const handleClick = useCallback((id) => { ... }, [])

const renderItem = useCallback((item) => (
  <ItemCard item={item} onClick={handleClick} />
), [handleClick])
```

### 4. Set Appropriate Overscan

```typescript
// Too low - visible items pop in
<VirtualList overscan={1} />

// Too high - rendering too many items
<VirtualList overscan={50} />

// Good - balanced
<VirtualList overscan={5} /> // Default

// Better for fast scrolling
<VirtualList overscan={10} />
```

### 5. Handle Loading and Empty States

```typescript
<VirtualList
  items={data || []}
  isLoading={isLoading}
  loadingState={<ListSkeleton count={5} />}
  emptyState={
    <EmptyState
      title="No items"
      description="Add your first item"
    />
  }
/>
```

---

## Performance Tips

### 1. Optimize Item Components

```typescript
// Memoize item component
const WorkflowItem = React.memo(({ workflow }) => (
  <div className="p-4 border-b">
    <h3>{workflow.name}</h3>
    <p>{workflow.description}</p>
  </div>
))

// Use in VirtualList
<VirtualList
  renderItem={(workflow) => <WorkflowItem workflow={workflow} />}
/>
```

### 2. Avoid Inline Styles in Render

```typescript
// Bad - creates new object every render
renderItem={(item) => (
  <div style={{ padding: 16, border: '1px solid gray' }}>
    {item.name}
  </div>
)}

// Good - use CSS classes
renderItem={(item) => (
  <div className="p-4 border border-gray-200">
    {item.name}
  </div>
)}
```

### 3. Debounce Expensive Operations

```typescript
const debouncedSearch = useMemo(
  () => debounce((term: string) => {
    // Expensive search operation
  }, 300),
  []
)

// Use with virtual list
<VirtualList
  items={filteredItems}
  renderItem={(item) => <Item item={item} onSearch={debouncedSearch} />}
/>
```

### 4. Use Dynamic Height When Needed

```typescript
// For items with variable height
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: (index) => {
    // Return different estimates based on content
    const item = items[index]
    return item.hasImage ? 300 : 100
  },
  // Enable dynamic measurement
  measureElement: (element) => element?.getBoundingClientRect().height
})
```

---

## Examples

### Example 1: Simple Workflow List

```typescript
function SimpleWorkflowList() {
  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows
  })

  return (
    <VirtualList
      items={workflows}
      height={600}
      estimateSize={80}
      renderItem={(workflow) => (
        <div className="p-4 border-b hover:bg-gray-50">
          <div className="flex justify-between items-center">
            <span className="font-medium">{workflow.name}</span>
            <Badge variant="primary">{workflow.status}</Badge>
          </div>
        </div>
      )}
      getItemKey={(w) => w.id}
    />
  )
}
```

### Example 2: Asset Grid with Actions

```typescript
function AssetGridWithActions() {
  const { data: assets = [] } = useQuery({
    queryKey: ['assets'],
    queryFn: fetchAssets
  })

  const handleDelete = useCallback((id: string) => {
    // Delete asset
  }, [])

  return (
    <VirtualGrid
      items={assets}
      height="calc(100vh - 200px)"
      estimateSize={250}
      columns={3}
      gap={16}
      renderItem={(asset) => (
        <div className="bg-white rounded-lg border hover:shadow-lg transition-shadow">
          <img
            src={asset.url}
            alt={asset.name}
            className="w-full h-40 object-cover rounded-t-lg"
          />
          <div className="p-3">
            <h4 className="font-medium">{asset.name}</h4>
            <div className="flex gap-2 mt-2">
              <Button size="sm" variant="outline">
                Edit
              </Button>
              <Button
                size="sm"
                variant="danger"
                onClick={() => handleDelete(asset.id)}
              >
                Delete
              </Button>
            </div>
          </div>
        </div>
      )}
      getItemKey={(a) => a.id}
    />
  )
}
```

### Example 3: Searchable List

```typescript
function SearchableWorkflowList() {
  const [search, setSearch] = useState('')
  const { data: workflows = [] } = useQuery({
    queryKey: ['workflows'],
    queryFn: fetchWorkflows
  })

  const filteredWorkflows = useMemo(() =>
    workflows.filter(w =>
      w.name.toLowerCase().includes(search.toLowerCase())
    ),
    [workflows, search]
  )

  return (
    <div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search workflows..."
        className="w-full px-4 py-2 border rounded-lg mb-4"
      />

      <VirtualList
        items={filteredWorkflows}
        height={500}
        estimateSize={100}
        renderItem={(workflow) => (
          <WorkflowCard workflow={workflow} />
        )}
        getItemKey={(w) => w.id}
        emptyState={
          <EmptyState
            title="No matches"
            description={`No workflows match "${search}"`}
          />
        }
      />
    </div>
  )
}
```

### Example 4: Infinite Scroll with Virtual List

```typescript
function InfiniteWorkflowList() {
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage
  } = useInfiniteQuery({
    queryKey: ['workflows'],
    queryFn: ({ pageParam = 0 }) => fetchWorkflowsPage(pageParam),
    getNextPageParam: (lastPage, pages) => lastPage.nextCursor
  })

  const allWorkflows = useMemo(() =>
    data?.pages.flatMap(page => page.workflows) || [],
    [data]
  )

  const { parentRef } = useVirtualList(allWorkflows, {
    estimateSize: () => 100,
    overscan: 5
  })

  // Load more when scrolled near bottom
  useEffect(() => {
    const parent = parentRef.current
    if (!parent) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = parent
      if (scrollHeight - scrollTop <= clientHeight * 1.5) {
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      }
    }

    parent.addEventListener('scroll', handleScroll)
    return () => parent.removeEventListener('scroll', handleScroll)
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  return (
    <VirtualList
      items={allWorkflows}
      height={600}
      estimateSize={100}
      renderItem={(workflow) => <WorkflowCard workflow={workflow} />}
      getItemKey={(w) => w.id}
    />
  )
}
```

---

## Performance Comparison

### Without Virtual Scrolling
```
List with 1000 items:
- Initial render: ~800ms
- Memory usage: ~50MB (1000 DOM nodes)
- Scroll FPS: ~30fps (laggy)
```

### With Virtual Scrolling
```
List with 1000 items:
- Initial render: ~80ms
- Memory usage: ~5MB (~20 DOM nodes)
- Scroll FPS: ~60fps (smooth)
```

**10x faster initial render, 10x less memory usage!**

---

## Troubleshooting

### Items jumping around while scrolling

**Cause:** Inaccurate height estimates

**Solution:**
```typescript
// Use dynamic measurement
const virtualizer = useVirtualizer({
  count: items.length,
  getScrollElement: () => parentRef.current,
  estimateSize: () => 100,
  // Let virtualizer measure actual heights
  measureElement: (element) => element?.getBoundingClientRect().height
})
```

### Poor performance with virtual scrolling

**Cause:** Expensive render functions or non-memoized components

**Solution:**
```typescript
// Memoize item component
const Item = React.memo(({ item }) => <div>{item.name}</div>)

// Memoize render function
const renderItem = useCallback((item) => <Item item={item} />, [])
```

### Empty space at bottom of list

**Cause:** Total height calculation is off

**Solution:**
```typescript
// Ensure all items are measured
<VirtualList
  renderItem={(item, index) => (
    <div
      key={item.id}
      data-index={index}
      ref={virtualizer.measureElement} // Important!
    >
      {/* content */}
    </div>
  )}
/>
```

---

## Migration from Regular Lists

### Step 1: Wrap existing list

```typescript
// Before
<div className="overflow-auto" style={{ height: 600 }}>
  {items.map(item => <ItemCard key={item.id} item={item} />)}
</div>

// After
<VirtualList
  items={items}
  height={600}
  estimateSize={80}
  renderItem={(item) => <ItemCard item={item} />}
  getItemKey={(item) => item.id}
/>
```

### Step 2: Add loading and empty states

```typescript
<VirtualList
  items={items}
  height={600}
  estimateSize={80}
  renderItem={(item) => <ItemCard item={item} />}
  getItemKey={(item) => item.id}
  isLoading={isLoading}
  loadingState={<ListSkeleton count={5} />}
  emptyState={<EmptyState title="No items" />}
/>
```

### Step 3: Optimize if needed

```typescript
// Memoize item component
const ItemCard = React.memo(({ item }) => { ... })

// Use in VirtualList
<VirtualList
  items={items}
  renderItem={(item) => <ItemCard item={item} />}
  overscan={10} // Increase if fast scrolling
/>
```

---

## Further Reading

- [TanStack Virtual Documentation](https://tanstack.com/virtual/latest)
- [React Performance Optimization](https://react.dev/learn/render-and-commit)
- [Virtual Scrolling Best Practices](https://web.dev/virtualize-long-lists-react-window/)
