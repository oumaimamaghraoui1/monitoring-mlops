# ==============================================
# RCA INFERENCE SCRIPT (CI-SAFE)
# ==============================================

import sys
import json
import joblib
import numpy as np
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]

MODEL_PATH = BASE_DIR / "models" / "rca_model.pkl"
ENCODER_PATH = BASE_DIR / "models" / "rca_label_encoder.pkl"

model = joblib.load(MODEL_PATH)
encoder = joblib.load(ENCODER_PATH)

ACTIONS = {
    "CPU_SATURATION": "Scale backend instance",
    "MEMORY_PRESSURE": "Investigate memory leak",
    "BLOCKING_IO": "Check blocking synchronous calls",
    "DEPENDENCY_LATENCY": "Inspect upstream API latency",
    "UNKNOWN": "Investigate logs"
}

# ============================
# HANDLE CI TEST MODE
# ============================

if os.getenv("CI") and len(sys.argv) < 2:

    print("✅ CI inference test — generating synthetic input")

    data = {
        "cpu": 50,
        "latency": 200,
        "heapGrowth": 10,
        "gc": 5,
        "lag": 3
    }

else:
    data = json.loads(sys.argv[1])

# ============================
# EXTRACT FEATURES
# ============================

cpu = data.get("cpu", 0)
latency = data.get("latency", 0)
heap = data.get("heapGrowth", 0)
gc = data.get("gc", 0)
lag = data.get("lag", 0)

# ============================
# HEURISTIC OVERRIDE
# ============================

if latency > 1500 and cpu < 60:

    result = {
        "cause": "DEPENDENCY_LATENCY",
        "recommendation": ACTIONS["DEPENDENCY_LATENCY"]
    }

    print(json.dumps(result))
    sys.exit(0)

# ============================
# ML PREDICTION
# ============================

X = np.array([[cpu, latency, heap, gc, lag]])

proba = model.predict_proba(X)[0]
confidence = max(proba)

pred = model.predict(X)[0]
cause = encoder.inverse_transform([pred])[0]

# ============================
# CONFIDENCE GATE
# ============================

if confidence < 0.4:
    cause = "UNKNOWN"

result = {
    "cause": cause,
    "recommendation": ACTIONS.get(cause, "Investigate logs")
}

print(json.dumps(result))