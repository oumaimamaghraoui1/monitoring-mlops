import pandas as pd
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE = BASE_DIR / "mlops/data/features/security_features.parquet"
MODEL   = BASE_DIR / "mlops/models/anomaly/security_if.joblib"
SCALER  = BASE_DIR / "mlops/models/anomaly/security_scaler.joblib"

def main():

    df = pd.read_parquet(IN_FILE)

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

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        contamination=0.02,
        n_estimators=200,
        random_state=42
    )

    model.fit(X_scaled)

    MODEL.parent.mkdir(exist_ok=True,parents=True)

    joblib.dump(model, MODEL)
    joblib.dump(scaler, SCALER)

    print("✅ Security UEBA trained")

if __name__ == "__main__":
    main()