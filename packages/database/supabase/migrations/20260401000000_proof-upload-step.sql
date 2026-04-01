-- Add ProofUpload to the procedure step type enum
ALTER TYPE "procedureStepType" ADD VALUE 'ProofUpload';

-- Allow employees with production_update to upload to models storage path
CREATE POLICY "Employees with production_update can upload models"
ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'private'
  AND (storage.foldername(name))[2] = 'models'
  AND has_role('employee', (storage.foldername(name))[1])
  AND has_company_permission('production_update', (storage.foldername(name))[1])
);

-- Allow employees with production_update to insert modelUpload records
CREATE POLICY "Employees with production_update can create model uploads"
ON "modelUpload" FOR INSERT WITH CHECK (
  has_role('employee', "companyId")
  AND has_company_permission('production_update', "companyId")
);
