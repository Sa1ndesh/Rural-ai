/* ══════════════════════════════════════════════════
   RuralX AI – Scanning Page Logic (Premium v4)
   Proper SVG icons · Accurate health delta comparison
   ══════════════════════════════════════════════════ */

const STEPS = [
    { id:'st_qc',  sts:'sts_qc',  label:'Image Quality Assessment',  pct:12 },
    { id:'st_enh', sts:'sts_enh', label:'Enhancement Pipeline',       pct:25 },
    { id:'st_ens', sts:'sts_ens', label:'Triple-Ensemble Inference',   pct:48 },
    { id:'st_mc',  sts:'sts_mc',  label:'MC Dropout Uncertainty',     pct:65 },
    { id:'st_gc',  sts:'sts_gc',  label:'Grad-CAM Heatmap',          pct:78 },
    { id:'st_rp',  sts:'sts_rp',  label:'Clinical Report Generation', pct:90 },
    { id:'st_sv',  sts:'sts_sv',  label:'Cloud Sync & Comparison',    pct:100 },
];

/* SVG icons for triage levels */
const TRIAGE_ICONS = {
    CRITICAL: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    HIGH:     `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    MEDIUM:   `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`,
    LOW:      `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`,
    ROUTINE:  `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

/* SVG for delta trend */
const DELTA_ICONS = {
    IMPROVED: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
    WORSENED: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
    STABLE:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
    BASELINE: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`,
};

let scanData = null, previousScan = null;

document.addEventListener('DOMContentLoaded', async () => {
    const auth = window.RuralXAuth;
    const session = await auth.requireAuth('/auth');
    if (!session) return;

    const raw = sessionStorage.getItem('rxScanData');
    if (!raw) { window.location.href = '/app'; return; }
    scanData = JSON.parse(raw);

    document.getElementById('sName').textContent = scanData.patient_name || '\u2014';
    document.getElementById('sAge').textContent  = scanData.age || '\u2014';
    document.getElementById('sSpo2').textContent = scanData.spo2 ? `${scanData.spo2}%` : '\u2014';

    const user    = session.user;
    const profile = await auth.getProfile(user.id);
    const pid     = profile?.patient_id || '\u2014';
    document.getElementById('sPid').textContent  = pid;
    document.getElementById('rpName').textContent = scanData.patient_name || '\u2014';
    document.getElementById('rpPid').textContent  = pid;

    if (scanData.xray_base64) {
        const img = document.getElementById('scanImg');
        img.src = scanData.xray_base64; img.style.display = 'block';
        document.getElementById('scanPH').style.display = 'none';
    }

    try { previousScan = await auth.getPreviousScan(); } catch(e) { console.warn('No previous scan:', e); }
    await runAnalysis(auth, profile);
});

/* ── Step animation helpers ── */
function stepActive(id, stsId) {
    document.getElementById(id)?.classList.add('active');
    const s = document.getElementById(stsId);
    if (s) s.innerHTML = '<div class="spinner"></div>';
}
function stepDone(id, stsId) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('active'); el.classList.add('done'); }
    const s = document.getElementById(stsId);
    if (s) s.innerHTML = '<div class="checkmark"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg></div>';
}
function setProgress(p) {
    document.getElementById('pFill').style.width = p + '%';
    document.getElementById('pPct').textContent  = p + '%';
}
function setLabel(t) { document.getElementById('statusLabel').textContent = t; }
function wait(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ── Main Analysis Flow ── */
async function runAnalysis(auth, profile) {
    const animateSteps = async () => {
        for (let i = 0; i < 5; i++) {
            stepActive(STEPS[i].id, STEPS[i].sts);
            setLabel(STEPS[i].label + '\u2026');
            setProgress(STEPS[i].pct);
            await wait(1000);
            stepDone(STEPS[i].id, STEPS[i].sts);
        }
    };

    // Show detection dots on X-ray after 2.5s
    setTimeout(() => {
        ['dot1','dot2','dot3'].forEach((id, i) => {
            setTimeout(() => document.getElementById(id)?.classList.add('show'), i * 400);
        });
    }, 2500);

    // Build FormData from sessionStorage
    const fd = new FormData();
    if (scanData.xray_base64) {
        const arr = scanData.xray_base64.split(',');
        const mime = arr[0].match(/:(.*?);/)?.[1] || 'image/jpeg';
        const raw = atob(arr[1]);
        const buf = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) buf[i] = raw.charCodeAt(i);
        fd.append('image', new Blob([buf], { type: mime }), scanData.xray_name || 'xray.jpg');
    }
    ['patient_name','age','spo2','temperature','fever_days','cough_days','symptoms','haemoptysis','bcg','language']
        .forEach(k => { if (scanData[k] !== undefined && scanData[k] !== '') fd.append(k, scanData[k]); });

    // Run animation + API call in parallel
    const [, res] = await Promise.all([
        animateSteps(),
        fetch('/api/predict', { method: 'POST', body: fd }).then(r => r.json()).catch(() => ({ success:false, error:'Server unreachable' })),
    ]);

    if (!res.success) { setLabel('Error: ' + (res.error||'Analysis failed')); return; }

    // Complete remaining steps
    for (let i = 5; i < STEPS.length; i++) {
        stepActive(STEPS[i].id, STEPS[i].sts);
        setLabel(STEPS[i].label + '\u2026');
        setProgress(STEPS[i].pct);
        await wait(600);
        stepDone(STEPS[i].id, STEPS[i].sts);
    }

    setLabel('Analysis Complete');
    setProgress(100);

    // Save to Supabase
    await saveScan(auth, res, profile, previousScan);
    await wait(700);
    showResults(res, previousScan);
}

/* ── Save scan to database ── */
async function saveScan(auth, data, profile, prev) {
    try {
        const r = data.results;
        const tbF = parseFloat(r.tb_prob), pnF = parseFloat(r.pneumonia_prob);
        // Pass ALL data including text prob fields and findings for accurate delta
        const delta = auth.computeHealthDelta(prev, {
            tb_prob_float: tbF, pneumonia_prob_float: pnF,
            tb_prob: r.tb_prob, pneumonia_prob: r.pneumonia_prob,
            risk_level: r.risk_level, diagnosis: r.diagnosis,
            confidence: r.confidence,
            radiological_findings: r.radiological_findings || {},
        });
        const saved = await auth.saveScan({
            session_id: data.session_id,
            patient_name: scanData.patient_name || 'Unknown',
            patient_age: scanData.age || '',
            diagnosis: r.diagnosis, confidence: r.confidence, risk_level: r.risk_level,
            tb_prob: r.tb_prob, pneumonia_prob: r.pneumonia_prob,
            tb_prob_float: tbF, pneumonia_prob_float: pnF,
            uncertainty_pct: r.uncertainty_pct,
            spo2: scanData.spo2 || '', temperature: scanData.temperature || '',
            fever_days: scanData.fever_days || '', cough_days: scanData.cough_days || '',
            haemoptysis: scanData.haemoptysis || 'no', bcg_status: scanData.bcg || 'unknown',
            symptoms: scanData.symptoms || '', language: scanData.language || 'en',
            radiological_findings: r.radiological_findings || {},
            report_json: data.report, structured_json: data.structured,
            xray_image: scanData.xray_base64 || null,
            heatmap_image: data.heatmap || null,
            prev_scan_id: prev?.id || null,
            health_delta: delta,
        });
        if (saved) document.getElementById('savedPill').style.display = 'inline-flex';
    } catch(e) { console.error('Save error:', e); }
}

/* ── Show Results ── */
function showResults(data, prev) {
    document.getElementById('scanningView').style.display = 'none';
    document.getElementById('resultsView').style.display  = 'block';
    document.getElementById('resTime').textContent = new Date().toLocaleString();

    const r = data.results;

    // Triage
    const hero = document.getElementById('triageHero');
    hero.className = `triage-hero risk-${r.risk_level}`;
    document.getElementById('triageEmb').innerHTML = TRIAGE_ICONS[r.risk_level] || TRIAGE_ICONS.MEDIUM;
    document.getElementById('tLevel').textContent = `${r.risk_level} RISK`;
    document.getElementById('tDx').textContent    = `Diagnosis: ${r.diagnosis}`;
    document.getElementById('tRef').textContent   = r.referral_hours === 0 ? 'Immediate referral required'
        : r.referral_hours ? `Referral recommended within ${r.referral_hours} hours`
        : 'Routine follow-up recommended';

    // Metrics
    document.getElementById('mConf').textContent = `${r.confidence}%`;
    document.getElementById('mUnc').textContent  = `\u00B1${r.uncertainty_pct}%`;
    document.getElementById('mQa').textContent   = data.qa_message || 'Passed';

    // Probability bars
    const tb = (parseFloat(r.tb_prob) * 100).toFixed(1);
    const pn = (parseFloat(r.pneumonia_prob) * 100).toFixed(1);
    document.getElementById('rTbPct').textContent = `${tb}%`;
    document.getElementById('rPnPct').textContent = `${pn}%`;
    requestAnimationFrame(() => {
        document.getElementById('rTbBar').style.width = `${tb}%`;
        document.getElementById('rPnBar').style.width = `${pn}%`;
    });

    // Radiological findings
    const fl = document.getElementById('findingsList');
    fl.innerHTML = '';
    const entries = Object.entries(r.radiological_findings || {}).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
        fl.innerHTML = '<span style="font-size:.78rem;color:var(--muted);">No significant findings detected</span>';
    } else {
        entries.forEach(([name, prob]) => {
            const pct = (prob * 100).toFixed(0);
            const el = document.createElement('div');
            el.className = 'finding';
            el.innerHTML = `<span class="finding-name">${esc(name)}</span><div class="finding-bar"><div class="finding-fill" style="width:0%" data-pct="${pct}"></div></div><span class="finding-pct">${pct}%</span>`;
            fl.appendChild(el);
        });
    }
    requestAnimationFrame(() => fl.querySelectorAll('.finding-fill').forEach(b => b.style.width = b.dataset.pct + '%'));

    // Anatomical Visualizer
    const lobes = ['lobe-ru', 'lobe-rm', 'lobe-rl', 'lobe-lu', 'lobe-ll'];
    lobes.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.setAttribute('class', 'lung-lobe safe');
    });

    if (r.radiological_findings) {
        const fKeys = Object.keys(r.radiological_findings).map(k => k.toLowerCase());
        const hasConsolidation = fKeys.some(k => k.includes('consolidation') || k.includes('opacity'));
        const hasInfiltrate = fKeys.some(k => k.includes('infiltrate') || k.includes('effusion'));
        const isTB = r.tb_prob > 0.5;
        const isPn = r.pneumonia_prob > 0.5;

        if (isTB) {
            // TB often in upper lobes
            const el1 = document.getElementById('lobe-ru');
            const el2 = document.getElementById('lobe-lu');
            if (el1) el1.setAttribute('class', 'lung-lobe danger');
            if (el2 && Math.random() > 0.5) el2.setAttribute('class', 'lung-lobe warn');
        } else if (isPn) {
            // Pneumonia often in lower lobes
            const el1 = document.getElementById('lobe-rl');
            const el2 = document.getElementById('lobe-ll');
            if (el1) el1.setAttribute('class', hasConsolidation ? 'lung-lobe danger' : 'lung-lobe warn');
            if (el2 && Math.random() > 0.3) el2.setAttribute('class', 'lung-lobe warn');
        } else if (hasInfiltrate || hasConsolidation) {
            const el = document.getElementById('lobe-rm');
            if (el) el.setAttribute('class', 'lung-lobe warn');
        }
    }
    // Heatmap
    document.getElementById('hmImg').src = data.heatmap;
    document.getElementById('ogImg').src = scanData.xray_base64 || '';
    document.querySelectorAll('.hm-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.hm-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            const hm = document.getElementById('hmImg'), og = document.getElementById('ogImg');
            if (tab.dataset.v === 'hm') { hm.style.opacity = '1'; og.style.opacity = '0'; }
            else { hm.style.opacity = '0'; og.style.opacity = '1'; }
        });
    });
    document.getElementById('hmOp')?.addEventListener('input', e => {
        document.getElementById('hmImg').style.opacity = e.target.value;
    });

    // Report
    const rpt = data.report;
    if (rpt?.data) {
        const rl = document.getElementById('reportList');
        rl.innerHTML = '';
        rpt.data.forEach(item => {
            const el = document.createElement('div');
            el.className = 'report-item';
            el.innerHTML = `<span class="rp-label">${esc(item.label)}</span><span class="rp-val ${valClass(item.value)}">${esc(item.value)}</span>`;
            rl.appendChild(el);
        });
    }

    // Health Delta Comparison
    renderDelta(prev, r);

    // Google AI Studio (Gemini) Consultation & Chat
    initGeminiIntegration(data, scanData);
}


/* ── Health Delta Renderer ── */
function renderDelta(prev, results) {
    const wrap = document.getElementById('deltaWrap');
    if (!wrap) return;

    // First scan: show baseline
    if (!prev) {
        wrap.innerHTML = `<div class="delta-card baseline">
            <div class="delta-head">${DELTA_ICONS.BASELINE}<div><strong>First Scan \u2014 Baseline Established</strong><span class="delta-sub">Future scans will compare against this record to track your health progress over time.</span></div></div>
        </div>`;
        return;
    }

    const auth = window.RuralXAuth;
    const d = auth.computeHealthDelta(prev, {
        tb_prob_float: parseFloat(results.tb_prob),
        pneumonia_prob_float: parseFloat(results.pneumonia_prob),
        tb_prob: results.tb_prob,
        pneumonia_prob: results.pneumonia_prob,
        risk_level: results.risk_level,
        diagnosis: results.diagnosis,
        confidence: results.confidence,
        radiological_findings: results.radiological_findings || {},
    });
    if (!d) return;

    const cls   = d.overall_trend === 'IMPROVED' ? 'improved' : d.overall_trend === 'WORSENED' ? 'worsened' : 'stable';
    const label = d.overall_trend === 'IMPROVED' ? 'Health Improved' : d.overall_trend === 'WORSENED' ? 'Health Declined' : 'Condition Stable';
    const icon  = DELTA_ICONS[d.overall_trend] || DELTA_ICONS.STABLE;

    const arrow = (v) => v < 0 ? '\u2193' : v > 0 ? '\u2191' : '\u2192';
    const color = (v) => v < 0 ? '#10B981' : v > 0 ? '#EF4444' : '#94A3B8';

    // Build per-finding comparison rows
    let findingsHtml = '';
    if (d.findings_delta && d.findings_delta.length > 0) {
        const rows = d.findings_delta.slice(0, 6).map(f => {
            const fc = f.trend === 'improved' ? '#10B981' : '#EF4444';
            const fa = f.trend === 'improved' ? '\u2193' : '\u2191';
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:0.35rem 0;border-bottom:1px solid rgba(255,255,255,0.04);font-size:0.75rem;">
                <span style="color:var(--muted);">${esc(f.name)}</span>
                <span><span style="color:var(--muted);font-size:0.68rem;">${f.prev_val}%</span> <span style="color:${fc};font-weight:700;">${fa} ${f.curr_val}%</span></span>
            </div>`;
        }).join('');
        findingsHtml = `<div style="margin-top:0.85rem;border-top:1px solid rgba(255,255,255,0.06);padding-top:0.65rem;">
            <span style="font-size:0.58rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--muted);">Per-Finding Changes</span>
            ${rows}
        </div>`;
    }

    // Diagnosis change banner
    let diagHtml = '';
    if (d.diagnosis_changed) {
        diagHtml = `<div class="dm-item" style="grid-column:1/-1;background:rgba(99,102,241,0.08);">
            <span class="dm-label">Diagnosis Changed</span>
            <span class="dm-val" style="font-size:.82rem;">${esc(d.prev_diagnosis)} \u2192 ${esc(d.curr_diagnosis)}</span>
        </div>`;
    }

    // Time label
    let timeLabel;
    if (d.days_since_last === 0) timeLabel = 'Earlier today';
    else if (d.days_since_last === 1) timeLabel = '1 day since last scan';
    else if (d.days_since_last != null) timeLabel = `${d.days_since_last} days since last scan`;
    else timeLabel = 'Compared to previous scan';
    if (d.prev_scan_date) timeLabel += ` (${new Date(d.prev_scan_date).toLocaleDateString()})`;

    wrap.innerHTML = `<div class="delta-card ${cls}">
        <div class="delta-head">${icon}<div><strong>${label}</strong><span class="delta-sub">${timeLabel}</span></div></div>
        <div class="delta-metrics">
            <div class="dm-item">
                <span class="dm-label">TB Probability</span>
                <span class="dm-val" style="color:${color(d.tb_change)}">${arrow(d.tb_change)} ${Math.abs(d.tb_change).toFixed(1)}%</span>
                <span class="dm-sub">${d.prev_tb}% \u2192 ${d.curr_tb}%</span>
            </div>
            <div class="dm-item">
                <span class="dm-label">Pneumonia Prob.</span>
                <span class="dm-val" style="color:${color(d.pneumonia_change)}">${arrow(d.pneumonia_change)} ${Math.abs(d.pneumonia_change).toFixed(1)}%</span>
                <span class="dm-sub">${d.prev_pneumonia}% \u2192 ${d.curr_pneumonia}%</span>
            </div>
            <div class="dm-item">
                <span class="dm-label">Risk Level</span>
                <span class="dm-val" style="font-size:.82rem;color:${color(d.risk_change)}">${d.prev_risk || '\u2014'} \u2192 ${d.curr_risk || '\u2014'}</span>
            </div>
            <div class="dm-item">
                <span class="dm-label">Previous Diagnosis</span>
                <span class="dm-val" style="font-size:.82rem;">${esc(d.prev_diagnosis || '\u2014')}</span>
            </div>
            ${diagHtml}
        </div>
        ${findingsHtml}
    </div>`;
}

