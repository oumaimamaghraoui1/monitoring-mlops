import argparse
import os
import joblib
import pandas as pd

from scipy.sparse import load_npz, hstack


def build_query_vector(query_text, word_vectorizer, char_vectorizer):
    q_word = word_vectorizer.transform([query_text])
    q_char = char_vectorizer.transform([query_text])
    return hstack([q_word, q_char]).tocsr()


def main(model_dir, code=None, text=None, top_k=5):
    artifacts_path = os.path.join(model_dir, "recommender_artifacts.joblib")
    matrix_path = os.path.join(model_dir, "transaction_matrix.npz")
    data_path = os.path.join(model_dir, "transactions_enriched.csv")

    artifacts = joblib.load(artifacts_path)
    df = pd.read_csv(data_path)
    X = load_npz(matrix_path)

    word_vectorizer = artifacts["word_vectorizer"]
    char_vectorizer = artifacts["char_vectorizer"]
    knn = artifacts["knn"]

    query_vector = None
    query_label = None
    exclude_index = None

    if code:
        match = df[df["Transaction Code"] == code]
        if match.empty:
            print(f"❌ Transaction code not found: {code}")
            return

        idx = match.index[0]
        query_vector = X[idx]
        query_label = code
        exclude_index = idx

    elif text:
        query_vector = build_query_vector(text, word_vectorizer, char_vectorizer)
        query_label = text

    else:
        print("❌ Provide either --code or --text")
        return

    distances, indices = knn.kneighbors(query_vector, n_neighbors=min(top_k + 1, len(df)))

    print(f"\n🔎 Recommendations for: {query_label}\n")

    shown = 0
    for dist, idx in zip(distances[0], indices[0]):
        if exclude_index is not None and idx == exclude_index:
            continue

        row = df.iloc[idx]
        similarity = 1 - dist

        print(f"#{shown + 1}")
        print(f"Transaction Code : {row['Transaction Code']}")
        print(f"Program          : {row['Program']}")
        print(f"Screen           : {row['Screen']}")
        print(f"Category         : {row['category']}")
        print(f"Cluster          : {row['cluster']}")
        print(f"Description      : {row['Transaction Description']}")
        print(f"Similarity       : {similarity:.4f}")
        print("-" * 60)

        shown += 1
        if shown >= top_k:
            break


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Recommend similar SAP transactions.")
    parser.add_argument("--model_dir", required=True, help="Path to artifacts directory")
    parser.add_argument("--code", help="Transaction code to search")
    parser.add_argument("--text", help="Free text query")
    parser.add_argument("--top_k", type=int, default=5, help="Number of recommendations")
    args = parser.parse_args()

    main(args.model_dir, code=args.code, text=args.text, top_k=args.top_k)