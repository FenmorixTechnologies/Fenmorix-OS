-- Expenses & Deductions (tile "books", part of the vendor module "sales"): the owner's business expenses, mileage log, vehicles,
-- home office and receipts, summed by IRS Schedule C line for the accountant. Lives only on the vendor's office install.
CREATE TABLE IF NOT EXISTS biz_vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                              -- "2022 F-150"
  details text NOT NULL DEFAULT '',                -- year/make/model, plate, VIN last 4
  in_service date,                                 -- first used for the business
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- One row per vehicle per tax year: odometer at the start/end of the year and which method the accountant uses
CREATE TABLE IF NOT EXISTS biz_vehicle_years (
  vehicle_id uuid NOT NULL REFERENCES biz_vehicles(id) ON DELETE CASCADE,
  year int NOT NULL,
  odo_start numeric(10, 1),
  odo_end numeric(10, 1),
  method text NOT NULL DEFAULT 'standard' CHECK (method IN ('standard', 'actual')),
  commute_miles numeric(10, 1) NOT NULL DEFAULT 0,
  PRIMARY KEY (vehicle_id, year)
);
CREATE TABLE IF NOT EXISTS biz_trips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES biz_vehicles(id) ON DELETE SET NULL,
  day date NOT NULL,
  purpose text NOT NULL,
  from_place text NOT NULL DEFAULT '',
  to_place text NOT NULL DEFAULT '',
  miles numeric(8, 1) NOT NULL CHECK (miles >= 0),
  round_trip boolean NOT NULL DEFAULT false,       -- miles already count both ways when true (shown as such)
  odo_start numeric(10, 1),
  odo_end numeric(10, 1),
  client_id uuid REFERENCES sales_clients(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_trips_day ON biz_trips (day DESC);
CREATE TABLE IF NOT EXISTS biz_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  day date NOT NULL,
  category text NOT NULL,                          -- key in server/books.js CATEGORIES
  vendor text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric(12, 2) NOT NULL CHECK (amount >= 0),
  business_pct numeric(5, 2) NOT NULL DEFAULT 100 CHECK (business_pct BETWEEN 0 AND 100),
  vehicle_id uuid REFERENCES biz_vehicles(id) ON DELETE SET NULL,
  client_id uuid REFERENCES sales_clients(id) ON DELETE SET NULL,
  paid_with text NOT NULL DEFAULT '',              -- "Business card", "Cash" (never a card number)
  note text NOT NULL DEFAULT '',
  recurring_id uuid,                               -- made from a monthly bill (biz_recurring)
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_expenses_day ON biz_expenses (day DESC);
CREATE TABLE IF NOT EXISTS biz_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id uuid REFERENCES biz_expenses(id) ON DELETE CASCADE,
  trip_id uuid REFERENCES biz_trips(id) ON DELETE CASCADE,
  name text NOT NULL,
  mime text NOT NULL,
  size int NOT NULL,
  data bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS biz_receipts_expense ON biz_receipts (expense_id);
-- Monthly bills (internet, phone, hosting, software): one click adds this month's expense
CREATE TABLE IF NOT EXISTS biz_recurring (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  vendor text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  business_pct numeric(5, 2) NOT NULL DEFAULT 100,
  day_of_month int NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  active boolean NOT NULL DEFAULT true
);
