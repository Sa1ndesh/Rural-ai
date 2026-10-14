// Optional: Set your own Supabase project URL and Anon Key if you wish to use cloud sync.
// Leave blank to run 100% offline with local browser storage and zero network errors.
const SUPABASE_URL = '';
const SUPABASE_ANON_KEY = '';

let _supabase = null;
if (SUPABASE_URL && SUPABASE_URL.trim() !== '' && window.supabase && window.supabase.createClient) {
    try {
        _supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
        console.log('[RuralX] Supabase cloud client ready.');
    } catch (err) {
        console.warn('[RuralX] Supabase init error:', err);
        _supabase = null;
    }
} else {
    console.log('[RuralX] Offline Local Storage mode active.');
}

/* ════════════════════════════════════
   OFFLINE / LOCAL STORAGE HELPERS
════════════════════════════════════ */
function offlineLogin(userCustomData = {}) {
    const pid = userCustomData.patient_id || generatePatientId();
    const name = userCustomData.full_name || 'Dr. Rural Clinician';
    const email = userCustomData.email || 'doctor@ruralx.clinic';
    const user = {
        id: userCustomData.id || 'local-offline-doctor',
        email: email,
        user_metadata: {
            full_name: name,
            patient_id: pid,
            date_of_birth: userCustomData.date_of_birth || '1985-06-15',
            phone: userCustomData.phone || '+91 9876543210'
        }
    };
    const session = {
        access_token: 'local-offline-token-' + Date.now(),
        token_type: 'bearer',
        user: user
    };
    const profile = {
        id: user.id,
        patient_id: pid,
        full_name: name,
        date_of_birth: user.user_metadata.date_of_birth,
        phone: user.user_metadata.phone,
        age: calculateAge(user.user_metadata.date_of_birth) || 39
    };
    try {
        localStorage.setItem('rx_local_session', JSON.stringify(session));
        localStorage.setItem('rx_local_user', JSON.stringify(user));
        localStorage.setItem('rx_local_profile', JSON.stringify(profile));
    } catch(e) {}
    return { session, user, profile };
}

/* ════════════════════════════════════
   AUTH HELPERS
════════════════════════════════════ */
async function getSession() {
    try {
        if (_supabase) {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
            const { data: { session } } = await Promise.race([_supabase.auth.getSession(), timeoutPromise]);
            if (session) return session;
        }
    } catch (e) {
        // Fallback to local
    }
    const raw = localStorage.getItem('rx_local_session');
    return raw ? JSON.parse(raw) : null;
}

async function getCurrentUser() {
    try {
        if (_supabase) {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
            const { data: { user } } = await Promise.race([_supabase.auth.getUser(), timeoutPromise]);
            if (user) return user;
        }
    } catch (e) {}
    const raw = localStorage.getItem('rx_local_user');
    return raw ? JSON.parse(raw) : null;
}

async function signOut() {
    try {
        if (_supabase) await _supabase.auth.signOut();
    } catch (e) {}
    try {
        localStorage.removeItem('rx_local_session');
        localStorage.removeItem('rx_local_user');
        localStorage.removeItem('rx_local_profile');
    } catch(e) {}
    window.location.href = '/auth';
}

/* ════════════════════════════════════
   PATIENT ID GENERATOR
════════════════════════════════════ */
function generatePatientId() {
    const year  = new Date().getFullYear();
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let s = '';
    for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return `RX-${year}-${s}`;
}

/* ════════════════════════════════════
   AGE CALCULATOR
════════════════════════════════════ */
function calculateAge(dobString) {
    if (!dobString) return null;
    const dob  = new Date(dobString);
    const now  = new Date();
    let age    = now.getFullYear() - dob.getFullYear();
    const m    = now.getMonth() - dob.getMonth();
    if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
    return age >= 0 ? age : null;
}

/* ════════════════════════════════════
   PROFILE HELPERS
════════════════════════════════════ */
async function getProfile(userId) {
    try {
        if (_supabase) {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
            const { data, error } = await Promise.race([
                _supabase.from('profiles').select('*').eq('id', userId).single(),
                timeoutPromise
            ]);
            if (data && !error) return data;
        }
    } catch (e) {}
    const raw = localStorage.getItem('rx_local_profile');
    if (raw) return JSON.parse(raw);
    const user = await getCurrentUser();
    return {
        id: userId || 'local-offline-doctor',
        full_name: user?.user_metadata?.full_name || 'Dr. Rural Clinician',
        patient_id: user?.user_metadata?.patient_id || 'RX-DEMO-001',
        age: 38
    };
}

