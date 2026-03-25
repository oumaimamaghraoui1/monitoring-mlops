import pandas as pd
import numpy as np
import os

os.makedirs("monitoring-backend/mlops/data/processed", exist_ok=True)

n = 500

df = pd.DataFrame({
    "cpu": np.random.rand(n),
    "memory": np.random.rand(n),
    "disk": np.random.rand(n),
    "network": np.random.rand(n),
    "incident_type": np.random.choice([0,1,2], n)
})

df.to_csv(
    "monitoring-backend/mlops/data/processed/rca_ci_dataset.csv",
    index=False
)

print("✅ RCA synthetic CI dataset generated")