/* ── Helpers ── */
function valClass(v) {
    const u = String(v).toUpperCase();
    if (u.includes('CRITICAL') || u.includes('HIGH')) return 'danger';
    if (u.includes('MEDIUM')) return 'warning';
    if (u.includes('LOW') || u.includes('NORMAL') || u.includes('ROUTINE')) return 'success';
    return '';
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ══════════════════════════════════════════════════
   Google AI Studio (Gemini) Front-End Controller
   ══════════════════════════════════════════════════ */
let geminiChatHistory = [];
let currentAnalysisData = null;
let currentPatientData = null;

function initGeminiIntegration(data, pData) {
    currentAnalysisData = data;
    currentPatientData = pData;

    const keyBtn = document.getElementById('geminiKeyBtn');
    const drawer = document.getElementById('geminiKeyDrawer');
    const saveKeyBtn = document.getElementById('saveGeminiKeyBtn');
    const keyInput = document.getElementById('geminiApiKeyInput');
    const keyText = document.getElementById('geminiKeyStatusText');
    const consultBtn = document.getElementById('btnConsultGemini');
    const refreshBtn = document.getElementById('geminiRefreshBtn');
    const chatForm = document.getElementById('geminiChatForm');

    // 1. Check local key
    const savedKey = localStorage.getItem('gemini_api_key') || '';
    if (savedKey) {
        if (keyInput) keyInput.value = savedKey;
        keyBtn?.classList.add('has-key');
        if (keyText) keyText.textContent = 'Key Saved';
    }

    // Check server status
    fetch('/api/gemini/status', {
        headers: { 'X-Gemini-Key': savedKey }
    })
    .then(r => r.json())
    .then(status => {
        if (status.available) {
            keyBtn?.classList.add('has-key');
            if (keyText) keyText.textContent = 'Connected';
        }
    })
    .catch(() => {});

    // Toggle drawer
    keyBtn?.addEventListener('click', () => {
        if (!drawer) return;
        drawer.style.display = drawer.style.display === 'none' ? 'block' : 'none';
    });

    // Save key
    saveKeyBtn?.addEventListener('click', () => {
        const val = keyInput?.value?.trim() || '';
        if (val) {
            localStorage.setItem('gemini_api_key', val);
            keyBtn?.classList.add('has-key');
            if (keyText) keyText.textContent = 'Key Saved';
            if (drawer) drawer.style.display = 'none';
        } else {
            localStorage.removeItem('gemini_api_key');
            keyBtn?.classList.remove('has-key');
            if (keyText) keyText.textContent = 'API Key';
        }
    });

    // Consult trigger
    consultBtn?.addEventListener('click', () => runGeminiConsultation());
    refreshBtn?.addEventListener('click', () => runGeminiConsultation());

    // Chat submit
    chatForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        sendGeminiChatMessage();
    });
}

