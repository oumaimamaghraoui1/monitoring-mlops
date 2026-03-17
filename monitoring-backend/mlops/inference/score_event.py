import joblib
import sys
import json
import pandas as pd
import numpy as np
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent.parent

MODEL = joblib.load(ROOT / "mlops/models/anomaly/isolation_forest.joblib")
SCALER = joblib.load(ROOT / "mlops/models/anomaly/scaler.joblib")

try:

    # ✅ READ FROM STDIN INSTEAD OF ARGV
    raw = sys.stdin.read()
    log = json.loads(raw)

    df = pd.DataFrame([log])

    required = [
        "hour",
        "day",
        "weekend",
        "actor_count_7d",
        "actor_object_7d",
        "time_since_last_actor",
        "first_time_role"
    ]

    for col in required:
        if col not in df:
            df[col] = 0

    X = df[required].astype(np.float64)

    X_scaled = SCALER.transform(X)

    score = MODEL.decision_function(X_scaled)[0]
    pred  = MODEL.predict(X_scaled)[0]

    print(json.dumps({
        "score": float(score),
        "anomaly": int(pred == -1)
    }), flush=True)

except Exception as e:

    print(json.dumps({
        "score": 0,
        "anomaly": 0,
        "error": str(e)
    }), flush=True)