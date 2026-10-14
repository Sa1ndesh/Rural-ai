"""
RuralX AI - Google AI Studio (Gemini) Integration Module
Provides Multimodal Chest X-Ray Second Opinions and Interactive AI Radiologist Assistance
Directly communicating with the Google AI Studio (Gemini) API via HTTP REST.
Zero external package dependencies required (uses standard library urllib & json).
"""

import os
import io
import json
import base64
import urllib.request
import urllib.error
import ssl
from typing import Dict, Any, Optional, List


class GeminiMedicalService:
    # Google AI Studio model endpoints (ordered by preference)
    MODELS = [
        "gemini-2.5-flash",
        "gemini-1.5-flash",
        "gemini-1.5-flash-8b",
        "gemini-1.5-pro",
    ]

    BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"

    @staticmethod
    def get_api_key(passed_key: Optional[str] = None) -> Optional[str]:
        """Resolve API key from passed argument, .env, or system environment."""
        if passed_key and passed_key.strip():
            return passed_key.strip()
        return os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or ""

    @classmethod
    def is_configured(cls, passed_key: Optional[str] = None) -> bool:
        key = cls.get_api_key(passed_key)
        return bool(key and len(key) >= 10)

    @classmethod
    def _call_gemini_api(cls, payload: dict, api_key: str, preferred_model: Optional[str] = None) -> Dict[str, Any]:
        """Makes an HTTP POST request to Google AI Studio REST API."""
        candidate_models = [preferred_model] if preferred_model else cls.MODELS
        
        ctx = ssl.create_default_context()
        data_bytes = json.dumps(payload).encode('utf-8')
        last_error = ""

        for model in candidate_models:
            if not model:
                continue
            url = cls.BASE_URL.format(model=model, key=api_key)
            req = urllib.request.Request(
                url,
                data=data_bytes,
                headers={"Content-Type": "application/json"}
            )
            try:
                with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
                    resp_data = json.loads(resp.read().decode('utf-8'))
                    
                    # Extract generated text from Gemini response structure
                    candidates = resp_data.get("candidates", [])
                    if candidates:
                        content = candidates[0].get("content", {})
                        parts = content.get("parts", [])
                        if parts:
                            text = parts[0].get("text", "")
                            return {
                                "success": True,
                                "text": text,
                                "model_used": model,
                                "finish_reason": candidates[0].get("finishReason", "STOP")
                            }
                    last_error = "No content returned in candidate parts"
            except urllib.error.HTTPError as he:
                err_body = he.read().decode('utf-8', errors='ignore')
                last_error = f"HTTP {he.code}: {err_body}"
            except Exception as e:
                last_error = str(e)

        return {"success": False, "error": last_error}

    @classmethod
    def generate_radiological_analysis(
        cls,
        image_bytes: bytes,
        patient_info: Dict[str, Any],
        local_prediction: Dict[str, Any],
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Multimodal analysis: passes the raw X-ray along with patient telemetry
        and trained DenseNet-121 predictions to Google AI Studio Gemini.
        """
        key = cls.get_api_key(api_key)
        if not key:
            return {
                "success": False,
                "error": "Google AI Studio API Key not found. Please provide an API key in settings or set GEMINI_API_KEY."
            }

        try:
            # Encode image as base64
            img_b64 = base64.b64encode(image_bytes).decode('utf-8')
            
            # Format clinical telemetry
            name = patient_info.get("name") or patient_info.get("patient_name") or "Patient"
            age = patient_info.get("age", "Unknown")
            spo2 = patient_info.get("spo2", "Not recorded")
            symptoms = patient_info.get("symptoms", "Not specified")
            haemoptysis = "Yes" if patient_info.get("haemoptysis") else "No"
            fever_days = patient_info.get("fever_days", "Not recorded")

            pred_diag = local_prediction.get("diagnosis", "Inconclusive")
            pred_conf = local_prediction.get("confidence", 0.0)
            tb_prob = float(local_prediction.get("tb_prob", 0.0)) * 100
            pn_prob = float(local_prediction.get("pneumonia_prob", 0.0)) * 100
            findings = local_prediction.get("radiological_findings", {})
            findings_str = ", ".join([f"{k}: {v}" for k, v in findings.items()]) if findings else "None"

            prompt_text = f"""
You are an expert Chief Thoracic Radiologist and Senior Pulmonologist advising a frontline health worker in a rural or remote primary care center.
Attached is the patient's digital chest radiograph (CXR) and preliminary on-device edge AI (DenseNet-121) screening results.

### PATIENT VITALS & CLINICAL HISTORY:
- Patient: {name} | Age: {age} | SpO2: {spo2}%
- Reported Symptoms: {symptoms}
- Haemoptysis (Coughing blood): {haemoptysis}
- Fever Duration: {fever_days} days

### EDGE AI PRELIMINARY SCREENING (DenseNet-121):
- Primary Indication: {pred_diag} (Confidence: {pred_conf}%)
- TB Probability: {tb_prob:.1f}%
- Pneumonia Probability: {pn_prob:.1f}%
- Detected Biomarkers: {findings_str}

### INSTRUCTIONS FOR YOUR REPORT:
Generate a thorough, clear, structured medical second opinion in Markdown formatted with the following exact sections:

## 1. Executive Diagnostic Impression
- Concise summary statement correlating the radiographic findings with the patient's oxygen saturation and clinical history.

## 2. Systematic Radiographic Analysis
- **Lungs & Airspace**: Detailed evaluation of both upper, middle, and lower lobes (consolidation, patchy opacities, cavitation, fibrotic bands, or air bronchograms).
- **Pleural Spaces & Angles**: Costophrenic and cardiophrenic angles (blunting, effusion, thickening).
- **Cardiothoracic Silhouette**: Heart size, mediastinal contour, and vascularity.

## 3. Differential Diagnosis & Risk Triage
- Discussion on Tuberculosis vs. Bacterial / Viral Pneumonia vs. Normal baseline.
- Assigned Clinical Risk Level (CRITICAL / HIGH / MEDIUM / LOW).

## 4. Rural Clinical Action Plan
- **Immediate Bedside Actions**: Oxygen titration, position, vitals monitoring.
- **Diagnostic Confirmation**: Sputum smear microscopy, GeneXpert MTB/RIF recommendation, CBC.
- **Empirical Regimen & Precautions**: Isolation / mask protocol if infectious, empirical antibiotic/antitubercular referral pathways.
- **Urgent Transfer Threshold**: Timeframe (e.g. within 2–6 hours) to refer to a district hospital if warning signs occur.

Be clear, professional, rigorous, and supportive of rural field practitioners.
"""

            payload = {
                "contents": [
                    {
                        "parts": [
                            {"text": prompt_text},
                            {
                                "inline_data": {
                                    "mime_type": "image/jpeg",
                                    "data": img_b64
                                }
                            }
                        ]
                    }
                ],
                "generationConfig": {
                    "temperature": 0.2,
                    "topP": 0.85,
                    "maxOutputTokens": 2048
                }
            }

            result = cls._call_gemini_api(payload, key)
            if result.get("success"):
                return {
                    "success": True,
                    "model_used": result.get("model_used"),
                    "report_markdown": result.get("text"),
                    "provider": "Google AI Studio"
                }
            else:
                return {
                    "success": False,
                    "error": result.get("error", "Failed to get response from Google AI Studio")
                }

        except Exception as e:
            return {"success": False, "error": str(e)}

    @classmethod
    def chat_followup(
        cls,
        user_message: str,
        chat_history: List[Dict[str, str]],
        patient_context: Dict[str, Any],
        api_key: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Interactive Q&A regarding the current patient's scan and management plan.
        """
        key = cls.get_api_key(api_key)
        if not key:
            return {"success": False, "error": "Google AI Studio API Key is missing."}

        try:
            name = patient_context.get('name') or patient_context.get('patient_name') or 'Patient'
            age = patient_context.get('age', 'N/A')
            spo2 = patient_context.get('spo2', 'N/A')
            diagnosis = patient_context.get('diagnosis', 'N/A')
            risk = patient_context.get('risk_level', 'N/A')
            symptoms = patient_context.get('symptoms', 'None reported')

            system_prompt = (
                f"You are the RuralX AI Senior Medical Advisor powered by Google AI Studio (Gemini). "
                f"You are assisting a healthcare worker managing this patient in a rural setting:\n"
                f"- Name/ID: {name}, Age: {age}, SpO2: {spo2}%\n"
                f"- Diagnosis: {diagnosis} (Risk: {risk})\n"
                f"- Symptoms: {symptoms}\n\n"
                f"Answer the user's clinical question directly, concisely, and practically for rural healthcare delivery. "
                f"Format your answer with clean markdown."
            )

            # Build Gemini contents array
            contents = [
                {"role": "user", "parts": [{"text": system_prompt}]},
                {"role": "model", "parts": [{"text": "Understood. I am ready to advise on this clinical case. What questions do you have?"}]}
            ]

            for msg in chat_history[-6:]:
                role = "user" if msg.get("role") == "user" else "model"
                contents.append({
                    "role": role,
                    "parts": [{"text": msg.get("content", "")}]
                })

            contents.append({
                "role": "user",
                "parts": [{"text": user_message}]
            })

            payload = {
                "contents": contents,
                "generationConfig": {
                    "temperature": 0.3,
                    "topP": 0.85,
                    "maxOutputTokens": 1024
                }
            }

            result = cls._call_gemini_api(payload, key)
            if result.get("success"):
                return {
                    "success": True,
                    "reply": result.get("text"),
                    "model_used": result.get("model_used")
                }
            else:
                return {
                    "success": False,
                    "error": result.get("error", "No response from Gemini")
                }

        except Exception as e:
            return {"success": False, "error": str(e)}
