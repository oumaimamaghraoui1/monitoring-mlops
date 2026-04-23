# mlops/training/compare_config_models.py

import pandas as pd
import numpy as np
from pathlib import Path
from itertools import combinations

from sklearn.ensemble import IsolationForest
from sklearn.svm import OneClassSVM
from sklearn.neighbors import LocalOutlierFactor
from sklearn.covariance import EllipticEnvelope
from sklearn.preprocessing import StandardScaler

BASE_DIR = Path(__file__).resolve().parents[2]

INPUT_FILE = BASE_DIR / "mlops" / "data" / "features" / "ml_features.parquet"
OUT_DIR = BASE_DIR / "mlops" / "models" / "config_comparison"

FEATURES = [
    "hour",
    "day",
    "weekend",
    "actor_count_7d",
    "actor_object_7d",
    "time_since_last_actor",
    "first_time_role"
]


def load_data():
    df = pd.read_parquet(INPUT_FILE)

    cols = ["uuid"] + FEATURES
    df = df[cols].copy()

    for col in FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.replace([np.inf, -np.inf], np.nan).fillna(0)

    return df


def train_and_score_models(df):
    X = df[FEATURES].copy()

    scaler = StandardScaler()
    X_scaled = scaler.fit_transform(X)

    models = {
        "IsolationForest": IsolationForest(
            n_estimators=200,
            contamination=0.02,
            random_state=42
        ),
        "OneClassSVM": OneClassSVM(
            kernel="rbf",
            nu=0.02,
            gamma="scale"
        ),
        "LOF": LocalOutlierFactor(
            n_neighbors=20,
            contamination=0.02,
            novelty=False
        ),
        "EllipticEnvelope": EllipticEnvelope(
            contamination=0.02,
            random_state=42
        )
    }

    scored_results = {}
    score_rows = []

    for name, model in models.items():
        print(f"\n[INFO] Training/scoring {name}...")

        scored_df = df[["uuid"]].copy()

        if name == "LOF":
            pred = model.fit_predict(X_scaled)
            score = model.negative_outlier_factor_
        else:
            model.fit(X_scaled)
            pred = model.predict(X_scaled)
            score = model.decision_function(X_scaled)

        scored_df["score"] = score
        scored_df["prediction"] = pred
        scored_df["anomaly"] = (scored_df["prediction"] == -1).astype(int)

        scored_results[name] = scored_df

        score_rows.append({
            "model": name,
            "anomalies_detected": int(scored_df["anomaly"].sum()),
            "score_mean": float(np.mean(score)),
            "score_std": float(np.std(score)),
            "score_max": float(np.max(score)),
            "score_min": float(np.min(score)),
        })

        scored_df.to_csv(OUT_DIR / f"{name}_scored.csv", index=False)

    return scored_results, pd.DataFrame(score_rows)


def compute_pairwise_overlap(scored_results):
    rows = []

    for model_a, model_b in combinations(scored_results.keys(), 2):
        a_set = set(scored_results[model_a].loc[scored_results[model_a]["anomaly"] == 1, "uuid"])
        b_set = set(scored_results[model_b].loc[scored_results[model_b]["anomaly"] == 1, "uuid"])

        inter = len(a_set & b_set)
        union = len(a_set | b_set)
        count_a = len(a_set)
        count_b = len(b_set)

        overlap_a = (inter / count_a * 100) if count_a else 0
        overlap_b = (inter / count_b * 100) if count_b else 0
        jaccard = (inter / union * 100) if union else 0

        rows.append({
            "model_a": model_a,
            "model_b": model_b,
            "count_a": count_a,
            "count_b": count_b,
            "intersection": inter,
            "union": union,
            "overlap_a_pct": round(overlap_a, 2),
            "overlap_b_pct": round(overlap_b, 2),
            "jaccard_pct": round(jaccard, 2),
        })

    return pd.DataFrame(rows)


def compute_presence_matrix(scored_results):
    all_uuids = sorted(set().union(*[
        set(df.loc[df["anomaly"] == 1, "uuid"]) for df in scored_results.values()
    ]))

    matrix = pd.DataFrame({"uuid": all_uuids})

    for model_name, sdf in scored_results.items():
        anomalies = set(sdf.loc[sdf["anomaly"] == 1, "uuid"])
        matrix[model_name] = matrix["uuid"].apply(lambda x: 1 if x in anomalies else 0)

    model_cols = list(scored_results.keys())
    matrix["detected_by_n_models"] = matrix[model_cols].sum(axis=1)

    return matrix


