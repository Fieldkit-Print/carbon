# Templates & Decorations in Carbon ERP

## System Overview

Carbon is a manufacturing ERP system built with React Router, Supabase (Postgres), and TypeScript. The configurator system allows items (Parts, Services) to be made "configurable" so that their manufacturing methods can be dynamically customized at quoting and production time.

**Templates** and **Decorations** are two ways to apply configurable items to quote lines or jobs. They use the same underlying infrastructure but differ in how they affect the manufacturing method:

- **Template**: REPLACES the quote/job method entirely. Used when you want to start from a pre-built configurable item.
- **Decoration**: MERGES into the existing method. Used for add-on processes like printing, embroidery, coating, etc. that layer on top of an existing method.

---

## Architecture

### Key Concepts

1. **Configurable Item**: Any Part or Service with `itemReplenishment.requiresConfiguration = true`. These items have configuration parameters defined and a make method that can be dynamically modified based on parameter values.

2. **Configuration Parameters**: Input fields defined on a configurable item. Each has a `key` (variable name), `label` (display name), `dataType`, and optional validation/defaults. Parameters are organized into groups for multi-step wizard display.

3. **Configuration Rules**: JavaScript/TypeScript code snippets stored per-field on an item. When a method is applied with a configuration, these rules execute to dynamically modify method properties (e.g., filtering BOM items, changing process parameters, selecting materials).

4. **Configuration Values**: The actual user-provided values collected via the configurator wizard. Stored as JSON in `quoteLine.configuration` or `job.configuration`.

### Data Flow

```
ITEM MASTER (Configurable Item)
  |-- itemReplenishment.requiresConfiguration = true
  |-- configurationParameterGroup[] (wizard steps)
  |   \-- configurationParameter[] (inputs: text, numeric, boolean, list, material, date)
  |-- configurationRule[] (field -> JavaScript code)
  \-- makeMethod (bill of material + bill of process)

QUOTING
  |-- User clicks "Apply Template" or "Add Decoration"
  |-- Selects configurable item from list
  |-- Fills in configurator wizard (parameters by group)
  |-- System calls get-method edge function with:
  |     sourceId: configurable item ID
  |     targetId: quote line ID
  |     configuration: JSON of parameter values
  |     merge: "on" (decorations only)
  \-- Edge function applies configuration rules to transform method
      then inserts/merges into quote line method

PRODUCTION
  |-- Job created from quote (configuration inherited)
  |-- Or user manually applies template/decoration to job
  \-- Same get-method flow with job as target
```

---

## Database Schema

### Tables

**`configurationParameterGroup`** - Groups parameters into wizard steps
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | |
| itemId | TEXT FK->item | Which item this group belongs to |
| name | TEXT | Display name (e.g., "Dimensions", "Material Options") |
| sortOrder | FLOAT | Ordering within the wizard |
| isUngrouped | BOOLEAN | Auto-created group for ungrouped parameters |
| companyId | TEXT FK->company | |

**`configurationParameter`** - Individual configuration inputs
| Column | Type | Description |
|--------|------|-------------|
| id | TEXT PK | |
| itemId | TEXT FK->item | Which item this parameter belongs to |
| label | TEXT | Display label (e.g., "Thread Color") |
| key | TEXT | Variable name for code (e.g., "thread_color"). Must match `^[a-zA-Z0-9]+(_[a-zA-Z0-9]+)*$` |
| dataType | ENUM | One of: `text`, `numeric`, `boolean`, `list`, `material`, `date` |
| listOptions | TEXT[] | Required when dataType is `list` — the dropdown choices |
| materialFormFilterId | TEXT | Optional filter for `material` type parameters |
| defaultValue | TEXT | Default value |
| description | TEXT | Help text shown in wizard |
| required | BOOLEAN | Whether the field must be filled |
| configurationParameterGroupId | TEXT FK | Which group this belongs to |
| sortOrder | FLOAT | Ordering within the group |
| companyId | TEXT FK->company | |

**`configurationRule`** - Code that transforms method fields based on configuration
| Column | Type | Description |
|--------|------|-------------|
| itemId | TEXT | Composite PK with field |
| field | TEXT | The field path this rule modifies (e.g., `billOfProcess:operation_1:processId`) |
| code | TEXT | JavaScript function body. Receives hydrated configuration as parameter. |
| companyId | TEXT FK->company | |

**`itemReplenishment`** - Item manufacturing settings
| Column | Type | Description |
|--------|------|-------------|
| requiresConfiguration | BOOLEAN | When true, item appears in template/decoration item lists |

**`quoteLine.configuration`** / **`job.configuration`** - JSONB storing the collected parameter values.

### How Configuration Gets Applied

When a user selects a template/decoration and fills the configurator:

1. The `get-method` edge function (`packages/database/supabase/functions/get-method/index.ts`) is invoked
2. It fetches the source item's make method tree
3. It fetches all `configurationRule` records for the item
4. For each field in the method (operations, materials, etc.), it checks if a rule exists
5. If a rule exists, it executes the code with the hydrated configuration values
6. The rule's return value overrides the default field value
7. The transformed method is inserted into the target (quote line or job)

