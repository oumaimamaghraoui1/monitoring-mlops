from pathlib import Path
import re
import joblib
import numpy as np
import pandas as pd
import subprocess
import sys
from flask import Flask, request, jsonify
from flask_cors import CORS
from scipy.sparse import load_npz, hstack
from sklearn.metrics.pairwise import cosine_similarity
from difflib import SequenceMatcher

BASE_DIR = Path(__file__).resolve().parent

ARTIFACTS_DIR = Path("/tmp/sap_ai_recommender_artifacts")
ARTIFACTS_DIR.mkdir(parents=True, exist_ok=True)

VECTORIZER_PATH = ARTIFACTS_DIR / "vectorizer.joblib"
MODEL_PATH = ARTIFACTS_DIR / "model.joblib"
MATRIX_PATH = ARTIFACTS_DIR / "matrix.npz"
DATA_PATH = ARTIFACTS_DIR / "transactions_model.csv"
RAW_INPUT_PATH = BASE_DIR / "data" / "transactions.csv"

def ensure_artifacts():
    required_files = [VECTORIZER_PATH, MODEL_PATH, MATRIX_PATH, DATA_PATH]

    if all(p.exists() for p in required_files):
        return

    print("Artifacts missing. Rebuilding artifacts in /tmp...")

    subprocess.run(
        [
            sys.executable,
            str(BASE_DIR / "preprocess_transactions.py"),
            "--input",
            str(RAW_INPUT_PATH),
        ],
        check=True,
        cwd=str(BASE_DIR),
    )

    env = os.environ.copy()
    env["ARTIFACTS_DIR"] = str(ARTIFACTS_DIR)

    subprocess.run(
        [
            sys.executable,
            str(BASE_DIR / "train_recommender.py"),
        ],
        check=True,
        cwd=str(BASE_DIR),
        env=env,
    )

ensure_artifacts()

TOP_K = 15
RERANK_POOL = 15

MIN_SCORE_EXACT = 0.22
MIN_SCORE_NEAR = 0.30
MIN_SCORE_TASK = 0.24
MIN_SCORE_SEMANTIC = 0.20
MIN_SCORE_FAMILY = 0.30

QUERY_ALIAS_ROUTER = {
    "CHECK PAYROLL AREA RUN PAYROLL": "HRPAY00_RPUCPA00",
    "TOTAL PAYMENT CONFIGURATION": "HRPAYCNTPM_CONF",
    "DISPLAY CONSTRUCTION SITES": "HRPAYDEBSA",
    "MAINTAIN CONSTRUCTION SITES": "HRPAYDEBSP",
    "NOTIFICATION PROCESSOR": "HRPAYDEE2PKV_PROCESS",
    "CREATE SALES REPRESENTATIVE": "VPE1",
    "DISPLAY SALES REPRESENTATIVE": "VPE3",
    "MANAGE RETROACTIVE MASTER DATA CHANGES": "/ACCGO/BACKDATED",
    "VIEW CONTRACT SNAPSHOT HISTORY": "/ACCGO/CAK_SNAPSHOTS",
    "REPORT ON CONTRACT CHANGES": "/ACCGO/CHNG_LOG_DISP",
    "SHOW SETTLEMENT UNIT": "/ACCGO/CAS_STLDOCDIS",
    "SHOW MASTER TO STATUS ASSIGNMENT": "/ACCGO/AS_MD_STS",
    "TRACK REASON CODES": "/ACCGO/CAK_RC_TRACE",
    "COMMON UI CONFIGURATION": "/ACCGO/COMMON_UI",
    "REPORT FOR CONTRACT HEADER CORRECTION": "/ACCGO/CAKHDR_CORR",
    "BATCH INPUT FOR CLOSING CONTRACTS": "/ACCGO/CAK_CCL_BI",
}

task_router = {
    "CREATE MATERIAL": "MM01",
    "CHANGE MATERIAL": "MM02",
    "DISPLAY MATERIAL": "MM03",
}

print("Loading artifacts...")
vectorizer = joblib.load(VECTORIZER_PATH)
model = joblib.load(MODEL_PATH)
X = load_npz(MATRIX_PATH)
df = pd.read_csv(DATA_PATH, low_memory=False)

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
df["_PROG_UP"] = df["Program"].str.upper()

print(f"Loaded {len(df)} transactions from {DATA_PATH}")

app = Flask(__name__)
CORS(app)


