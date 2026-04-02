import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]

DATA_PATH = BASE_DIR / "data" / "rca" / "rca_dataset.csv"
OUT_PATH  = BASE_DIR / "data" / "rca" / "rca_dataset_clean.csv"

print("📂 Loading RCA dataset from:", DATA_PATH)

df = pd.read_csv(DATA_PATH)

feature_cols = [
    "cpu","latency","heap_ratio","gc","lag",
    "cpu_delta","lag_delta","handle_count",
    "handle_delta","req_rate","resp_rate"
]

print("Original dataset size:", len(df))

# ============================
# Detect contradictions
# ============================
counts = (
    df.groupby(feature_cols)["cause"]
      .nunique()
      .reset_index(name="n")
)

invalid = counts[counts["n"] > 1]

print("⚠ Contradictory rows detected:", len(invalid))

# ============================
# Keep only valid groups
# ============================
valid = counts[counts["n"] == 1].drop(columns=["n"])

cleaned = df.merge(valid, on=feature_cols, how="inner")

print("✅ Cleaned dataset size:", len(cleaned))

cleaned.to_csv(OUT_PATH, index=False)

print("✅ Saved cleaned dataset to:", OUT_PATH)