async function runGeminiConsultation() {
    const emptyState = document.getElementById('geminiEmptyState');
    const loadingState = document.getElementById('geminiLoadingState');
    const resultArea = document.getElementById('geminiResultArea');
    const chatSection = document.getElementById('geminiChatSection');
    const markdownBody = document.getElementById('geminiMarkdownBody');
    const modelTag = document.getElementById('geminiModelTag');
    const tsTag = document.getElementById('geminiTimestamp');
    const drawer = document.getElementById('geminiKeyDrawer');

    const key = localStorage.getItem('gemini_api_key') || '';

    // Switch UI to loading
    if (emptyState) emptyState.style.display = 'none';
    if (resultArea) resultArea.style.display = 'none';
    if (loadingState) loadingState.style.display = 'flex';

    try {
        const payload = {
            image_b64: currentPatientData?.xray_base64 || '',
            patient_name: currentPatientData?.patient_name || 'Patient',
            age: currentPatientData?.age || '',
            spo2: currentPatientData?.spo2 || '',
            symptoms: currentPatientData?.symptoms || '',
            haemoptysis: currentPatientData?.haemoptysis === 'yes',
            fever_days: currentPatientData?.fever_days || '',
            local_prediction: currentAnalysisData?.results || {}
        };

        const res = await fetch('/api/gemini/analyze', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Gemini-Key': key
            },
            body: JSON.stringify(payload)
        }).then(r => r.json());

        if (loadingState) loadingState.style.display = 'none';

        if (res.success && res.report_markdown) {
            if (resultArea) resultArea.style.display = 'block';
            if (chatSection) chatSection.style.display = 'block';

            if (markdownBody) {
                if (typeof window.marked !== 'undefined' && window.marked.parse) {
                    markdownBody.innerHTML = window.marked.parse(res.report_markdown);
                } else {
                    markdownBody.textContent = res.report_markdown;
                }
            }

            if (modelTag) modelTag.textContent = res.model_used || 'Gemini 1.5 Flash';
            if (tsTag) tsTag.textContent = 'Generated at ' + new Date().toLocaleTimeString();

            // Reset chat history with context
            geminiChatHistory = [
                { role: 'model', content: res.report_markdown }
            ];
        } else {
            if (emptyState) emptyState.style.display = 'block';
            if (drawer) drawer.style.display = 'block';
            alert('Google AI Studio: ' + (res.error || 'Failed to generate report. Please verify your API Key.'));
        }
    } catch (err) {
        if (loadingState) loadingState.style.display = 'none';
        if (emptyState) emptyState.style.display = 'block';
        alert('Consultation request failed: ' + err.message);
    }
}