def normalize_query(text: str) -> str:
    return str(text).strip().replace('"', "").upper()


def clamp01(x: float) -> float:
    return max(0.0, min(1.0, float(x)))


def lexical_similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, str(a).upper(), str(b).upper()).ratio()


def lexical_desc_similarity(query: str, desc: str) -> float:
    return SequenceMatcher(None, normalize_query(query), normalize_query(desc)).ratio()


def tokenize(text: str):
    return re.findall(r"[A-Z0-9_/]+", str(text).upper())


def token_overlap_score(query: str, desc: str) -> float:
    q_tokens = [t for t in tokenize(query) if len(t) > 2]
    if not q_tokens:
        return 0.0
    d = str(desc).upper()
    hits = sum(1 for t in q_tokens if t in d)
    return hits / max(len(q_tokens), 1)


def is_code_like(query: str) -> bool:
    q = normalize_query(query)
    return bool(re.fullmatch(r"[\/A-Z0-9_]+", q)) and len(q) <= 24


def is_exact_tcode_query(query: str) -> bool:
    q = normalize_query(query)
    if not q or " " in q:
        return False
    return bool(re.fullmatch(r"[\/A-Z0-9_]+", q)) and any(ch.isdigit() for ch in q) and len(q) <= 30


def is_prefix_code_query(query: str) -> bool:
    q = normalize_query(query)
    if not q or " " in q:
        return False
    return bool(re.fullmatch(r"[\/A-Z0-9_]+", q)) and len(q) >= 2 and len(q) <= 12


def is_family_query(query: str) -> bool:
    q = normalize_query(query)
    return len(q) in [2, 3] and q.isalpha()


def get_family_prefix(tcode: str) -> str:
    t = str(tcode).upper().strip()
    if not t:
        return ""
    if t.startswith("/"):
        parts = [p for p in t.split("/") if p]
        if parts:
            return parts[-1][:2]
    return t[:2]


def same_family_code(a: str, b: str) -> bool:
    return get_family_prefix(a) == get_family_prefix(b)


def dedupe_results(results):
    seen = set()
    unique = []
    for item in results:
        key = str(item.get("tcode", "")).upper()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique


def detect_cluster(row):
    tcode = str(row["Transaction Code"]).upper()
    desc = str(row["Transaction Description"]).upper()
    if tcode.startswith("HR") or any(k in desc for k in ["PAYROLL", "PERSONNEL", "HUMAN RESOURCES", "EMPLOYEE"]):
        return "HR / HCM"
    if "WORKBENCH" in desc:
        return "Workbench"
    if "CONFIG" in desc or "CONFIGURATION" in desc:
        return "Configuration"
    return "Functional Other"


def make_result(row, score: float):
    return {
        "tcode": str(row["Transaction Code"]).upper(),
        "program": str(row["Program"]),
        "description": str(row["Transaction Description"]),
        "cluster": detect_cluster(row),
        "score": round(float(score), 6),
    }


def build_query_vector(query: str):
    if isinstance(vectorizer, dict):
        word_vec = vectorizer["word_vectorizer"].transform([query])
        char_vec = vectorizer["char_vectorizer"].transform([query])
        return hstack([word_vec, char_vec]).tocsr()
    return vectorizer.transform([query])


def query_action_tokens(query: str):
    q = normalize_query(query)
    action_map = {
        "CREATE": {"CREATE", "NEW", "ADD", "GENERATE", "OPEN"},
        "CHANGE": {"CHANGE", "MODIFY", "EDIT", "UPDATE", "MAINTAIN", "MAINTENANCE", "MANAGE"},
        "DISPLAY": {"DISPLAY", "SHOW", "VIEW", "READ", "TRACK"},
        "DELETE": {"DELETE", "REMOVE", "CANCEL"},
        "PROCESS": {"PROCESS", "PROCESSOR", "PROCESSING", "RUN", "EXECUTE", "TEST"},
        "CONFIG": {"CONFIG", "CONFIGURATION", "SETUP", "CUSTOMIZING", "CONFIGURE"},
        "LIST": {"LIST", "OVERVIEW", "WORKLIST", "HISTORY"},
        "REPORT": {"REPORT", "REPORTING", "LOG"},
    }
    q_tokens = set(tokenize(q))
    found = set()
    for label, variants in action_map.items():
        if q_tokens.intersection(variants):
            found.add(label)
    return found