async function createProfile(userId, profileData) {
    const patient_id = profileData.patient_id || generatePatientId();
    const age = calculateAge(profileData.date_of_birth);
    const localProf = { id: userId, patient_id, age, ...profileData };
    try {
        localStorage.setItem('rx_local_profile', JSON.stringify(localProf));
    } catch(e) {}
    try {
        if (_supabase) {
            const { data } = await _supabase.from('profiles').insert([localProf]).select().single();
            if (data) return data;
        }
    } catch(e) {}
    return localProf;
}

async function updateProfile(userId, updates) {
    if (updates.date_of_birth) {
        updates.age = calculateAge(updates.date_of_birth);
    }
    const prev = await getProfile(userId) || {};
    const merged = { ...prev, ...updates };
    try {
        localStorage.setItem('rx_local_profile', JSON.stringify(merged));
    } catch(e) {}
    try {
        if (_supabase) {
            const { data } = await _supabase.from('profiles').update(updates).eq('id', userId).select().single();
            if (data) return data;
        }
    } catch(e) {}
    return merged;
}

/* ════════════════════════════════════
   SCAN STORAGE
════════════════════════════════════ */

/**
 * Get the most recent scan for this user (for comparison)
 */
async function getPreviousScan() {
    try {
        if (_supabase) {
            const user = await getCurrentUser();
            if (user) {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
                const { data, error } = await Promise.race([
                    _supabase.from('scans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(1).maybeSingle(),
                    timeoutPromise
                ]);
                if (data && !error) return data;
            }
        }
    } catch(e) {}
    const raw = localStorage.getItem('rx_local_scans');
    if (raw) {
        const list = JSON.parse(raw);
        if (list.length > 0) return list[0];
    }
    return null;
}

/**
 * Safely extract a float probability from a scan record.
 */
function _extractProb(scan, floatKey, textKey) {
    if (scan[floatKey] != null && !isNaN(parseFloat(scan[floatKey]))) return parseFloat(scan[floatKey]);
    if (scan[textKey]  != null && !isNaN(parseFloat(scan[textKey])))  return parseFloat(scan[textKey]);
    return 0;
}

/**
 * Generate health delta: detailed comparison between previous and current scan.
 */
function computeHealthDelta(prevScan, currentData) {
    if (!prevScan) return null;

    // Extract probabilities with fallback to text fields
    const prev = {
        tb:        _extractProb(prevScan, 'tb_prob_float', 'tb_prob'),
        pneumonia: _extractProb(prevScan, 'pneumonia_prob_float', 'pneumonia_prob'),
        risk:      prevScan.risk_level || '',
        diagnosis: prevScan.diagnosis  || '',
        confidence: parseFloat(prevScan.confidence || 0),
    };
    const curr = {
        tb:        _extractProb(currentData, 'tb_prob_float', 'tb_prob'),
        pneumonia: _extractProb(currentData, 'pneumonia_prob_float', 'pneumonia_prob'),
        risk:      currentData.risk_level || '',
        diagnosis: currentData.diagnosis  || '',
        confidence: parseFloat(currentData.confidence || 0),
    };

    const RISK_RANK = { ROUTINE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };

    const tbDiff   = curr.tb        - prev.tb;
    const pnDiff   = curr.pneumonia - prev.pneumonia;
    const prevRiskRank = RISK_RANK[prev.risk] ?? 0;
    const currRiskRank = RISK_RANK[curr.risk] ?? 0;
    const riskDiff     = currRiskRank - prevRiskRank;

    let score = 0;
    score += tbDiff * 2;
    score += pnDiff * 1.5;
    score += riskDiff * 0.15;
    if (curr.diagnosis === 'Normal' && prev.diagnosis !== 'Normal') score -= 0.3;
    if (prev.diagnosis === 'Normal' && curr.diagnosis !== 'Normal') score += 0.3;

    const overallTrend = score < -0.02 ? 'IMPROVED'
                       : score >  0.02 ? 'WORSENED'
                       : 'STABLE';

    const diagnosisChanged = prev.diagnosis !== curr.diagnosis;

    let daysSince = null;
    if (prevScan.created_at) {
        daysSince = Math.max(0, Math.round((Date.now() - new Date(prevScan.created_at).getTime()) / 86400000));
    }

    let findingsDelta = [];
    const prevFindings = prevScan.radiological_findings || {};
    const currFindings = currentData.radiological_findings || {};
    const allFindingKeys = new Set([...Object.keys(prevFindings), ...Object.keys(currFindings)]);
    allFindingKeys.forEach(key => {
        const pv = parseFloat(prevFindings[key] || 0);
        const cv = parseFloat(currFindings[key] || 0);
        const change = cv - pv;
        if (Math.abs(change) > 0.01) {
            findingsDelta.push({
                name: key,
                prev_val: +(pv * 100).toFixed(1),
                curr_val: +(cv * 100).toFixed(1),
                change:   +(change * 100).toFixed(1),
                trend:    change < 0 ? 'improved' : 'worsened',
            });
        }
    });
    findingsDelta.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));

    return {
        prev_diagnosis:     prev.diagnosis,
        curr_diagnosis:     curr.diagnosis,
        diagnosis_changed:  diagnosisChanged,
        prev_tb:            +(prev.tb * 100).toFixed(1),
        curr_tb:            +(curr.tb * 100).toFixed(1),
        tb_change:          +(tbDiff * 100).toFixed(1),
        prev_pneumonia:     +(prev.pneumonia * 100).toFixed(1),
        curr_pneumonia:     +(curr.pneumonia * 100).toFixed(1),
        pneumonia_change:   +(pnDiff * 100).toFixed(1),
        risk_change:        riskDiff,
        prev_risk:          prev.risk,
        curr_risk:          curr.risk,
        overall_trend:      overallTrend,
        trend_score:        +score.toFixed(3),
        days_since_last:    daysSince,
        prev_scan_date:     prevScan.created_at,
        prev_confidence:    prev.confidence,
        curr_confidence:    curr.confidence,
        findings_delta:     findingsDelta,
    };
}