async function sendGeminiChatMessage() {
    const input = document.getElementById('geminiChatInput');
    const msgList = document.getElementById('geminiChatMessages');
    const sendBtn = document.getElementById('geminiSendBtn');

    if (!input || !msgList) return;
    const text = input.value.trim();
    if (!text) return;

    // Add user bubble
    const userEl = document.createElement('div');
    userEl.className = 'g-msg user';
    userEl.innerHTML = `<div class="g-msg-bubble">${esc(text)}</div>`;
    msgList.appendChild(userEl);
    input.value = '';
    msgList.scrollTop = msgList.scrollHeight;

    // Add AI loading bubble
    const aiEl = document.createElement('div');
    aiEl.className = 'g-msg ai';
    aiEl.innerHTML = `<div class="g-msg-bubble" style="opacity:0.6;">Consulting Gemini…</div>`;
    msgList.appendChild(aiEl);
    msgList.scrollTop = msgList.scrollHeight;

    if (sendBtn) sendBtn.disabled = true;

    try {
        const key = localStorage.getItem('gemini_api_key') || '';
        const res = await fetch('/api/gemini/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Gemini-Key': key
            },
            body: JSON.stringify({
                message: text,
                history: geminiChatHistory,
                patient_context: {
                    name: currentPatientData?.patient_name || 'Patient',
                    age: currentPatientData?.age || '',
                    spo2: currentPatientData?.spo2 || '',
                    diagnosis: currentAnalysisData?.results?.diagnosis || '',
                    risk_level: currentAnalysisData?.results?.risk_level || '',
                    symptoms: currentPatientData?.symptoms || ''
                }
            })
        }).then(r => r.json());

        if (res.success && res.reply) {
            aiEl.innerHTML = `<div class="g-msg-bubble">${typeof window.marked !== 'undefined' ? window.marked.parse(res.reply) : esc(res.reply)}</div>`;
            geminiChatHistory.push({ role: 'user', content: text });
            geminiChatHistory.push({ role: 'model', content: res.reply });
        } else {
            aiEl.innerHTML = `<div class="g-msg-bubble" style="color:var(--red);">Error: ${esc(res.error || 'No reply')}</div>`;
        }
    } catch (e) {
        aiEl.innerHTML = `<div class="g-msg-bubble" style="color:var(--red);">Request failed: ${esc(e.message)}</div>`;
    } finally {
        if (sendBtn) sendBtn.disabled = false;
        msgList.scrollTop = msgList.scrollHeight;
    }
}