def row_action_tokens(row) -> set:
    desc = str(row["Transaction Description"]).upper()
    d_tokens = set(tokenize(desc))
    action_map = {
        "CREATE": {"CREATE", "NEW", "ADD", "GENERATE", "OPEN"},
        "CHANGE": {"CHANGE", "MODIFY", "EDIT", "UPDATE", "MAINTAIN", "MAINTENANCE", "MANAGE"},
        "DISPLAY": {"DISPLAY", "SHOW", "VIEW", "READ", "TRACK"},
        "DELETE": {"DELETE", "REMOVE", "CANCEL"},
        "PROCESS": {"PROCESS", "PROCESSOR", "PROCESSING", "RUN", "EXECUTE", "TEST"},
        "CONFIG": {"CONFIG", "CONFIGURATION", "SETUP", "CUSTOMIZING", "CONFIGURE"},
        "LIST": {"LIST", "OVERVIEW", "WORKLIST", "HISTORY"},
        "REPORT": {"REPORT", "REPORTING", "LOG"},
    }
    found = set()
    for label, variants in action_map.items():
        if d_tokens.intersection(variants):
            found.add(label)
    return found


def action_alignment_bonus(query: str, row) -> float:
    q_actions = query_action_tokens(query)
    if not q_actions:
        return 0.0

    r_actions = row_action_tokens(row)
    overlap = q_actions.intersection(r_actions)

    if overlap:
        return min(0.16, 0.08 * len(overlap))

    if "DISPLAY" in q_actions and any(a in r_actions for a in {"CREATE", "CHANGE", "CONFIG", "PROCESS"}):
        return -0.14
    if "CREATE" in q_actions and any(a in r_actions for a in {"DISPLAY", "CHANGE"}):
        return -0.12
    if "CHANGE" in q_actions and "DISPLAY" in r_actions:
        return -0.10
    if "CONFIG" in q_actions and any(a in r_actions for a in {"DISPLAY", "REPORT"}):
        return -0.10
    if "REPORT" in q_actions and any(a in r_actions for a in {"CONFIG", "CREATE", "CHANGE"}):
        return -0.10

    return -0.08


def program_similarity_bonus(program_a: str, program_b: str) -> float:
    a = str(program_a).upper().strip()
    b = str(program_b).upper().strip()
    if not a or not b:
        return 0.0
    if a == b:
        return 0.15
    if len(a) >= 5 and len(b) >= 5 and a[:5] == b[:5]:
        return 0.08
    if len(a) >= 3 and len(b) >= 3 and a[:3] == b[:3]:
        return 0.04
    return 0.0


def is_generic_user_noise(row) -> bool:
    desc = str(row["Transaction Description"]).upper()
    tcode = str(row["Transaction Code"]).upper()
    generic_patterns = [
        "USER NAME FOR USER FIELD", "USER FIELD 1", "USER FIELD 2", "USER FIELD 3",
        "USER FIELD 4", "USER FIELD 5", "USER FIELD 6", "USER FIELD 7",
        "USER FIELD 8", "USER FIELD 9", "USER FIELD 10", "USER FIELD 11",
        "USER FIELD 12", "NAME FOR USER FIELD"
    ]
    if tcode.startswith("OITM"):
        return True
    return any(p in desc for p in generic_patterns)


def business_relation_bonus(anchor_tcode: str, candidate_tcode: str) -> float:
    anchor = str(anchor_tcode).upper()
    candidate = str(candidate_tcode).upper()
    business_relations = {
        "MM01": {"MM02", "MM03", "MM17", "MM50"},
        "SU01": {"SU10", "SUIM", "PFCG"},
        "SE38": {"SE80", "SE37", "SE11"},
        "SE11": {"SE16", "SE16N", "SE80"},
    }
    if anchor == candidate:
        return 0.25
    related = business_relations.get(anchor, set())
    if candidate in related:
        return 0.18
    return 0.0


def exact_prefix_match_bonus(query: str, code: str) -> float:
    q = normalize_query(query)
    c = normalize_query(code)
    if not q or not c:
        return 0.0
    if c == q:
        return 0.35
    if c.startswith(q):
        return 0.28
    if len(q) >= 2 and c[:2] == q[:2]:
        return 0.14
    if len(q) >= 1 and c[:1] == q[:1]:
        return 0.04
    return -0.18


