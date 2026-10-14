-- ══════════════════════════════════════════════════════════
-- RuralX AI – Migration v2: Comprehensive Patient Tracking
-- Run in: Supabase Dashboard → SQL Editor → New Query
-- ══════════════════════════════════════════════════════════

-- ── Extend profiles table ──
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS age              INTEGER,
    ADD COLUMN IF NOT EXISTS known_conditions JSONB         DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS last_scan_at     TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS scan_count       INTEGER       DEFAULT 0;

-- ── Extend scans table with full vitals + images + comparison data ──
ALTER TABLE public.scans
    ADD COLUMN IF NOT EXISTS spo2                  TEXT,
    ADD COLUMN IF NOT EXISTS temperature           TEXT,
    ADD COLUMN IF NOT EXISTS fever_days            TEXT,
    ADD COLUMN IF NOT EXISTS cough_days            TEXT,
    ADD COLUMN IF NOT EXISTS haemoptysis           TEXT,
    ADD COLUMN IF NOT EXISTS bcg_status            TEXT,
    ADD COLUMN IF NOT EXISTS symptoms              TEXT,
    ADD COLUMN IF NOT EXISTS tb_prob_float         FLOAT,
    ADD COLUMN IF NOT EXISTS pneumonia_prob_float  FLOAT,
    ADD COLUMN IF NOT EXISTS uncertainty_pct       TEXT,
    ADD COLUMN IF NOT EXISTS radiological_findings JSONB,
    ADD COLUMN IF NOT EXISTS xray_image            TEXT,
    ADD COLUMN IF NOT EXISTS heatmap_image         TEXT,
    ADD COLUMN IF NOT EXISTS prev_scan_id          UUID,
    ADD COLUMN IF NOT EXISTS health_delta          JSONB;

-- ── Function: update profile after each scan ──
CREATE OR REPLACE FUNCTION public.update_profile_after_scan()
RETURNS TRIGGER AS $$
DECLARE
    v_conditions JSONB;
    v_diagnosis  TEXT;
BEGIN
    v_diagnosis := NEW.diagnosis;

    -- Get current known_conditions
    SELECT known_conditions INTO v_conditions
    FROM public.profiles WHERE id = NEW.user_id;

    IF v_conditions IS NULL THEN v_conditions := '[]'::jsonb; END IF;

    -- Add new diagnosis if not already present
    IF v_diagnosis IS NOT NULL AND v_diagnosis != 'Normal' THEN
        IF NOT (v_conditions @> jsonb_build_array(v_diagnosis)) THEN
            v_conditions := v_conditions || jsonb_build_array(v_diagnosis);
        END IF;
    END IF;

    -- Update profile
    UPDATE public.profiles
    SET
        known_conditions = v_conditions,
        last_scan_at     = NEW.created_at,
        scan_count       = COALESCE(scan_count, 0) + 1
    WHERE id = NEW.user_id;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_scan_inserted ON public.scans;
CREATE TRIGGER on_scan_inserted
    AFTER INSERT ON public.scans
    FOR EACH ROW EXECUTE FUNCTION public.update_profile_after_scan();

SELECT 'Migration v2 complete' AS status;
