import joblib
import sys
import json
import re
import pandas as pd
import numpy as np
from pathlib import Path

# ==========================================
# ROOT PATH
# ==========================================
ROOT = Path(__file__).resolve().parent.parent.parent

MODEL = joblib.load(ROOT / "mlops/models/anomaly/isolation_forest.joblib")
SCALER = joblib.load(ROOT / "mlops/models/anomaly/scaler.joblib")

# ==========================================
# REQUIRED FEATURES
# ==========================================
required = [
    "hour",
    "day",
    "weekend",
    "actor_count_7d",
    "actor_object_7d",
    "time_since_last_actor",
    "first_time_role"
]

EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


# ==========================================
# SCORING FUNCTION
# ==========================================
def score_dataframe(df):
    for col in required:
        if col not in df.columns:
            df[col] = 0

    X = (
        df[required]
        .apply(pd.to_numeric, errors="coerce")
        .replace([np.inf, -np.inf], np.nan)
        .fillna(0)
    )

    X_scaled = SCALER.transform(X)

    df["anomalyScore"] = MODEL.decision_function(X_scaled)
    df["anomaly"] = MODEL.predict(X_scaled)

    return df


# ==========================================
# HELPERS
# ==========================================
def safe_parse_json(value):
    try:
        return json.loads(value)
    except Exception:
        return None


def first_email(value):
    if not value:
        return ""
    m = EMAIL_RE.search(str(value))
    return m.group(0).lower() if m else ""


def safe_parse_message(row):
    raw = row.get("raw") if isinstance(row, dict) else None
    if raw and raw.get("message"):
        return safe_parse_json(raw.get("message"))
    return None


def get_actor_raw(row):
    return (
        row.get("actor")
        or (row.get("raw") or {}).get("user")
        or row.get("user")
        or "Unknown"
    )


def clean_actor_display(value):
    if not value:
        return "Unknown"

    s = str(value).strip()

    email = first_email(s)
    if email:
        return email

    if s.startswith("user/"):
        return s.split("/")[-1]

    if "|" in s:
        after_pipe = s.split("|")[1]
        return after_pipe.split("!")[0]

    if s.startswith("sb-") and "!" in s:
        return s.replace("sb-", "", 1).split("!")[0]

    return s


def clean_target_display(value):
    if not value:
        return "Unknown"

    s = str(value).strip()

    if s == "Unknown":
        return "Unknown"

    email = first_email(s)
    if email:
        return email

    if s.startswith("user/"):
        return s.split("/")[-1]

    return s


def is_human_actor(actor_raw):
    return (
        isinstance(actor_raw, str)
        and (
            actor_raw.startswith("user/")
            or "@" in actor_raw
        )
    )


def is_human_event(row):
    actor_raw = get_actor_raw(row)
    return bool(row.get("isHuman") is True) or is_human_actor(actor_raw)


def normalize_crud(value, fallback="OTHER"):
    v = str(value or fallback or "OTHER").strip().upper()
    if v in ("CREATE", "UPDATE", "DELETE"):
        return v
    return "OTHER"


def extract_crud_type(row, parsed):
    attrs = parsed.get("attributes", []) if parsed else []

    crud = (
        (((parsed or {}).get("object") or {}).get("id") or {}).get("crudType")
        if parsed else None
    )
    if crud:
        return normalize_crud(crud, row.get("action"))

    crud = (
        (((parsed or {}).get("object") or {}).get("id") or {}).get("operationType")
        if parsed else None
    )
    if crud:
        return normalize_crud(crud, row.get("action"))

    for a in attrs:
        if a and a.get("name") == "operation":
            crud = a.get("new") or a.get("old")
            if crud:
                return normalize_crud(crud, row.get("action"))

    crud = parsed.get("crudType") if parsed else None
    if crud:
        return normalize_crud(crud, row.get("action"))

    return normalize_crud(row.get("action"), "OTHER")


def extract_scim_user_info(parsed):
    if not parsed or not isinstance(parsed.get("attributes"), list):
        return {"email": "", "name": ""}

    for attr in parsed["attributes"]:
        if not attr or attr.get("name") != "complete":
            continue

        for payload in [attr.get("new"), attr.get("old")]:
            if not payload:
                continue

            obj = safe_parse_json(payload)
            if not obj or not isinstance(obj, dict):
                continue

            email = ""
            emails = obj.get("emails") or []

            if isinstance(emails, list):
                first = next((e for e in emails if isinstance(e, dict) and e.get("value")), None)
                if first and first.get("value"):
                    email = str(first["value"]).lower()

            if not email and obj.get("externalId"):
                email = first_email(obj.get("externalId"))

            if not email:
                email = first_email(payload)

            name_obj = obj.get("name") or {}
            name = (
                name_obj.get("formatted")
                or " ".join([x for x in [name_obj.get("givenName"), name_obj.get("familyName")] if x]).strip()
            )

            if email or name:
                return {"email": email or "", "name": name or ""}

    return {"email": "", "name": ""}


def extract_role_name(row):
    if not row:
        return ""

    try:
        parsed = safe_parse_json(((row.get("raw") or {}).get("message")) or "{}")
        role = ((((parsed or {}).get("object") or {}).get("id") or {}).get("rolecollection_name"))
        if role:
            return str(role).strip()
    except Exception:
        pass

    details = str(row.get("details") or "").strip()
    if details.startswith("Assigned role: "):
        return details.replace("Assigned role: ", "").strip()

    if (
        row.get("objectType") == "Role Assignment"
        and row.get("target")
        and row.get("target") != "Unknown"
        and row.get("target") != row.get("actor")
    ):
        return str(row.get("target")).strip()

    return ""


