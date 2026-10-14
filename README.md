<div align="center">

# 🏥 RuralX-AI

### Offline-Capable AI Diagnostic System for Rural Healthcare

[![PyTorch](https://img.shields.io/badge/PyTorch-2.3-EE4C2C?style=for-the-badge&logo=pytorch&logoColor=white)](https://pytorch.org)
[![Flask](https://img.shields.io/badge/Flask-3.0-000000?style=for-the-badge&logo=flask&logoColor=white)](https://flask.palletsprojects.com)
[![Python](https://img.shields.io/badge/Python-3.8+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

<br/>

**AI-powered chest X-ray analysis with Grad-CAM explainability, risk-based triage, and multilingual diagnostic reports — designed for deployment in low-resource, offline environments.**

[Features](#-key-features) · [How It Works](#-how-it-works) · [Setup](#-setup) · [Architecture](#-architecture)

---

</div>

## 🎯 Problem Statement

Rural India faces a critical shortage of radiologists — one for every 100,000+ people. Chest conditions like pneumonia and tuberculosis go undiagnosed until they become life-threatening. RuralX-AI bridges this gap with:

- **AI-powered X-ray analysis** that runs on low-cost hardware
- **Explainable results** (Grad-CAM heatmaps) that clinicians can trust
- **Multilingual reports** for local healthcare workers
- **Offline capability** for areas with unreliable internet

---

## ✨ Key Features

| Feature | Description |
|---------|-------------|
| 🧠 **Multimodal AI** | Combines chest X-ray images + clinical data (age, symptoms, SpO2) |
| 🔥 **Grad-CAM XAI** | Heatmaps pinpointing exact areas of concern on X-rays |
| 📋 **Image Quality Check** | Pre-screens for blur, under-exposure, poor quality before analysis |
| 🚦 **Risk Triage** | Categorizes patients: Low → Moderate → High → Critical |
| 🌐 **Multilingual Reports** | Auto-translates findings to Hindi, Kannada, and more |
| 🖥️ **Web Interface** | Browser-based dashboard for screening and results |
| 📡 **Offline-Capable** | Architecture optimized for edge deployment (quantization in progress) |
| 🔐 **Auth System** | Supabase-backed user authentication |
| 📱 **PWA Support** | Service worker + manifest for installable web app |

---

## 🧠 How It Works

```
X-Ray Upload → Quality Assessment (blur, exposure, artifact check)
                    │
                    ├── Poor quality → Reject with reason
                    │
                    └── Acceptable → AI Analysis Pipeline
                                        │
                                        ├── Deep Learning Model (ResNet/DenseNet)
                                        ├── Clinical Data Fusion (age, SpO2, symptoms)
                                        ├── Grad-CAM Heatmap Generation
                                        └── Risk Scoring & Triage Level
                                                │
                                                └── Multilingual Report Generation
                                                        ├── English
                                                        ├── Hindi
                                                        └── Kannada
```

---

## 🛠 Tech Stack

| Layer | Technology |
|-------|-----------|
| AI Framework | PyTorch 2.3 + TorchVision |
| Web Server | Flask 3.0 + Gunicorn |
| Image Processing | OpenCV + Pillow |
| Explainability | Grad-CAM (custom implementation) |
| Frontend | HTML/CSS/JS (PWA-ready) |
| Auth & Storage | Supabase |
| Deployment | Docker + Railway/Render |
| Quantization | TorchScript (planned for edge) |

---

## 🏗️ Architecture

```
├── app.py                    # Flask web server + routes
├── main.py                   # CLI entry point
├── train_model.py            # Model training pipeline
├── model_classes.json        # Disease classification labels
├── src/
│   └── ruralx_pipeline.py   # Core AI inference pipeline
├── srcp/
│   ├── exception.py          # Custom exception handling
│   └── logger.py             # Structured logging
├── config/
│   └── schema.yaml           # Data schema configuration
├── static/
│   ├── style.css             # Main styling
│   ├── scanning.css/js       # Scanning animation UI
│   ├── auth.css              # Auth page styling
│   ├── landing.css/js        # Landing page
│   ├── supabase-client.js    # Frontend Supabase SDK
│   ├── sw.js                 # Service Worker (offline)
│   └── manifest.json         # PWA manifest
├── templates/
│   ├── index.html            # Main diagnostic interface
│   ├── scanning.html         # Analysis progress UI
│   ├── landing.html          # Public landing page
│   └── auth.html             # Login/signup
├── reports/                   # Generated diagnostic reports
├── supabase_migration.sql    # Database schema
├── Dockerfile                 # Container deployment
├── requirements.txt           # Python dependencies
└── setup.py                   # Package setup
```

---

## 🚀 Setup

### Prerequisites
- Python 3.8+
- PyTorch 2.3+
- (Optional) NVIDIA GPU for faster inference

### Installation

```bash
git clone https://github.com/mudassiralladatkhan/RuralX-AI.git
cd RuralX-AI

# Create virtual environment
python -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Run the web server
python app.py
```

Navigate to `http://localhost:5000`

### Docker

```bash
docker build -t ruralx-ai .
docker run -p 5000:5000 ruralx-ai
```

---

## 📊 Disease Classes

The model classifies chest X-rays across multiple pathologies:
- Pneumonia (bacterial & viral)
- Tuberculosis
- Normal (healthy)
- Additional classes defined in `model_classes.json`

---

## 🎯 Design Principles

| Principle | Implementation |
|-----------|---------------|
| **Low-cost** | Runs on Raspberry Pi class hardware (with quantized model) |
| **Explainable** | Every diagnosis shows WHERE and WHY via Grad-CAM |
| **Accessible** | Multilingual output for non-English healthcare workers |
| **Trustworthy** | Image quality gating prevents false diagnoses from bad inputs |
| **Offline-first** | PWA + local inference = no internet dependency |

---

## 🌍 Impact Potential

- 🏥 Target: **Primary Health Centers** in rural India (150,000+ facilities)
- 👥 Serves: **500M+** rural population with limited radiology access
- ⏱️ Speed: **<30 seconds** from X-ray upload to complete report
- 💰 Cost: **<$1** per screening (vs $15-50 for urban radiology)

---

<div align="center">

**Built with 🏥 by [Mudassir Alladatkhan](https://github.com/mudassiralladatkhan)**

*Bringing AI diagnostics to every village health center.*

</div>
