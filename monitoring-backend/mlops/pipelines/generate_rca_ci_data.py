import pandas as pd
import numpy as np
import os

os.makedirs("monitoring-backend/mlops/data/processed", exist_ok=True)

n = 500

df = pd.DataFrame({
    "cpu": np.random.uniform(0,100,n),
    "latency": np.random.uniform(0,200,n),
    "heap_ratio": np.random.uniform(0.3,0.9,n),
    "gc": np.random.uniform(0,5,n),
    "lag": np.random.uniform(0,50,n),
    "cpu_delta": np.random.uniform(-5,5,n),
    "lag_delta": np.random.uniform(-5,5,n),
    "handle_count": np.random.randint(1,25,n),
    "handle_delta": np.random.randint(0,5,n),
    "req_rate": np.random.uniform(0.01,0.04,n),
    "resp_rate": np.random.uniform(0.005,0.035,n),
    "cause": np.random.choice([
        "CPU_SATURATION",
        "MEMORY_PRESSURE",
        "DEPENDENCY_LATENCY",
        "QUERY_LATENCY",
        "REQUEST_BACKLOG",
        "CONNECTION_SATURATION",
        "THREAD_POOL_STARVATION"
    ],n)
})

df.to_csv(
    "monitoring-backend/mlops/data/processed/rca_ci_dataset.csv",
    index=False
)

print("✅ RCA synthetic CI dataset generated")