def positional_code_similarity(query: str, code: str) -> float:
    q = normalize_query(query)
    c = normalize_query(code)
    if not q or not c:
        return 0.0
    max_len = max(len(q), len(c))
    score = 0.0
    for i in range(min(len(q), len(c))):
        if q[i] == c[i]:
            score += 0.30 if i == 0 else 0.25 if i == 1 else 0.20 if i == 2 else 0.10
        else:
            score -= 0.35 if i == 0 else 0.25 if i == 1 else 0.08
    if abs(len(c) - len(q)) <= 1:
        score += 0.08
    elif abs(len(c) - len(q)) <= 2:
        score += 0.03
    score = score / max(max_len, 1)
    return max(-0.30, min(0.35, score))


def accgo_namespace_bonus(query: str, row) -> float:
    q = normalize_query(query)
    tcode = str(row["Transaction Code"]).upper()
    desc = str(row["Transaction Description"]).upper()

    accgo_clues = [
        "CONTRACT", "SETTLEMENT", "SNAPSHOT", "RETROACTIVE", "REASON",
        "COUNTERPARTY", "CANCELLATION", "TRUE-UP", "APPLICATION",
        "PRICE", "QUOTE", "FBO", "WORK LIST", "UI", "STATUS"
    ]

    if tcode.startswith("/ACCGO/"):
        if any(clue in q for clue in accgo_clues):
            return 0.12
        if "ACCGO" in q:
            return 0.15
        if any(clue in desc for clue in accgo_clues):
            return 0.05
    return 0.0


def filter_results(results, min_score: float, top_k: int = TOP_K):
    filtered = [r for r in results if float(r["score"]) >= min_score]
    filtered = dedupe_results(filtered)
    filtered.sort(key=lambda x: (-x["score"], x["tcode"]))

    cleaned = []
    for item in filtered:
        tcode = str(item["tcode"]).upper()
        score = float(item["score"])
        if tcode.startswith("OITM") and score < 0.40:
            continue
        cleaned.append(item)

    return cleaned[:top_k]


def recommend_code_first(query: str, top_k: int = TOP_K):
    q = normalize_query(query)
    if not q:
        return []

    # hard exact match first
    exact = df[df["_TCODE_UP"] == q]
    exact_results = []
    if not exact.empty:
        exact_row = exact.iloc[0]
        exact_results.append(make_result(exact_row, 1.0))

    candidates = df.copy()

    def code_score(row):
        code = str(row["Transaction Code"]).upper()
        desc = str(row["Transaction Description"]).upper()

        if code == q:
            return 1000.0  # hard override

        score = 0.0

        if code.startswith(q):
            score += 12.0

        if q.startswith(code):
            score += 2.0

        lex = lexical_similarity(q, code)
        score += 5.0 * lex

        if same_family_code(q, code):
            score += 2.0

        if len(q) >= 2 and len(code) >= 2 and code[:2] == q[:2]:
            score += 1.2

        if len(q) >= 1 and len(code) >= 1 and code[0] == q[0]:
            score += 0.3

        if q in desc:
            score += 0.3

        return score

    candidates["code_score"] = candidates.apply(code_score, axis=1)
    candidates = candidates[candidates["code_score"] > 0].copy()

    if candidates.empty:
        return exact_results[:top_k]

    candidates = candidates.sort_values(
        by=["code_score", "Transaction Code"],
        ascending=[False, True]
    )

    results = []
    seen = set()

    # exact row first
    for item in exact_results:
        seen.add(item["tcode"])
        results.append(item)

    # non-exact candidates with smoother normalization
    non_exact = candidates[candidates["_TCODE_UP"] != q].head(top_k * 3)

    if not non_exact.empty:
        max_non_exact = float(non_exact["code_score"].max())

        for _, row in non_exact.iterrows():
            tcode = str(row["Transaction Code"]).upper()
            if tcode in seen:
                continue

            raw = float(row["code_score"])
            norm = 0.35 + 0.60 * (raw / max_non_exact) if max_non_exact > 0 else 0.35
            norm = min(norm, 0.95)

            results.append(make_result(row, norm))
            seen.add(tcode)

            if len(results) >= top_k:
                break

    return results[:top_k]

