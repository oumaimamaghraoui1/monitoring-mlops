import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
dataset = BASE_DIR / "data/rca/rca_dataset.csv"

df = pd.read_csv(dataset)

print("Before:",df.columns)

if "heapGrowth" in df.columns:
    df = df.drop(columns=["heapGrowth"])

print("After:",df.columns)

df.to_csv(dataset,index=False)

print("✅ heapGrowth removed")