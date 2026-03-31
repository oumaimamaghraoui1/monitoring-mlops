import joblib
import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

MODEL  = joblib.load(BASE_DIR / "mlops/models/anomaly/security_if.joblib")
SCALER = joblib.load(BASE_DIR / "mlops/models/anomaly/security_scaler.joblib")

INPUT  = BASE_DIR / "mlops/data/features/security_features.parquet"
OUTPUT = BASE_DIR / "data/security_scored_snapshot.json"

def main():

    df = pd.read_parquet(INPUT)

    features = [
      "hour",
      "weekend",
      "is_night",
      "login_count_7d",
      "token_count_7d",
      "first_time_ip",
      "first_time_client",
      "time_since_last_login"
    ]

    X = df[features].fillna(0)
    X_scaled = SCALER.transform(X)

    df["anomalyScore"] = MODEL.decision_function(X_scaled)
    df["anomaly"] = MODEL.predict(X_scaled)

    df.to_json(OUTPUT,orient="records",date_format="iso")

    print("✅ Security events scored")

if __name__ == "__main__":
    main()