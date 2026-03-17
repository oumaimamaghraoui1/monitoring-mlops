import json, re, hashlib, shutil
from pathlib import Path
from datetime import datetime, timezone
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]

SRC_LOGS = BASE_DIR / "data"
RAW_DIR  = BASE_DIR / "mlops" / "data" / "raw"
OUT_FILE = BASE_DIR / "mlops" / "data" / "processed" / "ml_events.parquet"

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")

def first_email(s):
    if not s: return None
    m = EMAIL_RE.search(str(s))
    return m.group(0) if m else None

def to_utc(ts):
    try:
        dt = datetime.fromisoformat(str(ts).replace("Z","+00:00"))
        return dt.astimezone(timezone.utc)
    except:
        return None

def sha(s):
    return hashlib.sha256(s.encode()).hexdigest()

def snapshot_logs():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    for f in SRC_LOGS.glob("*.json"):
        shutil.copy(f, RAW_DIR / f.name)

def normalize_config(log):

    # Sometimes SAP wraps log as string
    if isinstance(log, str):
        try:
            log = json.loads(log)
        except:
            return None

    raw = log.get("raw", {})

    msg = raw.get("message")

    # SAP embeds JSON inside string → parse again
    if isinstance(msg, str):
        try:
            msg = json.loads(msg)
        except:
            msg = {}

    if not isinstance(msg, dict):
        return None

    obj = msg.get("object", {})
    idd = obj.get("id", {})

    # ✅ ROLE COLLECTION EXTRACTION (IMPORTANT)
    details = (
        idd.get("rolecollection_name")
        or idd.get("role_name")
        or idd.get("scope_name")
        or idd.get("object_id")
        or ""
    )

    # ✅ CRUD ACTION
    action = idd.get("crudType") or "UPDATE"

    # ✅ ROLE ASSIGNMENT DETECTION
    if idd.get("tableName") == "xs_rolecollection2user":
        object_type = "Role Assignment"
    else:
        object_type = "Configuration Change"

    # ✅ ACTOR EXTRACTION FROM SAP PATH
    actor = (
        first_email(msg.get("user"))
        or first_email(raw.get("user"))
        or first_email(log.get("actor"))
        or "Unknown"
    )

    # ✅ UUID IS INSIDE msg NOT log
    event_id = (
        msg.get("uuid")
        or log.get("uuid")
        or sha(json.dumps(log))
    )

    return {
        "event_id": event_id,
        "time": to_utc(log.get("time")),
        "actor": actor,
        "action": action,
        "object_type": object_type,
        "details": details,
        "target": "Unknown",
        "success": msg.get("success", True)
    }

def main():

    snapshot_logs()

    rows = []

    for f in RAW_DIR.glob("*.json"):
        with open(f) as fp:
            data = json.load(fp)

        for log in data:
            row = normalize_config(log)
            if row:
                rows.append(row)

    df = pd.DataFrame(rows)
    df = df.dropna(subset=["time"])
    df = df.sort_values("time")
    df = df.drop_duplicates(subset=["event_id"])

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_FILE,index=False)

    print("✅ ml_events.parquet created")

if __name__ == "__main__":
    main()