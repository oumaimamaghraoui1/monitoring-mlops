from pathlib import Path
import sys
import json
import joblib

# Load trained model + encoder
BASE_DIR = Path(__file__).resolve().parents[2]


MODEL_PATH = BASE_DIR / "mlops/models/rca_model.pkl"
ENCODER_PATH = BASE_DIR / "mlops/models/rca_label_encoder.pkl"

model = joblib.load(MODEL_PATH)
encoder = joblib.load(ENCODER_PATH)


# Read input from Node
input_data = json.loads(sys.argv[1])

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

result = {
    "cause": cause,
    "recommendation": ""
}

# ✅ THIS LINE IS THE MOST IMPORTANT
print(json.dumps(result))

# ✅ EXIT SO NODE STOPS WAITING
sys.exit(0)