def rank_alias_match(exact_code: str, query: str = "", top_k: int = TOP_K):
    match = df[df["_TCODE_UP"] == normalize_query(exact_code)]
    if match.empty:
        return []

    idx = match.index[0]
    anchor_row = df.iloc[idx]
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))

    exact_result = make_result(anchor_row, 1.0)
    rescored = []

    for dist, j in zip(distances[0], indices[0]):
        if j == idx:
            continue

        row = df.iloc[j]
        candidate_tcode = str(row["Transaction Code"]).upper()
        anchor_tcode = str(anchor_row["Transaction Code"]).upper()

        ml_score = 1 - float(dist)
        overlap = token_overlap_score(query, row["Transaction Description"])
        desc_lex = lexical_desc_similarity(query, row["Transaction Description"])
        action_bonus = action_alignment_bonus(query, row)
        family_bonus = 0.14 if same_family_code(anchor_tcode, candidate_tcode) else -0.06
        accgo_bonus = accgo_namespace_bonus(query, row)
        noise_penalty = -0.12 if is_generic_user_noise(row) else 0.0

        final_score = (
            0.32 * ml_score +
            0.20 * overlap +
            0.14 * desc_lex +
            family_bonus +
            action_bonus +
            accgo_bonus +
            noise_penalty
        )

        rescored.append(make_result(row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["score"], x["tcode"]))
    return filter_results([exact_result] + rescored, MIN_SCORE_TASK, top_k)


def rank_exact_match(idx: int, query: str = "", top_k: int = TOP_K):
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))
    anchor_row = df.iloc[idx]
    anchor_tcode = str(anchor_row["Transaction Code"]).upper()
    anchor_prog = str(anchor_row["Program"]).upper()
    anchor_cluster = detect_cluster(anchor_row)
    exact_result = make_result(anchor_row, 1.0)
    rescored = []

    for dist, j in zip(distances[0], indices[0]):
        if j == idx:
            continue

        row = df.iloc[j]
        candidate_tcode = str(row["Transaction Code"]).upper()
        candidate_prog = str(row["Program"]).upper()
        candidate_cluster = detect_cluster(row)

        ml_score = 1 - float(dist)
        overlap = token_overlap_score(query, row["Transaction Description"])
        lex_code = lexical_similarity(anchor_tcode, candidate_tcode)
        accgo_bonus = accgo_namespace_bonus(query, row)

        final_score = (
            0.44 * ml_score +
            0.08 * overlap +
            (0.18 if same_family_code(anchor_tcode, candidate_tcode) else -0.10) +
            (0.08 if candidate_cluster == anchor_cluster else 0.0) +
            program_similarity_bonus(anchor_prog, candidate_prog) +
            business_relation_bonus(anchor_tcode, candidate_tcode) +
            0.18 * lex_code +
            action_alignment_bonus(query, row) +
            accgo_bonus +
            (-0.18 if is_generic_user_noise(row) else 0.0)
        )

        rescored.append(make_result(row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["score"], x["tcode"]))
    return filter_results([exact_result] + rescored, MIN_SCORE_EXACT, top_k)


def rank_near_code_mode(query: str, top_k: int = TOP_K):
    q = normalize_query(query)
    candidates = df.copy()
    candidates["lex_score"] = candidates["Transaction Code"].apply(lambda x: lexical_similarity(q, str(x)))
    candidates = candidates[candidates["lex_score"] >= 0.45].copy()

    if candidates.empty:
        return []

    def candidate_gate_score(code):
        code = str(code).upper()
        score = 0.0
        if code == q:
            score += 1.0
        if code.startswith(q):
            score += 0.8
        if same_family_code(q, code):
            score += 0.45
        if len(q) >= 2 and len(code) >= 2 and code[:2] == q[:2]:
            score += 0.30
        if len(q) >= 1 and len(code) >= 1 and code[0] == q[0]:
            score += 0.10
        return score

    candidates["gate_score"] = candidates["Transaction Code"].apply(candidate_gate_score)
    candidates = candidates[candidates["gate_score"] > 0].copy()

    if candidates.empty:
        return []

    anchor_idx = candidates.sort_values(
        by=["gate_score", "lex_score", "Transaction Code"],
        ascending=[False, False, True]
    ).index[0]

    anchor_row = df.loc[anchor_idx]
    anchor_tcode = str(anchor_row["Transaction Code"]).upper()
    anchor_prog = str(anchor_row["Program"]).upper()
    anchor_cluster = detect_cluster(anchor_row)

    sims = cosine_similarity(X[candidates.index], X[anchor_idx]).flatten()
    candidates["ml_score"] = sims

    def compute_score(row):
        code = str(row["Transaction Code"]).upper()
        prog = str(row["Program"]).upper()
        cluster = detect_cluster(row)

        final = (
            0.22 * float(row["lex_score"]) +
            0.12 * float(row["ml_score"]) +
            0.18 * min(float(row["gate_score"]), 1.0) +
            exact_prefix_match_bonus(q, code) +
            positional_code_similarity(q, code) +
            (0.18 if same_family_code(q, code) else -0.20) +
            (0.05 if cluster == anchor_cluster else 0.0) +
            program_similarity_bonus(anchor_prog, prog) +
            business_relation_bonus(anchor_tcode, code) +
            action_alignment_bonus(query, row) +
            accgo_namespace_bonus(query, row) +
            (-0.16 if is_generic_user_noise(row) else 0.0)
        )

        if code.startswith(q):
            final += 0.15

        return clamp01(final)

    candidates["final_score"] = candidates.apply(compute_score, axis=1)
    candidates = candidates.sort_values(
        by=["final_score", "gate_score", "Transaction Code"],
        ascending=[False, False, True]
    ).head(top_k * 3)

    return filter_results(
        [make_result(row, row["final_score"]) for _, row in candidates.iterrows()],
        MIN_SCORE_NEAR,
        top_k
    )


