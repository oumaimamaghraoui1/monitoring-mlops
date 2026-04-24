from flask import Flask, request, jsonify
from flask_cors import CORS
import joblib
import pandas as pd
import numpy as np
from scipy.sparse import load_npz, hstack
from sklearn.metrics.pairwise import cosine_similarity
from difflib import SequenceMatcher
from sentence_transformers import SentenceTransformer, CrossEncoder
import traceback
import re
import os

app = Flask(__name__)
CORS(app)

TOP_K = 15
CANDIDATE_POOL_K = 20

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
}

task_router = {
    "CREATE MATERIAL": "MM01",
    "CHANGE MATERIAL": "MM02",
    "DISPLAY MATERIAL": "MM03",
}

EMBED_MODEL_NAME_FALLBACK = "sentence-transformers/all-MiniLM-L6-v2"
CROSS_ENCODER_NAME = "cross-encoder/ms-marco-MiniLM-L-6-v2"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ARTIFACTS_DIR = os.path.join(BASE_DIR, "artifacts")

vectorizer = joblib.load(os.path.join(ARTIFACTS_DIR, "vectorizer.joblib"))
model = joblib.load(os.path.join(ARTIFACTS_DIR, "model.joblib"))
X = load_npz(os.path.join(ARTIFACTS_DIR, "matrix.npz"))
df = pd.read_csv(os.path.join(ARTIFACTS_DIR, "transactions_model.csv"), low_memory=False)

embedding_matrix = np.load(os.path.join(ARTIFACTS_DIR, "embedding_matrix.npy"))
embed_name_path = os.path.join(ARTIFACTS_DIR, "embedding_model_name.txt")
if os.path.exists(embed_name_path):
    with open(embed_name_path, "r", encoding="utf-8") as f:
        EMBED_MODEL_NAME = f.read().strip()
else:
    EMBED_MODEL_NAME = EMBED_MODEL_NAME_FALLBACK

embedder = SentenceTransformer(EMBED_MODEL_NAME)
cross_encoder = CrossEncoder(CROSS_ENCODER_NAME)

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

if "reranker_text" not in df.columns:
    df["reranker_text"] = (
        "TCODE " + df["Transaction Code"].fillna("").astype(str) +
        " ; DESCRIPTION " + df["Transaction Description"].fillna("").astype(str) +
        " ; PROGRAM " + df["Program"].fillna("").astype(str)
    )
else:
    df["reranker_text"] = df["reranker_text"].fillna("").astype(str)

df["_DESC_UP"] = df["Transaction Description"].str.upper()
df["_TCODE_UP"] = df["Transaction Code"].str.upper()
df["_PROG_UP"] = df["Program"].str.upper()

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

def score_confidence(score: float) -> str:
    if score >= 0.75:
        return "high"
    if score >= 0.45:
        return "medium"
    return "low"

def dedupe_results(results):
    seen = set()
    unique = []
    for item in results:
        key = str(item.get("tcode", "")).upper()
        if key not in seen:
            seen.add(key)
            unique.append(item)
    return unique

def build_query_vector(query: str):
    if isinstance(vectorizer, dict):
        word_vec = vectorizer["word_vectorizer"].transform([query])
        char_vec = vectorizer["char_vectorizer"].transform([query])
        return hstack([word_vec, char_vec]).tocsr()
    return vectorizer.transform([query])

def build_query_embedding(query: str):
    emb = embedder.encode(
        [query],
        normalize_embeddings=True,
        convert_to_numpy=True
    ).astype("float32")
    return emb[0]

