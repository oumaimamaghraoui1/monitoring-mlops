import pandas as pd

main = pd.read_csv("data/rca/rca_dataset.csv")
new  = pd.read_csv("data/rca/incidents_log.csv")

# ✅ REMOVE HEADER DUPLICATES
new = new[new['cause'] != 'cause']

merged = pd.concat([main,new],ignore_index=True)
merged = merged.drop_duplicates()

merged.to_csv("data/rca/rca_dataset.csv",index=False)

print("✅ Dataset updated")