#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
XCCONFIG_PATH = REPO_ROOT / "apps/mac/Configurations/Project.xcconfig"
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")


@dataclass(frozen=True)
class VersionState:
  marketing_version: str
  build_number: int


def parse_version_state(content: str) -> VersionState:
  marketing_match = re.search(r"^MARKETING_VERSION = ([0-9.]+)$", content, re.MULTILINE)
  build_match = re.search(r"^CURRENT_PROJECT_VERSION = ([0-9]+)$", content, re.MULTILINE)
  if marketing_match is None:
    raise ValueError("MARKETING_VERSION not found")
  if build_match is None:
    raise ValueError("CURRENT_PROJECT_VERSION not found")
  return VersionState(
    marketing_version=marketing_match.group(1),
    build_number=int(build_match.group(1)),
  )


def version_tuple(version: str) -> tuple[int, int, int]:
  return tuple(int(part) for part in version.split("."))


def validate_new_version(candidate: str, current: str) -> str | None:
  if not VERSION_PATTERN.fullmatch(candidate):
    return "version must be in x.y.z format"
  if version_tuple(candidate) <= version_tuple(current):
    return f"version must be greater than {current}"
  return None


def update_version_state(content: str, version: str, build: int) -> str:
  content = re.sub(
    r"^MARKETING_VERSION = [0-9.]+$",
    f"MARKETING_VERSION = {version}",
    content,
    count=1,
    flags=re.MULTILINE,
  )
  content = re.sub(
    r"^CURRENT_PROJECT_VERSION = [0-9]+$",
    f"CURRENT_PROJECT_VERSION = {build}",
    content,
    count=1,
    flags=re.MULTILINE,
  )
  return content


def read_version_state(path: Path = XCCONFIG_PATH) -> VersionState:
  return parse_version_state(path.read_text(encoding="utf-8"))


def prompt_for_version(current: str) -> str:
  while True:
    candidate = input("New version (x.y.z): ").strip()
    error = validate_new_version(candidate, current)
    if error is None:
      return candidate
    print(f"error: {error}")


def run(command: list[str], cwd: Path = REPO_ROOT) -> str:
  result = subprocess.run(
    command,
    cwd=cwd,
    check=True,
    capture_output=True,
    text=True,
  )
  return result.stdout.strip()


def run_interactive(command: list[str], cwd: Path = REPO_ROOT) -> None:
  subprocess.run(command, cwd=cwd, check=True)


def bump_version() -> tuple[str, int]:
  current_state = read_version_state()
  print(f"Current version: {current_state.marketing_version} ({current_state.build_number})")
  new_version = prompt_for_version(current_state.marketing_version)
  new_build = current_state.build_number + 1
  updated = update_version_state(
    XCCONFIG_PATH.read_text(encoding="utf-8"),
    version=new_version,
    build=new_build,
  )
  XCCONFIG_PATH.write_text(updated, encoding="utf-8")
  run_interactive(["git", "add", str(XCCONFIG_PATH.relative_to(REPO_ROOT))])
  run_interactive(["git", "commit", "-m", f"bump v{new_version}"])
  run_interactive(["git", "tag", "-a", f"v{new_version}", "-m", f"v{new_version}"])
  print(f"Bumped version to {new_version} ({new_build})")
  return new_version, new_build


def current_repository() -> str:
  return run(["gh", "repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"])


def previous_release_tag() -> str:
  try:
    return run(
      [
        "gh",
        "release",
        "list",
        "--exclude-drafts",
        "--exclude-pre-releases",
        "--limit",
        "1",
        "--json",
        "tagName",
        "--jq",
        ".[0].tagName",
      ]
    )
  except subprocess.CalledProcessError:
    return ""


def generate_release_notes(tag: str, notes_path: Path) -> None:
  repo = current_repository()
  previous_tag = previous_release_tag()
  command = [
    "gh",
    "api",
    f"repos/{repo}/releases/generate-notes",
    "-f",
    f"tag_name={tag}",
  ]
  if previous_tag:
    command.extend(["-f", f"previous_tag_name={previous_tag}"])
  notes = run(command + ["--jq", ".body"])
  notes_path.write_text(notes, encoding="utf-8")


def edit_release_notes(notes_path: Path) -> None:
  editor = os.environ.get("EDITOR", "vim")
  run_interactive([*shlex.split(editor), str(notes_path)])


def create_release(tag: str, notes_path: Path) -> None:
  run_interactive(["gh", "release", "create", tag, "--notes-file", str(notes_path)])


def bump_and_release() -> None:
  version, _ = bump_version()
  tag = f"v{version}"
  run_interactive(["git", "push", "--follow-tags"])
  with tempfile.NamedTemporaryFile(
    mode="w+",
    encoding="utf-8",
    prefix=f"{tag}-",
    suffix="-release-notes.md",
    delete=False,
  ) as handle:
    notes_path = Path(handle.name)
  try:
    generate_release_notes(tag, notes_path)
    edit_release_notes(notes_path)
    create_release(tag, notes_path)
  finally:
    notes_path.unlink(missing_ok=True)


def main() -> int:
  os.chdir(REPO_ROOT)
  parser = argparse.ArgumentParser()
  parser.parse_args()
  bump_and_release()
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
