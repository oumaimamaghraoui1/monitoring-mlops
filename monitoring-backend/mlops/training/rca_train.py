import os
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder

BASE_DIR = Path(__file__).resolve().parents[1]

# ============================
# DATASET RESOLUTION
# ============================

def resolve_rca_dataset_path():
    """
    Resolve which RCA dataset to use.

    Supported modes:
      - RCA_DATA_MODE=synthetic  -> uses CI synthetic dataset
      - RCA_DATA_MODE=real       -> uses RCA_DATASET_PATH
      - fallback:
          * if CI is set -> synthetic
          * otherwise -> local real dataset under mlops/data/rca/rca_dataset_clean.csv
    """
    mode = os.getenv("RCA_DATA_MODE", "").strip().lower()

    synthetic_path = BASE_DIR / "data" / "processed" / "rca_ci_dataset.csv"
    local_real_default = BASE_DIR / "data" / "rca" / "rca_dataset_clean.csv"
    real_path_raw = os.getenv("RCA_DATASET_PATH", "").strip()

    # Explicit real mode
    if mode == "real":
        if not real_path_raw:
            raise RuntimeError(
                "RCA_DATASET_PATH is required when RCA_DATA_MODE=real"
            )

        real_path = Path(real_path_raw)

        if not real_path.exists():
            raise RuntimeError(f"Real RCA dataset not found: {real_path}")

        print("✅ Real evaluation mode — using protected local RCA dataset")
        return real_path

    # Explicit synthetic mode
    if mode == "synthetic":
        if not synthetic_path.exists():
            raise RuntimeError(f"Synthetic RCA dataset not found: {synthetic_path}")

        print("✅ Synthetic mode — using CI RCA dataset")
        return synthetic_path

    # Fallback behavior
    if os.getenv("CI"):
        print("✅ CI environment detected — using synthetic RCA dataset")

        if not synthetic_path.exists():
            raise RuntimeError(f"Synthetic RCA dataset not found: {synthetic_path}")

        return synthetic_path

    print("✅ Local environment — using real RCA dataset")

    if not local_real_default.exists():
        raise RuntimeError(f"Local real RCA dataset not found: {local_real_default}")

    return local_real_default


# ============================
# LOAD DATASET
# ============================

DATA_PATH = resolve_rca_dataset_path()

print("📂 Loading RCA dataset from:", DATA_PATH)

df = pd.read_csv(DATA_PATH)

print("Dataset shape:", df.shape)

# ============================
# FEATURES & LABEL
# ============================

FEATURE_COLUMNS = [
    "cpu",
    "latency",
    "heap_ratio",
    "gc",
    "lag",
    "cpu_delta",
    "lag_delta",
    "handle_count",
    "handle_delta",
    "req_rate",
    "resp_rate"
]

TARGET_COLUMN = "cause"

missing_features = [col for col in FEATURE_COLUMNS if col not in df.columns]
if missing_features:
    raise RuntimeError(f"Missing required feature columns: {missing_features}")

if TARGET_COLUMN not in df.columns:
    raise RuntimeError(f"Missing target column: {TARGET_COLUMN}")

X = df[FEATURE_COLUMNS]
y = df[TARGET_COLUMN]

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