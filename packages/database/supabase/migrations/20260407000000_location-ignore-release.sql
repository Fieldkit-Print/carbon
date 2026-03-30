-- Add ignoreRelease flag to location table
-- Locations with this flag show operations in MES when job is Planned (before Release)

ALTER TABLE "location" ADD COLUMN "ignoreRelease" BOOLEAN NOT NULL DEFAULT false;

-- Update get_active_job_operations_by_location to include Planned jobs
-- at ignoreRelease locations
DROP FUNCTION IF EXISTS get_active_job_operations_by_location;
CREATE OR REPLACE FUNCTION get_active_job_operations_by_location(
  location_id TEXT,
  work_center_ids TEXT[]
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "jobMakeMethodId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "priority" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "customerName" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityScrapped" NUMERIC,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "salesOrderReadableId" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "thumbnailPath" TEXT,
  "operationDueDate" DATE
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  WITH relevant_jobs AS (
    -- Existing: Released jobs at this location
    SELECT *
    FROM "job"
    WHERE "locationId" = location_id
    AND ("status" = 'Ready' OR "status" = 'In Progress' OR "status" = 'Paused')
  ),
  prerelease_jobs AS (
    -- NEW: Planned jobs that have operations with work centers at this ignoreRelease location
    SELECT DISTINCT j.*
    FROM "job" j
    JOIN "jobOperation" jo ON j.id = jo."jobId"
    JOIN "workCenter" wc ON jo."workCenterId" = wc.id
    JOIN "location" l ON wc."locationId" = l.id
    WHERE j."status" = 'Planned'
    AND l."ignoreRelease" = true
    AND l.id = location_id
  ),
  all_relevant_jobs AS (
    SELECT * FROM relevant_jobs
    UNION
    SELECT * FROM prerelease_jobs
  )
  SELECT
    jo."id",
    jo."jobId",
    jo."jobMakeMethodId",
    jo."order" AS "operationOrder",
    jo."priority",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    arj."jobId" AS "jobReadableId",
    arj."status" AS "jobStatus",
    arj."dueDate" AS "jobDueDate",
    arj."deadlineType" AS "jobDeadlineType",
    arj."customerId" AS "jobCustomerId",
    c."name" AS "customerName",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN arj."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    arj."salesOrderId",
    arj."salesOrderLineId",
    so."salesOrderId" as "salesOrderReadableId",
    jo."assignee",
    jo."tags",
    COALESCE(mu."thumbnailPath", i."thumbnailPath") as "thumbnailPath",
    jo."dueDate" AS "operationDueDate"
  FROM "jobOperation" jo
  JOIN all_relevant_jobs arj ON arj.id = jo."jobId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "customer" c ON arj."customerId" = c.id
  LEFT JOIN "salesOrder" so ON arj."salesOrderId" = so.id
  LEFT JOIN "modelUpload" mu ON i."modelUploadId" = mu.id
  WHERE CASE
    WHEN array_length(work_center_ids, 1) > 0 THEN
      jo."workCenterId" = ANY(work_center_ids) AND jo."status" != 'Done' AND jo."status" != 'Canceled'
    ELSE
      jo."status" != 'Done' AND jo."status" != 'Canceled'
  END
  -- For prerelease (Planned) jobs, only show operations whose work center is at this location
  AND (
    arj."status" != 'Planned'
    OR jo."workCenterId" IN (
      SELECT wc2.id FROM "workCenter" wc2 WHERE wc2."locationId" = location_id
    )
  )
  ORDER BY jo."startDate", jo."priority";

END;
$$ LANGUAGE plpgsql;


-- Update get_assigned_job_operations to include Planned jobs at ignoreRelease locations
DROP FUNCTION IF EXISTS get_assigned_job_operations;
CREATE OR REPLACE FUNCTION get_assigned_job_operations(
  user_id TEXT,
  company_id TEXT
)
RETURNS TABLE (
  "id" TEXT,
  "jobId" TEXT,
  "operationOrder" DOUBLE PRECISION,
  "processId" TEXT,
  "workCenterId" TEXT,
  "description" TEXT,
  "setupTime" NUMERIC,
  "setupUnit" factor,
  "laborTime" NUMERIC,
  "laborUnit" factor,
  "machineTime" NUMERIC,
  "machineUnit" factor,
  "operationOrderType" "methodOperationOrder",
  "jobReadableId" TEXT,
  "jobStatus" "jobStatus",
  "jobDueDate" DATE,
  "jobDeadlineType" "deadlineType",
  "jobCustomerId" TEXT,
  "salesOrderReadableId" TEXT,
  "salesOrderId" TEXT,
  "salesOrderLineId" TEXT,
  "parentMaterialId" TEXT,
  "itemReadableId" TEXT,
  "itemDescription" TEXT,
  "operationStatus" "jobOperationStatus",
  "targetQuantity" NUMERIC,
  "operationQuantity" NUMERIC,
  "quantityComplete" NUMERIC,
  "quantityScrapped" NUMERIC,
  "thumbnailPath" TEXT,
  "assignee" TEXT,
  "tags" TEXT[],
  "operationDueDate" DATE
)
SECURITY INVOKER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    jo."id",
    jo."jobId",
    jo."order" AS "operationOrder",
    jo."processId",
    jo."workCenterId",
    jo."description",
    jo."setupTime",
    jo."setupUnit",
    jo."laborTime",
    jo."laborUnit",
    jo."machineTime",
    jo."machineUnit",
    jo."operationOrder" AS "operationOrderType",
    j."jobId" AS "jobReadableId",
    j."status" AS "jobStatus",
    j."dueDate" AS "jobDueDate",
    j."deadlineType" AS "jobDeadlineType",
    j."customerId" AS "jobCustomerId",
    so."salesOrderId" AS "salesOrderReadableId",
    so."id" AS "salesOrderId",
    j."salesOrderLineId",
    jmm."parentMaterialId",
    i."readableId" as "itemReadableId",
    i."name" as "itemDescription",
    CASE
      WHEN j."status" = 'Paused' THEN 'Paused'
      ELSE jo."status"
    END AS "operationStatus",
    jo."targetQuantity"::NUMERIC,
    jo."operationQuantity",
    jo."quantityComplete",
    jo."quantityScrapped",
    CASE
      WHEN jmm."parentMaterialId" IS NULL THEN COALESCE(i."thumbnailPath", j_mu."thumbnailPath", i_mu."thumbnailPath")
      ELSE COALESCE(i."thumbnailPath", i_mu."thumbnailPath")
    END as "thumbnailPath",
    jo."assignee",
    jo."tags",
    jo."dueDate" AS "operationDueDate"
  FROM "jobOperation" jo
  JOIN "job" j ON j.id = jo."jobId"
  LEFT JOIN "salesOrderLine" sol ON sol."id" = j."salesOrderLineId"
  LEFT JOIN "salesOrder" so ON so."id" = sol."salesOrderId"
  LEFT JOIN "jobMakeMethod" jmm ON jo."jobMakeMethodId" = jmm.id
  LEFT JOIN "item" i ON jmm."itemId" = i.id
  LEFT JOIN "modelUpload" j_mu ON j_mu.id = j."modelUploadId"
  LEFT JOIN "modelUpload" i_mu ON i_mu.id = i."modelUploadId"
  WHERE jo."assignee" = user_id
  AND jo."status" IN ('Todo', 'Ready', 'Waiting', 'In Progress', 'Paused')
  AND (
    j."status" IN ('Ready', 'In Progress', 'Paused')
    OR (
      j."status" = 'Planned'
      AND EXISTS (
        SELECT 1 FROM "workCenter" wc
        JOIN "location" l ON wc."locationId" = l.id
        WHERE wc.id = jo."workCenterId"
        AND l."ignoreRelease" = true
      )
    )
  )
  AND j."companyId" = company_id
  ORDER BY jo."priority";
END;
$$ LANGUAGE plpgsql;
