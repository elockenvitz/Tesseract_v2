# Attention System

The Attention system provides the backbone for Tesseract's "10-minute screen" - a unified view of everything requiring the user's attention.

## Overview

The system normalizes various underlying objects (projects, deliverables, trades, notifications, etc.) into a unified `AttentionItem` format and categorizes them into 4 dashboard sections:

1. **What I Need To Do** (`action_required`) - Tasks and items requiring direct action
2. **Decisions I Need To Make** (`decision_required`) - Items awaiting explicit decisions/approvals
3. **What's New** (`informational`) - Recent updates and changes
4. **Team Priority** (`alignment`) - High-activity items across the team

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      DashboardPage.tsx                          │
│                    (AttentionDashboard)                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     useAttention Hook                           │
│         (TanStack Query + Supabase Functions)                   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│              Attention Edge Function                            │
│        (supabase/functions/attention/index.ts)                  │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Collectors  │  │   Scoring    │  │ De-duplicate │          │
│  │  (per table) │─▶│   Engine     │─▶│   & Sort     │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    attention_user_state                         │
│               (per-user read/snooze/dismiss)                    │
└─────────────────────────────────────────────────────────────────┘
```

## Attention ID Computation

Each attention item has a deterministic `attention_id` computed as:

```
attention_id = SHA256(source_type:source_id:attention_type:reason_code).hex()[:32]
```

This ensures:
- Same item always produces same ID across API calls
- User state (read/snooze/dismiss) persists correctly
- De-duplication works reliably

Example:
```
source_type: "project_deliverable"
source_id: "abc-123-uuid"
attention_type: "action_required"
reason_code: "deliverable_pending"

attention_id: "7f83b1657ff1fc53b92dc18148a1d65d"
```

## Data Sources by Section

### ACTION_REQUIRED
| Source Table | Reason Code | Description |
|--------------|-------------|-------------|
| `project_deliverables` | `deliverable_pending` | Incomplete deliverables assigned to user |
| `projects` | `project_blocked` | Blocked projects user owns |
| `projects` | `project_overdue` | Overdue projects |
| `projects` | `project_due_soon` | Projects due within 7 days |

### DECISION_REQUIRED
| Source Table | Reason Code | Description |
|--------------|-------------|-------------|
| `trade_queue_items` | `trade_vote_needed` | Trades pending user's vote |
| `asset_list_suggestions` | `suggestion_pending` | List suggestions awaiting response |

### INFORMATIONAL
| Source Table | Reason Code | Description |
|--------------|-------------|-------------|
| `notifications` | `{notification.type}` | Unread notifications |
| `project_activity` | `{activity_type}` | Recent project activity from others |

### ALIGNMENT
| Source Table | Reason Code | Description |
|--------------|-------------|-------------|
| `projects` | `high_activity` | Projects with 2+ contributors and recent activity |

## Scoring Weights

Scores determine item ordering within each section. All weights are tunable in `supabase/functions/attention/index.ts`:

```typescript
const WEIGHTS = {
  // Urgency
  overdue_days_multiplier: 10,    // +10 per day overdue
  due_soon_days_threshold: 3,     // Days to consider "due soon"
  due_soon_bonus: 20,             // Bonus for due soon items

  // Ownership
  owner_bonus: 15,                // User owns the item
  assigned_bonus: 10,             // User is assigned

  // Type bonuses
  decision_required_bonus: 30,    // Decision items get priority
  action_required_bonus: 20,      // Action items next
  blocking_bonus: 25,             // Items blocking others

  // Activity
  recent_activity_threshold_hours: 24,
  recent_activity_bonus: 10,      // Active in last 24h
  stale_activity_penalty: -5,     // Inactive for 72h+

  // Severity multipliers
  severity_multipliers: {
    low: 1.0,
    medium: 1.25,
    high: 1.5,
    critical: 2.0,
  },
}
```

### Score Calculation Example

A project deliverable that is:
- 2 days overdue (+20)
- Owned by user (+15)
- Severity: high (×1.5)
- Recently active (+10)

Base score: `10 × 1.5 = 15`
Additions: `15 + 20 + 15 + 10 = 60`
**Final score: 75**

## API Endpoints

### GET /attention

Fetch all attention items for the authenticated user.

**Query Parameters:**
- `window_hours` (optional, default: 24) - Time window for informational items

**Response:**
```json
{
  "generated_at": "2025-01-30T12:00:00Z",
  "window_start": "2025-01-29T12:00:00Z",
  "window_hours": 24,
  "sections": {
    "informational": [...],
    "action_required": [...],
    "decision_required": [...],
    "alignment": [...]
  },
  "counts": {
    "informational": 5,
    "action_required": 3,
    "decision_required": 1,
    "alignment": 2,
    "total": 11
  }
}
```

### POST /attention/ack

Acknowledge an informational item.

**Request:**
```json
{ "attention_id": "7f83b1657ff1fc53..." }
```

### POST /attention/snooze

Snooze an item until a future time.

**Request:**
```json
{
  "attention_id": "7f83b1657ff1fc53...",
  "snoozed_until": "2025-01-31T09:00:00Z"
}
```

### POST /attention/dismiss

Permanently dismiss an item.

**Request:**
```json
{ "attention_id": "7f83b1657ff1fc53..." }
```

### POST /attention/mark-read

Mark an item as read (but not acknowledged).

**Request:**
```json
{ "attention_id": "7f83b1657ff1fc53..." }
```

## Database Schema

### attention_user_state

Stores per-user state for attention items.

```sql
CREATE TABLE attention_user_state (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id),
  attention_id text NOT NULL,
  read_state attention_read_state DEFAULT 'unread',
  last_viewed_at timestamptz,
  snoozed_until timestamptz,
  dismissed_at timestamptz,
  personal_rank_override numeric,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, attention_id)
);
```

**RLS Policies:** Users can only access their own rows.

## Frontend Components

### useAttention Hook

```typescript
import { useAttention } from '../hooks/useAttention'

