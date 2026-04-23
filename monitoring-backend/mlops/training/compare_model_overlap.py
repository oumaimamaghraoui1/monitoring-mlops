# mlops/training/compare_model_overlap.py

import pandas as pd
from pathlib import Path
from itertools import combinations

BASE_DIR = Path(__file__).resolve().parents[2]
COMP_DIR = BASE_DIR / "mlops" / "models" / "comparison"

MODEL_FILES = {
    "IsolationForest": COMP_DIR / "IsolationForest_scored.csv",
    "OneClassSVM": COMP_DIR / "OneClassSVM_scored.csv",
    "LOF": COMP_DIR / "LOF_scored.csv",
    "EllipticEnvelope": COMP_DIR / "EllipticEnvelope_scored.csv",
}

def load_anomaly_sets():
    anomaly_sets = {}
    full_dfs = {}

    for model_name, file_path in MODEL_FILES.items():
        df = pd.read_csv(file_path)
        full_dfs[model_name] = df

        if "uuid" not in df.columns or "anomaly" not in df.columns:
            raise ValueError(f"{model_name}: missing required columns 'uuid' or 'anomaly'")

        anomaly_ids = set(df.loc[df["anomaly"] == 1, "uuid"].astype(str))
        anomaly_sets[model_name] = anomaly_ids

    return anomaly_sets, full_dfs

def main():
    anomaly_sets, full_dfs = load_anomaly_sets()
    model_names = list(anomaly_sets.keys())

    print("\n=== Anomaly counts by model ===")
    for name in model_names:
        print(f"{name}: {len(anomaly_sets[name])}")

    # Pairwise overlap table
    pairwise_rows = []

    print("\n=== Pairwise overlap ===")
    for a, b in combinations(model_names, 2):
        set_a = anomaly_sets[a]
        set_b = anomaly_sets[b]

        inter = set_a & set_b
        union = set_a | set_b

        overlap_a = len(inter) / len(set_a) if len(set_a) else 0
        overlap_b = len(inter) / len(set_b) if len(set_b) else 0
        jaccard = len(inter) / len(union) if len(union) else 0

        row = {
            "model_a": a,
            "model_b": b,
            "count_a": len(set_a),
            "count_b": len(set_b),
            "intersection": len(inter),
            "union": len(union),
            "overlap_a_pct": round(100 * overlap_a, 2),
            "overlap_b_pct": round(100 * overlap_b, 2),
            "jaccard_pct": round(100 * jaccard, 2),
        }
        pairwise_rows.append(row)

        print(
            f"{a} vs {b} | "
            f"intersection={len(inter)} | "
            f"jaccard={100*jaccard:.2f}% | "
            f"{a}_overlap={100*overlap_a:.2f}% | "
            f"{b}_overlap={100*overlap_b:.2f}%"
        )

    pairwise_df = pd.DataFrame(pairwise_rows)
    pairwise_df.to_csv(COMP_DIR / "pairwise_overlap.csv", index=False)

    # All-model intersection
    common_all = set.intersection(*(anomaly_sets[m] for m in model_names))
    print(f"\n=== Common anomalies detected by ALL models ===")
    print(f"Count: {len(common_all)}")

    common_all_df = pd.DataFrame({"uuid": sorted(common_all)})
    common_all_df.to_csv(COMP_DIR / "common_anomalies_all_models.csv", index=False)

    # Unique anomalies per model
    unique_rows = []
    for model in model_names:
        others_union = set().union(*(anomaly_sets[m] for m in model_names if m != model))
        unique_ids = anomaly_sets[model] - others_union

        print(f"\n=== Unique anomalies for {model} ===")
        print(f"Count: {len(unique_ids)}")

        df_model = full_dfs[model].copy()
        df_unique = df_model[df_model["uuid"].astype(str).isin(unique_ids)].copy()
        df_unique = df_unique.sort_values("score", ascending=False)
        df_unique.to_csv(COMP_DIR / f"{model}_unique_anomalies.csv", index=False)

        unique_rows.append({
            "model": model,
            "unique_anomalies": len(unique_ids)
        })

    pd.DataFrame(unique_rows).to_csv(COMP_DIR / "unique_anomaly_counts.csv", index=False)

    # Presence matrix
    all_ids = sorted(set().union(*anomaly_sets.values()))
    presence = pd.DataFrame({"uuid": all_ids})

    for model in model_names:
        presence[model] = presence["uuid"].isin(anomaly_sets[model]).astype(int)

    presence["detected_by_n_models"] = presence[model_names].sum(axis=1)
    presence.to_csv(COMP_DIR / "anomaly_presence_matrix.csv", index=False)

    print("\n✅ Overlap analysis saved in:", COMP_DIR)

if __name__ == "__main__":
    main()