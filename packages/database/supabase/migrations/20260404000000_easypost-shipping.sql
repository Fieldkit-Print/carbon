-- EasyPost shipping integration: parcel table and shipment/shippingMethod columns

-- Add EasyPost columns to shipment
ALTER TABLE "shipment"
  ADD COLUMN "easypostShipmentId" TEXT,
  ADD COLUMN "easypostTrackerId" TEXT,
  ADD COLUMN "labelUrl" TEXT,
  ADD COLUMN "labelFormat" TEXT,
  ADD COLUMN "trackingStatus" TEXT,
  ADD COLUMN "trackingUpdatedAt" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "estimatedDeliveryDate" TIMESTAMP WITH TIME ZONE,
  ADD COLUMN "selectedRate" JSONB;

-- Add EasyPost columns to shippingMethod
ALTER TABLE "shippingMethod"
  ADD COLUMN "easypostCarrier" TEXT,
  ADD COLUMN "easypostService" TEXT;

-- Create parcel table
CREATE TABLE "parcel" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "shipmentId" TEXT NOT NULL,
  "length" NUMERIC NOT NULL DEFAULT 0,
  "width" NUMERIC NOT NULL DEFAULT 0,
  "height" NUMERIC NOT NULL DEFAULT 0,
  "weight" NUMERIC NOT NULL DEFAULT 0,
  "predefinedPackage" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "parcel_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "parcel_shipmentId_fkey"
    FOREIGN KEY ("shipmentId") REFERENCES "shipment" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "parcel_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "parcel_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "parcel_updatedBy_fkey"
    FOREIGN KEY ("updatedBy") REFERENCES "user" ("id")
    ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "parcel_shipmentId_idx" ON "parcel" ("shipmentId");
CREATE INDEX "parcel_companyId_idx" ON "parcel" ("companyId");

ALTER TABLE "parcel" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "parcel"
  FOR SELECT USING (
    "companyId" = ANY (
      SELECT DISTINCT unnest(ARRAY(
        SELECT unnest(get_companies_with_employee_permission('inventory_view'))
        UNION
        SELECT unnest(get_companies_with_employee_permission('sales_view'))
      ))
    )
  );

CREATE POLICY "INSERT" ON "parcel"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "parcel"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "parcel"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('inventory_delete'))::text[]
    )
  );