For **decorations** (`merge: "on"`), the method is merged into the existing method rather than replacing it.

---

## Key Files

### UI Components

| File | Purpose |
|------|---------|
| `apps/erp/app/components/Configurator/ConfiguratorForm/ConfiguratorForm.ee.tsx` | Main configurator wizard modal. Renders parameters grouped into steps. |
| `apps/erp/app/components/Configurator/ConfigurationEditor/ConfigurationEditor.ee.tsx` | Monaco code editor for writing configuration rules on items |
| `apps/erp/app/components/Configurator/types.ts` | TypeScript types for Configuration, Parameter, ConfiguratorDataType |
| `apps/erp/app/components/Configurator/utils.ts` | Code generation helpers for Monaco editor |

### Templates & Decorations in Quotes

| File | Purpose |
|------|---------|
| `apps/erp/app/modules/sales/ui/Quotes/QuoteMakeMethodTools.tsx` | Toolbar with "Apply Template" and "Add Decoration" buttons. Handles item selection, parameter fetching, configurator modal, and form submission. |
| `apps/erp/app/modules/production/ui/Jobs/JobMakeMethodTools.tsx` | Same pattern for jobs |

### Configuration Parameter Management (Item Master)

| File | Purpose |
|------|---------|
| `apps/erp/app/modules/items/ui/Parts/ConfigurationParameters.tsx` | Drag-and-drop UI for defining parameters and groups on an item |
| `apps/erp/app/modules/items/items.models.ts` | Validators: `configurationParameterValidator`, `configurationRuleValidator` |
| `apps/erp/app/modules/items/items.service.ts` | `getConfigurationParameters()`, `upsertConfigurationParameter()`, `upsertConfigurationRule()` |

### Backend (Edge Functions)

| File | Purpose |
|------|---------|
| `packages/database/supabase/functions/get-method/index.ts` | Core edge function. Applies configuration rules when copying methods to quotes/jobs. Contains `hydrateConfiguration()` for enriching material references. |
| `packages/database/supabase/functions/lib/methods.ts` | Shared method utilities, pricing engine, rate lookups |

### API

| File | Purpose |
|------|---------|
| `apps/erp/app/routes/api+/items.configurable.ts` | Returns list of item IDs that have `requiresConfiguration = true` |

---

## How to Build a Template

A template is a configurable item whose method gets applied to a quote line when selected. Here's how to build one:

### Step 1: Create the Item

Create a Part (or Service) that represents the template. For example, "Custom T-Shirt" or "Laser Cut Plate".

### Step 2: Set Up Manufacturing

1. On the item's Details page, set **Replenishment System** to "Make"
2. Check **Requires Configuration** = true
3. Build the item's **Make Method** (bill of material + bill of process) with the base/default configuration

### Step 3: Define Configuration Parameters

Navigate to the item's Configuration Parameters section:

1. **Create Parameter Groups** to organize the wizard into logical steps (e.g., "Material", "Sizing", "Print Options")
2. **Create Parameters** within each group:
   - `label`: What the user sees (e.g., "Shirt Size")
   - `key`: Variable name for rules (e.g., `shirt_size`). Use lowercase with underscores.
   - `dataType`: Choose the appropriate input type
     - `list` for dropdowns (requires `listOptions`)
     - `numeric` for quantities/measurements
     - `text` for free-form input
     - `boolean` for yes/no toggles
     - `material` for material selection (filterable by form)
     - `date` for date inputs
   - `required`: Whether the user must fill this in
   - `defaultValue`: Pre-populated value

### Step 4: Write Configuration Rules (Optional)

For dynamic behavior based on parameter values, write configuration rules. Rules are JavaScript functions that receive the configuration values and return a value for a specific method field.

Example rule for a BOM material quantity:
```javascript
export function configure(config) {
  // config.shirt_size is the selected size
  const sizeMultipliers = {
    "S": 1.0,
    "M": 1.2,
    "L": 1.4,
    "XL": 1.6,
    "XXL": 1.8
  };
  return sizeMultipliers[config.shirt_size] ?? 1.0;
}
```

Rules can control:
- Which operations are included in the BOP
- Material quantities in the BOM
- Process parameters (setup time, labor time, etc.)
- Work center selection

### Step 5: Test

1. Create a quote with a line item
2. Click **Apply Template** in the method toolbar
3. Select your configurable item
4. Fill in the wizard
5. Verify the resulting method has the correct materials, operations, and parameters

---

## How to Build a Decoration

A decoration is identical to a template in setup, but it's applied differently:

1. Build the configurable item the same way (Steps 1-4 above)
2. The decoration's method should only contain the add-on processes (e.g., screen printing operations, embroidery materials)
3. When the user clicks **Add Decoration** instead of **Apply Template**, the system sends `merge: "on"` to the get-method function
4. The decoration's method is MERGED into the existing method rather than replacing it

