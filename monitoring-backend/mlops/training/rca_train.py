# ==============================================
# RCA TRAINING SCRIPT (CI-SAFE)
# ==============================================

import os
import pandas as pd
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder

# ============================
# BASE PATH
# ============================

BASE_DIR = Path(__file__).resolve().parents[1]

# ============================
# SELECT DATASET BASED ON ENV
# ============================

if os.getenv("CI"):
    print("✅ CI environment detected — using synthetic RCA dataset")
    DATA_PATH = BASE_DIR / "data" / "processed" / "rca_ci_dataset.csv"
else:
    print("✅ Local environment — using real RCA dataset")
    DATA_PATH = BASE_DIR / "data" / "rca" / "rca_dataset.csv"

print("📂 Loading RCA dataset from:", DATA_PATH)

# ============================
# LOAD DATASET
# ============================

df = pd.read_csv(DATA_PATH)

print("Dataset shape:", df.shape)
print(df.head())

# ============================
# FEATURES & LABEL
# ============================

X = df[["cpu", "latency", "heapGrowth", "gc", "lag"]]
y = df["cause"]

# ============================
# ENCODE LABELS
# ============================

label_encoder = LabelEncoder()
y_encoded = label_encoder.fit_transform(y)

print("Encoded classes:")
print(label_encoder.classes_)

# ============================
# TRAIN MODEL
# ============================

model = RandomForestClassifier(
    n_estimators=100,
    max_depth=5,
    random_state=42
)

model.fit(X, y_encoded)

print("✅ RCA model trained")

# ============================
# CREATE MODEL DIRECTORY
# ============================

MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PATH = MODEL_DIR / "rca_model.pkl"
ENCODER_PATH = MODEL_DIR / "rca_label_encoder.pkl"

# ============================
# SAVE MODEL + ENCODER
# ============================

joblib.dump(model, MODEL_PATH)
joblib.dump(label_encoder, ENCODER_PATH)

print("✅ Model saved to:", MODEL_PATH)
print("✅ Label encoder saved to:", ENCODER_PATH)

print("🎉 RCA training complete!")
