from flask import Flask, request, jsonify, send_from_directory
import os
import io
import base64
import json
from PIL import Image
import datetime
import uuid
import shelve
from dotenv import load_dotenv

load_dotenv()

HISTORY_DB = 'scan_history.db'

from src.ruralx_pipeline import (
    RuralXModelSystem,
    ImageEnhancementPipeline,
    MultilingualReportGen,
    build_structured_output,
)
from src.gemini_service import GeminiMedicalService


app = Flask(__name__, static_folder='static', template_folder='templates')

# ── Supabase (server-side, optional – for future server auth verification) ──
try:
    from supabase import create_client, Client
    _supabase_url = os.environ.get("SUPABASE_URL", "")
    _supabase_key = os.environ.get("SUPABASE_KEY", "")
    supabase_client: Client = create_client(_supabase_url, _supabase_key) if _supabase_url else None
    if supabase_client:
        print("[OK] Supabase client initialized.")
except Exception as e:
    supabase_client = None
    print(f"[WARN] Supabase client not available: {e}")

# ── Global ML system initialisation ──
print("Initializing RuralX AI System (v2 – Enhanced)...")
system = RuralXModelSystem()
print("System Initialized.")


# ──────────────────────────────────────────────────────────────
# Frontend Routes
# ──────────────────────────────────────────────────────────────

@app.route('/sw.js')
def service_worker():
    """Serve Service Worker from root for full scope"""
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')

@app.route('/manifest.json')
def manifest():
    """Serve Web App Manifest from root"""
    return send_from_directory('static', 'manifest.json', mimetype='application/manifest+json')

@app.route('/')
def landing():
    """Animated landing page"""
    return send_from_directory('templates', 'landing.html')

@app.route('/auth')
def auth():
    """Sign in / Sign up page"""
    return send_from_directory('templates', 'auth.html')

@app.route('/app')
def index():
    """Main diagnosis application (requires client-side auth)"""
    return send_from_directory('templates', 'index.html')

@app.route('/scanning')
def scanning():
    """Scanning animation + results page"""
    return send_from_directory('templates', 'scanning.html')


# ──────────────────────────────────────────────────────────────
# History API (local shelve fallback)
# ──────────────────────────────────────────────────────────────

