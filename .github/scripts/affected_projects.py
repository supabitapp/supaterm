#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from pre_push import MAIN_REF, PrePushError, is_zero_object_name, parse_push_updates


REPO_ROOT = Path(__file__).resolve().parents[2]
MARKDOWN_SUFFIXES = (".md", ".mdx")
SKILL_DATA_DIRECTORY = "integrations/supaterm/skill-data"
SKILL_STUB_DIRECTORY = "integrations/supaterm/skills/supaterm"


class AffectedProjectsError(Exception):
  pass


@dataclass(frozen=True)
class PathSet:
  files: frozenset[str] = frozenset()
  directories: tuple[str, ...] = ()

  def contains(self, path: str) -> bool:
    return path in self.files or any(
      path == directory or path.startswith(f"{directory}/") for directory in self.directories
    )

  def patterns(self) -> set[str]:
    return set(self.files) | {f"{directory}/**" for directory in self.directories}


GLOBAL_PATHS = PathSet(files=frozenset({"Makefile", "mise.toml"}))
BUNDLED_SKILL_PATHS = PathSet(
  directories=(SKILL_DATA_DIRECTORY, SKILL_STUB_DIRECTORY)
)
SHARED_APPLE_PATHS = PathSet(
  files=frozenset(
    {
      ".github/workflows/ci.yml",
      "apps/.swift-format.json",
      "apps/.swiftlint.yml",
      "apps/Tuist.mk",
      "apps/Tuist.swift",
      "apps/Workspace.swift",
    }
  ),
  directories=(
    ".github/actions/setup-macos",
    ".github/actions/setup-mise",
    "apps/Configurations",
    "apps/shared",
    "apps/Tuist",
  ),
)
DOCS_SNAPSHOT_DIRECTORY = (
  "apps/mac/supatermSnapshotTests/__Snapshots__/SupatermSnapshotTests"
)
DOCS_SNAPSHOT_PATHS = frozenset(
  f"{DOCS_SNAPSHOT_DIRECTORY}/{name}"
  for name in (
    "catalogScenarios.agent-panel-branch-pr-checks-dark.png",
    "catalogScenarios.settings-coding-agents-enabled-dark.png",
    "catalogScenarios.sidebar-full-dark.png",
  )
)
DOCS_PATHS = PathSet(
  files=frozenset(
    {
      ".github/workflows/deploy-docs.yml",
      "apps/supaterm.com/public/logo-mark.svg",
      "apps/supaterm.com/public/logo.svg",
    }
  )
  | DOCS_SNAPSHOT_PATHS,
  directories=("apps/docs.supaterm.com", SKILL_DATA_DIRECTORY),
)
IOS_PATHS = PathSet(directories=("apps/ios",))
MAC_PATHS = PathSet(
  files=frozenset({".gitmodules"}),
  directories=("apps/mac",),
)
WEB_PATHS = PathSet(
  files=frozenset({".github/workflows/deploy-web.yml"}),
  directories=("apps/supaterm.com",),
)
PROJECT_PATHS = {
  "docs": (GLOBAL_PATHS, DOCS_PATHS),
  "ios": (GLOBAL_PATHS, SHARED_APPLE_PATHS, IOS_PATHS),
  "mac": (GLOBAL_PATHS, SHARED_APPLE_PATHS, MAC_PATHS, BUNDLED_SKILL_PATHS),
  "web": (GLOBAL_PATHS, WEB_PATHS),
}
PROJECTS = tuple(PROJECT_PATHS)


def project_patterns(project: str) -> set[str]:
  patterns = set()
  for path_set in PROJECT_PATHS[project]:
    patterns.update(path_set.patterns())
  return patterns


def affected_projects(paths: set[str]) -> set[str]:
  affected = set()
  for path in paths:
    for project, path_sets in PROJECT_PATHS.items():
      if (
        project != "docs"
        and path.endswith(MARKDOWN_SUFFIXES)
        and not BUNDLED_SKILL_PATHS.contains(path)
      ):
        continue
      if any(path_set.contains(path) for path_set in path_sets):
        affected.add(project)
  return affected


def diff_paths(repository: Path, *revisions: str) -> set[str]:
  output = git(repository, "diff", "--no-renames", "--name-only", "-z", *revisions, "--")
  return {os.fsdecode(path) for path in output.split(b"\0") if path}


def empty_tree(repository: Path) -> str:
  return os.fsdecode(git(repository, "mktree", input=b"")).strip()


def git_environment() -> dict[str, str]:
  return {name: value for name, value in os.environ.items() if not name.startswith("GIT_")}


def git(repository: Path, *arguments: str, input: bytes | None = None) -> bytes:
  result = subprocess.run(
    ["git", *arguments],
    cwd=repository,
    env=git_environment(),
    input=input,
    capture_output=True,
    check=False,
  )
  if result.returncode != 0:
    detail = os.fsdecode(result.stderr).strip() or os.fsdecode(result.stdout).strip()
    raise AffectedProjectsError(f"git {arguments[0]} failed: {detail}")
  return result.stdout


def pushed_paths(repository: Path, stream: TextIO) -> set[str]:
  paths = set()
  for update in parse_push_updates(stream):
    if update.remote_ref != MAIN_REF or is_zero_object_name(update.local_object_name):
      continue
    base = (
      empty_tree(repository)
      if is_zero_object_name(update.remote_object_name)
      else update.remote_object_name
    )
    paths.update(diff_paths(repository, base, update.local_object_name))
  return paths


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument("project", nargs="?", choices=PROJECTS)
  parser.add_argument("--base")
  parser.add_argument("--head")
  parser.add_argument("--repo", type=Path, default=REPO_ROOT)
  arguments = parser.parse_args()
  if (arguments.base is None) != (arguments.head is None):
    parser.error("--base and --head must be used together")
  try:
    paths = (
      diff_paths(arguments.repo, f"{arguments.base}...{arguments.head}")
      if arguments.base is not None
      else pushed_paths(arguments.repo, sys.stdin)
    )
  except (AffectedProjectsError, PrePushError) as error:
    print(f"error: {error}", file=sys.stderr)
    return 1
  affected = affected_projects(paths)
  if arguments.project is not None:
    print("run" if arguments.project in affected else "skip")
    return 0
  for project in PROJECTS:
    print(f"{project}={'true' if project in affected else 'false'}")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
