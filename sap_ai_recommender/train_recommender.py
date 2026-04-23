import os
import re
import joblib
import numpy as np
import pandas as pd

from scipy.sparse import hstack, save_npz
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.neighbors import NearestNeighbors
from sentence_transformers import SentenceTransformer

# ====================================================
# CONFIG
# ====================================================
os.makedirs("artifacts", exist_ok=True)

INPUT_PATH = "output/transactions_cleaned.csv"
OUT_VECTORIZER = "artifacts/vectorizer.joblib"
OUT_MODEL = "artifacts/model.joblib"
OUT_MATRIX = "artifacts/matrix.npz"
OUT_DATA = "artifacts/transactions_model.csv"

OUT_EMBED_MODEL_NAME = "artifacts/embedding_model_name.txt"
OUT_EMBED_MATRIX = "artifacts/embedding_matrix.npy"

EMBED_MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# ====================================================
# LOAD DATA
# ====================================================
df = pd.read_csv(INPUT_PATH)

required_cols = ["Transaction Code", "Transaction Description", "Program"]
missing = [c for c in required_cols if c not in df.columns]
if missing:
    raise ValueError(f"Missing required columns: {missing}")

optional_cols = ["Transaction Menu", "Transaction Info", "Transaction Variant Info"]
for col in optional_cols:
    if col not in df.columns:
        df[col] = ""

df["Transaction Code"] = (
    df["Transaction Code"]
    .fillna("")
    .astype(str)
    .str.strip()
    .str.replace('"', "", regex=False)
    .str.upper()
)

for col in [
    "Transaction Description",
    "Program",
    "Transaction Menu",
    "Transaction Info",
    "Transaction Variant Info",
]:
    df[col] = df[col].fillna("").astype(str).str.strip()

