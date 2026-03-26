import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]

dataset = BASE_DIR / "data/rca/rca_dataset.csv"

df = pd.read_csv(dataset)

print("Loaded:",len(df),"rows")

# already new‑schema → skip
if "cpu_delta" in df.columns:
    print("Already upgraded")
    exit()

df["heap_ratio"] = df["heapGrowth"]

df["cpu_delta"] = 0
df["lag_delta"] = 0

df = df[
[
 "cpu",
 "latency",
 "heap_ratio",
 "gc",
 "lag",
 "cpu_delta",
 "lag_delta",
 "cause"
]
]

df.to_csv(dataset,index=False)

print("✅ Legacy RCA dataset upgraded to 7‑feature schema")