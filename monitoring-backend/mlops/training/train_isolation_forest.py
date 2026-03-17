import pandas as pd
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.preprocessing import StandardScaler
import joblib

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE  = BASE_DIR / "mlops" / "data" / "features" / "ml_features.parquet"
MODEL_OUT = BASE_DIR / "mlops" / "models" / "anomaly" / "isolation_forest.joblib"
SCALER_OUT = BASE_DIR / "mlops" / "models" / "anomaly" / "scaler.joblib"

def main():

    df = pd.read_parquet(IN_FILE)

    # ---- SELECT ML FEATURES ----
    X = df[[
        "hour",
        "day",
        "weekend",
        "actor_count_7d",
        "actor_object_7d",
        "time_since_last_actor",
        "first_time_role"
    ]].fillna(0)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    model = IsolationForest(
        n_estimators=200,
        contamination=0.02,
        random_state=42
    )

    model.fit(X_scaled)

    MODEL_OUT.parent.mkdir(parents=True, exist_ok=True)

    joblib.dump(model, MODEL_OUT)
    joblib.dump(scaler, SCALER_OUT)

    print("✅ Isolation Forest model trained")

if __name__ == "__main__":
    main()