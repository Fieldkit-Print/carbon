ALTER TABLE "companySettings"
ADD COLUMN "defaultCustomerItemGroupId" TEXT REFERENCES "itemPostingGroup"("id");
