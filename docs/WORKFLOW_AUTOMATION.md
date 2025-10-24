# Workflow Automation System

## Overview

The workflow automation system allows workflows to automatically trigger actions based on time-based events or activity-based events. Key features include:

1. **Dynamic Workflow Naming** - Automatically create workflow copies with unique names using placeholders
2. **Universe Configuration** - Define which assets, themes, or portfolios should automatically receive a workflow when it kicks off
3. **Automation Rules** - Set up time-based and activity-based triggers for workflow actions

## Dynamic Suffix System

### Purpose

When a workflow automation rule triggers and creates a copy of a workflow, we need to ensure the new workflow has a unique name. This is accomplished using:

1. **Dynamic Placeholders** - Special tokens that get replaced with current date values
2. **Uniqueness Checking** - Automatic detection and resolution of name conflicts

### Available Placeholders

| Placeholder | Description | Example (Oct 2025) |
|------------|-------------|-------------------|
| `{Q}` | Quarter number | `4` |
| `{QUARTER}` | Quarter with Q prefix | `Q4` |
| `{YEAR}` | Full year | `2025` |
| `{YY}` | Short year (2 digits) | `25` |
| `{MONTH}` | Current month | `Oct` |
| `{START_MONTH}` | Quarter start month | `Oct` |
| `{END_MONTH}` | Quarter end month | `Dec` |

### Example Usage

**Suffix Pattern:** `{Q}{YEAR}`
- Q1 2025: "Due Diligence - 12025"
- Q2 2025: "Due Diligence - 22025"
- Q3 2025: "Due Diligence - 32025"
- Q4 2025: "Due Diligence - 42025"

**Suffix Pattern:** `{QUARTER} {YEAR} Earnings`
- Q1 2025: "Due Diligence - Q1 2025 Earnings"
- Q2 2025: "Due Diligence - Q2 2025 Earnings"

## Uniqueness Guarantee

### How It Works

When a workflow automation rule triggers:

1. **Process Dynamic Suffix**
   ```sql
   process_dynamic_suffix('{Q}{YEAR}')
   -- Returns: "42025" in Q4 2025
   ```

2. **Generate Unique Name**
   ```sql
   generate_unique_workflow_name('Due Diligence', '{Q}{YEAR}', user_id)
   -- Returns: "Due Diligence - 42025"
   ```

3. **Handle Conflicts**
   - If "Due Diligence - 42025" exists
   - Try "Due Diligence - 42025 (2)"
   - Try "Due Diligence - 42025 (3)"
   - Continue until unique name found

### Database Functions

#### `process_dynamic_suffix(suffix text) → text`

Processes all dynamic placeholders in the suffix string.

**Example:**
```sql
SELECT process_dynamic_suffix('{QUARTER} {YEAR}');
-- Returns: "Q4 2025" (in Q4 2025)
```

#### `generate_unique_workflow_name(base_name text, suffix text, user_id uuid) → text`

Generates a guaranteed unique workflow name by:
1. Processing dynamic suffix
2. Combining base name + suffix
3. Checking for conflicts
4. Adding counter if needed

**Example:**
```sql
SELECT generate_unique_workflow_name('Due Diligence', '{Q}{YEAR}', current_user_id);
-- Returns: "Due Diligence - 42025" or "Due Diligence - 42025 (2)" if conflict
```

#### `copy_workflow_with_unique_name(source_workflow_id uuid, suffix text, target_user_id uuid, copy_progress boolean) → uuid`

Copies an entire workflow including:
- Workflow metadata
- Stages
- Automation rules
- Optionally: progress data

Returns the new workflow ID.

#### `execute_workflow_automation_action(asset_id uuid, workflow_id uuid, action_type text, action_value jsonb, user_id uuid)`

Executes automation rule actions:
- `branch_copy` - Copy workflow with progress
- `branch_nocopy` - Copy workflow without progress
- `move_stage` - Move asset to different stage
- `reset_complete` - Reset workflow progress

## Frontend Integration

### Preview Function

The frontend includes a preview function that mirrors the database logic:

```typescript
processDynamicSuffix(suffix: string): string
```

This allows users to see what the suffix will look like before saving the rule.

### Important Notes

1. **Frontend = Preview Only**: The frontend function shows what the name will look like
2. **Backend = Actual Execution**: The database function guarantees uniqueness
3. **Keep In Sync**: Both functions should process placeholders identically

## Usage Examples

### Example 1: Quarterly Earnings Workflow

**Setup:**
- Base Workflow: "Earnings Review"
- Suffix: `{QUARTER} {YEAR}`
- Trigger: 3 days before earnings date

**Result:**
- Q1 2025: "Earnings Review - Q1 2025"
- Q2 2025: "Earnings Review - Q2 2025"
- If duplicate: "Earnings Review - Q2 2025 (2)"

### Example 2: Monthly Review

**Setup:**
- Base Workflow: "Monthly Review"
- Suffix: `{MONTH} {YEAR}`
- Trigger: First day of month

**Result:**
- Jan 2025: "Monthly Review - Jan 2025"
- Feb 2025: "Monthly Review - Feb 2025"

