import argparse
import pandas as pd
import re

def extract_namespace(code):

    if isinstance(code,str) and code.startswith("/"):
        match = re.match(r'^(/[^/]+/)',code)
        if match:
            return match.group(1)
    if str(code).startswith("Z"):
        return "Z_CUSTOM"
    if str(code).startswith("Y"):
        return "Y_CUSTOM"
    return "STANDARD"


parser = argparse.ArgumentParser()
parser.add_argument("--input", required=True)
args = parser.parse_args()

df = pd.read_csv(
    args.input,
    engine="python",
    quotechar='"',
    on_bad_lines='skip'
)

df['namespace'] = df['Transaction Code'].apply(extract_namespace)
df['has_description'] = df['Transaction Description'].notnull().astype(int)
df['contains_badi'] = df['Transaction Description'].astype(str).str.contains("BAdI").astype(int)

df['prefix'] = df['Transaction Code'].astype(str).str[:2]

df['combined_text'] = (
    df['Transaction Code'].astype(str)+" "+
    df['Program'].astype(str)+" "+
    df['Transaction Description'].astype(str)+" "+
    df['namespace'].astype(str)+" "+
    df['prefix']
)

df.to_csv("output/transactions_cleaned.csv",index=False)

summary = pd.DataFrame({
    "Metric":[
    "Total Rows",
    "Unique Transaction Codes",
    "Has Description",
    "Contains BAdI"
    ],
    "Value":[
    len(df),
    df["Transaction Code"].nunique(),
    df["has_description"].sum(),
    df["contains_badi"].sum()
]})

with pd.ExcelWriter("output/transactions_profile.xlsx",engine="openpyxl") as writer:
    df.to_excel(writer,sheet_name="Cleaned_Data",index=False)
    summary.to_excel(writer,sheet_name="Summary",index=False)

print("✅ Preprocessing finished + Excel Profile Created")