import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE  = BASE_DIR / "mlops" / "data" / "processed" / "ml_events.parquet"
OUT_FILE = BASE_DIR / "mlops" / "data" / "features" / "ml_features.parquet"

def rolling_count(group, window="7D"):
    group = group.sort_values("time").copy()
    group["event"] = 1

    rolled = (
        group.rolling(window=window, on="time")["event"]
        .count()
    )

    group["count"] = rolled.values
    return group["count"]

def main():

    df = pd.read_parquet(IN_FILE)

    df["time"] = pd.to_datetime(df["time"], utc=True)

    # ---- Time Features ----
    df["hour"] = df["time"].dt.hour
    df["day"]  = df["time"].dt.dayofweek
    df["weekend"] = df["day"].isin([5,6]).astype(int)

    df = df.sort_values(["actor","time"]).reset_index(drop=True)

    # ---- Actor Activity 7D ----
    df["actor_count_7d"] = (
        df.groupby("actor", group_keys=False)
        .apply(lambda g: rolling_count(g, "7D"))
        .reset_index(drop=True)
    )

    # ---- Actor + Object Behaviour 7D ----
    df["actor_object_7d"] = (
        df.groupby(["actor","object_type"], group_keys=False)
        .apply(lambda g: rolling_count(g, "7D"))
        .reset_index(drop=True)
    )

    # ---- Time Since Last Activity ----
    df["time_since_last_actor"] = (
        df.groupby("actor")["time"]
        .diff()
        .dt.total_seconds()
        .fillna(0)
    )

    # ---- First Time Behaviour ----
    df["first_time_role"] = (df["actor_object_7d"] <= 1).astype(int)

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT_FILE,index=False)

    print("✅ ml_features.parquet created")

if __name__ == "__main__":
    main()