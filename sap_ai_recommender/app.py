from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd
from scipy.sparse import load_npz
from sklearn.metrics.pairwise import cosine_similarity
from difflib import SequenceMatcher
import traceback
import re

app = Flask(__name__)
CORS(app)

# =========================
# LOAD TRAINED ARTIFACTS
# =========================
vectorizer = joblib.load("artifacts/vectorizer.joblib")
model = joblib.load("artifacts/model.joblib")
X = load_npz("artifacts/matrix.npz")
df = pd.read_csv("artifacts/transactions_model.csv")

# =========================
# NORMALIZE DATASET
# =========================
df["Transaction Code"] = (
    df["Transaction Code"]
    .astype(str)
    .str.strip()
    .str.replace('"', "", regex=False)
    .str.upper()
)

df["Transaction Description"] = (
    df["Transaction Description"]
    .fillna("")
    .astype(str)
    .str.strip()
)

df["Program"] = (
    df["Program"]
    .fillna("")
    .astype(str)
    .str.strip()
)

df["_DESC_UP"] = df["Transaction Description"].str.upper()
df["_TCODE_UP"] = df["Transaction Code"].str.upper()

# ====================================================
# HELPERS
# ====================================================
def normalize_query(text: str) -> str:
    return str(text).strip().replace('"', "").upper()

def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))

def lexical_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, a, b).ratio()

def tokenize(text: str):
    return re.findall(r"[A-Z0-9_/]+", str(text).upper())

def token_overlap_score(query: str, desc: str) -> float:
    q_tokens = [t for t in tokenize(query) if len(t) > 2]
    if not q_tokens:
        return 0.0
    d = str(desc).upper()
    hits = sum(1 for t in q_tokens if t in d)
    return hits / max(len(q_tokens), 1)

# ====================================================
# CLUSTER DETECTOR (ENHANCED)
# ====================================================
def detect_cluster(row):
    tcode = str(row["Transaction Code"]).upper()
    desc = str(row["Transaction Description"]).upper()
    prog = str(row["Program"]).upper()

    if tcode.startswith("SM") or any(k in desc for k in [
        "LOG", "PROCESS", "WORK PROCESS", "UPDATE", "LOCK", "SYSTEM LOG", "RFC ERROR", "BACKGROUND JOB"
    ]):
        return "Monitoring"

    if tcode.startswith("SU") or any(k in desc for k in [
        "USER", "ROLE", "AUTH", "AUTHORIZATION", "PROFILE", "LOGIN"
    ]):
        return "User Administration"

    if tcode.startswith("ST") or any(k in desc for k in [
        "PERFORMANCE", "WORKLOAD", "TRACE", "DUMP", "STATISTICS"
    ]):
        return "Performance Monitoring"

    if tcode.startswith("SE") or prog.startswith("SAPLSE"):
        return "Development Tools"

    if tcode.startswith("SP") or any(k in desc for k in [
        "IMG", "CUSTOMIZING", "SETUP", "CONFIGURATION"
    ]):
        return "IMG Customizing"

    if tcode.startswith("DB") or any(k in desc for k in [
        "DATABASE", "DBA", "BACKUP", "LOCKWAITS", "INDEXES", "CONSISTENCY", "TABLES AND INDEXES"
    ]):
        return "Database Administration"

    if any(k in desc for k in [
        "INTEGRATION", "INTERFACE", "IDOC", "QUEUE", "RFC", "BILLING INTEGRATION"
    ]):
        return "Integration"

    if tcode.startswith("HR") or any(k in desc for k in [
        "HUMAN RESOURCES", "HR", "PAYROLL", "PERSONNEL", "TIME MANAGEMENT", "DAQ"
    ]):
        return "HR / HCM"

    if any(k in desc for k in [
        "TABLE", "INDEX", "VIEW", "DICTIONARY"
    ]):
        return "Technical Dictionary"

    if tcode.startswith("IN") or "NETWORK" in desc:
        return "PM Network Planning"

    if tcode.startswith("Z") or tcode.startswith("Y"):
        return "Custom Development"

    if tcode.startswith("/"):
        return "Namespace Development"

    return "Functional Other"

# ====================================================
# ROUTERS / INTENT MAPS
# ====================================================

task_router = {
    "DISPLAY AND DELETE LOCKS": "SM12",
    "DELETE LOCKS": "SM12",
    "LOCK ENTRIES": "SM12",
    "LOCKS": "SM12",
    "SYSTEM LOG": "SM21",
    "BACKGROUND JOB": "SM37",
    "UPDATE RECORDS": "SM13",
    "WORK PROCESS": "SM50",
    "GLOBAL WORK PROCESS": "SM66",
    "RFC ERROR": "SM58"
}