function MyComponent() {
  const {
    sections,           // { informational, action_required, ... }
    counts,             // { total, informational, ... }
    isLoading,
    acknowledge,        // (attention_id) => Promise
    snoozeFor,          // (attention_id, hours) => Promise
    dismiss,            // (attention_id) => Promise
    refetch,
  } = useAttention({ windowHours: 24 })
}
```

### AttentionDashboard Component

```tsx
<AttentionDashboard
  onNavigate={(url) => handleNavigation(url)}
  maxItemsPerSection={5}
  showScore={isDev}  // Show debug score in dev mode
/>
```

### AttentionCard Component

Individual card for each attention item with:
- Source type icon
- Title and reason text
- Due date badge
- Quick actions (Ack/Snooze/Dismiss)
- Click to navigate

## De-duplication

If an item qualifies for multiple attention types (e.g., a blocked project is both an "action" and might appear in "alignment"), the system keeps only the highest-priority type:

```
decision_required > action_required > informational > alignment
```

## Known TODOs

1. **Workflow Items**: Add collector for workflow checklist items assigned to user
2. **Coverage Changes**: Add collector for coverage assignment changes
3. **Note Updates**: Add collector for shared note updates
4. **Real-time**: Add Supabase Realtime subscription for live updates
5. **Bulk Actions**: Add bulk acknowledge/dismiss for clearing sections
6. **Filters**: Add ability to filter by source type or severity
7. **Personal Priority Override**: Implement drag-to-reorder with personal_rank_override

## Testing

To test locally:

1. Deploy the Edge Function:
   ```bash
   supabase functions deploy attention
   ```

2. Test the endpoint:
   ```bash
   curl -H "Authorization: Bearer YOUR_JWT" \
     "https://YOUR_PROJECT.supabase.co/functions/v1/attention?window_hours=24"
   ```

3. View in UI:
   - Navigate to Dashboard tab
   - Attention Center section shows all 4 sections
   - In dev mode, scores are displayed on cards
