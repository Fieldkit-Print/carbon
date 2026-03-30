# Return Orders Spec

## Overview

Return orders manage the lifecycle of goods coming back from customers — whether they are returnable/loaner assets, defective items, or warranty returns. A return order tracks authorization, receipt, inspection, and restocking or disposal of returned goods.

## Motivation

Currently, Carbon handles outbound asset/loaner flows via sales orders and shipments, but there is no dedicated inbound return workflow. Users work around this with Inbound Transfer receipts, which lacks proper authorization tracking, customer linkage, and inspection steps.

## Data Model

### Table: `returnOrder`

| Column | Type | Notes |
|--------|------|-------|
| id | text (nanoid) | PK |
| returnOrderId | text | Human-readable sequence ID (e.g., RO-0001) |
| status | enum | Draft, Authorized, Received, Inspecting, Complete, Cancelled |
| customerId | text | FK to customer |
| customerContactId | text | FK to customerContact, nullable |
| salesOrderId | text | FK to salesOrder, nullable — the original outbound order |
| invoiceId | text | FK to salesInvoice, nullable |
| returnType | enum | Return, Exchange, Warranty, Loaner Return |
| returnReason | text | Free text reason |
| requestedDate | date | When the customer requested the return |
| authorizedDate | date | When the return was authorized |
| receivedDate | date | When goods were physically received |
| locationId | text | FK to location — receiving warehouse |
| assignee | text | FK to user, nullable |
| notes | text | nullable |
| customFields | jsonb | nullable |
| companyId | text | FK to company |
| createdAt / updatedAt | timestamp | |
| createdBy / updatedBy | text | FK to user |

### Table: `returnOrderLine`

| Column | Type | Notes |
|--------|------|-------|
| id | text (nanoid) | PK |
| returnOrderId | text | FK to returnOrder |
| partId | text | FK to part |
| description | text | nullable — override description |
| quantityExpected | numeric | How many the customer is returning |
| quantityReceived | numeric | How many were actually received |
| unitOfMeasure | text | |
| disposition | enum | Restock, Scrap, Repair, Quarantine |
| inspectionNotes | text | nullable |
| salesOrderLineId | text | FK to salesOrderLine, nullable — traces back to original line |
| lotNumber | text | nullable — for lot-tracked items |
| serialNumber | text | nullable — for serial-tracked items |
| shelfId | text | FK to shelf, nullable — where to put restocked items |
| companyId | text | FK to company |
| createdAt / updatedAt | timestamp | |
| createdBy / updatedBy | text | FK to user |

## Status Flow

```
Draft → Authorized → Received → Inspecting → Complete
                                     ↓
                                  Cancelled (from any state except Complete)
```

- **Draft**: Return order created, not yet approved
- **Authorized**: Return approved, RMA number issued, awaiting shipment from customer
- **Received**: Goods physically received at warehouse
- **Inspecting**: Items being inspected for condition/disposition
- **Complete**: All lines dispositioned (restocked, scrapped, repaired, etc.)
- **Cancelled**: Return cancelled at any point before completion

## Line Item Disposition

Each return order line gets a disposition after inspection:

- **Restock**: Item passes inspection, goes back to available inventory
- **Scrap**: Item is damaged beyond repair, removed from inventory
- **Repair**: Item needs repair before restocking (could trigger a work order)
- **Quarantine**: Item held pending further evaluation

## Inventory Impact

- On **Received**: Inventory increases in a "Returns" or "Inspection" location (not yet available)
- On disposition **Restock**: Transfer from inspection location to the target shelf/bin
- On disposition **Scrap**: Decrease inventory, post scrap journal entry
- On disposition **Repair**: Optionally create a job/work order for the repair

## Credit/Refund Handling

- Return orders can optionally generate a **credit memo** against the original invoice
- Credit memo amount can be full or partial (e.g., restocking fee deducted)
- If linked to a sales order, the credit traces back to the original transaction

## UI Routes

- `/x/return-order` — list of all return orders (filterable by status, customer, date)
- `/x/return-order/new` — create new return order
- `/x/return-order/$returnOrderId` — return order detail (layout route)
- `/x/return-order/$returnOrderId/details` — form with return order fields
- `/x/return-order/$returnOrderId/lines` — line items with quantities and disposition
- `/x/return-order/$returnOrderId/inspection` — inspection workflow per line

## Integration Points

- **Sales Orders**: Link return to original sales order for traceability
- **Invoicing**: Generate credit memos from completed returns
- **Inventory**: Post inventory transactions on receive and disposition
- **Jobs**: Optionally create repair jobs from lines with "Repair" disposition
- **Customer Portal**: Show return order status on the external customer portal
- **Tracked Entities**: For serial/lot tracked items, update entity status on return

## Permissions

- Uses the existing `inventory` permission module (view/create/update/delete)
- Or a new `returns` permission if more granular control is needed

## Sequence

- Add to the `sequence` table: `{ table: "returnOrder", prefix: "RO-", ... }`
- Support custom ID entry via `SequenceOrCustomId` component

## Future Considerations

- Automated return authorization rules (auto-approve returns within X days)
- Customer self-service return requests via customer portal
- Return shipping label generation via EasyPost integration
- Return analytics (return rate by customer, by part, reasons breakdown)
