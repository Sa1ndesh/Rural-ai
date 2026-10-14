/* ════════════════════════════════════════════════════════════
   RuralX AI – App Page Logic (form → scanning redirect)
   ════════════════════════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
    const auth = window.RuralXAuth;

    // ── Auth Guard ──
    const session = await auth.requireAuth('/auth');
    if (!session) return;

    const user    = session.user;
    const profile = await auth.getProfile(user.id);

    // ── Populate header ──
    const name = profile?.full_name || user.email?.split('@')[0] || 'User';
    const bar  = document.getElementById('userProfileBar');
    if (bar) {
        document.getElementById('userAvatar').textContent = name.charAt(0).toUpperCase();
        document.getElementById('userName').textContent   = name;
        document.getElementById('userPid').textContent    = profile?.patient_id || '—';
        bar.style.display = 'flex';
    }

    // ── Auto-fill patient name ──
    const nameInput = document.getElementById('patientName');
    if (nameInput && profile?.full_name && !nameInput.value) {
        nameInput.value = profile.full_name;
    }

    // ── DOB → Age auto-calculate ──
    const dobInput = document.getElementById('patientDob');
    const ageInput = document.getElementById('age');
    if (dobInput) {
        const calcAge = (dob) => {
            const age = auth.calculateAge(dob);
            if (age !== null && ageInput) ageInput.value = age;
        };
        dobInput.addEventListener('change', () => calcAge(dobInput.value));
        if (profile?.date_of_birth) { dobInput.value = profile.date_of_birth; calcAge(profile.date_of_birth); }
    }

    // ── Drop Zone ──
    const dropZone   = document.getElementById('dropZone');
    const xrayInput  = document.getElementById('xrayImage');
    const imgPreview = document.getElementById('imagePreview');
    const dropPH     = document.getElementById('dropPlaceholder');
    const dropOvly   = document.getElementById('dropOverlay');

    let currentXrayBase64 = null;
    let currentXrayMeta   = { name: 'xray.jpg', type: 'image/jpeg' };

    ['dragenter','dragover','dragleave','drop'].forEach(e => dropZone.addEventListener(e, ev => { ev.preventDefault(); ev.stopPropagation(); }));
    ['dragenter','dragover'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.add('dragover')));
    ['dragleave','drop'].forEach(e => dropZone.addEventListener(e, () => dropZone.classList.remove('dragover')));
    dropZone.addEventListener('drop', e => { xrayInput.files = e.dataTransfer.files; handleFile(e.dataTransfer.files[0]); });
    xrayInput.addEventListener('change', function() { if (this.files?.[0]) handleFile(this.files[0]); });

    function handleFile(file) {
        if (!file.type.match('image.*')) { alert('Please upload an image file.'); return; }
        currentXrayMeta = { name: file.name, type: file.type };
        const reader = new FileReader();
        reader.onload = e => {
            currentXrayBase64 = e.target.result;
            imgPreview.src = e.target.result;
            imgPreview.classList.remove('hidden');
            dropPH.classList.add('hidden');
            if (dropOvly) dropOvly.classList.remove('hidden');
        };
        reader.readAsDataURL(file);
    }

    // ── Pre-risk strip ──
    const spo2El = document.getElementById('spo2');
    const preRisk = document.getElementById('preRiskStrip');
    const preText = document.getElementById('preRiskText');
    function checkPreRisk() {
        const msgs = [];
        if (spo2El?.value && parseInt(spo2El.value) < 94) msgs.push(`Low SpO2 (${spo2El.value}%)`);
        if (document.querySelector('input[name="haemoptysis"][value="yes"]')?.checked) msgs.push('Haemoptysis');
        const fd = document.getElementById('fever_days');
        if (fd?.value && parseInt(fd.value) >= 14) msgs.push('Prolonged Fever');
        if (preRisk) preRisk.style.display = msgs.length ? 'block' : 'none';
        if (preText) preText.textContent = msgs.join(', ');
    }
    spo2El?.addEventListener('input', checkPreRisk);
    document.getElementById('fever_days')?.addEventListener('input', checkPreRisk);
    document.querySelectorAll('input[name="haemoptysis"]').forEach(el => el.addEventListener('change', checkPreRisk));

    // ── Form Submit → Redirect to /scanning ──
    const form       = document.getElementById('diagnosisForm');
    const analyzeBtn = document.getElementById('analyzeBtn');

    form.addEventListener('submit', e => {
        e.preventDefault();
        if (!currentXrayBase64) { alert('Please upload an X-ray image first.'); return; }

        analyzeBtn.disabled = true;
        document.getElementById('btnText').textContent = 'Preparing…';

        // Collect all form values into a plain object
        const scanPayload = {
            xray_base64:  currentXrayBase64,
            xray_name:    currentXrayMeta.name,
            xray_type:    currentXrayMeta.type,
            patient_name: document.getElementById('patientName')?.value || '',
            age:          document.getElementById('age')?.value || '',
            patient_dob:  document.getElementById('patientDob')?.value || '',
            gender:       document.getElementById('patientGender')?.value || '',
            spo2:         document.getElementById('spo2')?.value || '',
            temperature:  document.getElementById('temperature')?.value || '',
            fever_days:   document.getElementById('fever_days')?.value || '',
            cough_days:   document.getElementById('cough_days')?.value || '',
            symptoms:     document.getElementById('symptoms')?.value || '',
            haemoptysis:  document.querySelector('input[name="haemoptysis"]:checked')?.value || 'no',
            bcg:          document.querySelector('input[name="bcg"]:checked')?.value || 'unknown',
            language:     document.querySelector('input[name="language"]:checked')?.value || 'en',
        };

        // Store in sessionStorage and redirect
        sessionStorage.setItem('rxScanData', JSON.stringify(scanPayload));
        window.location.href = '/scanning';
    });

    // ── Nav Tabs ──
    document.querySelectorAll('.nav-tab').forEach(tab => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            document.querySelectorAll('.tab-view').forEach(v => v.style.display = 'none');
            const tv = document.getElementById(tab.dataset.target);
            if (tv) tv.style.display = 'block'; // Block is better for map container than grid
            if (tab.dataset.target === 'historyView') loadHistory();
            if (tab.dataset.target === 'epiDashboardView') loadEpiDashboard();
        });
    });

    // ── Epi Dashboard (Map) ──
    let mapInitialized = false;
    let epiMap = null;
    async function loadEpiDashboard() {
        if (!mapInitialized) {
            // Clean Dark Map Tiles (ESRI Dark Gray Canvas - No API Key Required)
            epiMap = L.map('indiaMap').setView([22.5937, 78.9629], 5); // Center of India
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
                attribution: '&copy; Esri &mdash; Esri, DeLorme, NAVTEQ',
                maxZoom: 16
            }).addTo(epiMap);
            L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}', {
                maxZoom: 16
            }).addTo(epiMap);
            mapInitialized = true;
        } else {
            epiMap.invalidateSize(); // Fix gray tiles issue when unhidden
        }

        // Fetch all recent scans
        let data = [];
        try {
            if (window.RuralXAuth.supabase) {
                const res = await window.RuralXAuth.supabase.from('rx_scans')
                    .select('diagnosis, created_at, risk_level')
                    .order('created_at', { ascending: false })
                    .limit(100);
                if (!res.error && res.data) data = res.data;
            }
        } catch (e) {
            console.warn('Supabase epi load error:', e);
        }

        if (!data || data.length === 0) {
            const localScans = await auth.getPatientScans(100);
            data = localScans.map(s => ({
                diagnosis: s.diagnosis || 'Pneumonia',
                risk_level: s.risk_level || 'HIGH',
                created_at: s.created_at || s.timestamp || new Date().toISOString()
            }));
            // Provide sample demo hotspot points if no scans yet
            if (data.length === 0) {
                data = [
                    { diagnosis: 'Tuberculosis', risk_level: 'CRITICAL', created_at: new Date().toISOString() },
                    { diagnosis: 'Pneumonia', risk_level: 'HIGH', created_at: new Date().toISOString() },
                    { diagnosis: 'Tuberculosis', risk_level: 'HIGH', created_at: new Date().toISOString() },
                    { diagnosis: 'Pneumonia', risk_level: 'MEDIUM', created_at: new Date().toISOString() }
                ];
            }
        }

        if (data && data.length) {
            let tb = 0, pneu = 0;
            
            // Clear existing layers (except tile layer)
            epiMap.eachLayer((layer) => {
                if (layer instanceof L.CircleMarker) epiMap.removeLayer(layer);
            });

            data.forEach(scan => {
                const isTB = scan.diagnosis.toLowerCase().includes('tuberculosis');
                const isPneu = scan.diagnosis.toLowerCase().includes('pneumonia');
                
                if (isTB) tb++;
                if (isPneu) pneu++;

                if (isTB || isPneu) {
                    // Generate random coords around central/north India for demo hotspot simulation
                    // Latitude roughly 15.0 to 28.0, Longitude 73.0 to 85.0
                    const lat = 15.0 + Math.random() * 13.0;
                    const lng = 73.0 + Math.random() * 12.0;

                    const color = isTB ? '#EF4444' : '#F59E0B'; // Red for TB, Orange for Pneu
                    
                    L.circleMarker([lat, lng], {
                        radius: 8,
                        fillColor: color,
                        color: color,
                        weight: 1,
                        opacity: 0.8,
                        fillOpacity: 0.5
                    }).addTo(epiMap).bindPopup(`<b>Detected:</b> ${scan.diagnosis}<br><b>Risk:</b> ${scan.risk_level}`);
                }
            });

            document.getElementById('tbCount').textContent = tb;
            document.getElementById('pneuCount').textContent = pneu;
        }
    }

    // ── History ──
    async function loadHistory() {
        const scans = await auth.getPatientScans(50);
        const list  = document.getElementById('historyList');
        list.innerHTML = '';
        if (!scans?.length) {
            list.innerHTML = `
                <div class="empty-state" style="padding: 4rem; text-align: center; border: 1px dashed rgba(255,255,255,0.1); border-radius: 16px;">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: rgba(255,255,255,0.2); margin-bottom: 1rem;"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                    <p style="font-weight: 600; color: #94A3B8; margin-bottom: 0.25rem;">No Scans Found</p>
                    <span style="font-size: 0.85rem; color: #64748B;">Upload your first X-ray to start tracking your health.</span>
                </div>`; 
            return;
        }

        const ICONS = {
            IMPROVED: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>`,
            WORSENED: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>`,
            STABLE:   `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>`,
            BASELINE: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>`
        };

        scans.forEach(scan => {
            const el = document.createElement('div');
            const d = scan.health_delta;
            
            if (!d) {
                el.className = 'delta-card baseline';
                el.innerHTML = `
                    <div class="delta-head">${ICONS.BASELINE}<div><strong>${esc(scan.patient_name||'Patient')} \u2014 Initial Baseline Scan</strong><span class="delta-sub">${new Date(scan.created_at).toLocaleString()}</span></div></div>
                    <div class="delta-metrics" style="grid-template-columns: 1fr 1fr 1fr;">
                        <div class="dm-item"><span class="dm-label">Diagnosis</span><span class="dm-val" style="font-size:0.9rem;">${esc(scan.diagnosis||'—')}</span></div>
                        <div class="dm-item"><span class="dm-label">Risk Level</span><span class="dm-val" style="font-size:0.9rem;color:${riskColor(scan.risk_level)}">${scan.risk_level||'—'}</span></div>
                        <div class="dm-item"><span class="dm-label">Confidence</span><span class="dm-val" style="font-size:0.9rem;">${scan.confidence||'—'}%</span></div>
                    </div>`;
            } else {
                const cls = d.overall_trend === 'IMPROVED' ? 'improved' : d.overall_trend === 'WORSENED' ? 'worsened' : 'stable';
                const label = d.overall_trend === 'IMPROVED' ? 'Health Improved' : d.overall_trend === 'WORSENED' ? 'Health Declined' : 'Condition Stable';
                const icon = ICONS[d.overall_trend] || ICONS.STABLE;
                const arrow = (v) => v < 0 ? '\u2193' : v > 0 ? '\u2191' : '\u2192';
                const color = (v) => v < 0 ? '#10B981' : v > 0 ? '#EF4444' : '#94A3B8';

                el.className = `delta-card ${cls}`;
                el.innerHTML = `
                    <div class="delta-head">${icon}<div><strong>${esc(scan.patient_name||'Patient')} \u2014 ${label}</strong><span class="delta-sub">${new Date(scan.created_at).toLocaleString()} \u2022 ${d.days_since_last ? d.days_since_last + ' days since previous' : 'Compared to previous'}</span></div></div>
                    <div class="delta-metrics">
                        <div class="dm-item">
                            <span class="dm-label">TB Prob.</span>
                            <span class="dm-val" style="color:${color(d.tb_change)}">${arrow(d.tb_change)} ${Math.abs(d.tb_change).toFixed(1)}%</span>
                        </div>
                        <div class="dm-item">
                            <span class="dm-label">Pneumonia</span>
                            <span class="dm-val" style="color:${color(d.pneumonia_change)}">${arrow(d.pneumonia_change)} ${Math.abs(d.pneumonia_change).toFixed(1)}%</span>
                        </div>
                        <div class="dm-item">
                            <span class="dm-label">Risk Level</span>
                            <span class="dm-val" style="font-size:0.85rem;color:${color(d.risk_change)}">${d.curr_risk || '\u2014'}</span>
                        </div>
                        <div class="dm-item">
                            <span class="dm-label">Diagnosis</span>
                            <span class="dm-val" style="font-size:0.85rem;">${esc(d.curr_diagnosis || '\u2014')}</span>
                        </div>
                    </div>`;
            }
            list.appendChild(el);
        });
    }

    function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    function riskColor(l) { return {CRITICAL:'#EF4444',HIGH:'#F97316',MEDIUM:'#F59E0B',LOW:'#10B981',ROUTINE:'#06B6D4'}[l]||'#94A3B8'; }

    loadHistory();
});

window.promptGeminiKey = function() {
    const curr = localStorage.getItem('gemini_api_key') || '';
    const val = prompt('Enter your Google AI Studio API Key (from https://aistudio.google.com/app/apikey):\nLeave blank to clear.', curr);
    if (val !== null) {
        if (val.trim()) {
            localStorage.setItem('gemini_api_key', val.trim());
            alert('Google AI Studio API Key saved successfully!\nIt will now be used for multimodal chest X-Ray second opinions.');
        } else {
            localStorage.removeItem('gemini_api_key');
            alert('Google AI Studio API Key cleared.');
        }
    }
};

