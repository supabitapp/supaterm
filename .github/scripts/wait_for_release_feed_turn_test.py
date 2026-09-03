import unittest
import urllib.error
from unittest.mock import Mock, call, patch

from wait_for_release_feed_turn import (
  active_predecessors,
  publication_order,
  wait_for_turn,
  workflow_runs,
)


def workflow_run(
  run_id: int,
  status: str,
  started_at: str,
  attempt: int = 1,
  name: str = "release",
) -> dict:
  return {
    "id": run_id,
    "name": name,
    "run_attempt": attempt,
    "run_started_at": started_at,
    "status": status,
  }


class PublicationOrderTest(unittest.TestCase):
  def test_order_uses_start_time_then_id_then_attempt(self) -> None:
    runs = [
      workflow_run(11, "queued", "2026-08-24T10:00:00Z", 2),
      workflow_run(10, "queued", "2026-08-24T10:00:00Z", 1),
      workflow_run(11, "queued", "2026-08-24T10:00:00Z", 1),
      workflow_run(99, "queued", "2026-08-24T09:59:59Z", 1),
    ]

    self.assertEqual(
      sorted(runs, key=publication_order),
      [runs[3], runs[1], runs[2], runs[0]],
    )

  def test_active_predecessors_returns_only_older_unfinished_runs(self) -> None:
    current = workflow_run(55, "in_progress", "2026-08-24T10:05:00Z")
    older = workflow_run(48, "in_progress", "2026-08-24T10:01:00Z")
    queued = workflow_run(52, "queued", "2026-08-24T10:03:00Z", name="release-tip")
    runs = [
      queued,
      older,
      workflow_run(45, "completed", "2026-08-24T10:00:00Z"),
      workflow_run(60, "in_progress", "2026-08-24T10:06:00Z"),
      current,
    ]

    self.assertEqual(active_predecessors(current, runs), [older, queued])


class WorkflowRunsTest(unittest.TestCase):
  @patch("wait_for_release_feed_turn.request_json")
  def test_loads_every_page_for_each_release_workflow(self, request_json: Mock) -> None:
    first_page = [
      workflow_run(run_id, "completed", f"2026-08-24T10:{run_id % 60:02d}:00Z")
      for run_id in range(100)
    ]
    final_run = workflow_run(100, "queued", "2026-08-24T11:00:00Z")
    request_json.side_effect = [
      {"workflow_runs": first_page},
      {"workflow_runs": [final_run]},
      {"workflow_runs": []},
    ]

    self.assertEqual(
      workflow_runs("supabitapp/supaterm", "token"),
      [*first_page, final_run],
    )
    base = "https://api.github.com/repos/supabitapp/supaterm/actions/workflows"
    self.assertEqual(
      request_json.call_args_list,
      [
        call(f"{base}/release.yml/runs?per_page=100&page=1", "token"),
        call(f"{base}/release.yml/runs?per_page=100&page=2", "token"),
        call(f"{base}/release-tip.yml/runs?per_page=100&page=1", "token"),
      ],
    )

  @patch("wait_for_release_feed_turn.request_json")
  def test_api_failure_is_not_treated_as_an_empty_queue(self, request_json: Mock) -> None:
    request_json.side_effect = urllib.error.HTTPError(
      "https://api.github.com/example",
      500,
      "server error",
      {},
      None,
    )

    with self.assertRaises(urllib.error.HTTPError):
      workflow_runs("supabitapp/supaterm", "token")


class WaitForTurnTest(unittest.TestCase):
  def test_polls_until_the_predecessor_completes(self) -> None:
    current = workflow_run(55, "in_progress", "2026-08-24T10:05:00Z")
    predecessor = workflow_run(48, "in_progress", "2026-08-24T10:01:00Z")
    load_runs = Mock(side_effect=[[predecessor], []])
    sleep = Mock()

    with patch("builtins.print") as print_mock:
      wait_for_turn(current, load_runs, 3, sleep)

    self.assertEqual(load_runs.call_count, 2)
    sleep.assert_called_once_with(3)
    print_mock.assert_called_once_with("Waiting for release 48", flush=True)

  def test_returns_without_sleeping_when_no_predecessor_is_active(self) -> None:
    current = workflow_run(55, "in_progress", "2026-08-24T10:05:00Z")
    load_runs = Mock(return_value=[])
    sleep = Mock()

    wait_for_turn(current, load_runs, 3, sleep)

    load_runs.assert_called_once_with()
    sleep.assert_not_called()


if __name__ == "__main__":
  unittest.main()
