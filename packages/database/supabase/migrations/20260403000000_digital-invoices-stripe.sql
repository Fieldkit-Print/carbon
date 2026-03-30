-- Digital Invoices with Stripe Payment + Cards on File
-- Enables customers to view and pay invoices online via shareable links,
-- and allows saving credit cards for future charges.

-- 1. Add new document types to externalLinkDocumentType
ALTER TYPE "externalLinkDocumentType" ADD VALUE IF NOT EXISTS 'SalesInvoice';
ALTER TYPE "externalLinkDocumentType" ADD VALUE IF NOT EXISTS 'PaymentMethod';

-- 2. Add externalLinkId to salesInvoice (same pattern as quote.externalLinkId)
ALTER TABLE "salesInvoice"
  ADD COLUMN "externalLinkId" uuid REFERENCES "externalLink"("id") ON DELETE SET NULL;

-- 3. Create customerStripeAccount table
-- Maps ERP customers to Stripe Customer IDs (for the shop's own Stripe account,
-- NOT the platform subscription Stripe account)
CREATE TABLE "customerStripeAccount" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "customerId" TEXT NOT NULL,
  "stripeCustomerId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  "createdBy" TEXT NOT NULL,
  "updatedAt" TIMESTAMP WITH TIME ZONE,

  CONSTRAINT "customerStripeAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customerStripeAccount_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "customer"("id") ON DELETE CASCADE,
  CONSTRAINT "customerStripeAccount_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE,
  CONSTRAINT "customerStripeAccount_createdBy_fkey"
    FOREIGN KEY ("createdBy") REFERENCES "user"("id"),
  CONSTRAINT "customerStripeAccount_unique" UNIQUE ("customerId", "companyId")
);

CREATE INDEX "customerStripeAccount_customerId_idx"
  ON "customerStripeAccount"("customerId");
CREATE INDEX "customerStripeAccount_companyId_idx"
  ON "customerStripeAccount"("companyId");

ALTER TABLE "customerStripeAccount" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "customerStripeAccount"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  );

CREATE POLICY "INSERT" ON "customerStripeAccount"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('sales_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "customerStripeAccount"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('sales_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "customerStripeAccount"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('sales_delete'))::text[]
    )
  );

-- 4. Create invoicePayment table to track Stripe payments against invoices
CREATE TABLE "invoicePayment" (
  "id" TEXT NOT NULL DEFAULT xid(),
  "invoiceId" TEXT NOT NULL,
  "stripePaymentIntentId" TEXT,
  "stripeCheckoutSessionId" TEXT,
  "amount" NUMERIC NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "paidAt" TIMESTAMP WITH TIME ZONE,
  "paidByEmail" TEXT,
  "companyId" TEXT NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),

  CONSTRAINT "invoicePayment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoicePayment_invoiceId_fkey"
    FOREIGN KEY ("invoiceId") REFERENCES "salesInvoice"("id") ON DELETE CASCADE,
  CONSTRAINT "invoicePayment_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "company"("id") ON DELETE CASCADE
);

CREATE INDEX "invoicePayment_invoiceId_idx"
  ON "invoicePayment"("invoiceId");
CREATE INDEX "invoicePayment_companyId_idx"
  ON "invoicePayment"("companyId");

ALTER TABLE "invoicePayment" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "SELECT" ON "invoicePayment"
  FOR SELECT USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_role())::text[]
    )
  );

CREATE POLICY "INSERT" ON "invoicePayment"
  FOR INSERT WITH CHECK (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_create'))::text[]
    )
  );

CREATE POLICY "UPDATE" ON "invoicePayment"
  FOR UPDATE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_update'))::text[]
    )
  );

CREATE POLICY "DELETE" ON "invoicePayment"
  FOR DELETE USING (
    "companyId" = ANY (
      (SELECT get_companies_with_employee_permission('invoicing_delete'))::text[]
    )
  );
