-- Customer carrier accounts: store customer-owned shipping accounts (e.g. "ship on our UPS account")

CREATE TABLE "customerCarrierAccount" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "customerId" TEXT NOT NULL,
  "carrier" "shippingCarrier" NOT NULL DEFAULT 'Other',
  "accountNumber" TEXT NOT NULL,
  "description" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,
  "updatedBy" TEXT,

  CONSTRAINT "customerCarrierAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customerCarrierAccount_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE,
  CONSTRAINT "customerCarrierAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

ALTER TABLE "customerCarrierAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees with sales_view can view customer carrier accounts" ON "customerCarrierAccount"
  FOR SELECT
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_view', "companyId")
  );

CREATE POLICY "Employees with sales_create can create customer carrier accounts" ON "customerCarrierAccount"
  FOR INSERT
  WITH CHECK (
    has_role('employee', "companyId") AND
    has_company_permission('sales_create', "companyId")
  );

CREATE POLICY "Employees with sales_update can update customer carrier accounts" ON "customerCarrierAccount"
  FOR UPDATE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_update', "companyId")
  );

CREATE POLICY "Employees with sales_delete can delete customer carrier accounts" ON "customerCarrierAccount"
  FOR DELETE
  USING (
    has_role('employee', "companyId") AND
    has_company_permission('sales_delete', "companyId")
  );

-- Add carrier account reference to sales order shipment and shipment
ALTER TABLE "salesOrderShipment"
  ADD COLUMN "customerCarrierAccountId" TEXT,
  ADD CONSTRAINT "salesOrderShipment_customerCarrierAccountId_fkey"
    FOREIGN KEY ("customerCarrierAccountId") REFERENCES "customerCarrierAccount"("id") ON DELETE SET NULL;

ALTER TABLE "shipment"
  ADD COLUMN "customerCarrierAccountId" TEXT,
  ADD CONSTRAINT "shipment_customerCarrierAccountId_fkey"
    FOREIGN KEY ("customerCarrierAccountId") REFERENCES "customerCarrierAccount"("id") ON DELETE SET NULL;
