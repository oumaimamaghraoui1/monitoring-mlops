import pandas as pd
import joblib
from scipy.sparse import load_npz
from openpyxl import Workbook

vectorizer = joblib.load("artifacts/vectorizer.joblib")
model = joblib.load("artifacts/model.joblib")

X = load_npz("artifacts/matrix.npz")
df = pd.read_csv("artifacts/transactions_model.csv")

query_code = input("Enter Transaction Code : ")

idx = df[df["Transaction Code"]==query_code].index[0]

distance,indices = model.kneighbors(X[idx],n_neighbors=10)

results=[]

for i,ind in enumerate(indices[0]):

    row=df.iloc[ind]

    results.append({
    "Rank":i+1,
    "Transaction Code":row["Transaction Code"],
    "Program":row["Program"],
    "Description":row["Transaction Description"],
    "Namespace":row["namespace"],
    "Similarity":1-distance[0][i]
})

result_df=pd.DataFrame(results)

with pd.ExcelWriter("output/AI_Recommendations.xlsx",engine="openpyxl") as writer:

    result_df.to_excel(writer,sheet_name="Recommendations",index=False)
    df.head(500).to_excel(writer,sheet_name="Dataset_Sample",index=False)

print("✅ Excel Recommendation File Created")