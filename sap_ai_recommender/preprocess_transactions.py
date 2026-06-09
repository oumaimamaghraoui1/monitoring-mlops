import argparse
import os
import re
import pandas as pd


OUTPUT_DIR = os.environ.get("OUTPUT_DIR", "output")
os.makedirs(OUTPUT_DIR, exist_ok=True)

OUT_CLEANED = os.path.join(OUTPUT_DIR, "transactions_cleaned.csv.gz")
OUT_SUMMARY = os.path.join(OUTPUT_DIR, "transactions_summary.csv")


def extract_namespace(code):
    code = "" if pd.isna(code) else str(code).strip()

    if code.startswith("/"):
        match = re.match(r"^(/[^/]+/)", code)
        if match:
            return match.group(1)

    if code.upper().startswith("Z"):
        return "Z_CUSTOM"

    if code.upper().startswith("Y"):
        return "Y_CUSTOM"

    return "STANDARD"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    args = parser.parse_args()

    df = pd.read_csv(
        args.input,
        engine="python",
        quotechar='"',
        on_bad_lines="skip",
        dtype=str
    )

    required_cols = [
        "Transaction Code",
        "Transaction Description",
        "Program"
    ]

    for col in required_cols:
        if col not in df.columns:
            df[col] = ""

    optional_cols = [
        "Transaction Menu",
        "Transaction Info",
        "Transaction Variant Info"
    ]

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
        "Transaction Variant Info"
    ]:
        df[col] = df[col].fillna("").astype(str).str.strip()

    df["namespace"] = df["Transaction Code"].apply(extract_namespace)

    df["has_description"] = (
        df["Transaction Description"]
        .fillna("")
        .str.strip()
        .ne("")
    ).astype(int)

    df["contains_badi"] = (
        df["Transaction Description"]
        .fillna("")
        .astype(str)
        .str.contains("BAdI", case=False, na=False)
    ).astype(int)

    df["prefix"] = df["Transaction Code"].astype(str).str[:2]

    df["combined_text"] = (
        df["Transaction Code"].astype(str) + " " +
        df["Program"].astype(str) + " " +
        df["Transaction Description"].astype(str) + " " +
        df["namespace"].astype(str) + " " +
        df["prefix"].astype(str)
    ).str.strip()

    df.to_csv(
        OUT_CLEANED,
        index=False,
        compression="gzip"
    )

    summary = pd.DataFrame({
        "Metric": [
            "Total Rows",
            "Unique Transaction Codes",
            "Has Description",
            "Contains BAdI",
            "Cleaned File"
        ],
        "Value": [
            len(df),
            df["Transaction Code"].nunique(),
            int(df["has_description"].sum()),
            int(df["contains_badi"].sum()),
            OUT_CLEANED
        ]
    })

    summary.to_csv(OUT_SUMMARY, index=False)

    print("✅ Preprocessing finished")
    print(f"✅ Cleaned file: {OUT_CLEANED}")
    print(f"✅ Summary file: {OUT_SUMMARY}")


if __name__ == "__main__":
    main()