intent_router = {
    "REBOOT": "SM",
    "MONITORING": "SM",
    "SYSTEM MONITORING": "SM",
    "LOCK": "SM",
    "UPDATE": "SM",
    "WORK PROCESS": "SM",
    "SYSTEM LOG": "SM",

    "USER": "SU",
    "ROLE": "SU",
    "AUTH": "SU",
    "LOGIN": "SU",

    "PERFORMANCE": "ST",
    "DUMP": "ST",
    "TRACE": "ST",

    "IMG": "SP",
    "CUSTOMIZING": "SP",

    "DATABASE": "DB",
    "DBA": "DB",
    "INDEX": "DB",
    "TABLE": "DB",

    "INTEGRATION": "INTEGRATION",
    "INTERFACE": "INTEGRATION",

    "HR": "HR",
    "HUMAN RESOURCES": "HR",
    "PERSONNEL": "HR",
    "PAYROLL": "HR",

    "ADMIN": "ADMIN",
    "ADMINISTRATOR": "ADMIN",
    "ADMINISTRATION": "ADMIN"
}

# ====================================================
# RESULT FORMATTER
# ====================================================
def make_result(rank: int, row, score: float):
    return {
        "rank": rank,
        "tcode": str(row["Transaction Code"]),
        "program": str(row["Program"]),
        "desc": str(row["Transaction Description"]),
        "similarity": round(clamp01(score), 4),
        "cluster": detect_cluster(row)
    }

# ====================================================
# RANKERS
# ====================================================
def rank_exact_match(idx: int, query: str = "", top_k: int = 15):
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k, len(df)))

    results = []
    for rank, (dist, j) in enumerate(zip(distances[0], indices[0]), start=1):
        row = df.iloc[j]
        ml_score = 1 - float(dist)
        overlap = token_overlap_score(query, row["Transaction Description"]) if query else 0.0
        final_score = 0.85 * ml_score + 0.15 * overlap
        results.append(make_result(rank, row, final_score))
    return results

def rank_prefix_mode(query: str, prefix_df: pd.DataFrame, top_k: int = 15):
    candidates = prefix_df.copy()

    candidates["lex_score"] = candidates["Transaction Code"].apply(
        lambda x: lexical_similarity(query, str(x))
    )

    anchor_idx = candidates.sort_values(
        by=["lex_score", "Transaction Code"],
        ascending=[False, True]
    ).index[0]

    anchor_vec = X[anchor_idx]
    sims = cosine_similarity(X[candidates.index], anchor_vec).flatten()
    candidates["ml_score"] = sims

    candidates["final_score"] = (
        0.65 * candidates["lex_score"] +
        0.35 * candidates["ml_score"]
    )

    candidates = candidates.sort_values(
        by=["final_score", "Transaction Code"],
        ascending=[False, True]
    ).head(top_k)

    results = []
    for rank, (_, row) in enumerate(candidates.iterrows(), start=1):
        results.append(make_result(rank, row, row["final_score"]))
    return results

def rank_near_code_mode(query: str, top_k: int = 15):
    candidates = df.copy()

    candidates["lex_score"] = candidates["Transaction Code"].apply(
        lambda x: lexical_similarity(query, str(x))
    )

    candidates = candidates[candidates["lex_score"] >= 0.55].copy()

    if candidates.empty:
        return []

    anchor_idx = candidates.sort_values(
        by=["lex_score", "Transaction Code"],
        ascending=[False, True]
    ).index[0]

    anchor_vec = X[anchor_idx]
    sims = cosine_similarity(X[candidates.index], anchor_vec).flatten()
    candidates["ml_score"] = sims

    candidates["final_score"] = (
        0.70 * candidates["lex_score"] +
        0.30 * candidates["ml_score"]
    )

    candidates = candidates.sort_values(
        by=["final_score", "Transaction Code"],
        ascending=[False, True]
    ).head(top_k)

    results = []
    for rank, (_, row) in enumerate(candidates.iterrows(), start=1):
        results.append(make_result(rank, row, row["final_score"]))
    return results