### Example 3: Conference Follow-up

**Setup:**
- Base Workflow: "Conference Follow-up"
- Suffix: `{Q}{YY}`
- Trigger: After conference attendance

**Result:**
- Q4 2025: "Conference Follow-up - 425"
- If attended multiple Q4 2025 conferences:
  - "Conference Follow-up - 425 (2)"
  - "Conference Follow-up - 425 (3)"

## Migrations

The system is implemented across two migrations:

1. **20251023000000_add_unique_workflow_name_generator.sql**
   - `process_dynamic_suffix()`
   - `generate_unique_workflow_name()`

2. **20251023000001_add_workflow_automation_executor.sql**
   - `copy_workflow_with_unique_name()`
   - `execute_workflow_automation_action()`

To apply:
```bash
# Apply migrations to your Supabase project
supabase db push
```

## Testing

### Manual Testing

1. Create a workflow with name "Test Workflow"
2. Create automation rule with suffix `{QUARTER} {YEAR}`
3. Trigger the rule
4. Verify new workflow created: "Test Workflow - Q4 2025"
5. Trigger again
6. Verify: "Test Workflow - Q4 2025 (2)"

### SQL Testing

```sql
-- Test dynamic suffix processing
SELECT process_dynamic_suffix('{QUARTER} {YEAR}');

-- Test unique name generation
SELECT generate_unique_workflow_name('Test', '{Q}{YEAR}', auth.uid());

-- Test with existing workflow
INSERT INTO workflows (id, name, created_by)
VALUES (gen_random_uuid(), 'Test - 42025', auth.uid());

SELECT generate_unique_workflow_name('Test', '{Q}{YEAR}', auth.uid());
-- Should return "Test - 42025 (2)"
```

## Troubleshooting

### Issue: Duplicate Names Still Created

**Possible Causes:**
- Migration not applied
- Function not being called
- Race condition (rare)

**Solution:**
```sql
-- Check if functions exist
SELECT routine_name FROM information_schema.routines
WHERE routine_name IN ('process_dynamic_suffix', 'generate_unique_workflow_name');

-- Manually test
SELECT generate_unique_workflow_name('My Workflow', '{Q}{YEAR}', auth.uid());
```

### Issue: Suffix Not Processing

**Possible Causes:**
- Using wrong placeholder syntax
- Typo in placeholder name

**Solution:**
- Use exact placeholder names: `{Q}`, `{QUARTER}`, `{YEAR}`, etc.
- Check frontend preview matches expected output

## Workflow Universe Configuration

### Purpose

The Universe configuration system allows you to define which assets, themes, or portfolios should automatically receive a workflow when it kicks off. This eliminates the need to manually assign workflows to individual entities.

### Available Selection Criteria

| Criteria | Description | Example |
|----------|-------------|---------|
| **Analyst Coverage** | Select assets covered by specific analysts | Analyst names from coverage table |
| **Asset Lists** | Select assets from one or more user-created lists | "High Priority Watchlist", "Earnings This Week" |
| **Themes** | Select assets from specific investment themes | "AI & Machine Learning", "Clean Energy" |
| **Sectors** | Select assets by industry sector | Technology, Healthcare, Financials, Energy |
| **Priority Levels** | Select assets by their priority rating | Critical, High, Medium, Low |

### How It Works

1. **Navigate to Universe Tab**
   - Open your workflow in the Workflows page
   - Click on the "Universe" tab

2. **Select Your Universe**
   - Check the boxes for lists you want to include
   - Select themes to include all assets within those themes
   - Choose sectors to filter by industry
   - Pick priority levels to target specific assets

3. **Save Configuration**
   - Click "Save Universe" to store your selections
   - The workflow will automatically be assigned to matching entities when it kicks off

### Database Structure

**Table:** `workflow_universe_rules`

```sql
CREATE TABLE workflow_universe_rules (
  id UUID PRIMARY KEY,
  workflow_id UUID REFERENCES workflows(id),
  rule_type TEXT CHECK (rule_type IN ('list', 'theme', 'sector', 'priority', ...)),
  rule_config JSONB,
  combination_operator TEXT DEFAULT 'or',
  is_active BOOLEAN DEFAULT true,
  created_by UUID REFERENCES users(id)
);
```

**Rule Types and Configurations:**

```javascript
// Asset List Rule
{
  rule_type: 'list',
  rule_config: {
    list_ids: ['uuid1', 'uuid2'],
    operator: 'any'
  }
}

// Theme Rule
{
  rule_type: 'theme',
  rule_config: {
    theme_ids: ['uuid1', 'uuid2'],
    include_assets: true
  }
}

// Sector Rule
{
  rule_type: 'sector',
  rule_config: {
    sectors: ['Technology', 'Healthcare']
  }
}

// Priority Rule
{
  rule_type: 'priority',
  rule_config: {
    levels: ['Critical', 'High']
  }
}
```

### Usage Example

**Scenario:** Quarterly earnings review workflow

**Setup:**
1. Create workflow: "Earnings Review"
2. Configure Universe:
   - ✓ Asset Lists: "Earnings This Quarter"
   - ✓ Sectors: Technology, Healthcare
   - ✓ Priority: Critical, High