def query_action_tokens(query: str):
    q = normalize_query(query)
    action_map = {
        "CREATE": {"CREATE", "NEW", "ADD", "GENERATE"},
        "CHANGE": {"CHANGE", "MODIFY", "EDIT", "UPDATE", "MAINTAIN", "MAINTENANCE"},
        "DISPLAY": {"DISPLAY", "SHOW", "VIEW", "READ"},
        "DELETE": {"DELETE", "REMOVE", "CANCEL"},
        "PROCESS": {"PROCESS", "PROCESSOR", "PROCESSING"},
        "CONFIG": {"CONFIG", "CONFIGURATION", "SETUP", "CUSTOMIZING"},
        "LIST": {"LIST", "OVERVIEW"},
        "REPORT": {"REPORT", "REPORTING"},
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
        "CREATE": {"CREATE", "NEW", "ADD", "GENERATE"},
        "CHANGE": {"CHANGE", "MODIFY", "EDIT", "UPDATE", "MAINTAIN", "MAINTENANCE"},
        "DISPLAY": {"DISPLAY", "SHOW", "VIEW", "READ"},
        "DELETE": {"DELETE", "REMOVE", "CANCEL"},
        "PROCESS": {"PROCESS", "PROCESSOR", "PROCESSING"},
        "CONFIG": {"CONFIG", "CONFIGURATION", "SETUP", "CUSTOMIZING"},
        "LIST": {"LIST", "OVERVIEW"},
        "REPORT": {"REPORT", "REPORTING"},
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
    if not overlap:
        return -0.08
    return min(0.12, 0.06 * len(overlap))

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
        "USER NAME FOR USER FIELD",
        "USER FIELD 1", "USER FIELD 2", "USER FIELD 3",
        "USER FIELD 4", "USER FIELD 5", "USER FIELD 6",
        "USER FIELD 7", "USER FIELD 8", "USER FIELD 9",
        "USER FIELD 10", "USER FIELD 11", "USER FIELD 12",
        "NAME FOR USER FIELD",
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
            if i == 0:
                score += 0.30
            elif i == 1:
                score += 0.25
            elif i == 2:
                score += 0.20
            else:
                score += 0.10
        else:
            if i == 0:
                score -= 0.35
            elif i == 1:
                score -= 0.25
            else:
                score -= 0.08
    if abs(len(c) - len(q)) <= 1:
        score += 0.08
    elif abs(len(c) - len(q)) <= 2:
        score += 0.03
    score = score / max(max_len, 1)
    return max(-0.30, min(0.35, score))

def filter_results(results, min_score: float, top_k: int = TOP_K):
    filtered = [r for r in results if float(r["similarity"]) >= min_score]
    filtered = dedupe_results(filtered)
    filtered.sort(key=lambda x: (-x["similarity"], x["tcode"]))

    cleaned = []
    for item in filtered:
        tcode = str(item["tcode"]).upper()
        sim = float(item["similarity"])
        if tcode.startswith("OITM") and sim < 0.40:
            continue
        cleaned.append(item)

    for i, item in enumerate(cleaned, start=1):
        item["rank"] = i
        item["confidence"] = score_confidence(float(item["similarity"]))

    return cleaned[:top_k]

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

def make_result(rank: int, row, score: float):
    score = float(score)
    return {
        "rank": rank,
        "tcode": str(row["Transaction Code"]),
        "program": str(row["Program"]),
        "desc": str(row["Transaction Description"]),
        "similarity": score,
        "cluster": detect_cluster(row),
        "confidence": score_confidence(score),
    }

def rank_alias_match(exact_code: str, query: str = "", top_k: int = TOP_K):
    match = df[df["_TCODE_UP"] == normalize_query(exact_code)]
    if match.empty:
        return []

    idx = match.index[0]
    anchor_row = df.iloc[idx]
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))

    exact_result = make_result(1, anchor_row, 1.0)
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
        noise_penalty = -0.12 if is_generic_user_noise(row) else 0.0

        final_score = (
            0.34 * ml_score +
            0.20 * overlap +
            0.14 * desc_lex +
            family_bonus +
            action_bonus +
            noise_penalty
        )

        rescored.append(make_result(0, row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["similarity"], x["tcode"]))
    return filter_results([exact_result] + rescored, MIN_SCORE_TASK, top_k)

def rank_exact_match(idx: int, query: str = "", top_k: int = TOP_K):
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))
    anchor_row = df.iloc[idx]
    anchor_tcode = str(anchor_row["Transaction Code"]).upper()
    anchor_prog = str(anchor_row["Program"]).upper()
    anchor_cluster = detect_cluster(anchor_row)
    exact_result = make_result(1, anchor_row, 1.0)
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

        final_score = (
            0.46 * ml_score +
            0.08 * overlap +
            (0.18 if same_family_code(anchor_tcode, candidate_tcode) else -0.10) +
            (0.08 if candidate_cluster == anchor_cluster else 0.0) +
            program_similarity_bonus(anchor_prog, candidate_prog) +
            business_relation_bonus(anchor_tcode, candidate_tcode) +
            0.18 * lex_code +
            (-0.18 if is_generic_user_noise(row) else 0.0)
        )
        rescored.append(make_result(0, row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["similarity"], x["tcode"]))
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

    results = []
    for rank, (_, row) in enumerate(candidates.iterrows(), start=1):
        results.append(make_result(rank, row, float(row["final_score"])))

    return filter_results(results, MIN_SCORE_NEAR, top_k)

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

    results = []
    for rank, (_, row) in enumerate(fam.iterrows(), start=1):
        results.append(make_result(rank, row, float(row["final_score"])))

    return filter_results(results, MIN_SCORE_FAMILY, top_k)

