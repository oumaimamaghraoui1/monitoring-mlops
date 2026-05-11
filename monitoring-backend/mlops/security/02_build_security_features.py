import json
from pathlib import Path
import pandas as pd

BASE_DIR = Path(__file__).resolve().parents[2]

INPUT = BASE_DIR / "data" / "security_events.json"
OUTPUT = BASE_DIR / "mlops" / "data" / "features" / "security_features.parquet"


def load_security_events():
    if not INPUT.exists():
        raise FileNotFoundError(f"Missing security events file: {INPUT}")

    with open(INPUT, "r", encoding="utf-8") as fp:
        data = json.load(fp)

    if isinstance(data, list):
        return data

    if isinstance(data, dict) and isinstance(data.get("logs"), list):
        return data["logs"]

    return []


def map_event_group(event_type):
    t = str(event_type or "").lower()

    if (
        "userauthenticationsuccess" in t
        or "identityproviderauthenticationsuccess" in t
        or "login" in t
        or "authentication" in t
        or "authsuccess" in t
        or "logon" in t
    ):
        if "client" in t:
            return "CLIENT"
        if "token" in t:
            return "TOKEN"
        return "LOGIN"

    if (
        "tokenissuedevent" in t
        or "tokenissued" in t
        or "token" in t
        or "oauth" in t
        or "jwt" in t
    ):
        return "TOKEN"

    if (
        "clientauthenticationsuccess" in t
        or "clientauthentication" in t
        or "clientauth" in t
        or "client" in t
    ):
        return "CLIENT"

    return "OTHER"


def normalize_row(ev):
    if not isinstance(ev, dict):
        return None

    time_value = ev.get("time")
    dt = pd.to_datetime(time_value, utc=True, errors="coerce")

    if pd.isna(dt):
        return None

    user = ev.get("user") or "Unknown"
    client = ev.get("client") or "Unknown"
    ip = ev.get("ip") or "Unknown"
    origin = ev.get("origin") or "N/A"
    event_type = ev.get("eventType") or "Security Event"
    message = ev.get("message") or ""

    event_group = map_event_group(event_type)

    return {
        "uuid": ev.get("uuid") or f"{event_type}|{time_value}|{user}|{client}|{ip}",
        "time": dt,
        "user": str(user),
        "client": str(client),
        "ip": str(ip),
        "origin": str(origin),
        "eventType": str(event_type),
        "message": str(message),
        "eventGroup": event_group,
        "hour": int(dt.hour),
        "day": int(dt.dayofweek),
        "weekend": 1 if int(dt.dayofweek) >= 5 else 0,
        "is_night": 1 if int(dt.hour) < 6 or int(dt.hour) >= 22 else 0,
        "is_login": 1 if event_group == "LOGIN" else 0,
        "is_token": 1 if event_group == "TOKEN" else 0,
        "is_client": 1 if event_group == "CLIENT" else 0
    }


def add_rolling_counts(df):
    df = df.sort_values(["user", "time"]).copy()

    df["login_count_7d"] = 0.0
    df["token_count_7d"] = 0.0

    for user, idx in df.groupby("user").groups.items():
        g = df.loc[idx].sort_values("time").copy()

        login_rolled = (
            g.set_index("time")["is_login"]
            .rolling("7D")
            .sum()
        )

        token_rolled = (
            g.set_index("time")["is_token"]
            .rolling("7D")
            .sum()
        )

        df.loc[g.index, "login_count_7d"] = login_rolled.to_numpy()
        df.loc[g.index, "token_count_7d"] = token_rolled.to_numpy()

    return df


def add_first_time_flags(df):
    df = df.sort_values(["user", "time"]).copy()

    df["first_time_ip"] = 0
    df["first_time_client"] = 0

    seen_ip = set()
    seen_client = set()

    for idx, row in df.iterrows():
        user = row.get("user", "Unknown")
        ip = row.get("ip", "Unknown")
        client = row.get("client", "Unknown")

        ip_key = (user, ip)
        client_key = (user, client)

        if ip_key not in seen_ip:
            df.at[idx, "first_time_ip"] = 1
            seen_ip.add(ip_key)

        if client_key not in seen_client:
            df.at[idx, "first_time_client"] = 1
            seen_client.add(client_key)

    return df


def add_time_since_last_login(df):
    df = df.sort_values(["user", "time"]).copy()
    df["time_since_last_login"] = 0.0

    for user, idx in df.groupby("user").groups.items():
        g = df.loc[idx].sort_values("time").copy()

        last_login_time = None

        for row_idx, row in g.iterrows():
            current_time = row["time"]

            if last_login_time is None:
                df.at[row_idx, "time_since_last_login"] = 0.0
            else:
                df.at[row_idx, "time_since_last_login"] = float(
                    (current_time - last_login_time).total_seconds()
                )

            if row.get("eventGroup") == "LOGIN":
                last_login_time = current_time

    return df


def main():
    events = load_security_events()

    rows = []

    for ev in events:
        row = normalize_row(ev)
        if row:
            rows.append(row)

    df = pd.DataFrame(rows)

    if df.empty:
        raise RuntimeError("No valid security events found")

    df = df.drop_duplicates(subset=["uuid"], keep="last")
    df = df.sort_values("time").reset_index(drop=True)

    df = add_rolling_counts(df)
    df = add_first_time_flags(df)
    df = add_time_since_last_login(df)

    # Keep original event columns + ML features
    keep_cols = [
        "uuid",
        "time",
        "user",
        "client",
        "ip",
        "origin",
        "eventType",
        "message",
        "eventGroup",
        "hour",
        "day",
        "weekend",
        "is_night",
        "login_count_7d",
        "token_count_7d",
        "first_time_ip",
        "first_time_client",
        "time_since_last_login"
    ]

    df = df[keep_cols]

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUTPUT, index=False)

    print("✅ security_features.parquet created")
    print(f"✅ Output: {OUTPUT}")
    print(f"✅ Rows: {len(df)}")


if __name__ == "__main__":
    main()