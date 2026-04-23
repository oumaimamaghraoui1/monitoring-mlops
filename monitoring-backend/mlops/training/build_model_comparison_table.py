# mlops/training/build_model_comparison_table.py

import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]
COMP_DIR = BASE_DIR / "mlops" / "models" / "comparison"

PAIRWISE_FILE = COMP_DIR / "pairwise_overlap.csv"
UNIQUE_FILE = COMP_DIR / "unique_anomaly_counts.csv"

# Optional: if you want anomaly counts directly from scored files
SCORED_FILES = {
    "IsolationForest": COMP_DIR / "IsolationForest_scored.csv",
    "OneClassSVM": COMP_DIR / "OneClassSVM_scored.csv",
    "LOF": COMP_DIR / "LOF_scored.csv",
    "EllipticEnvelope": COMP_DIR / "EllipticEnvelope_scored.csv",
}

def load_anomaly_counts():
    rows = []
    for model, path in SCORED_FILES.items():
        df = pd.read_csv(path)
        count = int((df["anomaly"] == 1).sum())
        rows.append({"model": model, "anomaly_count": count})
    return pd.DataFrame(rows)

def compute_jaccard_stats(pairwise_df, model_name):
    mask_a = pairwise_df["model_a"] == model_name
    mask_b = pairwise_df["model_b"] == model_name

    vals_a = pairwise_df.loc[mask_a, ["model_b", "jaccard_pct"]].rename(columns={"model_b": "other_model"})
    vals_b = pairwise_df.loc[mask_b, ["model_a", "jaccard_pct"]].rename(columns={"model_a": "other_model"})
    vals = pd.concat([vals_a, vals_b], ignore_index=True)

    return {
        "avg_jaccard_pct": round(vals["jaccard_pct"].mean(), 2),
        "max_jaccard_pct": round(vals["jaccard_pct"].max(), 2),
        "min_jaccard_pct": round(vals["jaccard_pct"].min(), 2),
        "best_match_model": vals.sort_values("jaccard_pct", ascending=False).iloc[0]["other_model"],
        "worst_match_model": vals.sort_values("jaccard_pct", ascending=True).iloc[0]["other_model"],
    }

def add_interpretation(row):
    model = row["model"]
    unique_n = row["unique_anomalies"]
    avg_j = row["avg_jaccard_pct"]

    if model == "IsolationForest":
        return "Best overall balance; stable and consensual baseline."
    elif model == "OneClassSVM":
        return "Closest to IsolationForest; useful secondary benchmark."
    elif model == "LOF":
        return "Detects more local anomalies; more isolated than IF/OCSVM."
    elif model == "EllipticEnvelope":
        return "Least reliable here; highest uniqueness and weaker agreement."
    else:
        if avg_j >= 35 and unique_n <= 10:
            return "Stable model with good agreement."
        elif avg_j >= 25:
            return "Moderate agreement; complementary model."
        else:
            return "Low agreement; inspect carefully."

def main():
    pairwise_df = pd.read_csv(PAIRWISE_FILE)
    unique_df = pd.read_csv(UNIQUE_FILE)
    count_df = load_anomaly_counts()

    models = sorted(set(count_df["model"]) | set(unique_df["model"]))

    rows = []
    for model in models:
        anomaly_count = int(count_df.loc[count_df["model"] == model, "anomaly_count"].iloc[0])
        unique_count = int(unique_df.loc[unique_df["model"] == model, "unique_anomalies"].iloc[0])

        stats = compute_jaccard_stats(pairwise_df, model)

        row = {
            "model": model,
            "anomaly_count": anomaly_count,
            "unique_anomalies": unique_count,
            **stats
        }
        rows.append(row)

    final_df = pd.DataFrame(rows)

    # Optional ranking logic
    # Higher avg_jaccard is better, lower unique anomalies is better
    final_df["consensus_score"] = (
        final_df["avg_jaccard_pct"] - final_df["unique_anomalies"]
    ).round(2)

    final_df["interpretation"] = final_df.apply(add_interpretation, axis=1)

    final_df = final_df.sort_values(
        by=["avg_jaccard_pct", "unique_anomalies"],
        ascending=[False, True]
    ).reset_index(drop=True)

    output_file = COMP_DIR / "model_comparison_summary.csv"
    final_df.to_csv(output_file, index=False)

    print("\n=== Final model comparison summary ===")
    print(final_df.to_string(index=False))
    print(f"\n✅ Saved to: {output_file}")

if __name__ == "__main__":
    main()