def rank_task_phrase(query: str, exact_code: str, top_k: int = TOP_K):
    match = df[df["_TCODE_UP"] == exact_code]
    if match.empty:
        return []

    idx = match.index[0]
    anchor_row = df.iloc[idx]
    distances, indices = model.kneighbors(X[idx], n_neighbors=min(top_k * 5, len(df)))

    exact_result = make_result(1, anchor_row, 0.99)
    rescored = []

    for dist, j in zip(distances[0], indices[0]):
        if j == idx:
            continue
        row = df.iloc[j]
        final_score = (
            0.38 * (1 - float(dist)) +
            0.22 * token_overlap_score(query, row["Transaction Description"]) +
            0.12 * lexical_desc_similarity(query, row["Transaction Description"]) +
            action_alignment_bonus(query, row) +
            (-0.16 if is_generic_user_noise(row) else 0.0)
        )
        rescored.append(make_result(0, row, clamp01(final_score)))

    rescored.sort(key=lambda x: (-x["similarity"], x["tcode"]))
    return filter_results([exact_result] + rescored, MIN_SCORE_TASK, top_k)

def rank_semantic_text(query: str, top_k: int = TOP_K):
    query_vec = build_query_vector(query)
    if query_vec.nnz == 0:
        return []

    distances, indices = model.kneighbors(query_vec, n_neighbors=min(top_k * 7, len(df)))
    results = []

    for rank, (dist, j) in enumerate(zip(distances[0], indices[0]), start=1):
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

        final_score = (
            0.42 * (1 - float(dist)) +
            0.22 * token_overlap_score(query, row["Transaction Description"]) +
            0.22 * lexical_desc_similarity(query, row["Transaction Description"]) +
            min(keyword_bonus, 0.20) +
            action_alignment_bonus(query, row)
        )
        results.append(make_result(rank, row, clamp01(final_score)))

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
        family_results = rank_family_mode(query, top_k=20)
        if family_results:
            return family_results

    if is_code_like(query) and len(query) >= 2:
        near_code_results = rank_near_code_mode(query, top_k=TOP_K)
        if near_code_results:
            return near_code_results

    if len(query) >= 3:
        return rank_semantic_text(query, top_k=TOP_K)

    return []