def rank_family_mode(family_code: str, top_k: int = 20):
    fam_code = normalize_query(family_code)
    fam = df[df["_TCODE_UP"].str.startswith(fam_code)].copy()

    if fam.empty:
        return []

    def family_score(row):
        tcode = str(row["Transaction Code"]).upper()
        prog = str(row["Program"]).upper()
        score = 0.35
        if tcode.startswith(fam_code):
            score += 0.20
        if len(tcode) >= len(fam_code) + 1:
            score += 0.05
        if prog.startswith("SAPM") or prog.startswith("RS"):
            score += 0.03
        if is_generic_user_noise(row):
            score -= 0.12
        return clamp01(score)

    fam["final_score"] = fam.apply(family_score, axis=1)
    fam = fam.sort_values(by=["final_score", "Transaction Code"], ascending=[False, True]).head(top_k * 3)

    return filter_results(
        [make_result(row, row["final_score"]) for _, row in fam.iterrows()],
        MIN_SCORE_FAMILY,
        top_k
    )


def rank_task_phrase(query: str, exact_code: str, top_k: int = TOP_K):
    match = df[df["_TCODE_UP"] == exact_code]
    if match.empty:
        return []

    idx = match.index[0]
    anchor_row = df.iloc[idx]
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))

    exact_result = make_result(anchor_row, 0.99)
    rescored = []

    for dist, j in zip(distances[0], indices[0]):
        if j == idx:
            continue

        row = df.iloc[j]
        accgo_bonus = accgo_namespace_bonus(query, row)

        final_score = (
            0.36 * (1 - float(dist)) +
            0.22 * token_overlap_score(query, row["Transaction Description"]) +
            0.12 * lexical_desc_similarity(query, row["Transaction Description"]) +
            action_alignment_bonus(query, row) +
            accgo_bonus +
            (-0.16 if is_generic_user_noise(row) else 0.0)
        )
        rescored.append(make_result(row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["score"], x["tcode"]))
    return filter_results([exact_result] + rescored, MIN_SCORE_TASK, top_k)


def rank_semantic_text(query: str, top_k: int = TOP_K):
    query_vec = build_query_vector(query)
    if query_vec.nnz == 0:
        return []

    distances, indices = model.kneighbors(query_vec, n_neighbors=min(top_k * 7, len(df)))
    results = []

    for dist, j in zip(distances[0], indices[0]):
        row = df.iloc[j]
        desc_up = str(row["Transaction Description"]).upper()
        tcode_up = str(row["Transaction Code"]).upper()

        keyword_bonus = 0.0
        for token in tokenize(query):
            if len(token) > 2:
                if token in desc_up:
                    keyword_bonus += 0.05
                if token == tcode_up:
                    keyword_bonus += 0.10

        accgo_bonus = accgo_namespace_bonus(query, row)

        final_score = (
            0.40 * (1 - float(dist)) +
            0.22 * token_overlap_score(query, row["Transaction Description"]) +
            0.20 * lexical_desc_similarity(query, row["Transaction Description"]) +
            min(keyword_bonus, 0.20) +
            action_alignment_bonus(query, row) +
            accgo_bonus
        )
        results.append(make_result(row, clamp01(final_score)))

    return filter_results(results, MIN_SCORE_SEMANTIC, top_k)


