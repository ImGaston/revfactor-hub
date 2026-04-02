-- Assembly CRM integration: store client and company IDs for API mapping
ALTER TABLE clients ADD COLUMN assembly_client_id TEXT;
ALTER TABLE clients ADD COLUMN assembly_company_id TEXT;

CREATE INDEX idx_clients_assembly_client_id ON clients(assembly_client_id);
