from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[1]

main_path = BASE_DIR / "data/rca/rca_dataset.csv"
incidents_path = BASE_DIR / "data/rca/incidents_log.csv"

print("📂 Loading main dataset")

main = pd.read_csv(main_path)

print("📥 Loading new temporal incidents")

new = pd.read_csv(
    incidents_path,
    header=None
)

new.columns = [
 "cpu","latency","heap_ratio","gc",
 "lag","cpu_delta","lag_delta",
 "handle_count","handle_delta",
 "req_rate","resp_rate",
 "cause"
]

print("Main size:",len(main))
print("New incidents:",len(new))

merged = pd.concat([main,new],ignore_index=True)

print("Merged size:",len(merged))

merged.to_csv(main_path,index=False)

print("✅ Dataset updated")