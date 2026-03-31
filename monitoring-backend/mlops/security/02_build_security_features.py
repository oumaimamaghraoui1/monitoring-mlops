import pandas as pd
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[2]

IN_FILE  = BASE_DIR / "data" / "security_events.json"
OUT_FILE = BASE_DIR / "mlops" / "data" / "features" / "security_features.parquet"

def main():

    df = pd.read_json(IN_FILE)

    if df.empty:
        print("⚠️ No security events found.")
        return

    df["time"] = pd.to_datetime(df["time"], utc=True)

    # ⭐ TIME FEATURES
    df["hour"] = df["time"].dt.hour
    df["day"]  = df["time"].dt.dayofweek
    df["weekend"] = df["day"].isin([5,6]).astype(int)
    df["is_night"] = df["hour"].between(0,5).astype(int)

    df = df.sort_values(["user","time"]).reset_index(drop=True)

    # ⭐ LOGIN / TOKEN FLAGS
    df["login"] = (
        df["eventType"]
        .str.contains("AuthenticationSuccess",na=False)
    ).astype(int)

    df["token"] = (
        df["eventType"]
        .str.contains("TokenIssued",na=False)
    ).astype(int)

    # ⭐ USER HISTORY (7D)
    def roll(g,col):
        return (
            g.set_index("time")[col]
            .rolling("7D")
            .sum()
            .reset_index(drop=True)
        )

    df["login_count_7d"] = (
      df.groupby("user",group_keys=False)
        .apply(lambda g: roll(g,"login"))
        .reset_index(drop=True)
    )

    df["token_count_7d"] = (
      df.groupby("user",group_keys=False)
        .apply(lambda g: roll(g,"token"))
        .reset_index(drop=True)
    )

    # ⭐ IP DRIFT
    df["first_time_ip"] = (
        ~df.groupby("user")["ip"]
        .transform(lambda s: s.duplicated())
    ).astype(int)

    # ⭐ CLIENT DRIFT
    df["first_time_client"] = (
        ~df.groupby("user")["client"]
        .transform(lambda s: s.duplicated())
    ).astype(int)

    # ⭐ SESSION TEMPO
    df["time_since_last_login"] = (
        df.groupby("user")["time"]
        .diff()
        .dt.total_seconds()
        .fillna(0)
    )

    df = df[[
        "uuid",
        "time",
        "hour",
        "day",
        "weekend",
        "is_night",
        "login_count_7d",
        "token_count_7d",
        "first_time_ip",
        "first_time_client",
        "time_since_last_login"
    ]]

    OUT_FILE.parent.mkdir(parents=True,exist_ok=True)

    df.to_parquet(OUT_FILE,index=False)

    print("✅ security_features.parquet created")

if __name__ == "__main__":
    main()