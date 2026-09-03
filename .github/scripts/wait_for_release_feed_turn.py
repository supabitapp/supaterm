#!/usr/bin/env python3

from __future__ import annotations

import json
import os
import time
import urllib.request
from collections.abc import Callable, Iterable


WORKFLOWS = ("release.yml", "release-tip.yml")
PAGE_SIZE = 100


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
    page = 1
    while True:
      url = (
        f"https://api.github.com/repos/{repository}/actions/workflows/{workflow}/runs"
        f"?per_page={PAGE_SIZE}&page={page}"
      )
      page_runs = request_json(url, token)["workflow_runs"]
      runs.extend(page_runs)
      if len(page_runs) < PAGE_SIZE:
        break
      page += 1
  return runs


def wait_for_turn(
  current_run: dict,
  load_runs: Callable[[], list[dict]],
  poll_seconds: int,
  sleep: Callable[[float], None],
) -> None:
  while predecessors := active_predecessors(current_run, load_runs()):
    waiting = ", ".join(f"{run['name']} {run['id']}" for run in predecessors)
    print(f"Waiting for {waiting}", flush=True)
    sleep(poll_seconds)


def main() -> None:
  repository = os.environ["GITHUB_REPOSITORY"]
  token = os.environ["GH_TOKEN"]
  current_run_id = int(os.environ["GITHUB_RUN_ID"])
  poll_seconds = int(os.environ.get("RELEASE_FEED_POLL_SECONDS", "20"))
  current_run = workflow_run(repository, token, current_run_id)
  wait_for_turn(
    current_run,
    lambda: workflow_runs(repository, token),
    poll_seconds,
    time.sleep,
  )


if __name__ == "__main__":
  main()
