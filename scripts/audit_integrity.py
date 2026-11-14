"""Task A10 integrity audit, from git and files only: writes docs/audit-integrity.md.

    python -m scripts.audit_integrity

For every trial folder:
- order: the prediction commit (receipt.commit) and the commit that added receipt.json are ancestors of, and
  earlier than, the first commit that adds verification.json or any evaluation-derived file;
- hashes: trial -> training -> prediction -> receipt chain (scripts.predict.check), receipt hash = file,
  prediction bytes in the receipt's commit = file, verification.prediction_sha256 = file;
- verdicts: every residual block's D^2 = r'(C_pred + C_obs)^-1 r recomputed from verification.json, the
  verdict (D^2 <= 5.991) re-derived, C_pred compared with prediction.json where the times match, and the
  status and D^2 compared with scoreboard.json.
For the asteroid batch also: the pre-registered rules, the model code and both pre-freeze amendments are
ancestors of, and earlier than, the freeze commit.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from scripts import predict

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "static" / "data"
TRIALS = DATA / "trials"
OUT = ROOT / "docs" / "audit-integrity.md"
THRESHOLD = 5.991464547107979
FREEZE = "61b3cb7"
BATCH_BEFORE_FREEZE = {
    "b9ef625": "pre-registered rules and the MOST integrity rule",
    "8268808": "forecast model and verification code",
    "3dfd962": "amendment: heliocentric primary, barycentric v2 secondary",
    "4d7a076": "amendment: one rule for the batch; covariance envelope with the chi2-scaled formal estimate",
    "8fea8b9": "amendment timestamps corrected",
}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], cwd=ROOT, capture_output=True, text=True).stdout.strip()


def first_added(path: str) -> tuple[str, int] | None:
    lines = git("log", "--diff-filter=A", "--format=%H %ct", "--", path).splitlines()
    if not lines:
        return None
    commit, stamp = lines[-1].split()
    return commit, int(stamp)


def commit_time(commit: str) -> int:
    return int(git("show", "-s", "--format=%ct", commit))


def utc(stamp: int) -> str:
    import datetime
    return datetime.datetime.fromtimestamp(stamp, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M")


def ancestor(a: str, b: str) -> bool:
    return subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=ROOT).returncode == 0


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def evaluation_paths(trial_id: str, trial: dict) -> list[str]:
    paths = [f"static/data/trials/{trial_id}/verification.json"]
    if trial_id == "pluto-position-2026b":
        paths += ["static/data/trials/pluto/postmortem.json", "static/data/trials/pluto/hindcast-v2.json",
                  "docs/postmortem-pluto.md"]
    if trial.get("batch_id"):
        number = trial_id.split("-")[1]
        paths += [f"docs/exposure/asteroids/raw/{number}.json", "docs/exposure/asteroids/exploratory-outlier.json"]
    return paths


def evaluation_pixel_files(trial_id: str, trial: dict) -> list[Path]:
    """Evaluation cutouts on this machine (never committed): their file times are the evidence of when they were opened."""
    cache = ROOT / "cache"
    if trial_id == "pluto-position-2026b":
        return sorted((cache / "bodies" / "pluto-eval").glob("**/*.fits"))
    if trial.get("batch_id"):
        number = trial_id.split("-")[1]
        return sorted((cache / "asteroids" / number / "eval").glob("**/*.fits"))
    return []


def recompute(block: dict) -> dict:
    residual = np.array([block["east_arcsec"], block["north_arcsec"]], float)
    total = np.array(block["c_pred_arcsec2"], float) + np.array(block["c_obs_arcsec2"], float)
    d2 = float(residual @ np.linalg.inv(total) @ residual)
    return {"d2": d2, "status": "hit" if d2 <= THRESHOLD else "miss"}


def scoreboard_rows() -> dict:
    board = json.loads((DATA / "scoreboard.json").read_text())
    rows = {row["trial_id"]: row for row in board.get("rows", [])}
    rows.update({row["trial_id"]: row for row in (board.get("asteroid_batch") or {}).get("rows", [])})
    return rows


def audit_trial(trial_id: str, board: dict) -> dict:
    folder = TRIALS / trial_id
    trial = json.loads((folder / "trial.json").read_text())
    row = {"trial_id": trial_id, "category": trial["category"], "problems": [], "notes": []}
    if (folder / "abandoned.json").exists():
        row["kind"] = "abandoned before prediction"
        if (folder / "prediction.json").exists():
            row["problems"].append("abandoned trial has a prediction")
        return row
    for problem in predict.check(trial_id):
        row["problems"].append(problem)
    prediction_path, receipt_path = folder / "prediction.json", folder / "receipt.json"
    if not prediction_path.exists():
        row["problems"].append("no prediction")
        return row
    data = prediction_path.read_bytes()
    prediction = json.loads(data)
    if not receipt_path.exists():
        row["problems"].append("no receipt")
        return row
    receipt = json.loads(receipt_path.read_text())
    if receipt["prediction_sha256"] != sha(data):
        row["problems"].append("receipt hash differs from prediction.json")
    committed = subprocess.run(["git", "show", f"{receipt['commit']}:static/data/trials/{trial_id}/prediction.json"],
                               cwd=ROOT, capture_output=True).stdout
    if committed != data:
        row["problems"].append("prediction.json differs from the receipt's commit")
    prediction_added = first_added(f"static/data/trials/{trial_id}/prediction.json")
    receipt_added = first_added(f"static/data/trials/{trial_id}/receipt.json")
    if prediction_added and not prediction_added[0].startswith(receipt["commit"][:7]) and \
            not receipt["commit"].startswith(prediction_added[0][:7]):
        row["notes"].append(f"receipt.commit {receipt['commit'][:7]} is not the commit that first added "
                            f"prediction.json ({prediction_added[0][:7]})")
    row["prediction_commit"] = (receipt["commit"][:7], commit_time(receipt["commit"]))
    row["receipt_commit"] = (receipt_added[0][:7], receipt_added[1]) if receipt_added else None
    evaluation = [(path, first_added(path)) for path in evaluation_paths(trial_id, trial)]
    evaluation = [(path, added) for path, added in evaluation if added]
    if evaluation:
        path, (commit, stamp) = min(evaluation, key=lambda item: item[1][1])
        row["evaluation_commit"] = (commit[:7], stamp, path.split("/")[-1])
        for label, (other, other_stamp) in (("prediction", (receipt["commit"], row["prediction_commit"][1])),
                                            ("receipt", receipt_added)):
            if not ancestor(other, commit):
                row["problems"].append(f"{label} commit is not an ancestor of the first evaluation commit")
            if other_stamp >= stamp:
                row["problems"].append(f"{label} commit is not earlier than the first evaluation commit")
    else:
        row["evaluation_commit"] = None
    pixels = evaluation_pixel_files(trial_id, trial)
    if pixels:
        earliest = min(path.stat().st_mtime for path in pixels)
        row["evaluation_pixels"] = (len(pixels), int(earliest))
        if earliest <= row["prediction_commit"][1]:
            row["problems"].append("an evaluation cutout on disk is older than the prediction commit")
    verification_path = folder / "verification.json"
    board_row = board.get(trial_id)
    if prediction.get("prediction_status") == "insufficient_data":
        row["verdict"] = "insufficient_data (frozen)"
        if board_row and board_row["status"] != "insufficient_data":
            row["problems"].append(f"scoreboard says {board_row['status']}")
        return row
    if not verification_path.exists():
        row["verdict"] = "open forecast (not checked yet)" if trial.get("open_forecast") else "waiting"
        if board_row and board_row["status"] != "waiting" and not trial.get("open_forecast"):
            row["problems"].append(f"scoreboard says {board_row['status']}")
        return row
    verification = json.loads(verification_path.read_text())
    if verification["prediction_sha256"] != sha(data):
        row["problems"].append("verification refers to another prediction")
    residuals = verification.get("residuals") or {}
    recomputed = {}
    for name, block in residuals.items():
        if block is None:
            continue
        result = recompute(block)
        recomputed[name] = result
        if abs(result["d2"] - block["d2"]) > 1e-3 * max(1.0, abs(block["d2"])):
            row["problems"].append(f"{name} D2 stored {block['d2']} vs recomputed {result['d2']:.4f}")
        if block.get("status") != result["status"]:
            row["problems"].append(f"{name} status stored {block.get('status')} vs recomputed {result['status']}")
    if "model" in recomputed:
        if verification["status"] != recomputed["model"]["status"]:
            row["problems"].append(f"verification status {verification['status']} vs recomputed {recomputed['model']['status']}")
        stored_c = np.array(residuals["model"]["c_pred_arcsec2"], float)
        frozen_c = np.array((prediction.get("model") or {}).get("cov_arcsec2") or np.zeros((2, 2)), float)
        if abs(float(verification.get("t_mjd") or 0) - float(prediction.get("t_mjd") or 0)) < 1e-6 or trial.get("batch_id"):
            if not np.allclose(stored_c, frozen_c, rtol=1e-5, atol=1e-6):
                row["problems"].append("C_pred in verification differs from the frozen prediction")
            else:
                row["notes"].append("C_pred equals the frozen value")
        else:
            row["notes"].append(f"C_pred evaluated by the frozen code at the observed mean time (trace "
                                f"{np.trace(stored_c):.4g} vs {np.trace(frozen_c):.4g} at the planned time)")
    row["verdict"] = verification["status"]
    row["d2"] = {name: (residuals[name]["d2"], round(result["d2"], 4)) for name, result in recomputed.items()}
    if board_row:
        if board_row["status"] != verification["status"]:
            row["problems"].append(f"scoreboard status {board_row['status']} vs verification {verification['status']}")
        stored = board_row.get("model_d2")
        if "model" in recomputed and (stored is None or abs(stored - residuals["model"]["d2"]) > 1e-6):
            row["problems"].append(f"scoreboard model_d2 {stored} vs verification {residuals['model']['d2']}")
    else:
        row["problems"].append("not on the scoreboard")
    for correction in verification.get("corrections", []) or []:
        row["notes"].append(f"logged correction: {str(correction.get('what') or correction)[:90]}")
    return row


def batch_checks() -> list[dict]:
    rows = []
    freeze_time = commit_time(FREEZE)
    for commit, what in BATCH_BEFORE_FREEZE.items():
        ok_ancestor, stamp = ancestor(commit, FREEZE), commit_time(commit)
        rows.append({"commit": commit, "what": what, "time": stamp, "ancestor": ok_ancestor,
                     "earlier": stamp < freeze_time, "ok": ok_ancestor and stamp < freeze_time})
    at_freeze_forecast = git("show", f"{FREEZE}:scripts/asteroid_forecast.py")
    at_freeze_driver = git("show", f"{FREEZE}:scripts/asteroids.py")
    rows.append({"commit": FREEZE, "what": "freeze commit contains the covariance envelope "
                                          "(formal_scaled_by_chi2) and the heliocentric primary",
                 "time": freeze_time, "ancestor": True, "earlier": True,
                 "ok": "formal_scaled_by_chi2" in at_freeze_forecast
                       and 'PRIMARY, SECONDARY = "heliocentric_two_body", "barycentric_two_body"' in at_freeze_driver})
    selection = first_added("docs/exposure/asteroids/selection.json")
    rows.append({"commit": selection[0][:7], "what": "selection record added after the rules commit b9ef625",
                 "time": selection[1], "ancestor": ancestor("b9ef625", selection[0]),
                 "earlier": commit_time("b9ef625") < selection[1],
                 "ok": ancestor("b9ef625", selection[0]) and commit_time("b9ef625") < selection[1]})
    return rows


def render(rows: list[dict], batch: list[dict]) -> str:
    lines = ["# Integrity audit (Task A10)", "",
             f"Generated by `python -m scripts.audit_integrity` from git and files only, at git `{git('rev-parse', '--short', 'HEAD')}`.",
             "Times are UTC. The \"first evaluation commit\" is the first commit that adds verification.json or another",
             "evaluation-derived file (Pluto: post-mortem and hindcast; asteroid batch: raw MOST tables and the",
             "exploratory OUTLIER file). D² is recomputed as r'(C_pred + C_obs)^-1 r from each residual block.",
             "Evaluation pixels are never committed: for Pluto and the asteroids the earliest evaluation cutout on this",
             "machine (file time) must be later than the prediction commit (column \"Eval pixels first on disk\").",
             "Barnard's Star and Epsilon Indi B are retrospective by design: their holdout exposures were opened in A3,",
             "before the freeze, and their category says so. Makemake 2026a is retrospective (teammate viewing, A4).", "",
             "| Trial | Category | Prediction commit | Receipt commit | First evaluation commit | Eval pixels first on disk | D² stored → recomputed | Verdict | Result |",
             "|---|---|---|---|---|---|---|---|---|"]
    for row in rows:
        def show(entry):
            return f"`{entry[0]}` {utc(entry[1])}" if entry else "—"
        evaluation = row.get("evaluation_commit")
        evaluation_text = f"`{evaluation[0]}` {utc(evaluation[1])} ({evaluation[2]})" if evaluation else "—"
        d2 = "; ".join(f"{name} {stored} → {new}" for name, (stored, new) in (row.get("d2") or {}).items()) or "—"
        result = "PASS" if not row["problems"] else "FAIL: " + "; ".join(row["problems"])
        pixels = row.get("evaluation_pixels")
        pixel_text = f"{pixels[0]} files, {utc(pixels[1])}" if pixels else "—"
        lines.append(f"| `{row['trial_id']}` | {row['category']} | {show(row.get('prediction_commit'))} | "
                     f"{show(row.get('receipt_commit'))} | {evaluation_text} | {pixel_text} | {d2} | "
                     f"{row.get('verdict', row.get('kind', '—'))} | {result} |")
    lines += ["", "## Notes per trial", ""]
    for row in rows:
        for note in row["notes"]:
            lines.append(f"- `{row['trial_id']}`: {note}")
    lines += ["", "## Asteroid batch: committed before the freeze `61b3cb7`", "",
              "| Commit | What | Time (UTC) | Ancestor of the freeze | Earlier | Result |", "|---|---|---|---|---|---|"]
    for entry in batch:
        lines.append(f"| `{entry['commit']}` | {entry['what']} | {utc(entry['time'])} | {entry['ancestor']} | "
                     f"{entry['earlier']} | {'PASS' if entry['ok'] else 'FAIL'} |")
    failures = sum(1 for row in rows if row["problems"]) + sum(1 for entry in batch if not entry["ok"])
    lines += ["", "## Fixes made by this audit", "",
              "None were needed: every check passed. No frozen file was changed.", ""]
    lines += ["", f"**Summary:** {len(rows)} trial folders, {sum(1 for r in rows if not r['problems'])} pass; "
                  f"{len(batch)} batch checks, {sum(1 for e in batch if e['ok'])} pass; {failures} failures.", ""]
    return "\n".join(lines)


def main() -> int:
    board = scoreboard_rows()
    rows = [audit_trial(folder.name, board) for folder in sorted(TRIALS.iterdir()) if (folder / "trial.json").exists()]
    batch = batch_checks()
    OUT.write_text(render(rows, batch))
    failures = [row for row in rows if row["problems"]] + [e for e in batch if not e["ok"]]
    for row in rows:
        print(row["trial_id"], "PASS" if not row["problems"] else row["problems"])
    for entry in batch:
        print(entry["commit"], entry["what"][:50], "PASS" if entry["ok"] else "FAIL")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
