"""A10: the integrity audit passes and the submission numbers come from the data files."""
from scripts import audit_integrity, submission_numbers


def test_every_trial_passes_the_integrity_audit():
    board = audit_integrity.scoreboard_rows()
    rows = [audit_integrity.audit_trial(folder.name, board)
            for folder in sorted(audit_integrity.TRIALS.iterdir()) if (folder / "trial.json").exists()]
    assert rows and all(not row["problems"] for row in rows), [(r["trial_id"], r["problems"]) for r in rows if r["problems"]]


def test_batch_amendments_precede_the_freeze():
    assert all(entry["ok"] for entry in audit_integrity.batch_checks())


def test_d2_recomputation():
    block = {"east_arcsec": 3.0, "north_arcsec": 0.0, "c_pred_arcsec2": [[1.0, 0.0], [0.0, 1.0]],
             "c_obs_arcsec2": [[0.0, 0.0], [0.0, 0.0]]}
    assert audit_integrity.recompute(block) == {"d2": 9.0, "status": "miss"}


def test_submission_numbers_are_generated_with_sources():
    text = submission_numbers.build()
    lines = [line for line in text.splitlines() if line.startswith("- ")]
    assert len(lines) > 30 and all(" — `" in line and "` → `" in line for line in lines)
