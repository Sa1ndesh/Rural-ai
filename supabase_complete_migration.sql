-- ══════════════════════════════════════════════════════════════════════
-- RuralX AI – COMPLETE Database Setup (Run this ONE file)
-- Supabase Dashboard → SQL Editor → New Query → Paste & Run
-- Safe to run multiple times (all IF NOT EXISTS / IF NOT EXISTS)
-- ══════════════════════════════════════════════════════════════════════


-- ═══════════════════════════════════
-- 1. PROFILES TABLE
-- ═══════════════════════════════════

CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id    TEXT        UNIQUE NOT NULL,
    full_name     TEXT,
    email         TEXT,
    phone         TEXT,
    date_of_birth DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Add v2 columns (safe if already exist)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS age              INTEGER;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS known_conditions JSONB    DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_scan_at     TIMESTAMPTZ;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS scan_count       INTEGER  DEFAULT 0;

-- RLS
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile"  ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile"  ON public.profiles;

CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);


-- ═══════════════════════════════════
-- 2. SCANS TABLE (with ALL columns)
-- ═══════════════════════════════════

CREATE TABLE IF NOT EXISTS public.scans (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id      TEXT,
    session_id      TEXT,
    timestamp       TIMESTAMPTZ DEFAULT NOW(),
    patient_name    TEXT,
    patient_age     TEXT,
    diagnosis       TEXT,
    confidence      TEXT,
    risk_level      TEXT,
    tb_prob         TEXT,
    pneumonia_prob  TEXT,
    language        TEXT,
    report_json     JSONB,
    structured_json JSONB,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- v2 columns for full tracking + comparison
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS spo2                  TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS temperature           TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS fever_days            TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS cough_days            TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS haemoptysis           TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS bcg_status            TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS symptoms              TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS tb_prob_float         FLOAT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS pneumonia_prob_float  FLOAT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS uncertainty_pct       TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS radiological_findings JSONB;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS xray_image            TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS heatmap_image         TEXT;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS prev_scan_id          UUID;
ALTER TABLE public.scans ADD COLUMN IF NOT EXISTS health_delta          JSONB;

-- RLS
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own scans"  ON public.scans;
DROP POLICY IF EXISTS "Users can insert own scans" ON public.scans;

CREATE POLICY "Users can view own scans"
    ON public.scans FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own scans"
    ON public.scans FOR INSERT WITH CHECK (auth.uid() = user_id);


-- ═══════════════════════════════════
-- 3. AUTO-CREATE PROFILE ON SIGNUP
-- ═══════════════════════════════════

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, patient_id, full_name, email, phone, date_of_birth, age)
    VALUES (
        NEW.id,
        COALESCE(
            NEW.raw_user_meta_data->>'patient_id',
            'RX-' || EXTRACT(YEAR FROM NOW()) || '-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 6))
        ),
        NEW.raw_user_meta_data->>'full_name',
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        (NEW.raw_user_meta_data->>'date_of_birth')::DATE,
        CASE
            WHEN NEW.raw_user_meta_data->>'date_of_birth' IS NOT NULL
            THEN EXTRACT(YEAR FROM AGE(NOW(), (NEW.raw_user_meta_data->>'date_of_birth')::DATE))::INTEGER
            ELSE NULL
        END
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ═══════════════════════════════════
-- 4. AUTO-UPDATE PROFILE AFTER SCAN
-- ═══════════════════════════════════

CREATE OR REPLACE FUNCTION public.update_profile_after_scan()
RETURNS TRIGGER AS $$
DECLARE
    v_conditions JSONB;
BEGIN
    -- Get current known_conditions
    SELECT COALESCE(known_conditions, '[]'::jsonb) INTO v_conditions
    FROM public.profiles WHERE id = NEW.user_id;

    -- Add diagnosis if not already tracked and not Normal
    IF NEW.diagnosis IS NOT NULL AND NEW.diagnosis != 'Normal' THEN
        IF NOT (v_conditions @> jsonb_build_array(NEW.diagnosis)) THEN
            v_conditions := v_conditions || jsonb_build_array(NEW.diagnosis);
        END IF;
    END IF;

    -- Update profile stats
    UPDATE public.profiles
    SET
        known_conditions = v_conditions,
        last_scan_at     = COALESCE(NEW.created_at, NOW()),
        scan_count       = COALESCE(scan_count, 0) + 1
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_scan_inserted ON public.scans;
CREATE TRIGGER on_scan_inserted
    AFTER INSERT ON public.scans
    FOR EACH ROW EXECUTE FUNCTION public.update_profile_after_scan();


-- ═══════════════════════════════════
-- 5. VERIFY SETUP
-- ═══════════════════════════════════

-- Check that key columns exist
DO $$
BEGIN
    -- Verify critical v2 columns on scans
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'scans' AND column_name = 'tb_prob_float'
    ) THEN
        RAISE EXCEPTION 'CRITICAL: tb_prob_float column missing from scans table!';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'scans' AND column_name = 'health_delta'
    ) THEN
        RAISE EXCEPTION 'CRITICAL: health_delta column missing from scans table!';
    END IF;

    RAISE NOTICE 'All columns verified successfully.';
END $$;

SELECT 'COMPLETE MIGRATION DONE. Tables: profiles (with age, known_conditions), scans (with tb_prob_float, health_delta, xray_image). Triggers: on_auth_user_created, on_scan_inserted.' AS status;
