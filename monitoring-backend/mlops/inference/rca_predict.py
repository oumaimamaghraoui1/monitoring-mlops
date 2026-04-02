from pathlib import Path
import sys
import json
import joblib

BASE_DIR = Path(__file__).resolve().parents[2]

MODEL_PATH = BASE_DIR / "mlops/models/rca_model.pkl"
ENCODER_PATH = BASE_DIR / "mlops/models/rca_label_encoder.pkl"

# ✅ LOAD ONCE (GLOBAL)
model = joblib.load(MODEL_PATH)
encoder = joblib.load(ENCODER_PATH)

def predict_rca(input_data):

    X = [[
        input_data["cpu"],
        input_data["latency"],
        input_data["heap_ratio"],
        input_data["gc"],
        input_data["lag"],
        input_data["cpu_delta"],
        input_data["lag_delta"],
        input_data["handle_count"],
        input_data["handle_delta"],
        input_data["req_rate"],
        input_data["resp_rate"]
    ]]

    prediction = model.predict(X)[0]
    cause = encoder.inverse_transform([prediction])[0]

    return {
        "cause": cause
    }

if __name__ == "__main__":

    if len(sys.argv) > 1:
        input_data = json.loads(sys.argv[1])
    else:
        input_data = {
            "cpu":50,
            "latency":100,
            "heap_ratio":0.5,
            "gc":1,
            "lag":5,
            "cpu_delta":0,
            "lag_delta":0,
            "handle_count":5,
            "handle_delta":0,
            "req_rate":0.02,
            "resp_rate":0.015
        }

    result = predict_rca(input_data)

    print(json.dumps(result))
    sys.exit(0)