import os
import pandas as pd
import joblib
from pathlib import Path
from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import LabelEncoder
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix

BASE_DIR = Path(__file__).resolve().parents[1]

# ============================
# SELECT DATASET
# ============================

if os.getenv("CI"):
    print("✅ CI environment detected — using synthetic RCA dataset")
    DATA_PATH = BASE_DIR / "data" / "processed" / "rca_ci_dataset.csv"
else:
    print("✅ Local environment — using real RCA dataset")
    DATA_PATH = BASE_DIR / "data" / "rca" / "rca_dataset_clean.csv"

print("📂 Loading RCA dataset from:", DATA_PATH)

df = pd.read_csv(DATA_PATH)

print("Dataset shape:", df.shape)

# ============================
# FEATURES & LABEL
# ============================

X = df[
["cpu","latency","heap_ratio","gc",
 "lag","cpu_delta","lag_delta",
 "handle_count","handle_delta",
 "req_rate","resp_rate"]
]
y = df["cause"]

# ============================
# ENCODE LABELS
# ============================

label_encoder = LabelEncoder()
y_encoded = label_encoder.fit_transform(y)

print("Encoded classes:", label_encoder.classes_)

# ============================
# TRAIN / TEST SPLIT
# ============================

X_train, X_test, y_train, y_test = train_test_split(
    X,
    y_encoded,
    test_size=0.2,
    random_state=42,
    stratify=y_encoded
)

# ============================
# TRAIN MODEL
# ============================

model = RandomForestClassifier(
    n_estimators=100,
    max_depth=5,
    random_state=42
)

model.fit(X_train, y_train)

print("✅ RCA model trained")

# ============================
# EVALUATE MODEL
# ============================

y_pred = model.predict(X_test)

print("\n📊 Classification Report:")
print(classification_report(y_test, y_pred))

print("\n🧩 Confusion Matrix:")
print(confusion_matrix(y_test, y_pred))

# ============================
# SAVE TRAINED MODEL
# ============================

MODEL_DIR = BASE_DIR / "models"
MODEL_DIR.mkdir(parents=True, exist_ok=True)

MODEL_PATH = MODEL_DIR / "rca_model.pkl"
ENCODER_PATH = MODEL_DIR / "rca_label_encoder.pkl"

joblib.dump(model, MODEL_PATH)
joblib.dump(label_encoder, ENCODER_PATH)

print("✅ Model saved to:", MODEL_PATH)
print("✅ Encoder saved to:", ENCODER_PATH)

print("🎉 RCA training complete!")