@app.route('/api/history', methods=['GET'])
def get_history():
    try:
        with shelve.open(HISTORY_DB) as db:
            sessions = []
            for key in sorted(db.keys(), reverse=True)[:50]:
                sessions.append(db[key])
        return jsonify({"success": True, "sessions": sessions})
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route('/api/history/<session_id>', methods=['GET'])
def get_session(session_id):
    try:
        with shelve.open(HISTORY_DB) as db:
            if session_id in db:
                return jsonify({"success": True, "session": db[session_id]})
        return jsonify({"success": False, "error": "Session not found"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Core Prediction Endpoint
# ──────────────────────────────────────────────────────────────

@app.route('/api/predict', methods=['POST'])
def predict():
    if 'image' not in request.files:
        return jsonify({"success": False, "error": "No image provided"}), 400

    file             = request.files['image']
    language         = request.form.get('language', 'en')
    patient_age      = request.form.get('age', '')
    patient_symptoms = request.form.get('symptoms', '')
    patient_spo2     = request.form.get('spo2', '')
    haemoptysis      = request.form.get('haemoptysis', 'no') == 'yes'
    fever_days       = request.form.get('fever_days', '')

    image_bytes = file.read()

    # 1. Quality Assessment & Enhancement Pipeline
    use_esrgan = request.form.get('use_esrgan', 'false').lower() == 'true'
    is_valid, processed_image_bytes, qa_report = ImageEnhancementPipeline.process_image(image_bytes, use_esrgan=use_esrgan)

    if not is_valid:
        return jsonify({
            "success": False,
            "error": f"Image Rejected: {qa_report.get('Status')} (Score: {qa_report.get('NewBlurScore', qa_report.get('BlurScore'))})",
            "qa_report": qa_report
        }), 400

    # 2. Prediction (with uncertainty)
    try:
        patient_name = request.form.get('patient_name', 'Unknown')
        image_pil = Image.open(io.BytesIO(processed_image_bytes)).convert('RGB')
        results   = system.predict(
            image_pil,
            patient_name=patient_name,
            patient_age=patient_age,
            patient_spo2=patient_spo2,
            haemoptysis=haemoptysis,
            fever_days=fever_days
        )
    except Exception as e:
        return jsonify({"success": False, "error": f"Model error: {str(e)}"}), 500

    # 3. Multilingual Report
    report = MultilingualReportGen.generate_report(
        language=language,
        diagnosis=results['diagnosis'],
        confidence=results['confidence'],
        uncertainty=results['uncertainty_pct'],
        risk_level=results['risk_level'],
        recommendation=results['recommendation'],
        radiological_findings=results['radiological_findings'],
        tb_prob=results['tb_prob'],
        pneumonia_prob=results['pneumonia_prob'],
        referral_hours=results.get('referral_hours'),
    )

    # 4. Structured Output
    structured = build_structured_output(
        patient_info={"age": patient_age, "spo2": patient_spo2, "symptoms": patient_symptoms},
        prediction=results,
    )

    # 5. Heatmap encoding
    heatmap_b64      = base64.b64encode(results['heatmap_bytes']).decode('utf-8')
    heatmap_data_url = f"data:image/jpeg;base64,{heatmap_b64}"

    session_id = str(uuid.uuid4())[:8]

    # 6. Save to local shelve (offline fallback)
    try:
        with shelve.open(HISTORY_DB) as db:
            db[session_id] = {
                "session_id":    session_id,
                "timestamp":     datetime.datetime.utcnow().isoformat() + "Z",
                "patient_name":  request.form.get('patient_name', 'Unknown'),
                "patient_age":   patient_age,
                "diagnosis":     results['diagnosis'],
                "confidence":    f"{results['confidence']:.1f}",
                "risk_level":    results['risk_level'],
                "tb_prob":       f"{results['tb_prob']:.4f}",
                "pneumonia_prob":f"{results['pneumonia_prob']:.4f}",
                "language":      language,
            }
    except Exception:
        pass

    return jsonify({
        "success":    True,
        "session_id": session_id,
        "results": {
            "diagnosis":             results['diagnosis'],
            "confidence":            f"{results['confidence']:.1f}",
            "uncertainty_pct":       f"{results['uncertainty_pct']:.1f}",
            "risk_level":            results['risk_level'],
            "tb_prob":               f"{results['tb_prob']:.4f}",
            "pneumonia_prob":        f"{results['pneumonia_prob']:.4f}",
            "cardiomegaly_prob":     f"{results.get('cardiomegaly_prob', 0):.4f}",
            "ctr_value":             results.get('ctr_value', 'N/A'),
            "referral_hours":        results.get('referral_hours'),
            "radiological_findings": results['radiological_findings'],
            "risk_color":            _risk_color(results['risk_level']),
        },
        "report":     report,
        "structured": structured,
        "heatmap":    heatmap_data_url,
        "qa_message": f"Status: {qa_report.get('Status')} | Blur Score: {qa_report.get('NewBlurScore', qa_report.get('BlurScore'))}",
    })


# ──────────────────────────────────────────────────────────────
# Google AI Studio (Gemini) Endpoints
# ──────────────────────────────────────────────────────────────

@app.route('/api/gemini/status', methods=['GET', 'POST'])
def gemini_status():
    api_key = request.headers.get('X-Gemini-Key') or request.args.get('api_key') or os.environ.get('GEMINI_API_KEY')
    return jsonify({
        "available": GeminiMedicalService.is_configured(api_key),
        "has_env_key": bool(os.environ.get('GEMINI_API_KEY') or os.environ.get('GOOGLE_API_KEY'))
    })


@app.route('/api/gemini/analyze', methods=['POST'])
def gemini_analyze():
    try:
        api_key = request.headers.get('X-Gemini-Key') or request.form.get('api_key') or os.environ.get('GEMINI_API_KEY')
        
        # Get image bytes
        image_bytes = None
        if 'image' in request.files:
            image_bytes = request.files['image'].read()
        elif request.is_json and 'image_b64' in request.json:
            b64_str = request.json['image_b64']
            if ',' in b64_str:
                b64_str = b64_str.split(',', 1)[1]
            image_bytes = base64.b64decode(b64_str)
        elif 'image_b64' in request.form:
            b64_str = request.form['image_b64']
            if ',' in b64_str:
                b64_str = b64_str.split(',', 1)[1]
            image_bytes = base64.b64decode(b64_str)

        if not image_bytes:
            return jsonify({"success": False, "error": "No chest X-Ray image provided for Gemini analysis."}), 400

        # Patient info
        is_json = request.is_json
        body_json = request.get_json(silent=True) or {}
        
        patient_info = {
            "name": request.form.get('patient_name') or body_json.get('patient_name', 'Patient'),
            "age": request.form.get('age') or body_json.get('age', ''),
            "spo2": request.form.get('spo2') or body_json.get('spo2', ''),
            "symptoms": request.form.get('symptoms') or body_json.get('symptoms', ''),
            "haemoptysis": (request.form.get('haemoptysis') == 'yes') or (body_json.get('haemoptysis') is True),
            "fever_days": request.form.get('fever_days') or body_json.get('fever_days', ''),
        }

        # Local model prediction
        local_prediction = {}
        if request.form.get('local_prediction'):
            try:
                local_prediction = json.loads(request.form.get('local_prediction'))
            except Exception:
                pass
        elif body_json.get('local_prediction'):
            local_prediction = body_json.get('local_prediction')

        analysis = GeminiMedicalService.generate_radiological_analysis(
            image_bytes=image_bytes,
            patient_info=patient_info,
            local_prediction=local_prediction,
            api_key=api_key
        )
        return jsonify(analysis)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


@app.route('/api/gemini/chat', methods=['POST'])
def gemini_chat():
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_message = data.get('message', '')
        chat_history = data.get('history', [])
        patient_context = data.get('patient_context', {})
        api_key = request.headers.get('X-Gemini-Key') or data.get('api_key') or os.environ.get('GEMINI_API_KEY')

        if not user_message:
            return jsonify({"success": False, "error": "No question or query provided."}), 400

        res = GeminiMedicalService.chat_followup(
            user_message=user_message,
            chat_history=chat_history,
            patient_context=patient_context,
            api_key=api_key
        )
        return jsonify(res)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


# ──────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────


def _risk_color(risk_level: str) -> str:
    colors = {
        "CRITICAL": "#EF4444",
        "HIGH":     "#F97316",
        "MEDIUM":   "#F59E0B",
        "LOW":      "#10B981",
        "ROUTINE":  "#06B6D4",
    }
    return colors.get(risk_level, "#94A3B8")


# ──────────────────────────────────────────────────────────────
# Entry Point
# ──────────────────────────────────────────────────────────────

if __name__ == '__main__':
    os.makedirs('static', exist_ok=True)
    os.makedirs('templates', exist_ok=True)
    app.run(host='0.0.0.0', port=5000, debug=True, use_reloader=False)
