import json
import shutil
from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]

SRC_LOGS_FILE = BASE_DIR / "data" / "all_config_logs.json"
RAW_DIR = BASE_DIR / "mlops" / "data" / "raw"
OUT_FILE = BASE_DIR / "mlops" / "data" / "processed" / "ml_events.parquet"


def snapshot_logs():
    """
    Keep only the audit log source needed for the anomaly pipeline.
    This avoids copying unrelated JSON files (baseline, alerts, etc.)
    that break normalization.
    """
    RAW_DIR.mkdir(parents=True, exist_ok=True)

    # clean previous raw snapshots
    for f in RAW_DIR.glob("*.json"):
      try:
        f.unlink()
      except Exception:
        pass

    if not SRC_LOGS_FILE.exists():
        raise FileNotFoundError(f"Missing source log file: {SRC_LOGS_FILE}")

    shutil.copy(SRC_LOGS_FILE, RAW_DIR / SRC_LOGS_FILE.name)


def load_json_records(file_path):
    """
    Supports:
      - [ {...}, {...} ]
      - { "logs": [ {...}, {...} ] }
    Returns a list in all cases.
    """
    with open(file_path, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    if isinstance(data, list):
        return data

    if isinstance(data, dict):
        if isinstance(data.get("logs"), list):
            return data["logs"]
        return []

    return []


def normalize_config(log):
    """
    Normalize one audit log row for downstream feature generation.
    Returns None if the row is invalid.
    """
    if not isinstance(log, dict):
        return None

    raw = log.get("raw") or {}
    if not isinstance(raw, dict):
        raw = {}

    msg = raw.get("message")
    parsed = {}

    if msg and isinstance(msg, str):
        try:
            parsed = json.loads(msg)
        except Exception:
            parsed = {}

    # Resolve timestamp safely
    time_value = log.get("time") or raw.get("time") or parsed.get("time")
    dt = pd.to_datetime(time_value, errors="coerce", utc=True)
    if pd.isna(dt):
        return None

    actor = (
        log.get("actor")
        or raw.get("user")
        or parsed.get("user")
        or "Unknown"
    )

    action = log.get("action") or "OTHER"
    object_type = log.get("objectType") or "Configuration Change"
    details = log.get("details") or ""
    target = log.get("target") or "Unknown"
    is_human = bool(log.get("isHuman", False))

    return {
        "uuid": log.get("uuid") or raw.get("message_uuid"),
        "time": dt.isoformat(),
        "actor": actor,
        "action": action,
        "objectType": object_type,
        "details": details,
        "target": target,
        "isHuman": is_human,

        # behavioral / normalized fields
        "hour": int(dt.hour),
        "day": int(dt.dayofweek),
        "weekend": 1 if int(dt.dayofweek) >= 5 else 0,

        # raw-message indicators
        "raw_message_present": 1 if msg else 0,
        "parsed_type": ((parsed.get("object") or {}).get("type")) if parsed else ""
    }


def main():
    snapshot_logs()

    rows = []

    for f in RAW_DIR.glob("*.json"):
        records = load_json_records(f)

        for log in records:
            row = normalize_config(log)
            if row:
                rows.append(row)

    df = pd.DataFrame(rows)

    if df.empty:
        raise RuntimeError("No valid audit rows found during normalization")

    df = df.dropna(subset=["time"])
    df = df.sort_values("time")
    df = df.drop_duplicates(subset=["uuid"], keep="last")

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_FILE, index=False)

    print("✅ ml_events.parquet created")


if __name__ == "__main__":
    main()
