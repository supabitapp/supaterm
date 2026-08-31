#!/usr/bin/env python3

from __future__ import annotations

import argparse
import configparser
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO

from pre_push import MAIN_REF, PrePushError, is_zero_object_name, parse_push_updates


REPO_ROOT = Path(__file__).resolve().parents[2]


class ValidationError(Exception):
  pass


@dataclass(frozen=True)
class SubmoduleRule:
  path: Path
  url: str
  branch: str


def submodule_rules(repository: Path, revision: str) -> list[SubmoduleRule]:
  content = git(repository, "show", f"{revision}:.gitmodules")
  parser = configparser.ConfigParser(interpolation=None)
  parser.read_string(content)
  rules = []
  for section in parser.sections():
    branch = parser.get(section, "branch", fallback=None)
    if branch is None:
      continue
    path = parser.get(section, "path", fallback=None)
    url = parser.get(section, "url", fallback=None)
    if path is None or url is None:
      raise ValidationError(f"{section} must define path and url")
    rules.append(SubmoduleRule(path=Path(path), url=url, branch=branch))
  return sorted(rules, key=lambda rule: rule.path.as_posix())


def gitlink_object_name(repository: Path, revision: str, path: Path) -> str:
  entry = git(repository, "ls-tree", "-z", revision, "--", path.as_posix()).rstrip("\0")
  if not entry:
    raise ValidationError(f"{revision} does not contain submodule {path}")
  metadata, listed_path = entry.split("\t", maxsplit=1)
  mode, object_type, object_name = metadata.split()
  if listed_path != path.as_posix() or mode != "160000" or object_type != "commit":
    raise ValidationError(f"{path} is not a submodule in {revision}")
  return object_name


def required_branch_tip(repository: Path, rule: SubmoduleRule) -> str:
  submodule = submodule_path(repository, rule.path)
  result = run(["git", "-C", str(submodule), "rev-parse", "--git-dir"])
  if result.returncode != 0:
    raise ValidationError(
      f"{rule.path} is not initialized; run git submodule update --init --recursive -- {rule.path}"
    )
  branch = "main" if rule.branch == "." else rule.branch
  result = run(
    [
      "git",
      "-c",
      "submodule.recurse=false",
      "-C",
      str(submodule),
      "fetch",
      "--quiet",
      "--no-tags",
      rule.url,
      f"refs/heads/{branch}",
    ]
  )
  if result.returncode != 0:
    detail = result.stderr.strip() or result.stdout.strip()
    raise ValidationError(f"failed to fetch {rule.url} branch {branch}: {detail}")
  return git(submodule, "rev-parse", "FETCH_HEAD")


def validate_revision(repository: Path, revision: str) -> None:
  for rule in submodule_rules(repository, revision):
    pin = gitlink_object_name(repository, revision, rule.path)
    branch_tip = required_branch_tip(repository, rule)
    submodule = submodule_path(repository, rule.path)
    result = run(
      [
        "git",
        "-C",
        str(submodule),
        "merge-base",
        "--is-ancestor",
        pin,
        branch_tip,
      ]
    )
    if result.returncode != 0:
      branch = "main" if rule.branch == "." else rule.branch
      raise ValidationError(
        f"{rule.path} pin {pin} is not reachable from {rule.url} branch {branch}"
      )


def submodule_path(repository: Path, path: Path) -> Path:
  root = repository.resolve()
  submodule = (root / path).resolve()
  try:
    submodule.relative_to(root)
  except ValueError as error:
    raise ValidationError(f"submodule path leaves the repository: {path}") from error
  return submodule


def validate_push(repository: Path, stream: TextIO) -> None:
  revisions = {
    update.local_object_name
    for update in parse_push_updates(stream)
    if update.remote_ref == MAIN_REF and not is_zero_object_name(update.local_object_name)
  }
  for revision in sorted(revisions):
    validate_revision(repository, revision)


def git(repository: Path, *arguments: str) -> str:
  result = run(["git", *arguments], cwd=repository)
  if result.returncode != 0:
    detail = result.stderr.strip() or result.stdout.strip()
    raise ValidationError(f"git {' '.join(arguments)} failed: {detail}")
  return result.stdout.strip()


def run(command: list[str], cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
  return subprocess.run(
    command,
    cwd=cwd,
    text=True,
    capture_output=True,
    check=False,
  )


def main() -> int:
  parser = argparse.ArgumentParser()
  parser.add_argument("--repo", type=Path, default=REPO_ROOT)
  arguments = parser.parse_args()
  try:
    validate_push(arguments.repo.resolve(), sys.stdin)
  except (ValidationError, PrePushError, configparser.Error) as error:
    print(f"error: {error}", file=sys.stderr)
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
