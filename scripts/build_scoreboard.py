"""Derive static/data/scoreboard.json from the trial folders (DATA-CONTRACT V1 §10, V5.5).

Usage: python -m scripts.build_scoreboard

Never edited by hand. Open forecasts are listed separately and never counted. A frozen
prediction without a verification is "waiting"; a prediction frozen as insufficient_data
counts as insufficient_data.
"""
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
STATUSES = ("waiting", "hit", "miss", "insufficient_data", "ambiguous", "invalid_comparison")


def _sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build(generated_utc: str | None = None) -> dict:
    rows, counts, open_forecasts, derived = [], {}, [], []
    for folder in sorted((DATA / "trials").iterdir()):
        trial_path = folder / "trial.json"
        if not trial_path.exists():
            continue
        trial = json.loads(trial_path.read_text())
        derived.append({"path": f"trials/{folder.name}/trial.json", "sha256": _sha(trial_path)})
        prediction_path, verification_path = folder / "prediction.json", folder / "verification.json"
        prediction = json.loads(prediction_path.read_text()) if prediction_path.exists() else None
        if prediction:
            derived.append({"path": f"trials/{folder.name}/prediction.json", "sha256": _sha(prediction_path)})
        if trial.get("open_forecast"):
            open_forecasts.append(trial["trial_id"])
            continue
        verification = json.loads(verification_path.read_text()) if verification_path.exists() else None
        if verification:
            derived.append({"path": f"trials/{folder.name}/verification.json", "sha256": _sha(verification_path)})
        if prediction is None:
            continue  # not yet predicted: not on the scoreboard
        if prediction.get("prediction_status") == "insufficient_data":
            status, reason = "insufficient_data", prediction.get("status_reason_key")
        elif verification:
            status, reason = verification["status"], verification.get("status_reason_key")
        else:
            status, reason = "waiting", None
        category = trial["category"]
        counts.setdefault(category, {name: 0 for name in STATUSES})[status] += 1
        residuals = (verification or {}).get("residuals", {})
        rows.append({
            "trial_id": trial["trial_id"], "target_key": trial["target_key"], "quantity": trial["quantity"],
            "category": category, "labels": trial.get("labels", [category]), "status": status,
            "status_reason_key": reason, "exploratory": trial.get("exploratory", False),
            "confirmation_pending": trial.get("confirmation_pending", False),
            "counts_as_prospective": bool(category == "prospective_unexposed" and not trial.get("exploratory")
                                          and status in ("hit", "miss")),
            "model_error_arcsec": (residuals.get("model") or {}).get("error_arcsec"),
            "baseline_error_arcsec": (residuals.get("baseline") or {}).get("error_arcsec"),
        })
    return {
        "schema_version": "tenger.scoreboard/1",
        "contract_version": 5,
        "generated_utc": generated_utc or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "derived_from": derived,
        "counts": counts,
        "see_only": ["3i-atlas"],
        "open_forecasts": open_forecasts,
        "rows": rows,
    }


if __name__ == "__main__":
    document = build()
    (DATA / "scoreboard.json").write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    print(json.dumps(document["counts"]), document["open_forecasts"])
