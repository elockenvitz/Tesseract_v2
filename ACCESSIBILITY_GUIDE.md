# Accessibility Guide

This guide documents the accessibility features implemented in the Tesseract application and provides best practices for maintaining accessibility standards.

## Table of Contents

1. [Overview](#overview)
2. [ARIA Attributes](#aria-attributes)
3. [Keyboard Navigation](#keyboard-navigation)
4. [Screen Reader Support](#screen-reader-support)
5. [Focus Management](#focus-management)
6. [Testing Accessibility](#testing-accessibility)
7. [Best Practices](#best-practices)

---

## Overview

The Tesseract application follows WCAG 2.1 Level AA accessibility guidelines to ensure the application is usable by people with disabilities. All common components have been enhanced with proper ARIA attributes, keyboard navigation, and screen reader support.

### Key Features

- **ARIA Labels and Roles** - All interactive elements have descriptive labels
- **Keyboard Navigation** - Full keyboard accessibility for all features
- **Screen Reader Support** - Proper announcements and live regions
- **Focus Management** - Visible focus indicators and logical tab order
- **Semantic HTML** - Proper use of HTML5 semantic elements

---

## ARIA Attributes

### Toast Notifications

**File:** `src/components/common/Toast.tsx`

```typescript
// Container with live region for screen reader announcements
<div
  role="region"
  aria-live="polite"
  aria-atomic="false"
  aria-label="Notifications"
>
  {/* Toast items */}
</div>

// Individual toast with alert role
<div
  role="alert"
  aria-label={`${ariaLabel}: ${message}`}
>
  <Icon aria-hidden="true" /> {/* Decorative icons hidden from screen readers */}
  <p>{message}</p>
  <button aria-label="Close notification">
    <X />
  </button>
</div>
```

**ARIA Attributes Used:**
- `role="region"` - Defines a landmark region
- `role="alert"` - Announces important messages immediately
- `aria-live="polite"` - Announces updates when user is idle
- `aria-atomic="false"` - Only announces changed content
- `aria-label` - Provides accessible names
- `aria-hidden="true"` - Hides decorative elements from screen readers

### Empty States

**File:** `src/components/common/EmptyState.tsx`

```typescript
<div role="status" aria-live="polite">
  <div aria-hidden="true"> {/* Decorative icon */}
    <Icon />
  </div>
  <h3>{title}</h3>
  <p>{description}</p>
  <div role="group" aria-label="Available actions">
    <Button aria-label={action.label}>{action.label}</Button>
  </div>
</div>
```

**ARIA Attributes Used:**
- `role="status"` - Indicates status information
- `aria-live="polite"` - Announces when content becomes empty/populated
- `role="group"` - Groups related action buttons
- `aria-label` - Labels button groups and individual buttons

### Query Error Display

**File:** `src/components/common/QueryErrorDisplay.tsx`

```typescript
<div role="alert" aria-live="assertive">
  <div aria-hidden="true">
    <AlertCircle />
  </div>
  <h3>{title}</h3>
  <p>{errorMessage}</p>
  <Button aria-label="Try loading data again">
    <RefreshCw aria-hidden="true" />
    Try Again
  </Button>
</div>
```

**ARIA Attributes Used:**
- `role="alert"` - Immediately announces errors
- `aria-live="assertive"` - Interrupts screen reader to announce errors
- `aria-label` - Provides clear button labels

### Loading Skeletons

**File:** `src/components/common/LoadingSkeleton.tsx`

```typescript
<div
  role="status"
  aria-label="Loading cards"
  aria-busy="true"
>
  <div aria-hidden="true"> {/* Visual skeleton hidden from screen readers */}
    {/* Skeleton UI */}
  </div>
</div>
```

**ARIA Attributes Used:**
- `role="status"` - Indicates loading status
- `aria-busy="true"` - Indicates content is loading
- `aria-label` - Describes what is loading
- `aria-hidden="true"` - Hides visual skeleton from screen readers

### Virtual List/Grid

**File:** `src/components/common/VirtualList.tsx`

```typescript
// Virtual List
<div
  role="list"
  aria-label="Scrollable list"
>
  <div aria-live="polite" aria-atomic="false">
    {items.map(item => (
      <div role="listitem">
        {renderItem(item)}
      </div>
    ))}
  </div>
</div>

// Virtual Grid
<div
  role="grid"
  aria-label="Scrollable grid"
>
  <div aria-live="polite" aria-atomic="false">
    <div role="row">
      <div role="gridcell">
        {/* Cell content */}
      </div>
    </div>
  </div>
</div>
```

**ARIA Attributes Used:**
- `role="list"` / `role="grid"` - Defines list/grid structure
- `role="listitem"` / `role="row"` / `role="gridcell"` - Defines items
- `aria-live="polite"` - Announces content changes when scrolling
- `aria-atomic="false"` - Only announces new items

---

## Keyboard Navigation

### Toast Notifications

**Keyboard Shortcuts:**
- `Escape` - Closes any visible toast notification

**Implementation:**

```typescript
// Escape key handler in Toast component
React.useEffect(() => {
  const handleEscape = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose(id)
    }
  }

  document.addEventListener('keydown', handleEscape)
  return () => document.removeEventListener('keydown', handleEscape)
}, [id, onClose])
```

### Focus Management

All interactive elements (buttons, links, form fields) are keyboard accessible with:
- `Tab` - Move forward through interactive elements
- `Shift + Tab` - Move backward through interactive elements
- `Enter` / `Space` - Activate buttons and links
- `Escape` - Close modals and dismissible elements

### Focus Indicators

All interactive elements have visible focus indicators:

```typescript
// Example focus styles in buttons
<button className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500">
  Click me
</button>

// Example focus styles in toast close button
<button className="focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 rounded">
  <X />
</button>
```

---

## Screen Reader Support

### Live Regions

Live regions announce dynamic content changes to screen readers:

#### Polite Announcements

Used for non-critical updates that don't require immediate attention:

```typescript
// Empty states
<div aria-live="polite" role="status">
  No workflows yet
</div>

// Virtual lists (new items)
<div aria-live="polite" aria-atomic="false">
  {/* New items announced as they appear */}
</div>
```

#### Assertive Announcements

Used for critical information that requires immediate attention:

```typescript
// Error messages
<div aria-live="assertive" role="alert">
  Failed to load data
</div>
```

### Hidden Content

Decorative elements are hidden from screen readers:

```typescript
// Icons that don't convey unique information
<Icon aria-hidden="true" />

// Visual skeleton loaders
<div aria-hidden="true">
  {/* Skeleton UI */}
</div>
```

### Accessible Names

All interactive elements have accessible names:

```typescript
// Button with icon
<Button aria-label="Close notification">
  <X /> {/* Icon is decorative */}
</Button>

// Button with text and icon
<Button aria-label="Create workflow">
  <Plus aria-hidden="true" />
  Create Workflow
</Button>
```

---

## Focus Management

### Focus Indicators

All focusable elements have clear visual focus indicators using Tailwind CSS:

```css
/* Base focus styles */
focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500

/* Error context focus styles */
focus:ring-red-500

/* Success context focus styles */
focus:ring-green-500

/* Warning context focus styles */
focus:ring-yellow-500
```

### Tab Order

Tab order follows logical reading order:

1. Header/navigation elements
2. Main content (left to right, top to bottom)
3. Secondary actions
4. Footer elements

### Focus Trapping

Modal dialogs trap focus to prevent keyboard users from accidentally navigating outside:

```typescript
// Modal focus management (to be implemented)
useEffect(() => {
  if (isOpen) {
    const firstFocusable = modalRef.current?.querySelector('button, a, input')
    firstFocusable?.focus()
  }
}, [isOpen])
```

---

## Testing Accessibility

### Manual Testing

#### Keyboard Navigation Test

1. **Tab Navigation**
   - Use `Tab` to navigate through all interactive elements
   - Verify focus indicators are visible
   - Ensure tab order is logical

2. **Keyboard Shortcuts**
   - Test `Escape` key closes toasts
   - Test `Enter` and `Space` activate buttons
   - Test arrow keys work in custom controls

#### Screen Reader Testing

**Tools:**
- NVDA (Windows) - Free
- JAWS (Windows) - Commercial
- VoiceOver (Mac/iOS) - Built-in
- TalkBack (Android) - Built-in

**Testing Steps:**

1. **Enable screen reader**
   - Windows: NVDA or JAWS
   - Mac: VoiceOver (Cmd + F5)

2. **Test announcements**
   - Verify toasts are announced
   - Verify errors are announced
   - Verify loading states are announced
   - Verify empty states are announced

3. **Test navigation**
   - Navigate by headings
   - Navigate by landmarks
   - Navigate by buttons
   - Navigate by lists/grids

#### Visual Focus Test

1. Open application
2. Click anywhere to ensure page has focus
3. Press `Tab` repeatedly
4. Verify each interactive element shows clear focus indicator
5. Verify focus order is logical

### Automated Testing

#### Tools

**axe DevTools** (Browser Extension):
```bash
# Install axe DevTools browser extension
# Chrome: https://chrome.google.com/webstore
# Firefox: https://addons.mozilla.org/en-US/firefox/
```

**Lighthouse** (Built into Chrome):
```bash
# Open Chrome DevTools
# Navigate to Lighthouse tab
# Run accessibility audit
```

**Jest + Testing Library**:
```typescript
import { render, screen } from '@testing-library/react'
import { axe, toHaveNoViolations } from 'jest-axe'

expect.extend(toHaveNoViolations)

test('Component is accessible', async () => {
  const { container } = render(<MyComponent />)
  const results = await axe(container)
  expect(results).toHaveNoViolations()
})
```

---

## Best Practices

### 1. Use Semantic HTML

```typescript
// ✅ Good - Semantic HTML
<button onClick={handleClick}>Click me</button>
<nav>Navigation</nav>
<main>Main content</main>

// ❌ Bad - Non-semantic div
<div onClick={handleClick}>Click me</div>
```

### 2. Provide Text Alternatives

```typescript
// ✅ Good - Button with accessible name
<Button aria-label="Close">
  <X aria-hidden="true" />
</Button>

// ❌ Bad - Icon-only button without label
<Button>
  <X />
</Button>
```

### 3. Use ARIA Appropriately

```typescript
// ✅ Good - ARIA enhances native HTML
<button aria-label="Delete workflow">
  <Trash aria-hidden="true" />
</button>

// ❌ Bad - ARIA replaces native HTML unnecessarily
<div role="button" tabIndex={0} onClick={handleClick}>
  Click me
</div>
```

### 4. Manage Focus Properly

```typescript
// ✅ Good - Focus management for modals
useEffect(() => {
  if (isOpen) {
    previousFocus.current = document.activeElement
    modalRef.current?.focus()
  } else {
    previousFocus.current?.focus()
  }
}, [isOpen])

// ❌ Bad - No focus management
// Modal opens but focus stays on background
```

### 5. Provide Keyboard Navigation

```typescript
// ✅ Good - Keyboard event handlers
<div
  role="button"
  tabIndex={0}
  onClick={handleClick}
  onKeyDown={(e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      handleClick()
    }
  }}
>
  Custom button
</div>

// ❌ Bad - Click-only handler
<div onClick={handleClick}>
  Custom button
</div>
```

### 6. Use Live Regions Sparingly

```typescript
// ✅ Good - Live region for dynamic status updates
<div role="status" aria-live="polite">
  {itemCount} items in cart
</div>

// ❌ Bad - Live region for static content
<div aria-live="polite">
  Welcome to our site
</div>
```

### 7. Hide Decorative Content

```typescript
// ✅ Good - Decorative icon hidden
<Button>
  <Icon aria-hidden="true" />
  Save
</Button>

// ✅ Good - Informative icon with label
<Button aria-label="Save document">
  <Save />
</Button>
```

### 8. Test with Real Users

- Include users with disabilities in testing
- Test with actual screen readers
- Test with keyboard-only navigation
- Test with zoom and large text
- Test with high contrast mode

---

## Component Checklist

When creating new components, ensure they meet these criteria:

### ✅ Basic Requirements

- [ ] Uses semantic HTML where possible
- [ ] All interactive elements are keyboard accessible
- [ ] Focus indicators are clearly visible
- [ ] Color is not the only visual indicator
- [ ] Text has sufficient contrast (4.5:1 minimum)

### ✅ ARIA Implementation

- [ ] Has appropriate ARIA roles
- [ ] Has descriptive ARIA labels
- [ ] Uses live regions for dynamic content
- [ ] Hides decorative elements with `aria-hidden`
- [ ] Uses `aria-busy` for loading states

### ✅ Keyboard Navigation

- [ ] All functionality available via keyboard
- [ ] Tab order is logical
- [ ] Escape key closes dismissible elements
- [ ] Enter/Space activates buttons
- [ ] Arrow keys work for custom controls

### ✅ Screen Reader Support

- [ ] All content is announced properly
- [ ] Loading states are announced
- [ ] Errors are announced immediately
- [ ] Form errors are associated with inputs
- [ ] Button purposes are clear

### ✅ Testing

- [ ] Tested with keyboard-only navigation
- [ ] Tested with screen reader
- [ ] Passed automated accessibility tests
- [ ] No axe violations
- [ ] Lighthouse accessibility score > 90

---

## Resources

### Documentation

- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)
- [MDN Accessibility](https://developer.mozilla.org/en-US/docs/Web/Accessibility)
- [WebAIM Resources](https://webaim.org/resources/)

### Tools

- [axe DevTools](https://www.deque.com/axe/devtools/)
- [WAVE Browser Extension](https://wave.webaim.org/extension/)
- [Lighthouse](https://developers.google.com/web/tools/lighthouse)
- [NVDA Screen Reader](https://www.nvaccess.org/)
- [Color Contrast Checker](https://webaim.org/resources/contrastchecker/)

### Testing

- [NVDA Download](https://www.nvaccess.org/download/)
- [WebAIM Screen Reader Testing](https://webaim.org/articles/screenreader_testing/)
- [Keyboard Accessibility](https://webaim.org/techniques/keyboard/)

---

## Summary of Accessibility Enhancements

### Components Enhanced

1. **Toast Notifications** (`Toast.tsx`)
   - Added ARIA live regions
   - Added role="alert" for immediate announcements
   - Added Escape key handler
   - Added focus indicators
   - Hidden decorative icons

2. **Empty States** (`EmptyState.tsx`)
   - Added role="status" for loading announcements
   - Added aria-live="polite" for content changes
   - Added role="group" for action buttons
   - Hidden decorative icons

3. **Query Error Display** (`QueryErrorDisplay.tsx`)
   - Added role="alert" for error announcements
   - Added aria-live="assertive" for immediate feedback
   - Added descriptive button labels
   - Hidden decorative icons
   - Added focus indicators

4. **Loading Skeletons** (`LoadingSkeleton.tsx`)
   - Added role="status" for loading state
   - Added aria-busy="true" to indicate loading
   - Added descriptive aria-label
   - Hidden visual skeletons from screen readers

5. **Virtual List/Grid** (`VirtualList.tsx`)
   - Added role="list" and role="grid"
   - Added role="listitem", role="row", role="gridcell"
   - Added aria-live for content updates
   - Added descriptive labels

### Benefits

- **Screen Reader Users**: Clear announcements and navigation
- **Keyboard Users**: Full keyboard accessibility
- **Low Vision Users**: Clear focus indicators
- **All Users**: Better semantic structure and usability

---

## Maintenance

### When Adding New Components

1. Follow the [Component Checklist](#component-checklist)
2. Test with keyboard and screen reader
3. Run automated accessibility tests
4. Document any custom keyboard shortcuts
5. Update this guide if introducing new patterns

### When Modifying Existing Components

1. Verify ARIA attributes remain accurate
2. Test keyboard navigation still works
3. Re-run accessibility tests
4. Update documentation if behavior changes

### Regular Audits

- Run automated tests monthly
- Manual testing quarterly
- User testing with people with disabilities annually
- Update components based on feedback

---

## Contact

For accessibility questions or to report issues:
- Create an issue in the repository
- Tag with `accessibility` label
- Include steps to reproduce
- Include screen reader/browser information if applicable