def compute_unique_counts(scored_results):
    rows = []
    model_names = list(scored_results.keys())

    anomaly_sets = {
        model: set(df.loc[df["anomaly"] == 1, "uuid"])
        for model, df in scored_results.items()
    }

    for model in model_names:
        others = set().union(*[anomaly_sets[m] for m in model_names if m != model])
        unique_anomalies = anomaly_sets[model] - others

        rows.append({
            "model": model,
            "unique_anomalies": len(unique_anomalies)
        })

        pd.DataFrame({"uuid": sorted(unique_anomalies)}).to_csv(
            OUT_DIR / f"{model}_unique_anomalies.csv", index=False
        )

    return pd.DataFrame(rows)


def compute_common_anomalies(scored_results):
    anomaly_sets = [
        set(df.loc[df["anomaly"] == 1, "uuid"])
        for df in scored_results.values()
    ]

    common = set.intersection(*anomaly_sets) if anomaly_sets else set()
    return pd.DataFrame({"uuid": sorted(common)})


def build_comparison_summary(score_summary_df, pairwise_df, unique_df):
    models = score_summary_df["model"].tolist()
    rows = []

    for model in models:
        mask_a = pairwise_df["model_a"] == model
        mask_b = pairwise_df["model_b"] == model

        vals_a = pairwise_df.loc[mask_a, ["model_b", "jaccard_pct"]].rename(columns={"model_b": "other_model"})
        vals_b = pairwise_df.loc[mask_b, ["model_a", "jaccard_pct"]].rename(columns={"model_a": "other_model"})
        vals = pd.concat([vals_a, vals_b], ignore_index=True)

        best_row = vals.sort_values("jaccard_pct", ascending=False).iloc[0]
        worst_row = vals.sort_values("jaccard_pct", ascending=True).iloc[0]

        anomaly_count = int(score_summary_df.loc[score_summary_df["model"] == model, "anomalies_detected"].iloc[0])
        unique_count = int(unique_df.loc[unique_df["model"] == model, "unique_anomalies"].iloc[0])

        rows.append({
            "model": model,
            "anomaly_count": anomaly_count,
            "unique_anomalies": unique_count,
            "avg_jaccard_pct": round(vals["jaccard_pct"].mean(), 2),
            "max_jaccard_pct": round(vals["jaccard_pct"].max(), 2),
            "min_jaccard_pct": round(vals["jaccard_pct"].min(), 2),
            "best_match_model": best_row["other_model"],
            "worst_match_model": worst_row["other_model"],
            "consensus_score": round(vals["jaccard_pct"].mean() - unique_count, 2)
        })

    return pd.DataFrame(rows).sort_values(
        by=["avg_jaccard_pct", "unique_anomalies"],
        ascending=[False, True]
    ).reset_index(drop=True)


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    df = load_data()

    scored_results, score_summary_df = train_and_score_models(df)
    pairwise_df = compute_pairwise_overlap(scored_results)
    presence_df = compute_presence_matrix(scored_results)
    unique_df = compute_unique_counts(scored_results)
    common_df = compute_common_anomalies(scored_results)
    comparison_df = build_comparison_summary(score_summary_df, pairwise_df, unique_df)

    score_summary_df.to_csv(OUT_DIR / "model_score_summary.csv", index=False)
    pairwise_df.to_csv(OUT_DIR / "pairwise_overlap.csv", index=False)
    presence_df.to_csv(OUT_DIR / "anomaly_presence_matrix.csv", index=False)
    unique_df.to_csv(OUT_DIR / "unique_anomaly_counts.csv", index=False)
    common_df.to_csv(OUT_DIR / "common_anomalies_all_models.csv", index=False)
    comparison_df.to_csv(OUT_DIR / "model_comparison_summary.csv", index=False)

    print("\n=== Anomaly counts by model ===")
    for _, row in score_summary_df.iterrows():
        print(f"{row['model']}: {row['anomalies_detected']}")

    print("\n=== Pairwise overlap ===")
    for _, row in pairwise_df.iterrows():
        print(
            f"{row['model_a']} vs {row['model_b']} | "
            f"intersection={row['intersection']} | "
            f"jaccard={row['jaccard_pct']}% | "
            f"{row['model_a']}_overlap={row['overlap_a_pct']}% | "
            f"{row['model_b']}_overlap={row['overlap_b_pct']}%"
        )

    print("\n=== Common anomalies detected by ALL models ===")
    print(f"Count: {len(common_df)}")

    print("\n=== Unique anomalies by model ===")
    for _, row in unique_df.iterrows():
        print(f"{row['model']}: {row['unique_anomalies']}")

    print(f"\n✅ Config comparison outputs saved in: {OUT_DIR}")


if __name__ == "__main__":
    main()