# ====================================================
# HELPERS
# ====================================================
def normalize_text(text: str) -> str:
    text = str(text).upper()
    text = re.sub(r'["]+', " ", text)
    text = re.sub(r"[^A-Z0-9_/ ]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text

MANUAL_DESCRIPTION_OVERRIDES = {
    "HRPAY00_RPUCPA00": "Check Payroll Area for Run Payroll RPUCPA00",
    "HRPAYCNTPM_CONF": "Total Payment Configuration",
    "HRPAYDEBSA": "Display Construction Sites",
    "HRPAYDEBSP": "Maintain Construction Sites",
    "HRPAYDEE2PKV_PROCESS": "Notification Processor",
    "VPE1": "Create Sales Representative",
    "VPE2": "Change Sales Representative",
    "VPE3": "Display Sales Representative",
    "VPN1": "Number Range for Contact Person",
}

def expand_action_terms(text_u: str) -> list[str]:
    expansions = []

    if any(k in text_u for k in ["CREATE", "CREATION"]):
        expansions += ["CREATE NEW ADD INSERT GENERATE"]
    if any(k in text_u for k in ["CHANGE", "MODIFY", "EDIT"]):
        expansions += ["CHANGE MODIFY EDIT UPDATE MAINTAIN"]
    if any(k in text_u for k in ["DISPLAY", "VIEW", "SHOW"]):
        expansions += ["DISPLAY SHOW VIEW READ"]
    if any(k in text_u for k in ["MAINTAIN", "MAINTENANCE"]):
        expansions += ["MAINTAIN MAINTENANCE ADMINISTRATION UPDATE CONFIGURATION"]
    if any(k in text_u for k in ["CONFIGURATION", "CONFIG", "SETUP", "CUSTOMIZING"]):
        expansions += ["CONFIGURATION CONFIG SETUP CUSTOMIZING MAINTAIN"]
    if any(k in text_u for k in ["PROCESS", "PROCESSOR", "PROCESSING"]):
        expansions += ["PROCESS PROCESSOR PROCESSING EXECUTION HANDLING"]
    if "LIST" in text_u:
        expansions += ["LIST OVERVIEW DIRECTORY"]
    if "REPORT" in text_u:
        expansions += ["REPORT REPORTING ANALYSIS"]
    if "WORKBENCH" in text_u:
        expansions += ["WORKBENCH TOOL WORKSPACE"]

    return expansions

def expand_domain_terms(tcode: str, full_text: str, prog: str) -> str:
    tcode_u = normalize_text(tcode)
    text_u = normalize_text(full_text)
    prog_u = normalize_text(prog)

    expansions = []

    if tcode_u.startswith("SU") or any(k in text_u for k in ["USER", "AUTH", "ROLE", "PROFILE", "LOGIN"]):
        expansions += [
            "USER ADMINISTRATION AUTHORIZATION ROLE PROFILE LOGIN SECURITY USER MAINTENANCE"
        ]

    if tcode_u.startswith("SM") or any(k in text_u for k in [
        "LOCK", "LOG", "SYSTEM LOG", "WORK PROCESS", "BACKGROUND JOB", "UPDATE", "RFC"
    ]):
        expansions += [
            "MONITORING SYSTEM ADMIN LOCK SYSTEM LOG WORK PROCESS BACKGROUND JOB UPDATE RFC"
        ]

    if tcode_u.startswith("ST") or any(k in text_u for k in [
        "TRACE", "DUMP", "PERFORMANCE", "WORKLOAD", "STATISTICS"
    ]):
        expansions += [
            "PERFORMANCE TRACE DUMP WORKLOAD STATISTICS MONITORING ANALYSIS"
        ]

    if tcode_u.startswith("SE") or prog_u.startswith("SAPLSE"):
        expansions += [
            "ABAP DEVELOPMENT WORKBENCH EDITOR FUNCTION MODULE TABLE DICTIONARY"
        ]

    if tcode_u.startswith("MM") or any(k in text_u for k in [
        "MATERIAL", "PURCHASE", "STOCK", "VALUATION", "VENDOR", "INVOICE"
    ]):
        expansions += [
            "MATERIAL MANAGEMENT PURCHASE STOCK VALUATION VENDOR INVENTORY INVOICE"
        ]

    if tcode_u.startswith("HR") or any(k in text_u for k in [
        "PAYROLL", "PERSONNEL", "HUMAN RESOURCES", "EMPLOYEE", "EMPLOYMENT"
    ]):
        expansions += [
            "HUMAN RESOURCES PAYROLL PERSONNEL EMPLOYEE HR ADMINISTRATION"
        ]

    if "SALES REPRESENTATIVE" in text_u:
        expansions += ["SALES REPRESENTATIVE PARTNER SALES EMPLOYEE REPRESENTATIVE"]

    if "CONSTRUCTION SITE" in text_u or "CONSTRUCTION SITES" in text_u:
        expansions += ["CONSTRUCTION SITE CONSTRUCTION SITES BUILDING LOCATION"]

    if "NUMBER RANGE" in text_u:
        expansions += ["NUMBER RANGE INTERVAL COUNTER IDENTIFIER"]

    if "PAYROLL AREA" in text_u or "RUN PAYROLL" in text_u:
        expansions += ["PAYROLL AREA RUN PAYROLL PAYROLL EXECUTION PAYROLL PROCESS"]

    if "ERROR CONFIRMATION" in text_u:
        expansions += ["ERROR CONFIRMATION ERROR CONFIRMATIONS ASSIGNMENT ADMINISTRATION"]

    if "NOTIFICATION" in text_u:
        expansions += ["NOTIFICATION MESSAGE PROCESS PROCESSOR"]

    expansions += expand_action_terms(text_u)

    return " ".join(expansions).strip()

def build_weighted_text(row) -> str:
    tcode = normalize_text(row["Transaction Code"])
    desc = normalize_text(row["Transaction Description"])
    prog = normalize_text(row["Program"])
    menu = normalize_text(row["Transaction Menu"])
    info = normalize_text(row["Transaction Info"])
    variant = normalize_text(row["Transaction Variant Info"])

    override_desc = MANUAL_DESCRIPTION_OVERRIDES.get(tcode, "")
    override_desc_norm = normalize_text(override_desc) if override_desc else ""

    full_business_text = " ".join([desc, menu, info, variant, override_desc_norm]).strip()
    expansions = expand_domain_terms(tcode, full_business_text, prog)

    parts = []
    parts.append((" ".join([tcode] * 7)).strip())

    if desc:
        parts.append((" ".join([desc] * 5)).strip())
    if menu:
        parts.append((" ".join([menu] * 3)).strip())
    if info:
        parts.append((" ".join([info] * 3)).strip())
    if variant:
        parts.append((" ".join([variant] * 2)).strip())
    if override_desc_norm:
        parts.append((" ".join([override_desc_norm] * 4)).strip())
    if prog:
        parts.append((" ".join([prog] * 2)).strip())

    split_code = re.sub(r"([A-Z]+)([0-9]+)", r"\1 \2 \1\2", tcode)
    if split_code and split_code != tcode:
        parts.append(split_code)

    if expansions:
        parts.append(expansions)

    return " ".join([p for p in parts if p]).strip()

def build_reranker_text(row) -> str:
    tcode = normalize_text(row["Transaction Code"])
    desc = normalize_text(row["Transaction Description"])
    prog = normalize_text(row["Program"])
    menu = normalize_text(row["Transaction Menu"])
    info = normalize_text(row["Transaction Info"])
    variant = normalize_text(row["Transaction Variant Info"])

    parts = [
        f"TCODE {tcode}",
        f"DESCRIPTION {desc}" if desc else "",
        f"PROGRAM {prog}" if prog else "",
        f"MENU {menu}" if menu else "",
        f"INFO {info}" if info else "",
        f"VARIANT {variant}" if variant else "",
    ]
    return " ; ".join([p for p in parts if p]).strip()

# ====================================================
# BUILD TEXT
# ====================================================
df["combined_text"] = df.apply(build_weighted_text, axis=1)
df["reranker_text"] = df.apply(build_reranker_text, axis=1)
df["_TCODE_UP"] = df["Transaction Code"].str.upper()
df["_DESC_UP"] = df["Transaction Description"].str.upper()
df["_PROG_UP"] = df["Program"].str.upper()

# ====================================================
# TF-IDF
# ====================================================
word_vectorizer = TfidfVectorizer(
    analyzer="word",
    ngram_range=(1, 4),
    min_df=1,
    sublinear_tf=True,
    lowercase=False,
    norm="l2"
)

char_vectorizer = TfidfVectorizer(
    analyzer="char_wb",
    ngram_range=(3, 5),
    min_df=1,
    sublinear_tf=True,
    lowercase=False,
    norm="l2"
)

X_word = word_vectorizer.fit_transform(df["combined_text"])
X_char = char_vectorizer.fit_transform(df["combined_text"])
X = hstack([X_word, X_char]).tocsr()

vectorizer = {
    "word_vectorizer": word_vectorizer,
    "char_vectorizer": char_vectorizer,
}

# ====================================================
# KNN
# ====================================================
model = NearestNeighbors(
    metric="cosine",
    algorithm="brute",
    n_neighbors=min(25, len(df))
)
model.fit(X)

# ====================================================
# SEMANTIC EMBEDDINGS
# ====================================================
print(f"Loading embedding model: {EMBED_MODEL_NAME}")
embedder = SentenceTransformer(EMBED_MODEL_NAME)

semantic_texts = (
    df["Transaction Code"].fillna("").astype(str).str.upper() + " " +
    df["Transaction Description"].fillna("").astype(str) + " " +
    df["Transaction Menu"].fillna("").astype(str) + " " +
    df["Transaction Info"].fillna("").astype(str) + " " +
    df["Transaction Variant Info"].fillna("").astype(str)
).tolist()

embeddings = embedder.encode(
    semantic_texts,
    normalize_embeddings=True,
    convert_to_numpy=True,
    show_progress_bar=True
).astype("float32")

# ====================================================
# SAVE
# ====================================================
joblib.dump(vectorizer, OUT_VECTORIZER)
joblib.dump(model, OUT_MODEL)
save_npz(OUT_MATRIX, X)
np.save(OUT_EMBED_MATRIX, embeddings)
df.to_csv(OUT_DATA, index=False)

with open(OUT_EMBED_MODEL_NAME, "w", encoding="utf-8") as f:
    f.write(EMBED_MODEL_NAME)

print("✅ MODEL TRAINED SUCCESSFULLY")
print(f"Rows: {len(df)}")
print(f"Word features: {X_word.shape[1]}")
print(f"Char features: {X_char.shape[1]}")
print(f"Final matrix shape: {X.shape}")
print(f"Embedding matrix shape: {embeddings.shape}")