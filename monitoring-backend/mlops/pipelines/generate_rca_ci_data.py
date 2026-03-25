import pandas as pd
import numpy as np
import os

os.makedirs("monitoring-backend/mlops/data/processed", exist_ok=True)

n = 500

df = pd.DataFrame({
    "cpu": np.random.rand(n),
    "latency": np.random.rand(n),
    "heapGrowth": np.random.rand(n),
    "gc": np.random.rand(n),
    "lag": np.random.rand(n),
    "cause": np.random.choice(["MEMORY","CPU","NETWORK"], n)
})

df.to_csv(
    "monitoring-backend/mlops/data/processed/rca_ci_dataset.csv",
    index=False
)

print("✅ RCA synthetic CI dataset generated")
