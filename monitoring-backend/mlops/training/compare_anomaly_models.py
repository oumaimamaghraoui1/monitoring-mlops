# monitoring-backend/mlops/training/compare_anomaly_models.py

import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path
from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.neighbors import LocalOutlierFactor
from sklearn.covariance import EllipticEnvelope
from sklearn.preprocessing import StandardScaler

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE = BASE_DIR / "mlops" / "data" / "features" / "ml_features.parquet"
OUT_DIR = BASE_DIR / "mlops" / "models" / "comparison"
OUT_DIR.mkdir(parents=True, exist_ok=True)

FEATURES = [
    "hour",
    "day",
    "weekend",
    "actor_count_7d",
    "actor_object_7d",
    "time_since_last_actor",
    "first_time_role"
]

def get_score(model, X):
    if hasattr(model, "decision_function"):
        return -model.decision_function(X)
    elif hasattr(model, "score_samples"):
        return -model.score_samples(X)
    else:
        pred = model.predict(X)
        return (pred == -1).astype(float)

def main():
    df = pd.read_parquet(IN_FILE)
    X = df[FEATURES].fillna(0)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    models = {
        "IsolationForest": IsolationForest(
            n_estimators=200,
            contamination=0.02,
            random_state=42
        ),
        "OneClassSVM": OneClassSVM(
            nu=0.02,
            kernel="rbf",
            gamma="scale"
        ),
        "LOF": LocalOutlierFactor(
            n_neighbors=20,
            contamination=0.02,
            novelty=True
        ),
        "EllipticEnvelope": EllipticEnvelope(
            contamination=0.02,
            random_state=42
        )
    }

    summary = []

    for name, model in models.items():
        print(f"Training {name}...")
        model.fit(X_scaled)

        score = get_score(model, X_scaled)
        pred = model.predict(X_scaled)
        anomaly = (pred == -1).astype(int)

        out = df.copy()
        out["score"] = score
        out["anomaly"] = anomaly

        out = out.sort_values("score", ascending=False)

        out.to_csv(OUT_DIR / f"{name}_scored.csv", index=False)
        out.head(100).to_csv(OUT_DIR / f"{name}_top100.csv", index=False)

        summary.append({
            "model": name,
            "anomalies_detected": int(anomaly.sum()),
            "score_mean": float(pd.Series(score).mean()),
            "score_std": float(pd.Series(score).std()),
            "score_max": float(pd.Series(score).max()),
            "score_min": float(pd.Series(score).min())
        })

        plt.figure(figsize=(8, 5))
        plt.hist(score, bins=50)
        plt.title(f"Score distribution - {name}")
        plt.xlabel("Anomaly score")
        plt.ylabel("Count")
        plt.tight_layout()
        plt.savefig(OUT_DIR / f"{name}_hist.png")
        plt.close()

    pd.DataFrame(summary).to_csv(OUT_DIR / "comparison_summary.csv", index=False)
    print(f"✅ Comparison finished. Results saved in {OUT_DIR}")

if __name__ == "__main__":
    main()