def is_explicit_role_assignment(parsed):
    table_name = ((((parsed or {}).get("object") or {}).get("id") or {}).get("tableName"))
    object_type = (((parsed or {}).get("object") or {}).get("type"))
    role_name = ((((parsed or {}).get("object") or {}).get("id") or {}).get("rolecollection_name"))

    return (
        table_name == "xs_rolecollection2user"
        or object_type == "xs_rolecollection2user"
        or bool(role_name)
    )


def build_generic_details(parsed, current_details=""):
    d = str(current_details or "").strip()

    if d and not d.startswith("Assigned role: ") and not d.startswith("User identity updated"):
        return d

    object_node = (parsed or {}).get("object") or {}
    object_id = object_node.get("id") or {}
    table_name = object_id.get("tableName") or ""
    object_type_raw = object_node.get("type") or ""

    if object_type_raw == "Deployment":
        return "Deployment"
    if object_type_raw == "Undeployment":
        return "Undeployment"
    if object_type_raw == "Redeployment":
        return "Redeployment"

    if table_name:
        return f"Configuration updated ({table_name})"

    if object_type_raw:
        return f"Configuration updated ({object_type_raw})"

    return "Configuration updated"


def derive_display_row(row):
    parsed = safe_parse_message(row)

    actor_raw = get_actor_raw(row)
    actor = clean_actor_display(actor_raw)

    action = extract_crud_type(row, parsed)
    target = row.get("target") or "Unknown"
    object_type = row.get("objectType") or "Configuration Change"
    details = row.get("details") or ""

    obj_type = (((parsed or {}).get("object") or {}).get("type")) if parsed else None
    obj_id = (((parsed or {}).get("object") or {}).get("id")) if parsed else {}
    role_name = (obj_id or {}).get("rolecollection_name") or ""

    human = is_human_event(row)

    # 1) SCIM USER UPDATE MUST WIN FIRST
    if obj_type == "scim user":
      scim = extract_scim_user_info(parsed)
      object_type = "User Profile Update"
      target = clean_target_display(
          scim["email"] or (target if target != "Unknown" else actor)
      )
      details = (
          f"User identity updated: {scim['name']} ({scim['email']})"
          if scim["name"] and scim["email"]
          else f"User identity updated: {scim['email']}"
          if scim["email"]
          else details or "User identity updated"
      )
      human = True

    # 2) REAL ROLE ASSIGNMENT ONLY
    elif is_explicit_role_assignment(parsed):
      object_type = "Role Assignment"
      target = clean_target_display(role_name or extract_role_name(row) or target or "Role")
      details = (
          f"Assigned role: {role_name or extract_role_name(row)}"
          if (role_name or extract_role_name(row))
          else "Role assignment"
      )
      human = True

    # 3) GENERIC CONFIG CHANGE
    else:
      object_type = "Configuration Change"
      details = build_generic_details(parsed, details)
      target = clean_target_display(target)
      human = is_human_actor(actor_raw)

    return {
        "uuid": row.get("uuid"),
        "time": row.get("time"),
        "actor": actor or "Unknown",
        "target": target or "Unknown",
        "objectType": object_type or "Configuration Change",
        "action": action or "OTHER",
        "details": details or "",
        "isHuman": bool(human),
        "raw": row.get("raw") or None
    }


# ==========================================
# INPUT MODE SWITCH
# ==========================================
raw = sys.stdin.read() if not sys.stdin.isatty() else ""

# ==========================================
# REAL-TIME EVENT MODE
# ==========================================
if raw.strip():

    log = json.loads(raw)
    df = pd.DataFrame([log])

    df = score_dataframe(df)

    print(
        json.dumps(
            {
                "score": float(df["anomalyScore"].iloc[0]),
                "anomaly": int(df["anomaly"].iloc[0] == -1),
            }
        ),
        flush=True,
    )

# ==========================================
# BATCH SNAPSHOT MODE
# ==========================================
else:

    FEATURES = ROOT / "mlops/data/features/ml_features.parquet"
    RAW_LOGS = ROOT / "data/all_config_logs.json"
    OUTPUT = ROOT / "data/scored_snapshot.json"

    df_feat = pd.read_parquet(FEATURES)

    with open(RAW_LOGS, "r", encoding="utf-8") as f:
        raw_logs = json.load(f)

    normalized_raw_logs = [derive_display_row(log) for log in raw_logs]
    df_raw = pd.DataFrame(normalized_raw_logs)

    df_scored = score_dataframe(df_feat)

    df_final = df_scored.merge(
        df_raw[
            [
                "uuid",
                "action",
                "objectType",
                "details",
                "actor",
                "target",
                "isHuman",
                "time",
                "raw"
            ]
        ],
        on="uuid",
        how="left",
        suffixes=("", "_raw")
    )

    if "time_raw" in df_final.columns:
        df_final["time"] = df_final["time"].fillna(df_final["time_raw"])
        df_final = df_final.drop(columns=["time_raw"])

    df_final["action"] = df_final["action"].fillna("OTHER")
    df_final["objectType"] = df_final["objectType"].fillna("Configuration Change")
    df_final["target"] = df_final["target"].fillna("Unknown")
    df_final["isHuman"] = df_final["isHuman"].fillna(False)
    df_final["details"] = df_final["details"].fillna("")
    df_final["actor"] = df_final["actor"].fillna("Unknown")

    if "raw" not in df_final.columns:
        df_final["raw"] = None

    df_final["anomalyScore"] = df_final["anomalyScore"].fillna(0)
    df_final["anomaly"] = df_final["anomaly"].fillna(1)

    df_final.to_json(
        OUTPUT,
        orient="records",
        indent=2,
        date_format="iso"
    )

    print(
        f"[ML] Snapshot rebuilt with {len(df_final)} logs",
        flush=True
    )