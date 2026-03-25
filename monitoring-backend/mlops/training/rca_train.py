# ============================================
# RCA MODEL TRAINING SCRIPT
# Root Cause Analysis Classifier
# ============================================

import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
import joblib
import os

# ============================
# PATHS
# ============================

BASE = os.path.dirname(os.path.abspath(__file__))

DATA_PATH = os.path.join(BASE, "../data/rca/rca_dataset.csv")
MODEL_PATH = os.path.join(BASE, "../models/rca_model.pkl")
ENCODER_PATH = os.path.join(BASE, "../models/rca_label_encoder.pkl")

print("✅ Loading RCA dataset...")

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
# (ML needs numbers not text)
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
# CREATE MODELS FOLDER IF NEEDED
# ============================

os.makedirs("../models", exist_ok=True)

# ============================
# SAVE MODEL + ENCODER
# ============================

joblib.dump(model, MODEL_PATH)
joblib.dump(label_encoder, ENCODER_PATH)

print("✅ Model saved to:", MODEL_PATH)
print("✅ Label encoder saved to:", ENCODER_PATH)

print("🎉 RCA training complete!")