-- Clients & Quotes: schools as a kind of client (education pricing).
ALTER TABLE sales_clients DROP CONSTRAINT IF EXISTS sales_clients_kind_check;
ALTER TABLE sales_clients ADD CONSTRAINT sales_clients_kind_check CHECK (kind IN ('ps', 'biz', 'gov', 'edu'));
