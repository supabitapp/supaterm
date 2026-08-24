#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import time
import urllib.request
from collections.abc import Iterable


WORKFLOWS = ("release.yml", "release-tip.yml")


def publication_order(run: dict) -> tuple[str, int, int]:
  return (run["run_started_at"], run["id"], run["run_attempt"])


def active_predecessors(current_run: dict, runs: Iterable[dict]) -> list[dict]:
  current_order = publication_order(current_run)
  return sorted(
    (
      run
      for run in runs
      if run["id"] != current_run["id"]
      and publication_order(run) < current_order
      and run["status"] != "completed"
    ),
    key=publication_order,
  )


def request_json(url: str, token: str) -> dict:
  headers = {
    "Accept": "application/vnd.github+json",
    "Authorization": f"Bearer {token}",
    "X-GitHub-Api-Version": "2022-11-28",
  }
  request = urllib.request.Request(url, headers=headers)
  with urllib.request.urlopen(request) as response:
    return json.load(response)


def workflow_run(repository: str, token: str, run_id: int) -> dict:
  url = f"https://api.github.com/repos/{repository}/actions/runs/{run_id}"
  return request_json(url, token)


def workflow_runs(repository: str, token: str) -> list[dict]:
  runs = []
  for workflow in WORKFLOWS:
    url = f"https://api.github.com/repos/{repository}/actions/workflows/{workflow}/runs?per_page=100"
    runs.extend(request_json(url, token)["workflow_runs"])
  return runs


def main() -> None:
  repository = os.environ["GITHUB_REPOSITORY"]
  token = os.environ["GH_TOKEN"]
  current_run_id = int(os.environ["GITHUB_RUN_ID"])
  poll_seconds = int(os.environ.get("RELEASE_FEED_POLL_SECONDS", "20"))
  current_run = workflow_run(repository, token, current_run_id)
  while predecessors := active_predecessors(
    current_run,
    workflow_runs(repository, token),
  ):
    waiting = ", ".join(f"{run['name']} {run['id']}" for run in predecessors)
    print(f"Waiting for {waiting}", flush=True)
    time.sleep(poll_seconds)


if __name__ == "__main__":
  main()
