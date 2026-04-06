-- Add assembly_client_id to leads for linking to Assembly CRM
ALTER TABLE leads ADD COLUMN assembly_client_id TEXT DEFAULT NULL;
