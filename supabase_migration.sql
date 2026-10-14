-- ══════════════════════════════════════════════════════════
-- RuralX AI – Supabase Database Migration
-- Run this in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════

-- ── 1. Profiles Table ──
CREATE TABLE IF NOT EXISTS public.profiles (
    id            UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id    TEXT        UNIQUE NOT NULL,
    full_name     TEXT,
    email         TEXT,
    phone         TEXT,
    date_of_birth DATE,
    created_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own profile"   ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;

CREATE POLICY "Users can view own profile"
    ON public.profiles FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile"
    ON public.profiles FOR UPDATE USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile"
    ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- ── 2. Scans Table ──
CREATE TABLE IF NOT EXISTS public.scans (
    id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
    patient_id     TEXT        REFERENCES public.profiles(patient_id),
    session_id     TEXT,
    timestamp      TIMESTAMPTZ DEFAULT NOW(),
    patient_name   TEXT,
    patient_age    TEXT,
    diagnosis      TEXT,
    confidence     TEXT,
    risk_level     TEXT,
    tb_prob        TEXT,
    pneumonia_prob TEXT,
    language       TEXT,
    report_json    JSONB,
    structured_json JSONB,
    created_at     TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security
ALTER TABLE public.scans ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own scans"   ON public.scans;
DROP POLICY IF EXISTS "Users can insert own scans" ON public.scans;

CREATE POLICY "Users can view own scans"
    ON public.scans FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own scans"
    ON public.scans FOR INSERT WITH CHECK (auth.uid() = user_id);

-- ── 3. Auto-create Profile on Signup Trigger ──
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, patient_id, full_name, email, phone, date_of_birth)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'patient_id', 'RX-' || EXTRACT(YEAR FROM NOW()) || '-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 6))),
        NEW.raw_user_meta_data->>'full_name',
        NEW.email,
        NEW.raw_user_meta_data->>'phone',
        (NEW.raw_user_meta_data->>'date_of_birth')::DATE
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop existing trigger if it exists and recreate
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Done!
SELECT 'Migration complete. Tables: profiles, scans. Trigger: on_auth_user_created' AS status;
