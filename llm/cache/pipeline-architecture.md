# PDF Toolbox Pipeline Architecture

## Overview

The sub-production file generation system runs pdfToolbox `.kfpx` process plans sequentially across job operations, threading output files through a pipeline. Each process plan receives three files and a rich context JSON that enables intelligent decision-making based on downstream machines, job metadata, and operation parameters.

## Three-File Input Model

Every `.kfpx` process plan receives three files in its working directory:

| File | Description |
|------|-------------|
| `input.pdf` | Previous operation's output (or master if first in pipeline) |
| `master.pdf` | Original artwork file (always the item's master, never changes during pipeline) |
| `context.json` | Routing context with job metadata, operation parameters, MES scan URLs, and pipeline position |

The `.kfpx` flow runs on `input.pdf` by default. It can reference `master.pdf` via a pdfToolbox "Add File" action. It can read `context.json` for conditional logic.

## context.json Schema

```json
{
  "job": {
    "id": "uuid",
    "jobId": "J-001234",
    "quantity": 500,
    "customerName": "Acme Corp",
    "dueDate": "2026-04-20",
    "deadlineType": "Hard Deadline",
    "salesOrderId": "so_uuid",
    "tags": ["rush", "outdoor"],
    "url": "https://erp.fieldkit.cc/x/job/{id}"
  },
  "currentOperation": {
    "id": "op_uuid",
    "process": "Sticker Printing",
    "workCenter": "Roland VG3-640",
    "order": 1,
    "parameters": {
      "bleed": "3mm",
      "colorProfile": "CMYK-Roland"
    },
    "scan": {
      "start": "https://mes.fieldkit.cc/share/scan/start/{operationId}",
      "end": "https://mes.fieldkit.cc/share/scan/end/{operationId}"
    }
  },
  "downstream": [
    {
      "id": "op_uuid",
      "process": "Contour Cutting",
      "workCenter": "Graphtec CE7000",
      "order": 2,
      "parameters": { "cutSpeed": "30" },
      "scan": {
        "start": "https://mes.fieldkit.cc/share/scan/start/{operationId}",
        "end": "https://mes.fieldkit.cc/share/scan/end/{operationId}"
      }
    }
  ],
  "upstream": [
    {
      "id": "op_uuid",
      "process": "Normalization",
      "workCenter": null,
      "order": 0,
      "parameters": {}
    }
  ],
  "materials": [
    { "name": "3M IJ180Cv3 White Gloss Vinyl", "itemId": null }
  ]
}
```

### Field Reference

**`job`** — Job-level metadata:
- `id` / `jobId`: Internal UUID and human-readable job number
- `quantity`: Production quantity
- `customerName`: Customer name from linked customer record
- `dueDate`: Job due date (ISO date string)
- `deadlineType`: One of `"ASAP"`, `"Hard Deadline"`, `"Soft Deadline"`, `"No Deadline"`
- `salesOrderId`: Linked sales order UUID (nullable)
- `tags`: Array of job tags (e.g., `"rush"`, `"outdoor"`, `"sample"`)
- `url`: Direct link to the job in the ERP UI

**`currentOperation`** — The operation being processed:
- `process` / `workCenter`: Process name and assigned machine name
- `order`: Sequence position in the job method
- `parameters`: Key-value pairs from `jobOperationParameter` table (see below)
- `scan.start` / `scan.end`: MES time-tracking URLs, embeddable as QR codes on print output

**`downstream`** — Operations after the current one (same shape as currentOperation). Useful for:
- Branching prep logic based on the cutting machine downstream
- Adding cut marks only when a cutting step follows
- Including downstream scan QR codes on the current output

**`upstream`** — Operations before the current one (no scan URLs since they're already complete).

**`materials`** — Job materials (BOM items) for substrate-aware decisions.

### Operation Parameters

Parameters are key-value pairs stored in the `jobOperationParameter` table, set per operation on the job method. They flow into `context.json` as a flat `{ key: value }` object on each operation.

Use cases:
- Encode process-specific settings (bleed, color profile, cut speed, cut force)
- Pass custom instructions to the `.kfpx` flow without modifying the process plan
- Override defaults per job (e.g., different bleed for a specific customer)

Parameters are available on `currentOperation`, all `downstream` operations, and all `upstream` operations.

### Embeddable QR Codes / URLs

The context provides several URLs that `.kfpx` flows can embed as QR codes on output:
- **`currentOperation.scan.start`**: Operator scans to clock into this operation
- **`currentOperation.scan.end`**: Operator scans to mark operation complete
- **`downstream[].scan.start`**: Pre-printed QR for the next operation's clock-in
- **`job.url`**: Link to the full job in the ERP for quick lookup

## Pipeline Execution

### Two-Phase Model

Pipeline execution is split into two phases controlled by `process.runOnCreate`:

| Phase | When | Processes |
|-------|------|-----------|
| `create` | Job creation (even Draft) | `runOnCreate = true` (e.g., proof generation) |
| `release` | Job transitions to "Ready" | `runOnCreate = false` (default, e.g., print/cut prep) |

### Output Threading

Operations execute sequentially by `order`. The output of operation N becomes the input of operation N+1:

```
Master PDF
    |
    v
[Op 1: Normalization] --output--> [Op 2: Print Prep] --output--> [Op 3: Cut Prep]
                                        |
                                   master.pdf always
                                   available too
```

**"With Previous" operations**: Receive the same input as the last "After Previous" operation. Their output does NOT feed downstream.

### Output Destinations

Each process has an `outputDestination` that controls where its output goes:

| Destination | Behavior |
|-------------|----------|
| `operation` | Links output to the `jobOperation.modelUploadId` (default) |
| `proof` | Creates a `proofApproval` record, sets job to "Awaiting Proof Approval", auto-sends email to customer contacts |
| `master` | Updates `item.modelUploadId` (permanent normalization). Original preserved in `item.customerModelUploadId` |

### Hot Folder Routing

Each `workCenterProcess` junction (process + machine pairing) can have a `hotFolderPath`. When set, the pipeline output is copied to an S3 bucket at that path for NAS sync to the shop floor.

### Customer File Preservation

- `item.customerModelUploadId`: Set on first upload, never changed. The original customer artwork.
- `item.modelUploadId`: The production master. Updated when a process with `outputDestination = 'master'` runs.

## Database Schema

### Process Table Additions
- `runOnCreate` (BOOLEAN, default false) — run at job creation vs release
- `outputDestination` (ENUM: operation, proof, master) — where output goes

### WorkCenterProcess Table Addition
- `hotFolderPath` (TEXT, nullable) — S3 path prefix for hot folder routing

### Item Table Addition
- `customerModelUploadId` (TEXT, FK to modelUpload) — immutable original artwork

### jobOperationParameter Table
- `key` (TEXT) — parameter name
- `value` (TEXT) — parameter value
- `operationId` (TEXT, FK to jobOperation)

## Key Files

| File | Purpose |
|------|---------|
| `packages/jobs/trigger/generate-sub-production-files.ts` | Pipeline orchestration engine |
| `packages/jobs/trigger/pdf-toolbox/executor.ts` | pdfToolbox CLI wrapper, sends three files |
| `packages/jobs/trigger/pdf-toolbox/fixup.ts` | Schema task accepting masterPath + context |
| `packages/jobs/trigger/hot-folder.ts` | S3 hot folder copy utility |
| `services/pdftoolbox/server.js` | Fastify service accepting multipart (input + master + context) |
| `packages/database/supabase/migrations/20260417000000_pipeline-architecture.sql` | Schema migration |
| `apps/erp/app/routes/x+/job+/new.tsx` | Phase 1 trigger on job creation |
| `apps/erp/app/routes/x+/job+/$jobId.status.tsx` | Phase 2 trigger on job release |

## Proof Auto-Emailing

When `outputDestination = 'proof'`, the pipeline automatically:
1. Creates a `proofApproval` record (supersedes any pending proofs)
2. Creates/finds an `externalLink` for the proof portal
3. Sets job status to "Awaiting Proof Approval"
4. Sends email to customer contacts (SO contact + customer sales contact) via Resend
5. Email contains a link to `/share/proof/{externalLinkId}` for approval/rejection
