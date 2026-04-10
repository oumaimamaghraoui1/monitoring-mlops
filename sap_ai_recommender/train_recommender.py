import os
import pandas as pd
import joblib
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors
from scipy.sparse import save_npz

os.makedirs("artifacts", exist_ok=True)

df = pd.read_csv("output/transactions_cleaned.csv")
df["combined_text"] = df["combined_text"].fillna("").astype(str)

vectorizer = TfidfVectorizer()
X = vectorizer.fit_transform(df["combined_text"])

model = NearestNeighbors(metric="cosine")
model.fit(X)

joblib.dump(vectorizer, "artifacts/vectorizer.joblib")
joblib.dump(model, "artifacts/model.joblib")
save_npz("artifacts/matrix.npz", X)

df.to_csv("artifacts/transactions_model.csv", index=False)

print("✅ MODEL TRAINED SUCCESSFULLY")