def rank_family_mode(family_code: str, top_k: int = 20):
    fam = df[df["_TCODE_UP"].str.startswith(family_code)].copy()
    if fam.empty:
        return []

    def family_score(row):
        base = 0.30
        desc = str(row["Transaction Description"]).upper()
        tcode = str(row["Transaction Code"]).upper()

        if tcode.startswith(family_code):
            base += 0.20

        if family_code == "SM":
            for kw in ["LOG", "PROCESS", "LOCK", "UPDATE", "JOB", "RFC"]:
                if kw in desc:
                    base += 0.05

        if family_code == "SU":
            for kw in ["USER", "ROLE", "AUTH", "PROFILE"]:
                if kw in desc:
                    base += 0.05

        if family_code == "ST":
            for kw in ["PERFORMANCE", "TRACE", "DUMP", "WORKLOAD"]:
                if kw in desc:
                    base += 0.05

        if family_code == "DB":
            for kw in ["DATABASE", "INDEX", "BACKUP", "DBA", "TABLE"]:
                if kw in desc:
                    base += 0.05

        if family_code == "HR":
            for kw in ["HR", "PAYROLL", "PERSONNEL", "HUMAN RESOURCES"]:
                if kw in desc:
                    base += 0.05

        return clamp01(base)

    fam["final_score"] = fam.apply(family_score, axis=1)
    fam = fam.sort_values(
        by=["final_score", "Transaction Code"],
        ascending=[False, True]
    ).head(top_k)

    results = []
    for rank, (_, row) in enumerate(fam.iterrows(), start=1):
        results.append(make_result(rank, row, row["final_score"]))
    return results

def rank_task_phrase(query: str, exact_code: str, top_k: int = 15):
    match = df[df["_TCODE_UP"] == exact_code]
    if match.empty:
        return []

    idx = match.index[0]
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k, len(df)))

    results = []
    for rank, (dist, j) in enumerate(zip(distances[0], indices[0]), start=1):
        row = df.iloc[j]
        ml_score = 1 - float(dist)
        overlap = token_overlap_score(query, row["Transaction Description"])

        final_score = 0.65 * ml_score + 0.35 * overlap
        results.append(make_result(rank, row, final_score))
    return results

def rank_semantic_text(query: str, top_k: int = 15):
    query_vec = vectorizer.transform([query])

    if query_vec.nnz == 0:
        return []

    distances, indices = model.kneighbors(query_vec, n_neighbors=min(top_k, len(df)))

    results = []
    for rank, (dist, j) in enumerate(zip(distances[0], indices[0]), start=1):
        row = df.iloc[j]
        ml_score = 1 - float(dist)
        overlap = token_overlap_score(query, row["Transaction Description"])

        final_score = 0.70 * ml_score + 0.30 * overlap
        results.append(make_result(rank, row, final_score))

    return results

# ====================================================
# HEALTH
# ====================================================
@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

# ====================================================
# AI SEARCH
# ====================================================
@app.route("/recommend", methods=["POST"])
def recommend():
    try:
        data = request.get_json(silent=True) or {}
        raw_query = data.get("tcode", "")
        query = normalize_query(raw_query)

        if not query:
            return jsonify({
                "query": "",
                "mode": "empty",
                "resolved": "",
                "results": []
            }), 200

        print("Incoming query:", query)

        # 1) highly specific task routing first
        for phrase, exact_tcode in task_router.items():
            if phrase in query:
                print(f"Task matched: {phrase} -> {exact_tcode}")
                results = rank_task_phrase(query, exact_tcode, top_k=15)
                return jsonify({
                    "query": query,
                    "mode": "task",
                    "resolved": exact_tcode,
                    "results": results
                }), 200

        # 2) exact T-code first
        exact = df[df["_TCODE_UP"] == query]
        if not exact.empty:
            idx = exact.index[0]
            results = rank_exact_match(idx, query=query, top_k=15)
            return jsonify({
                "query": query,
                "mode": "exact",
                "resolved": query,
                "results": results
            }), 200

        # 3) near-code / typo / short partial like SE8 -> SE80
        if len(query) >= 2:
            near_code_results = rank_near_code_mode(query, top_k=15)
            if near_code_results:
                return jsonify({
                    "query": query,
                    "mode": "near-code",
                    "resolved": query,
                    "results": near_code_results
                }), 200

        # 4) broader intent routing
        routed = query
        for key, mapped in intent_router.items():
            if key in query:
                routed = mapped
                print(f"Intent matched: {key} -> {mapped}")
                break

        # 5) family/domain mode for exact family tokens
        if len(routed) in [2, 3]:
            family_results = rank_family_mode(routed, top_k=20)
            if family_results:
                return jsonify({
                    "query": query,
                    "mode": "family",
                    "resolved": routed,
                    "results": family_results
                }), 200

        # 6) semantic text fallback
        if len(query) >= 3:
            results = rank_semantic_text(query, top_k=15)
            return jsonify({
                "query": query,
                "mode": "semantic",
                "resolved": routed,
                "results": results
            }), 200

        return jsonify({
            "query": query,
            "mode": "none",
            "resolved": "",
            "results": []
        }), 200

    except Exception:
        traceback.print_exc()
        return jsonify({
            "query": "",
            "mode": "error",
            "resolved": "",
            "results": []
        }), 200

# ====================================================
# RUN
# ====================================================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9090)