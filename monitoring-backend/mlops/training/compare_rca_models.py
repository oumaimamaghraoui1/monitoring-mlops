# mlops/training/compare_rca_models.py

import os
from pathlib import Path
import joblib
import pandas as pd

from sklearn.model_selection import train_test_split
from sklearn.preprocessing import LabelEncoder, StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    classification_report,
    confusion_matrix,
    accuracy_score,
    precision_recall_fscore_support
)

from sklearn.ensemble import (
    RandomForestClassifier,
    ExtraTreesClassifier
)
from sklearn.linear_model import LogisticRegression

BASE_DIR = Path(__file__).resolve().parents[2]
OUT_DIR = Path(
    os.getenv(
        "RCA_OUTPUT_DIR",
        str(BASE_DIR / "mlops" / "models" / "rca_comparison")
    )
)


def resolve_rca_dataset_path():
    mode = os.getenv("RCA_DATA_MODE", "").strip().lower()

    synthetic_path = BASE_DIR / "mlops" / "data" / "processed" / "rca_ci_dataset.csv"
    local_real_default = BASE_DIR / "mlops" / "data" / "rca" / "rca_dataset_clean.csv"
    real_path_raw = os.getenv("RCA_DATASET_PATH", "").strip()

    if mode == "real":
        if not real_path_raw:
            raise RuntimeError("RCA_DATASET_PATH is required when RCA_DATA_MODE=real")

        real_path = Path(real_path_raw)
        if not real_path.exists():
            raise RuntimeError(f"Real RCA dataset not found: {real_path}")

        print("✅ Real evaluation mode — using protected local RCA dataset")
        return real_path

    if mode == "synthetic":
        if not synthetic_path.exists():
            raise RuntimeError(f"Synthetic RCA dataset not found: {synthetic_path}")

        print("✅ Synthetic mode — using CI RCA dataset")
        return synthetic_path

    if os.getenv("CI"):
        print("✅ CI environment detected — using synthetic RCA dataset")

        if not synthetic_path.exists():
            raise RuntimeError(f"Synthetic RCA dataset not found: {synthetic_path}")

        return synthetic_path

    print("✅ Local environment — using real RCA dataset")

    if not local_real_default.exists():
        raise RuntimeError(f"Local real RCA dataset not found: {local_real_default}")

    return local_real_default


def main():
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    data_path = resolve_rca_dataset_path()
    print("📂 Loading RCA dataset from:", data_path)
    print("📁 Output directory:", OUT_DIR)

    df = pd.read_csv(data_path)
    print("Dataset shape:", df.shape)

    feature_columns = [
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

    target_column = "cause"

    missing_features = [col for col in feature_columns if col not in df.columns]
    if missing_features:
        raise RuntimeError(f"Missing required feature columns: {missing_features}")

    if target_column not in df.columns:
        raise RuntimeError(f"Missing target column: {target_column}")

    required_columns = feature_columns + [target_column]
    if df[required_columns].isnull().any().any():
        raise RuntimeError("Dataset contains missing values in required columns")

    X = df[feature_columns]
    y = df[target_column]

    print("\nClass distribution:")
    print(y.value_counts())

    label_encoder = LabelEncoder()
    y_encoded = label_encoder.fit_transform(y)

    print("\nEncoded classes:", list(label_encoder.classes_))

    X_train, X_test, y_train, y_test = train_test_split(
        X,
        y_encoded,
        test_size=0.2,
        random_state=42,
        stratify=y_encoded
    )

    models = {
        "LogisticRegression": Pipeline([
            ("scaler", StandardScaler()),
            ("clf", LogisticRegression(
                max_iter=2000,
                random_state=42,
                class_weight="balanced"
            ))
        ]),
        "RandomForest": RandomForestClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            class_weight="balanced",
            n_jobs=-1
        ),
        "ExtraTrees": ExtraTreesClassifier(
            n_estimators=300,
            max_depth=None,
            min_samples_split=5,
            min_samples_leaf=2,
            random_state=42,
            class_weight="balanced",
            n_jobs=-1
        )
    }

    summary_rows = []

    for model_name, model in models.items():
        print(f"\n=== Training {model_name} ===")
        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)

        accuracy = accuracy_score(y_test, y_pred)
        precision_macro, recall_macro, f1_macro, _ = precision_recall_fscore_support(
            y_test, y_pred, average="macro", zero_division=0
        )
        precision_weighted, recall_weighted, f1_weighted, _ = precision_recall_fscore_support(
            y_test, y_pred, average="weighted", zero_division=0
        )

        report = classification_report(
            y_test,
            y_pred,
            target_names=label_encoder.classes_,
            output_dict=True,
            zero_division=0
        )

        report_df = pd.DataFrame(report).transpose()
        report_df.to_csv(OUT_DIR / f"{model_name}_classification_report.csv")

        cm = confusion_matrix(y_test, y_pred)
        cm_df = pd.DataFrame(
            cm,
            index=label_encoder.classes_,
            columns=label_encoder.classes_
        )
        cm_df.to_csv(OUT_DIR / f"{model_name}_confusion_matrix.csv")

        pred_df = pd.DataFrame({
            "y_true": label_encoder.inverse_transform(y_test),
            "y_pred": label_encoder.inverse_transform(y_pred)
        })
        pred_df.to_csv(OUT_DIR / f"{model_name}_predictions.csv", index=False)

        if hasattr(model, "feature_importances_"):
            fi_df = pd.DataFrame({
                "feature": feature_columns,
                "importance": model.feature_importances_
            }).sort_values("importance", ascending=False)
            fi_df.to_csv(OUT_DIR / f"{model_name}_feature_importance.csv", index=False)

        summary_rows.append({
            "model": model_name,
            "accuracy": round(accuracy, 4),
            "precision_macro": round(precision_macro, 4),
            "recall_macro": round(recall_macro, 4),
            "f1_macro": round(f1_macro, 4),
            "precision_weighted": round(precision_weighted, 4),
            "recall_weighted": round(recall_weighted, 4),
            "f1_weighted": round(f1_weighted, 4)
        })

        print(f"Accuracy: {accuracy:.4f}")
        print(f"Precision macro: {precision_macro:.4f}")
        print(f"Recall macro: {recall_macro:.4f}")
        print(f"F1 macro: {f1_macro:.4f}")
        print(f"F1 weighted: {f1_weighted:.4f}")

    summary_df = pd.DataFrame(summary_rows).sort_values(
        by=["f1_macro", "f1_weighted", "accuracy"],
        ascending=False
    )

    summary_df.to_csv(OUT_DIR / "model_comparison_summary.csv", index=False)

    best_model_name = summary_df.iloc[0]["model"]
    best_model = models[best_model_name]

    joblib.dump(best_model, OUT_DIR / f"{best_model_name}_model.pkl")
    joblib.dump(label_encoder, OUT_DIR / "label_encoder.pkl")

    metadata = {
        "dataset_path": str(data_path),
        "features": feature_columns,
        "target": target_column,
        "classes": list(label_encoder.classes_),
        "test_size": 0.2,
        "random_state": 42,
        "best_model": best_model_name
    }
    joblib.dump(metadata, OUT_DIR / "metadata.pkl")

    print("\n=== Final comparison summary ===")
    print(summary_df.to_string(index=False))
    print(f"\n✅ RCA comparison files saved in: {OUT_DIR}")
    print(f"✅ Best model saved as: {best_model_name}_model.pkl")


if __name__ == "__main__":
    main()