3. Save configuration

**Result:**
When the workflow kicks off automatically, it will be assigned to all assets that match ANY of:
- Assets in the "Earnings This Quarter" list
- Technology sector assets
- Healthcare sector assets
- Critical priority assets
- High priority assets

### Frontend Integration

The Universe tab provides an intuitive checkbox-based interface:

```typescript
// State management
const [selectedLists, setSelectedLists] = useState<string[]>([])
const [selectedThemes, setSelectedThemes] = useState<string[]>([])
const [selectedSectors, setSelectedSectors] = useState<string[]>([])
const [selectedPriorities, setSelectedPriorities] = useState<string[]>([])

// Save universe configuration
const saveUniverseMutation = useMutation({
  mutationFn: async ({ workflowId }) => {
    // Delete existing rules
    await supabase
      .from('workflow_universe_rules')
      .delete()
      .eq('workflow_id', workflowId)

    // Insert new rules based on selections
    const rules = []
    if (selectedLists.length > 0) {
      rules.push({ rule_type: 'list', rule_config: { list_ids: selectedLists } })
    }
    // ... more rule types

    await supabase
      .from('workflow_universe_rules')
      .insert(rules)
  }
})
```

### Universe Evaluation

When a workflow kicks off (either manually or via automation), the system evaluates the universe rules to determine which assets should receive the workflow.

#### Database Functions

**`evaluate_workflow_universe(workflow_id uuid, user_id uuid) → TABLE(asset_id uuid)`**

Evaluates all active universe rules for a workflow and returns matching asset IDs.

**Logic:**
1. Loops through all active universe rules for the workflow (ordered by sort_order)
2. For each rule type, queries the appropriate table:
   - **list**: Queries `asset_lists_assets` for assets in specified lists
   - **theme**: Queries `theme_assets` for assets in specified themes
   - **sector**: Queries `assets` table filtered by sector
   - **priority**: Queries `assets` table filtered by priority level
   - **coverage**: Queries `coverage` table for assets covered by specified analysts
3. Combines results using union (OR logic) - an asset is included if it matches ANY rule
4. Returns distinct asset IDs

**Example:**
```sql
-- Get all assets that match the workflow's universe
SELECT * FROM evaluate_workflow_universe(
  'workflow-uuid',
  'user-uuid'
);
```

**`apply_workflow_to_universe(workflow_id uuid, user_id uuid, start_workflow boolean) → integer`**

Applies a workflow to all assets in its configured universe.

**Logic:**
1. Calls `evaluate_workflow_universe()` to get matching assets
2. For each matching asset, creates an entry in `asset_workflow_progress`
3. Sets the asset to the first stage of the workflow
4. Optionally starts the workflow immediately (based on `start_workflow` parameter)
5. Returns count of assets that received the workflow

**Example:**
```sql
-- Apply workflow to its universe and start it
SELECT apply_workflow_to_universe(
  'workflow-uuid',
  'user-uuid',
  true  -- start immediately
);
-- Returns: 15 (number of assets)
```

**`copy_and_kickoff_workflow(source_workflow_id uuid, suffix text, user_id uuid, copy_progress boolean, start_workflow boolean) → jsonb`**

Helper function that combines workflow copying with universe application in one operation.

**Logic:**
1. Calls `copy_workflow_with_unique_name()` to create a new workflow copy
2. Automatically calls `apply_workflow_to_universe()` on the new workflow
3. Returns JSON object with workflow_id, asset_count, and workflow_name

**Example:**
```sql
-- Copy workflow with Q4 2025 suffix and kick it off to universe
SELECT copy_and_kickoff_workflow(
  'source-workflow-uuid',
  '{QUARTER} {YEAR}',
  'user-uuid',
  true,  -- copy progress
  true   -- start immediately
);
-- Returns: {"workflow_id": "...", "asset_count": 15, "workflow_name": "Due Diligence - Q4 2025"}
```

#### Integration with Automation

The universe evaluation integrates with the workflow automation system:

1. **Manual Kickoff**: When a user manually starts a workflow, they can choose to apply it to the entire universe
2. **Automated Kickoff**: When an automation rule triggers workflow creation, it can automatically apply to the universe
3. **Scheduled Kickoff**: Time-based triggers can evaluate the universe at kickoff time

### Migrations

The Universe system is implemented across three migrations:

1. **20251023000003_add_workflow_universe.sql**
   - Creates `workflow_universe_rules` table
   - Defines rule types and configurations
   - Sets up RLS policies

2. **20251023000004_add_universe_evaluator.sql**
   - `evaluate_workflow_universe()` - Evaluates rules and returns asset IDs
   - `apply_workflow_to_universe()` - Applies workflow to matching assets

3. **20251023000005_add_copy_and_kickoff_helper.sql**
   - `copy_and_kickoff_workflow()` - Helper that combines copy + universe application

To apply:
```bash
# Apply migrations to your Supabase project
supabase db push
```

## Future Enhancements

Potential additions:
- Custom date formats
- Week numbers
- Fiscal year support
- User-defined placeholders
- Template library