/**
 * Save full scan to local storage and Supabase
 */
async function saveScan(scanPayload) {
    const user = await getCurrentUser();
    const profile = await getProfile(user?.id);
    const scanRecord = {
        id: 'scan-' + Date.now(),
        user_id: user?.id || 'local-offline-doctor',
        patient_id: profile?.patient_id || null,
        created_at: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        ...scanPayload
    };
    try {
        const raw = localStorage.getItem('rx_local_scans');
        const list = raw ? JSON.parse(raw) : [];
        list.unshift(scanRecord);
        localStorage.setItem('rx_local_scans', JSON.stringify(list.slice(0, 100)));
    } catch(e) {
        console.warn('Failed saving scan locally:', e);
    }
    try {
        if (_supabase && user) {
            const { data } = await _supabase.from('scans').insert([scanRecord]).select().single();
            if (data) return data;
        }
    } catch(e) {}
    return scanRecord;
}

/**
 * Get all scans for current user
 */
async function getPatientScans(limit = 50) {
    try {
        if (_supabase) {
            const user = await getCurrentUser();
            if (user) {
                const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
                const { data, error } = await Promise.race([
                    _supabase.from('scans').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(limit),
                    timeoutPromise
                ]);
                if (data && !error && data.length > 0) return data;
            }
        }
    } catch(e) {}
    const raw = localStorage.getItem('rx_local_scans');
    return raw ? JSON.parse(raw).slice(0, limit) : [];
}

/* ════════════════════════════════════
   SIGN UP / SIGN IN
════════════════════════════════════ */
async function signUp({ email, password, full_name, phone, date_of_birth, patient_id }) {
    const pid = patient_id || generatePatientId();
    const age = calculateAge(date_of_birth);
    try {
        if (_supabase) {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
            const { data, error } = await Promise.race([
                _supabase.auth.signUp({
                    email,
                    password,
                    options: { data: { full_name, phone, date_of_birth, patient_id: pid, age } }
                }),
                timeoutPromise
            ]);
            if (!error && data?.user) return { ...data, patient_id: pid };
        }
    } catch (e) {
        console.warn('[RuralX] Supabase sign up unavailable, switching to local account:', e);
    }
    return offlineLogin({ email, full_name, phone, date_of_birth, patient_id: pid });
}

async function signIn({ email, password }) {
    try {
        if (_supabase) {
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2500));
            const { data, error } = await Promise.race([
                _supabase.auth.signInWithPassword({ email, password }),
                timeoutPromise
            ]);
            if (!error && data?.session) return data;
        }
    } catch(e) {
        console.warn('[RuralX] Supabase sign in unavailable, switching to local login:', e);
    }
    return offlineLogin({ email, full_name: email.split('@')[0] });
}

/* ════════════════════════════════════
   AUTH GUARD
════════════════════════════════════ */
async function requireAuth(redirectTo = '/auth') {
    const session = await getSession();
    if (!session) { window.location.href = redirectTo; return null; }
    return session;
}

/* ── Expose globally ── */
window.RuralXAuth = {
    supabase: _supabase,
    getSession, getCurrentUser, signOut,
    getProfile, createProfile, updateProfile,
    saveScan, getPatientScans, getPreviousScan,
    computeHealthDelta, calculateAge, generatePatientId,
    requireAuth, signUp, signIn, offlineLogin
};
