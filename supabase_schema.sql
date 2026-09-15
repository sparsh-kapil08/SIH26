-- ============================================================
-- AI-POWERED LEGAL METROLOGY COMPLIANCE & AUTHENTICITY CHECKER
-- Problem Statement ID: SIH26034
-- Department of Consumer Affairs (DoCA)
-- Ministry of Consumer Affairs, Food & Public Distribution
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Profiles Table (Enforcement Officers & Admins)
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Enforcement Officer',
  badge_number TEXT,
  role TEXT NOT NULL CHECK (role IN ('officer', 'admin')) DEFAULT 'officer',
  department TEXT DEFAULT 'Legal Metrology Enforcement Division',
  zone TEXT DEFAULT 'North Zone / Delhi NCR',
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Trigger to auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, badge_number, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'officer'),
    COALESCE(NEW.raw_user_meta_data->>'badge_number', 'LM-' || UPPER(SUBSTRING(NEW.id::text, 1, 6))),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Legal Metrology Enforcement Division')
  )
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name,
    role = EXCLUDED.role;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Scans Table (Inspection Dossiers)
CREATE TABLE IF NOT EXISTS public.scans (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  officer_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  
  -- Barcode & Authenticity Information
  barcode TEXT,
  barcode_type TEXT,
  barcode_valid BOOLEAN DEFAULT FALSE,
  barcode_registered BOOLEAN DEFAULT FALSE,
  db_product_name TEXT,
  db_manufacturer TEXT,
  db_mrp TEXT,
  db_source TEXT,
  db_raw_response JSONB,
  
  -- Extracted Label Declarations (AI Vision)
  extracted_product_name TEXT,
  extracted_mrp TEXT,
  extracted_manufacturer TEXT,
  extracted_address TEXT,
  extracted_mfg_date TEXT,
  extracted_net_qty TEXT,
  extracted_consumer_care TEXT,
  extracted_country_origin TEXT,
  extracted_importer TEXT,
  extracted_language TEXT DEFAULT 'English',
  gemini_confidence FLOAT DEFAULT 0.0,
  
  -- Visual Evidence & Calibration
  image_url TEXT,
  image_base64 TEXT,
  calibration_ratio FLOAT, -- px per mm
  pdp_area_sqcm FLOAT,     -- calculated Principal Display Panel area
  
  -- Legal Metrology Compliance Verdict
  overall_status TEXT CHECK (overall_status IN ('compliant', 'non_compliant', 'warning', 'pending')) DEFAULT 'pending',
  compliance_score INT DEFAULT 0,
  violation_count INT DEFAULT 0,
  warning_count INT DEFAULT 0,
  
  -- Authenticity Verdict (Barcode vs Label)
  authenticity_status TEXT CHECK (authenticity_status IN ('verified', 'mismatch', 'unverified', 'na')) DEFAULT 'na',
  authenticity_notes TEXT,
  
  -- Field Inspection Metadata
  location TEXT DEFAULT 'Market Inspection, New Delhi',
  store_name TEXT,
  store_address TEXT,
  notes TEXT,
  is_imported BOOLEAN DEFAULT FALSE,
  raw_gemini_response JSONB,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Declarations Table (Rule 6 Detailed Breakdown)
CREATE TABLE IF NOT EXISTS public.declarations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID REFERENCES public.scans(id) ON DELETE CASCADE NOT NULL,
  declaration_type TEXT NOT NULL,
  label TEXT NOT NULL,
  rule_reference TEXT NOT NULL,
  value_extracted TEXT,
  confidence FLOAT DEFAULT 0.0,
  present BOOLEAN DEFAULT FALSE,
  compliant BOOLEAN DEFAULT FALSE,
  bounding_box JSONB, -- {x, y, w, h}
  measured_font_size_mm FLOAT,
  min_required_font_size_mm FLOAT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Violations Table (Legal Violations & Statutory Sections)
CREATE TABLE IF NOT EXISTS public.violations (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID REFERENCES public.scans(id) ON DELETE CASCADE NOT NULL,
  rule_reference TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  severity TEXT CHECK (severity IN ('critical', 'warning', 'info')) NOT NULL DEFAULT 'critical',
  declaration_type TEXT,
  penalty_section TEXT DEFAULT 'Section 36(1) of Legal Metrology Act, 2009',
  suggestion TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Reports Table (Official Inspection Dossier)
CREATE TABLE IF NOT EXISTS public.reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  scan_id UUID REFERENCES public.scans(id) ON DELETE CASCADE NOT NULL,
  report_number TEXT UNIQUE NOT NULL,
  generated_by UUID REFERENCES public.profiles(id),
  summary TEXT,
  report_data JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Storage bucket for label scan images
INSERT INTO storage.buckets (id, name, public)
VALUES ('scan-images', 'scan-images', true)
ON CONFLICT (id) DO NOTHING;

-- Enable Row Level Security (RLS)
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Permissive demo access policies
DROP POLICY IF EXISTS "Public access for profiles" ON public.profiles;
CREATE POLICY "Public access for profiles" ON public.profiles FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for scans" ON public.scans;
CREATE POLICY "Public access for scans" ON public.scans FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for declarations" ON public.declarations;
CREATE POLICY "Public access for declarations" ON public.declarations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for violations" ON public.violations;
CREATE POLICY "Public access for violations" ON public.violations FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public access for reports" ON public.reports;
CREATE POLICY "Public access for reports" ON public.reports FOR ALL USING (true) WITH CHECK (true);

-- ============================================================
-- 6. Compliance Rules Table (Admin-Managed Statutory Rules)
--    Used by the Admin Rules Management CRUD portal.
--    The compliance engine reads active rules from here at runtime.
-- ============================================================
CREATE TABLE IF NOT EXISTS public.compliance_rules (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,

  -- Rule identity
  rule_reference TEXT NOT NULL UNIQUE,   -- e.g. "Rule 6(1)(a)"
  name TEXT NOT NULL,                    -- Short display name
  description TEXT,                      -- Full statutory text / description
  category TEXT NOT NULL CHECK (category IN ('mandatory_declaration', 'format_rule'))
             DEFAULT 'mandatory_declaration',

  -- Compliance engine configuration
  severity TEXT NOT NULL CHECK (severity IN ('critical', 'warning', 'info')) DEFAULT 'critical',
  score_deduction INT NOT NULL DEFAULT 10 CHECK (score_deduction BETWEEN 0 AND 30),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Statutory details
  penalty_section TEXT DEFAULT 'Section 36(1) of Legal Metrology Act, 2009',
  statutory_act   TEXT DEFAULT 'Legal Metrology (Packaged Commodities) Rules, 2011',
  suggestion      TEXT,     -- Remedial action text shown in the violation card

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for fast active-rule queries used by the compliance engine
CREATE INDEX IF NOT EXISTS idx_compliance_rules_active ON public.compliance_rules (is_active, category);

ALTER TABLE public.compliance_rules ENABLE ROW LEVEL SECURITY;

-- Officers: read-only (to load rules during a scan)
DROP POLICY IF EXISTS "Officers read compliance rules" ON public.compliance_rules;
CREATE POLICY "Officers read compliance rules" ON public.compliance_rules
  FOR SELECT USING (true);

-- Admins: full CRUD
DROP POLICY IF EXISTS "Admins manage compliance rules" ON public.compliance_rules;
CREATE POLICY "Admins manage compliance rules" ON public.compliance_rules
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ============================================================
-- 7. Compliance Settings Table (Key-Value Store)
--    Stores JSON arrays/objects for configurable compliance data:
--      - key = 'prohibited_quantity_words'  → TEXT[]
--      - key = 'second_schedule_pack_sizes' → JSONB object {category: [sizes]}
-- ============================================================
CREATE TABLE IF NOT EXISTS public.compliance_settings (
  key TEXT PRIMARY KEY,         -- Unique setting key
  value JSONB NOT NULL,         -- JSON value (array or object)
  description TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.compliance_settings ENABLE ROW LEVEL SECURITY;

-- Officers: read-only (to load settings during a scan)
DROP POLICY IF EXISTS "Officers read compliance settings" ON public.compliance_settings;
CREATE POLICY "Officers read compliance settings" ON public.compliance_settings
  FOR SELECT USING (true);

-- Admins: full CRUD
DROP POLICY IF EXISTS "Admins manage compliance settings" ON public.compliance_settings;
CREATE POLICY "Admins manage compliance settings" ON public.compliance_settings
  FOR ALL USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ── Seed Default Prohibited Words (Rule 12) ───────────────────
INSERT INTO public.compliance_settings (key, value, description) VALUES (
  'prohibited_quantity_words',
  '["minimum", "not less than", "average", "about", "approximately", "approx", "approx."]'::JSONB,
  'Rule 12: Vague or exaggerating quantity words prohibited on packaged commodity labels.'
) ON CONFLICT (key) DO NOTHING;

-- ── Seed Default Second Schedule Pack Sizes (Rule 5) ─────────
INSERT INTO public.compliance_settings (key, value, description) VALUES (
  'second_schedule_pack_sizes',
  '{
    "Biscuits":      [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 700, 800, 900, 1000],
    "Bread":         [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    "Tea":           [25, 50, 75, 100, 125, 150, 200, 250, 500, 1000],
    "Coffee":        [25, 50, 75, 100, 150, 200, 250, 500, 1000],
    "Toilet soap":   [25, 50, 75, 100, 125, 150, 200, 250, 300, 350, 400, 450, 500],
    "Laundry soap":  [50, 75, 100, 150, 200, 250, 300, 350, 400, 450, 500]
  }'::JSONB,
  'Rule 5 & Second Schedule: Standardised pack size lists for notified commodity categories.'
) ON CONFLICT (key) DO NOTHING;