### Example: Screen Print Decoration

- **Item**: "Screen Print Decoration"
- **Parameters**:
  - `print_locations` (list: "Front", "Back", "Left Sleeve", "Right Sleeve")
  - `ink_colors` (numeric: number of colors, 1-8)
  - `print_size` (list: "Small", "Medium", "Large", "Full")
- **Method**:
  - BOP: Screen print setup operation, screen print run operation
  - BOM: Ink material, screen material
- **Rules**:
  - Setup time varies by number of colors
  - Ink quantity varies by print size and number of locations

When applied to a t-shirt quote that already has a sewing method, the screen print operations are added alongside the existing sewing operations.

---

## Configuration Parameter Data Types

| Type | UI Component | Value Format | Notes |
|------|-------------|-------------|-------|
| `text` | Text input | `"string"` | Free-form text |
| `numeric` | Number input with +/- | `number` | Supports min/max/step |
| `boolean` | Toggle/checkbox | `true`/`false` | |
| `list` | Dropdown select | `"selected_option"` | Requires `listOptions` array defined on parameter |
| `material` | Material picker | `"itemId"` | Can filter by `materialFormFilterId`. Value is hydrated to full material object in rules. |
| `date` | Date picker | `"YYYY-MM-DD"` | |

### Material Type Hydration

When a parameter has `dataType: "material"`, the user selects a material item. In configuration rules, this value is automatically hydrated from a simple item ID to a rich object:

```javascript
// What the user selects: "item_abc123"
// What your rule receives:
config.fabric = {
  id: "item_abc123",
  materialFormId: "...",
  materialSubstanceId: "...",
  materialTypeId: "...",
  dimensionId: "...",
  finishId: "...",
  gradeId: "..."
}
```

This allows rules to make decisions based on material properties.

---

## Configuration Rule Patterns

### Field Naming Convention

Rules are keyed by field paths. The format is:
- `billOfProcess:{nodeLevelKey}:{fieldName}` for BOP operations
- `billOfMaterial:{nodeLevelKey}` for BOM materials

### Rule Function Signature

```javascript
// Every rule exports a configure function
export function configure(config) {
  // config is an object with all parameter keys as properties
  // Return the value for this field, or null/undefined to use default
}
```

### Common Rule Patterns

**Filtering operations based on configuration:**
```javascript
export function configure(config) {
  // Return array of operation IDs to include
  if (config.needs_embroidery) {
    return ["op_setup", "op_embroidery", "op_qc"];
  }
  return ["op_setup", "op_qc"]; // Skip embroidery
}
```

**Calculating material quantity:**
```javascript
export function configure(config) {
  const baseQty = config.width * config.height;
  const wasteFactor = 1.1; // 10% waste
  return baseQty * wasteFactor;
}
```

**Selecting a process based on configuration:**
```javascript
export function configure(config) {
  // Return process ID based on material type
  if (config.material?.materialSubstanceId === "metal_id") {
    return "laser_cut_process_id";
  }
  return "waterjet_process_id";
}
```

---

## Template vs Decoration Summary

| Aspect | Template | Decoration |
|--------|----------|------------|
| Button | "Apply Template" | "Add Decoration" |
| Effect | Replaces entire method | Merges into existing method |
| `merge` flag | Not set | `"on"` |
| Use case | Base product configuration | Add-on processes (print, embroidery, coating) |
| Can stack? | No (replaces) | Yes (multiple decorations can be added) |
| Item source | Any configurable item | Any configurable item |
| Destructive? | Yes (shows red confirm button) | No |

---

## Tips for Building Good Templates

1. **Keep parameters simple** - Use `list` type when possible to constrain choices. Free-form `text` should be rare.
2. **Group logically** - Organize parameters into 2-4 groups for a clean wizard experience. Don't put 20 parameters in one group.
3. **Use meaningful keys** - Parameter keys become variable names in rules. Use descriptive names like `thread_color` not `tc`.
4. **Default values matter** - Always set sensible defaults so the wizard can be completed quickly.
5. **Test with rules** - Use the Monaco editor's test/run feature to verify rules produce expected output before saving.
6. **Decoration methods should be additive** - Only include the operations and materials specific to the decoration, not the base product.
7. **Material parameters enable rich logic** - If your rules need to branch based on material properties, use `material` type parameters with appropriate form filters.

---

## Limitations & Notes

- **Sales Orders**: Configuration is stored on quote lines and jobs, but sales order lines do not currently have a configuration UI. Configuration carries from quote to job.
- **No decoration-specific table**: Templates and decorations are both just configurable items. The distinction is purely in how they're applied (replace vs merge).
- **Rule execution safety**: Rules run in a sandboxed environment. No network access, no timers, no imports. Keep rules pure and synchronous.
- **Configurable items are excluded from "Get Method"**: The regular "Get Method" dialog blacklists configurable items (they must be applied via the template/decoration flow instead).
