import unittest

from wait_for_release_feed_turn import active_predecessors


class WaitForReleaseFeedTurnTest(unittest.TestCase):
  def test_returns_active_older_runs_in_order(self) -> None:
    current = {
      "id": 55,
      "run_attempt": 1,
      "run_started_at": "2026-08-24T10:05:00Z",
    }
    runs = [
      self.workflow_run(52, "queued", "release-tip", "2026-08-24T10:03:00Z"),
      self.workflow_run(48, "in_progress", "release", "2026-08-24T10:01:00Z"),
      self.workflow_run(45, "completed", "release-tip", "2026-08-24T10:00:00Z"),
      self.workflow_run(60, "in_progress", "release", "2026-08-24T10:06:00Z"),
      self.workflow_run(55, "in_progress", "release-tip", "2026-08-24T10:05:00Z"),
    ]

    self.assertEqual(
      active_predecessors(current, runs),
      [
        self.workflow_run(48, "in_progress", "release", "2026-08-24T10:01:00Z"),
        self.workflow_run(52, "queued", "release-tip", "2026-08-24T10:03:00Z"),
      ],
    )

  def test_ignores_current_newer_and_completed_runs(self) -> None:
    current = {
      "id": 8,
      "run_attempt": 1,
      "run_started_at": "2026-08-24T10:01:00Z",
    }
    runs = [
      self.workflow_run(7, "completed", "release", "2026-08-24T10:00:00Z"),
      self.workflow_run(8, "in_progress", "release-tip", "2026-08-24T10:01:00Z"),
      self.workflow_run(9, "queued", "release", "2026-08-24T10:02:00Z"),
    ]

    self.assertEqual(active_predecessors(current, runs), [])

  def test_rerun_waits_for_an_earlier_attempt_with_a_higher_run_id(self) -> None:
    current = {
      "id": 8,
      "run_attempt": 2,
      "run_started_at": "2026-08-24T10:10:00Z",
    }
    newer_run = self.workflow_run(
      9,
      "in_progress",
      "release-tip",
      "2026-08-24T10:08:00Z",
    )

    self.assertEqual(active_predecessors(current, [newer_run]), [newer_run])

  @staticmethod
  def workflow_run(
    run_id: int,
    status: str,
    name: str,
    started_at: str,
    attempt: int = 1,
  ) -> dict:
    return {
      "id": run_id,
      "status": status,
      "name": name,
      "run_attempt": attempt,
      "run_started_at": started_at,
    }


if __name__ == "__main__":
  unittest.main()
