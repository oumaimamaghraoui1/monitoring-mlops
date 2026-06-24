# monitoring-backend/mlops/training/compare_ueba_security_models.py

import time
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
from pathlib import Path

from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.neighbors import LocalOutlierFactor
from sklearn.preprocessing import StandardScaler, MinMaxScaler

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE = BASE_DIR / "mlops" / "data" / "features" / "security_features.parquet"
OUT_DIR = BASE_DIR / "mlops" / "models" / "ueba_security_comparison"
OUT_DIR.mkdir(parents=True, exist_ok=True)

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

TOP_K_VALUES = [20, 50, 100]


def get_score(model, X):
    if hasattr(model, "decision_function"):
        return -model.decision_function(X)
    elif hasattr(model, "score_samples"):
        return -model.score_samples(X)
    else:
        pred = model.predict(X)
        return (pred == -1).astype(float)


def build_heuristic_flags(df):
    flagged = pd.DataFrame(index=df.index)

    flagged["odd_hour"] = ((df["hour"] <= 5) | (df["hour"] >= 22)).astype(int)
    flagged["night_activity"] = (df["is_night"] > 0).astype(int)
    flagged["first_time_ip_flag"] = (df["first_time_ip"] > 0).astype(int)
    flagged["first_time_client_flag"] = (df["first_time_client"] > 0).astype(int)

    login_count_thr = df["login_count_7d"].quantile(0.95)
    token_count_thr = df["token_count_7d"].quantile(0.95)
    inactivity_thr = df["time_since_last_login"].quantile(0.95)

    flagged["high_login_count"] = (df["login_count_7d"] >= login_count_thr).astype(int)
    flagged["high_token_count"] = (df["token_count_7d"] >= token_count_thr).astype(int)
    flagged["high_inactivity_gap"] = (df["time_since_last_login"] >= inactivity_thr).astype(int)

    flagged["heuristic_score"] = flagged.sum(axis=1)
    flagged["heuristic_suspicious"] = (flagged["heuristic_score"] >= 1).astype(int)

    return flagged


def evaluate_model(name, model_factory, X_scaled, original_df, n_runs=5):
    runtimes = []
    final_model = None

    for seed in range(n_runs):
        model = model_factory(seed)

        start = time.perf_counter()
        model.fit(X_scaled)
        runtime = time.perf_counter() - start
        runtimes.append(runtime)

        if seed == n_runs - 1:
            final_model = model

    final_scores = pd.Series(get_score(final_model, X_scaled))
    final_norm_scores = MinMaxScaler().fit_transform(final_scores.to_frame()).flatten()
    final_pred = final_model.predict(X_scaled)
    final_anomaly = (final_pred == -1).astype(int)

    out = original_df.copy()
    out["raw_score"] = final_scores
    out["normalized_score"] = final_norm_scores
    out["anomaly"] = final_anomaly

    heuristic_flags = build_heuristic_flags(out)
    out = pd.concat([out, heuristic_flags], axis=1)
    out = out.sort_values("normalized_score", ascending=False)

    out.to_csv(OUT_DIR / f"{name}_scored.csv", index=False)

    for k in TOP_K_VALUES:
        out.head(k).to_csv(OUT_DIR / f"{name}_top{k}.csv", index=False)

    plt.figure(figsize=(8, 5))
    plt.hist(final_norm_scores, bins=50)
    plt.title(f"Distribution des scores d'anomalie - {name}")
    plt.xlabel("Score d'anomalie normalisé")
    plt.ylabel("Nombre d'événements")
    plt.tight_layout()
    plt.savefig(OUT_DIR / f"{name}_score_hist.png")
    plt.close()

    anomaly_count = int(out["anomaly"].sum())
    anomaly_rate = anomaly_count / len(out)

    result = {
        "model": name,
        "runtime_mean_sec": round(float(np.mean(runtimes)), 4),
        "runtime_std_sec": round(float(np.std(runtimes)), 4),
        "anomalies_detected": anomaly_count,
        "anomaly_rate": round(anomaly_rate, 4),
    }

    for k in TOP_K_VALUES:
        topk = out.head(k)
        heuristic_hits = int(topk["heuristic_suspicious"].sum())
        heuristic_rate = heuristic_hits / k
        top_score_mean = float(topk["normalized_score"].mean())

        result[f"top{k}_score_mean"] = round(top_score_mean, 4)
        result[f"top{k}_heuristic_hits"] = heuristic_hits
        result[f"top{k}_heuristic_rate"] = round(heuristic_rate, 4)

    return result


def main():
    print("📂 Loading UEBA security feature dataset from:", IN_FILE)

    df = pd.read_parquet(IN_FILE)
    X = df[FEATURES].fillna(0)

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    models = {
        "IsolationForest": lambda seed: IsolationForest(
            n_estimators=200,
            contamination=0.02,
            random_state=42 + seed
        ),
        "OneClassSVM": lambda seed: OneClassSVM(
            nu=0.02,
            kernel="rbf",
            gamma="scale"
        ),
        "LOF": lambda seed: LocalOutlierFactor(
            n_neighbors=20,
            contamination=0.02,
            novelty=True
        )
    }

    summary_rows = []

    for name, factory in models.items():
        print(f"\n=== Evaluating {name} ===")
        row = evaluate_model(name, factory, X_scaled, df, n_runs=5)
        summary_rows.append(row)

        print(f"Runtime mean (s): {row['runtime_mean_sec']}")
        print(f"Runtime std (s): {row['runtime_std_sec']}")
        print(f"Anomalies detected: {row['anomalies_detected']}")
        print(f"Anomaly rate: {row['anomaly_rate']}")

        for k in TOP_K_VALUES:
            print(f"Top-{k} score mean: {row[f'top{k}_score_mean']}")
            print(f"Top-{k} heuristic hits: {row[f'top{k}_heuristic_hits']}/{k}")
            print(f"Top-{k} heuristic rate: {row[f'top{k}_heuristic_rate']}")

    summary_df = pd.DataFrame(summary_rows).sort_values(
        by=["top50_heuristic_rate", "top50_score_mean", "runtime_mean_sec"],
        ascending=[False, False, True]
    )

    summary_df.to_csv(OUT_DIR / "ueba_security_comparison_summary.csv", index=False)

    print("\n=== Final UEBA security comparison ===")
    print(summary_df.to_string(index=False))

    print(f"\n✅ Results saved in: {OUT_DIR}")


if __name__ == "__main__":
    main()