import joblib
import sys
import json
import pandas as pd
import numpy as np
from pathlib import Path

# ==========================================
# ROOT PATH
# ==========================================

ROOT = Path(__file__).resolve().parent.parent.parent

MODEL  = joblib.load(ROOT / "mlops/models/anomaly/isolation_forest.joblib")
SCALER = joblib.load(ROOT / "mlops/models/anomaly/scaler.joblib")

# ==========================================
# REQUIRED FEATURES
# ==========================================

required = [
    "hour",
    "day",
    "weekend",
    "actor_count_7d",
    "actor_object_7d",
    "time_since_last_actor",
    "first_time_role"
]

# ==========================================
# SCORING FUNCTION
# ==========================================

def score_dataframe(df):

    for col in required:
        if col not in df.columns:
            df[col] = 0

    X = (
        df[required]
        .apply(pd.to_numeric, errors="coerce")
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0)
    )

    X_scaled = SCALER.transform(X)

    df["anomalyScore"] = MODEL.decision_function(X_scaled)
    df["anomaly"]      = MODEL.predict(X_scaled)

    return df

# ==========================================
# INPUT MODE SWITCH
# ==========================================

raw = sys.stdin.read() if not sys.stdin.isatty() else ""

# ==========================================
# ✅ REAL‑TIME EVENT MODE
# ==========================================

if raw.strip():

    log = json.loads(raw)
    df  = pd.DataFrame([log])

    df = score_dataframe(df)

    print(json.dumps({
        "score": float(df["anomalyScore"].iloc[0]),
        "anomaly": int(df["anomaly"].iloc[0] == -1)
    }), flush=True)

# ==========================================
# ✅ BATCH SNAPSHOT MODE
# ==========================================

else:

    FEATURES  = ROOT / "mlops/data/features/ml_features.parquet"
    RAW_LOGS  = ROOT / "data/all_config_logs.json"
    OUTPUT    = ROOT / "data/scored_snapshot.json"

    # Behavioural features
    df_feat = pd.read_parquet(FEATURES)

    # Raw audit logs (✅ already migrated)
    with open(RAW_LOGS) as f:
        raw_logs = json.load(f)

    df_raw = pd.DataFrame(raw_logs)

    # Score behaviour
    df_scored = score_dataframe(df_feat)

    # ✅ MERGE RAW AUDIT CONTEXT (CRUD FIX)
    df_final = df_scored.merge(
        df_raw[
            [
                "uuid",
                "action",        # ✅ CRUD
                "objectType",
                "details",
                "actor",
                "target",
                "isHuman",
                "time"
            ]
        ],
        on="uuid",
        how="left",
        suffixes=("", "_raw")
    )

    # ✅ Preserve behavioural timeline
    if "time_raw" in df_final.columns:
        df_final["time"] = df_final["time"].fillna(df_final["time_raw"])
        df_final = df_final.drop(columns=["time_raw"])

    # ✅ Safety defaults (avoid nulls in UI)
    df_final["action"] = df_final["action"].fillna("OTHER")
    df_final["objectType"] = df_final["objectType"].fillna("Configuration Change")
    df_final["target"] = df_final["target"].fillna("Unknown")
    df_final["isHuman"] = df_final["isHuman"].fillna(False)

    df_final["anomalyScore"] = df_final["anomalyScore"].fillna(0)
    df_final["anomaly"]      = df_final["anomaly"].fillna(1)

    df_final.to_json(
        OUTPUT,
        orient="records",
        indent=2,
        date_format="iso"
    )

    print(
        f"[ML] Snapshot rebuilt with {len(df_final)} logs",
        flush=True
    )
