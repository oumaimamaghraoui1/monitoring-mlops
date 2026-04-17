import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE = BASE_DIR / "mlops" / "data" / "processed" / "ml_events.parquet"
OUT_FILE = BASE_DIR / "mlops" / "data" / "features" / "ml_features.parquet"


# =========================================================
# SAFE ROLLING COUNT (NO ROW DROP)
# =========================================================
def rolling_count(group, window="7D"):
    group = group.sort_values("time").copy()
    group["event"] = 1

    rolled = (
        group
        .set_index("time")["event"]
        .rolling(window)
        .count()
        .reset_index(drop=True)
    )

    rolled.index = group.index
    return rolled


# =========================================================
# MAIN PIPELINE
# =========================================================
def main():
    df = pd.read_parquet(IN_FILE)

    if df.empty:
        raise RuntimeError("ml_events.parquet is empty")

    # ✅ robust datetime parsing for mixed ISO strings
    df["time"] = pd.to_datetime(
        df["time"],
        utc=True,
        format="mixed",
        errors="coerce"
    )

    # drop invalid timestamps safely
    df = df.dropna(subset=["time"]).copy()

    if df.empty:
        raise RuntimeError("No valid timestamps found in ml_events.parquet")

    # ---------------------------
    # TIME FEATURES
    # ---------------------------
    df["hour"] = df["time"].dt.hour
    df["day"] = df["time"].dt.dayofweek
    df["weekend"] = df["day"].isin([5, 6]).astype(int)

    # ✅ ensure required grouping columns exist
    if "actor" not in df.columns:
        df["actor"] = "Unknown"

    if "objectType" not in df.columns:
        df["objectType"] = "Configuration Change"

    # sort by actor/time for rolling behaviour
    df = df.sort_values(["actor", "time"]).reset_index(drop=True)

    # ---------------------------
    # ACTOR ACTIVITY 7D
    # ---------------------------
    df["actor_count_7d"] = (
        df.groupby("actor", group_keys=False)
        .apply(lambda g: rolling_count(g, "7D"))
        .reset_index(drop=True)
    )

    # ---------------------------
    # ACTOR + OBJECT ACTIVITY 7D
    # ---------------------------
    df["actor_object_7d"] = (
        df.groupby(["actor", "objectType"], group_keys=False)
        .apply(lambda g: rolling_count(g, "7D"))
        .reset_index(drop=True)
    )

    # ---------------------------
    # TIME SINCE LAST ACTION
    # ---------------------------
    df["time_since_last_actor"] = (
        df.groupby("actor")["time"]
        .diff()
        .dt.total_seconds()
        .fillna(0)
    )

    # ---------------------------
    # FIRST TIME BEHAVIOUR FLAG
    # ---------------------------
    df["first_time_role"] = (df["actor_object_7d"] <= 1).astype(int)

    # ---------------------------
    # KEEP ONLY NEEDED COLUMNS
    # ---------------------------
    df = df[
        [
            "uuid",
            "time",
            "hour",
            "day",
            "weekend",
            "actor_count_7d",
            "actor_object_7d",
            "time_since_last_actor",
            "first_time_role"
        ]
    ]

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_FILE, index=False)

    print("✅ ml_features.parquet created")


if __name__ == "__main__":
    main()
