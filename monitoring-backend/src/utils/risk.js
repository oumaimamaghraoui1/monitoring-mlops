export function computeRisk(score) {

  if (score < -0.10) {
    return {
      label: "High",
      state: "Error"
    };
  }

  if (score < -0.02) {
    return {
      label: "Medium",
      state: "Warning"
    };
  }

  if (score < 0.05) {
    return {
      label: "Low",
      state: "Information"
    };
  }

  return {
    label: "Normal",
    state: "Success"
  };
}