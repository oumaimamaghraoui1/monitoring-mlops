import sys
import json
import joblib
import numpy as np
import os

BASE = os.path.dirname(os.path.abspath(__file__))

model = joblib.load(os.path.join(BASE,"../models/rca_model.pkl"))
encoder = joblib.load(os.path.join(BASE,"../models/rca_label_encoder.pkl"))

ACTIONS = {
    "CPU_SATURATION": "Scale backend instance",
    "MEMORY_PRESSURE": "Investigate memory leak",
    "BLOCKING_IO": "Check blocking synchronous calls",
    "DEPENDENCY_LATENCY": "Inspect upstream API latency"
}

data = json.loads(sys.argv[1])

cpu = data["cpu"]
latency = data["latency"]
heap = data.get("heapGrowth",0)
gc = data["gc"]
lag = data["lag"]

# ✅ HEURISTIC OVERRIDE FIRST
if latency > 1500 and cpu < 60:
    result = {
        "cause": "DEPENDENCY_LATENCY",
        "recommendation": ACTIONS["DEPENDENCY_LATENCY"]
    }
    print(json.dumps(result))
    sys.exit(0)

# ✅ OTHERWISE USE ML
X = np.array([[cpu, latency, heap, gc, lag]])

proba = model.predict_proba(X)[0]
confidence = max(proba)

pred = model.predict(X)[0]
cause = encoder.inverse_transform([pred])[0]

# ✅ CONFIDENCE GATE
if confidence < 0.4:
    cause = "UNKNOWN"

result = {
    "cause": cause,
    "recommendation": ACTIONS.get(cause,"Investigate logs")
}

print(json.dumps(result))