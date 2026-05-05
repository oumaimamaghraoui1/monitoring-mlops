import joblib
import pandas as pd
import numpy as np
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

MODEL_FILE = BASE_DIR / "mlops/models/anomaly/security_if.joblib"
SCALER_FILE = BASE_DIR / "mlops/models/anomaly/security_scaler.joblib"

INPUT = BASE_DIR / "mlops/data/features/security_features.parquet"
OUTPUT = BASE_DIR / "data/security_scored_snapshot.json"

FEATURES = [
    "hour",
    "weekend",
    "is_night",
    "login_count_7d",
    "token_count_7d",
    "first_time_ip",
    "first_time_client",
    "time_since_last_login"
]


def normalize_anomaly_score(decision_scores):
    """
    IsolationForest decision_function:
      higher  = more normal
      lower   = more anomalous

    We convert it to:
      0.000 = normal
      1.000 = very anomalous
    """

    scores = np.asarray(decision_scores, dtype=float)

    if len(scores) == 0:
        return scores

    min_score = np.min(scores)
    max_score = np.max(scores)

    if max_score == min_score:
        return np.zeros_like(scores)

    # Invert: low decision score = high anomaly score
    anomaly = (max_score - scores) / (max_score - min_score)

    return anomaly


def main():
    if not INPUT.exists():
        raise FileNotFoundError(f"Missing feature file: {INPUT}")

    if not MODEL_FILE.exists():
        raise FileNotFoundError(f"Missing model file: {MODEL_FILE}")

    if not SCALER_FILE.exists():
        raise FileNotFoundError(f"Missing scaler file: {SCALER_FILE}")

    model = joblib.load(MODEL_FILE)
    scaler = joblib.load(SCALER_FILE)

    df = pd.read_parquet(INPUT)

    if df.empty:
        print("⚠️ No security features to score.")
        df.to_json(OUTPUT, orient="records", date_format="iso")
        return

    missing = [c for c in FEATURES if c not in df.columns]
    if missing:
        raise ValueError(f"Missing required feature columns: {missing}")

    X = df[FEATURES].fillna(0)

    X_scaled = scaler.transform(X)

    # Raw IsolationForest values
    raw_decision_score = model.decision_function(X_scaled)

    # IsolationForest label:
    # -1 = anomaly
    #  1 = normal
    anomaly_label = model.predict(X_scaled)

    # Normalized score for UI:
    # 0 = normal, 1 = anomalous
    anomaly_score = normalize_anomaly_score(raw_decision_score)

    df["mlDecisionScore"] = raw_decision_score
    df["anomaly"] = anomaly_label
    df["anomalyScore"] = anomaly_score

    # Optional ML risk based only on normalized score
    def score_to_risk(s):
        if s >= 0.85:
            return "High"
        if s >= 0.65:
            return "Medium"
        if s >= 0.40:
            return "Low"
        return "Normal"

    df["mlRisk"] = df["anomalyScore"].apply(score_to_risk)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)

    df.to_json(
        OUTPUT,
        orient="records",
        date_format="iso",
        indent=2
    )

    print("✅ Security events scored")
    print(f"✅ Output: {OUTPUT}")
    print(f"✅ Rows: {len(df)}")
    print(f"✅ anomalyScore min: {df['anomalyScore'].min():.6f}")
    print(f"✅ anomalyScore max: {df['anomalyScore'].max():.6f}")
    print(f"✅ anomalyScore mean: {df['anomalyScore'].mean():.6f}")
    print("✅ ML risk distribution:")
    print(df["mlRisk"].value_counts(dropna=False).to_string())


if __name__ == "__main__":
    main()