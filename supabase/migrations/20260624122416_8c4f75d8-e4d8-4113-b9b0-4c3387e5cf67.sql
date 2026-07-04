
-- Sequences for human-readable codes
CREATE SEQUENCE IF NOT EXISTS patient_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS receipt_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS lab_code_seq START 1;
CREATE SEQUENCE IF NOT EXISTS rx_code_seq START 1;

CREATE OR REPLACE FUNCTION public.fmt_code(prefix TEXT, n BIGINT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$ SELECT prefix || '-' || lpad(n::text, 3, '0') $$;

-- STAFF
CREATE TABLE public.staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE,
  email TEXT UNIQUE NOT NULL,
  staff_id TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_read_all" ON public.staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_self_update" ON public.staff FOR UPDATE TO authenticated USING (auth.uid() = user_id);

-- PATIENTS
CREATE TABLE public.patients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_code TEXT UNIQUE NOT NULL DEFAULT public.fmt_code('PAT', nextval('patient_code_seq')),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  date_of_birth DATE NOT NULL,
  gender TEXT NOT NULL,
  phone_number TEXT NOT NULL,
  insurance_number TEXT,
  visit_reason TEXT NOT NULL,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  registered_by TEXT NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.patients TO authenticated;
GRANT ALL ON public.patients TO service_role;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "patients_all_authed" ON public.patients FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- VISITS
CREATE TABLE public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'Waiting',
  visit_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT NOT NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "visits_all_authed" ON public.visits FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PAYMENTS
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_number TEXT UNIQUE NOT NULL DEFAULT public.fmt_code('RCP', nextval('receipt_code_seq')),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  insurance_provider TEXT,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'Pending',
  processed_by TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments TO authenticated;
GRANT ALL ON public.payments TO service_role;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_all_authed" ON public.payments FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- TRIAGE
CREATE TABLE public.triage_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  bp_systolic INT, bp_diastolic INT,
  temperature NUMERIC(4,1), weight NUMERIC(5,2), height NUMERIC(5,2),
  bmi NUMERIC(5,2), pulse INT, oxygen_saturation INT, blood_sugar NUMERIC(5,2),
  chief_complaint TEXT,
  priority TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.triage_records TO authenticated;
GRANT ALL ON public.triage_records TO service_role;
ALTER TABLE public.triage_records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "triage_all_authed" ON public.triage_records FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- CONSULTATIONS
CREATE TABLE public.consultations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  presenting_complaint TEXT,
  history_of_presenting_illness TEXT,
  examination_findings TEXT,
  diagnosis TEXT,
  treatment_plan TEXT,
  consulted_by TEXT NOT NULL,
  consulted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consultations TO authenticated;
GRANT ALL ON public.consultations TO service_role;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "consultations_all_authed" ON public.consultations FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- LAB REQUESTS
CREATE TABLE public.lab_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_code TEXT UNIQUE NOT NULL DEFAULT public.fmt_code('LAB', nextval('lab_code_seq')),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  consultation_id UUID REFERENCES public.consultations(id) ON DELETE SET NULL,
  test_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'Pending',
  requested_by TEXT NOT NULL,
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_requests TO authenticated;
GRANT ALL ON public.lab_requests TO service_role;
ALTER TABLE public.lab_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_req_all_authed" ON public.lab_requests FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- LAB RESULTS
CREATE TABLE public.lab_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_request_id UUID NOT NULL REFERENCES public.lab_requests(id) ON DELETE CASCADE,
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  result_details TEXT NOT NULL,
  reference_range TEXT,
  result_status TEXT NOT NULL,
  notes TEXT,
  uploaded_by TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lab_results TO authenticated;
GRANT ALL ON public.lab_results TO service_role;
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lab_res_all_authed" ON public.lab_results FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- PRESCRIPTIONS
CREATE TABLE public.prescriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rx_code TEXT UNIQUE NOT NULL DEFAULT public.fmt_code('RX', nextval('rx_code_seq')),
  patient_id UUID NOT NULL REFERENCES public.patients(id) ON DELETE CASCADE,
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  consultation_id UUID REFERENCES public.consultations(id) ON DELETE SET NULL,
  medications JSONB NOT NULL DEFAULT '[]'::jsonb,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  dispensed BOOLEAN NOT NULL DEFAULT false,
  dispensed_by TEXT,
  dispensed_at TIMESTAMPTZ,
  notes TEXT
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.prescriptions TO authenticated;
GRANT ALL ON public.prescriptions TO service_role;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rx_all_authed" ON public.prescriptions FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- INVENTORY
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  medication_name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  stock_level INT NOT NULL DEFAULT 0,
  unit TEXT NOT NULL DEFAULT 'units',
  reorder_level INT NOT NULL DEFAULT 50,
  status TEXT NOT NULL DEFAULT 'In Stock'
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory TO authenticated;
GRANT ALL ON public.inventory TO service_role;
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inventory_all_authed" ON public.inventory FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed inventory
INSERT INTO public.inventory (medication_name, category, stock_level, reorder_level, status) VALUES
('Paracetamol','Analgesic',500,50,'In Stock'),
('Amoxicillin','Antibiotic',300,50,'In Stock'),
('Metformin','Antidiabetic',200,50,'In Stock'),
('Omeprazole','Antacid',150,50,'In Stock'),
('Ibuprofen','Analgesic',400,50,'In Stock'),
('Ciprofloxacin','Antibiotic',100,50,'In Stock'),
('Atenolol','Antihypertensive',120,50,'In Stock'),
('Amlodipine','Antihypertensive',80,50,'In Stock'),
('Metronidazole','Antibiotic',250,50,'In Stock'),
('Doxycycline','Antibiotic',180,50,'In Stock'),
('Cotrimoxazole','Antibiotic',300,50,'In Stock'),
('Diclofenac','Analgesic',200,50,'In Stock'),
('Salbutamol Inhaler','Respiratory',60,50,'In Stock'),
('ORS Sachets','Rehydration',500,50,'In Stock'),
('Zinc Tablets','Supplement',400,50,'In Stock'),
('Folic Acid','Supplement',350,50,'In Stock'),
('Iron Tablets','Supplement',300,50,'In Stock'),
('Vitamin C','Supplement',500,50,'In Stock'),
('Antacid Tablets','Antacid',250,50,'In Stock'),
('Oral Contraceptives','Contraceptive',150,50,'In Stock');

-- Enable realtime on all tables
ALTER PUBLICATION supabase_realtime ADD TABLE public.patients;
ALTER PUBLICATION supabase_realtime ADD TABLE public.visits;
ALTER PUBLICATION supabase_realtime ADD TABLE public.payments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.triage_records;
ALTER PUBLICATION supabase_realtime ADD TABLE public.consultations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_requests;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lab_results;
ALTER PUBLICATION supabase_realtime ADD TABLE public.prescriptions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.inventory;
ALTER PUBLICATION supabase_realtime ADD TABLE public.staff;

ALTER TABLE public.patients REPLICA IDENTITY FULL;
ALTER TABLE public.visits REPLICA IDENTITY FULL;
ALTER TABLE public.payments REPLICA IDENTITY FULL;
ALTER TABLE public.triage_records REPLICA IDENTITY FULL;
ALTER TABLE public.consultations REPLICA IDENTITY FULL;
ALTER TABLE public.lab_requests REPLICA IDENTITY FULL;
ALTER TABLE public.lab_results REPLICA IDENTITY FULL;
ALTER TABLE public.prescriptions REPLICA IDENTITY FULL;
ALTER TABLE public.inventory REPLICA IDENTITY FULL;