def recommend_cosine_tfidf(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    q_vec = build_query_vector(query)
    if q_vec.nnz == 0:
        return []
    sims = cosine_similarity(q_vec, X).flatten()
    top_idx = np.argsort(sims)[::-1][:top_k]

    results = []
    for rank, idx in enumerate(top_idx, start=1):
        results.append(make_result(rank, df.iloc[idx], float(sims[idx])))
    return results

def recommend_embedding_semantic(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    if not query:
        return []

    q_emb = build_query_embedding(query)
    sims = embedding_matrix @ q_emb
    top_idx = np.argsort(sims)[::-1][:top_k]

    results = []
    for rank, idx in enumerate(top_idx, start=1):
        results.append(make_result(rank, df.iloc[idx], float(sims[idx])))
    return results

def recommend_semantic_hybrid(raw_query: str, top_k: int = TOP_K):
    query = normalize_query(raw_query)
    if not query:
        return []

    if QUERY_ALIAS_ROUTER.get(query):
        return recommend_hybrid_engine(query, top_k=top_k)

    if is_code_like(query) or is_family_query(query):
        return recommend_hybrid_engine(query, top_k=top_k)

    tfidf_results = recommend_cosine_tfidf(query, top_k=top_k * 5)
    embed_results = recommend_embedding_semantic(query, top_k=top_k * 5)
    hybrid_results = recommend_hybrid_engine(query, top_k=top_k * 5)

    score_map = {}

    def add_scores(results, weight):
        for rank, item in enumerate(results, start=1):
            tcode = str(item["tcode"]).upper()
            score_map.setdefault(tcode, 0.0)
            score_map[tcode] += weight * (float(item["similarity"]) + 1.0 / (rank + 1))

    add_scores(tfidf_results, 0.30)
    add_scores(embed_results, 0.45)
    add_scores(hybrid_results, 0.25)

    merged = []
    for tcode, score in score_map.items():
        match = df[df["_TCODE_UP"] == tcode]
        if not match.empty:
            merged.append(make_result(0, match.iloc[0], float(score / 2.0)))

    merged = dedupe_results(merged)
    merged.sort(key=lambda x: (-x["similarity"], x["tcode"]))
    return merged[:top_k]

def rerank_with_cross_encoder(raw_query: str, base_results, top_k: int = TOP_K):
    query = str(raw_query).strip()
    if not base_results:
        return []

    pairs = []
    rows = []
    base_score_map = {}

    for item in base_results[:CANDIDATE_POOL_K]:
        tcode = str(item["tcode"]).upper()
        row = df[df["_TCODE_UP"] == tcode]
        if row.empty:
            continue
        r = row.iloc[0]
        rows.append(r)
        pairs.append([query, str(r["reranker_text"])])
        base_score_map[tcode] = float(item["similarity"])

    if not pairs:
        return base_results[:top_k]

    cross_scores = cross_encoder.predict(pairs)

    reranked = []
    for r, cross_score in zip(rows, cross_scores):
        tcode = str(r["Transaction Code"]).upper()
        base_score = base_score_map.get(tcode, 0.0)

        desc_lex = lexical_desc_similarity(query, r["Transaction Description"])
        overlap = token_overlap_score(query, r["Transaction Description"])
        action_bonus = action_alignment_bonus(query, r)

        final_score = (
            0.60 * clamp01(cross_score) +
            0.20 * clamp01(base_score) +
            0.12 * desc_lex +
            0.08 * overlap +
            action_bonus
        )

        reranked.append(make_result(0, r, final_score))

    reranked = dedupe_results(reranked)
    reranked.sort(key=lambda x: (-x["similarity"], x["tcode"]))

    for i, item in enumerate(reranked, start=1):
        item["rank"] = i
        item["confidence"] = score_confidence(float(item["similarity"]))

    return reranked[:top_k]

def recommend_semantic_hybrid_reranked(raw_query: str, top_k: int = TOP_K):
    base = recommend_semantic_hybrid(raw_query, top_k=max(CANDIDATE_POOL_K, top_k))
    return rerank_with_cross_encoder(raw_query, base, top_k=top_k)

@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

@app.route("/recommend", methods=["POST"])
def recommend():
    try:
        data = request.get_json(silent=True) or {}
        raw_query = data.get("tcode", "")
        query = normalize_query(raw_query)
        mode = data.get("mode", "semantic_hybrid_reranked")

        if not query:
            return jsonify({
                "query": "",
                "mode": "empty",
                "resolved": "",
                "results": [],
            }), 200

        if mode == "hybrid":
            results = recommend_hybrid_engine(query, top_k=TOP_K)
            return jsonify({
                "query": query,
                "mode": "hybrid",
                "resolved": query,
                "results": results,
            }), 200

        if mode == "cosine":
            results = recommend_cosine_tfidf(query, top_k=TOP_K)
            return jsonify({
                "query": query,
                "mode": "cosine",
                "resolved": query,
                "results": results,
            }), 200

        if mode == "embedding":
            results = recommend_embedding_semantic(query, top_k=TOP_K)
            return jsonify({
                "query": query,
                "mode": "embedding",
                "resolved": query,
                "results": results,
            }), 200

        if mode == "semantic_hybrid":
            results = recommend_semantic_hybrid(query, top_k=TOP_K)
            return jsonify({
                "query": query,
                "mode": "semantic_hybrid",
                "resolved": query,
                "results": results,
            }), 200

        results = recommend_semantic_hybrid_reranked(query, top_k=TOP_K)
        return jsonify({
            "query": query,
            "mode": "semantic_hybrid_reranked",
            "resolved": query,
            "results": results,
        }), 200

    except Exception as e:
        traceback.print_exc()
        return jsonify({
            "query": "",
            "mode": "error",
            "resolved": "",
            "results": [],
            "message": str(e),
        }), 200

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=9090)