def recommend_hybrid_engine(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    if not query:
        return []

    alias_tcode = QUERY_ALIAS_ROUTER.get(query)
    if alias_tcode:
        return rank_alias_match(alias_tcode, query=query, top_k=top_k)

    for phrase, exact_tcode in task_router.items():
        if phrase in query:
            return rank_task_phrase(query, exact_tcode, top_k=top_k)

    exact = df[df["_TCODE_UP"] == query]
    if not exact.empty:
        return rank_exact_match(exact.index[0], query=query, top_k=top_k)

    if is_family_query(query):
        family_results = rank_family_mode(query, top_k=top_k)
        if family_results:
            return family_results

    if is_code_like(query) and len(query) >= 2:
        near_code_results = rank_near_code_mode(query, top_k=top_k)
        if near_code_results:
            return near_code_results

    if len(query) >= 3:
        return rank_semantic_text(query, top_k=top_k)

    return []


def recommend_cosine_tfidf(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    q_vec = build_query_vector(query)
    if q_vec.nnz == 0:
        return []

    sims = cosine_similarity(q_vec, X).flatten()
    top_idx = np.argsort(sims)[::-1][:top_k]
    return [make_result(df.iloc[idx], sims[idx]) for idx in top_idx]


def recommend_lightweight_hybrid(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    if not query:
        return []

    if QUERY_ALIAS_ROUTER.get(query):
        return recommend_hybrid_engine(query, top_k=top_k)

    if is_family_query(query):
        return recommend_hybrid_engine(query, top_k=top_k)

    if is_exact_tcode_query(query) or is_prefix_code_query(query):
        code_results = recommend_code_first(query, top_k=top_k)
        if code_results:
            return code_results

    tfidf_results = recommend_cosine_tfidf(query, top_k=top_k * 5)
    hybrid_results = recommend_hybrid_engine(query, top_k=top_k * 5)

    tfidf_map = {str(item["tcode"]).upper(): float(item["score"]) for item in tfidf_results}
    hybrid_map = {str(item["tcode"]).upper(): float(item["score"]) for item in hybrid_results}

    tfidf_rank = {str(item["tcode"]).upper(): rank for rank, item in enumerate(tfidf_results, start=1)}
    hybrid_rank = {str(item["tcode"]).upper(): rank for rank, item in enumerate(hybrid_results, start=1)}

    candidate_codes = set(tfidf_map) | set(hybrid_map)
    merged = []

    for tcode in candidate_codes:
        row_match = df[df["_TCODE_UP"] == tcode]
        if row_match.empty:
            continue

        row = row_match.iloc[0]

        s_tfidf = tfidf_map.get(tcode, 0.0)
        s_hybrid = hybrid_map.get(tcode, 0.0)

        r_tfidf = tfidf_rank.get(tcode, 999)
        r_hybrid = hybrid_rank.get(tcode, 999)

        rank_bonus_tfidf = 1.0 / (r_tfidf + 1) if r_tfidf != 999 else 0.0
        rank_bonus_hybrid = 1.0 / (r_hybrid + 1) if r_hybrid != 999 else 0.0

        overlap = token_overlap_score(query, row["Transaction Description"])
        desc_lex = lexical_desc_similarity(query, row["Transaction Description"])
        action_bonus = action_alignment_bonus(query, row)

        family_bonus = 0.08 if same_family_code(query, tcode) else 0.0
        code_bonus = exact_prefix_match_bonus(query, tcode) if is_code_like(query) else 0.0
        noise_penalty = -0.15 if is_generic_user_noise(row) else 0.0
        accgo_bonus = accgo_namespace_bonus(query, row)

        final_score = (
            0.34 * s_tfidf +
            0.26 * s_hybrid +
            0.12 * rank_bonus_tfidf +
            0.10 * rank_bonus_hybrid +
            0.10 * overlap +
            0.08 * desc_lex +
            action_bonus +
            family_bonus +
            code_bonus +
            accgo_bonus +
            noise_penalty
        )

        merged.append(make_result(row, clamp01(final_score)))

    merged = dedupe_results(merged)
    merged.sort(key=lambda x: (-x["score"], x["tcode"]))
    return merged[:top_k]


def recommend_tfidf_reranked(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    if not query:
        return []

    # 0. exact code hard override
    exact = df[df["_TCODE_UP"] == query]
    if not exact.empty:
        return recommend_code_first(query, top_k=top_k)

    # 1. alias routing
    if QUERY_ALIAS_ROUTER.get(query):
        return recommend_hybrid_engine(query, top_k=top_k)

    # 2. code-like queries -> strict code-first
    if is_exact_tcode_query(query):
        code_results = recommend_code_first(query, top_k=top_k)
        if code_results:
            return code_results

    if is_prefix_code_query(query):
        code_results = recommend_code_first(query, top_k=top_k)
        if code_results:
            return code_results

    # 3. known task router
    if query in task_router:
        return recommend_hybrid_engine(query, top_k=top_k)

    # 4. family query
    if is_family_query(query):
        family_results = rank_family_mode(query, top_k=top_k)
        if family_results:
            return family_results

    tfidf_candidates = recommend_cosine_tfidf(query, top_k=RERANK_POOL)
    if not tfidf_candidates:
        return []

    tfidf_score_map = {str(item["tcode"]).upper(): float(item["score"]) for item in tfidf_candidates}
    tfidf_rank_map = {str(item["tcode"]).upper(): rank for rank, item in enumerate(tfidf_candidates, start=1)}

    rescored = []

    for item in tfidf_candidates:
        tcode = str(item["tcode"]).upper()
        row_match = df[df["_TCODE_UP"] == tcode]
        if row_match.empty:
            continue
        row = row_match.iloc[0]

        tfidf_score = tfidf_score_map.get(tcode, 0.0)
        tfidf_rank = tfidf_rank_map.get(tcode, 999)

        overlap = token_overlap_score(query, row["Transaction Description"])
        desc_lex = lexical_desc_similarity(query, row["Transaction Description"])
        action_bonus = action_alignment_bonus(query, row)
        rank_bonus = 1.0 / (tfidf_rank + 1) if tfidf_rank != 999 else 0.0
        noise_penalty = -0.06 if is_generic_user_noise(row) else 0.0
        accgo_bonus = accgo_namespace_bonus(query, row)

        family_hint = 0.04 if same_family_code(query, tcode) else 0.0

        final_score = (
            0.52 * tfidf_score +
            0.16 * rank_bonus +
            0.14 * overlap +
            0.12 * desc_lex +
            0.08 * max(action_bonus, -0.02) +
            family_hint +
            accgo_bonus +
            noise_penalty
        )

        rescored.append(make_result(row, clamp01(final_score)))

    rescored = dedupe_results(rescored)
    rescored.sort(key=lambda x: (-x["score"], x["tcode"]))
    return rescored[:top_k]


@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"})


@app.route("/recommend", methods=["POST"])
def recommend():
    data = request.get_json(force=True) or {}
    query = data.get("tcode", "") or data.get("query", "")
    mode = data.get("mode", "tfidf_reranked")

    if not str(query).strip():
        return jsonify({"results": []})

    try:
        if mode == "hybrid_engine":
            results = recommend_hybrid_engine(query, top_k=TOP_K)
        elif mode == "cosine_tfidf":
            results = recommend_cosine_tfidf(query, top_k=TOP_K)
        elif mode == "lightweight_hybrid":
            results = recommend_lightweight_hybrid(query, top_k=TOP_K)
        else:
            results = recommend_tfidf_reranked(query, top_k=TOP_K)

        payload = []
        for i, item in enumerate(results, start=1):
            row = {
                "rank": i,
                "code": item.get("tcode", ""),
                "program": item.get("program", ""),
                "description": item.get("description", ""),
                "cluster": item.get("cluster", ""),
                "similarity": item.get("score", 0.0),
                "score": item.get("score", 0.0),
                "Transaction Code": item.get("tcode", ""),
                "Program": item.get("program", ""),
                "Transaction Description": item.get("description", ""),
                "Cluster": item.get("cluster", ""),
                "Similarity": item.get("score", 0.0),
                "tcode": item.get("tcode", ""),
                "desc": item.get("description", ""),
            }
            payload.append(row)

        return jsonify({
            "query": query,
            "mode": mode,
            "results": payload
        })

    except Exception as e:
        return jsonify({"error": str(e), "results": []}), 500


if __name__ == "__main__":
    print("Starting Flask app on http://0.0.0.0:9090")
    app.run(host="0.0.0.0", port=9090, debug=False, use_reloader=False)