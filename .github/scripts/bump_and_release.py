#!/usr/bin/env python3

from __future__ import annotations

import argparse
import os
import re
import shlex
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import TextIO


REPO_ROOT = Path(__file__).resolve().parents[2]
XCCONFIG_PATH = REPO_ROOT / "apps/mac/Configurations/Project.xcconfig"
VERSION_STATE_PATH = XCCONFIG_PATH.relative_to(REPO_ROOT).as_posix()
VERSION_PATTERN = re.compile(r"^\d+\.\d+\.\d+$")
RELEASE_TAG_PATTERN = re.compile(r"^v(\d+\.\d+\.\d+)$")
ZERO_OID_PATTERN = re.compile(r"^0+$")
MAX_NON_LFS_BLOB_BYTES = 2 * 1024 * 1024


@dataclass(frozen=True)
class VersionState:
  marketing_version: str
  build_number: int


@dataclass(frozen=True)
class PushUpdate:
  local_ref: str
  local_object_name: str
  remote_ref: str
  remote_object_name: str


@dataclass(frozen=True)
class PendingRelease:
  tag: str
  release_state: str
  commit: str


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


def read_version_state_at_revision(revision: str) -> VersionState:
  return parse_version_state(run(["git", "show", f"{revision}:{VERSION_STATE_PATH}"]))


def prompt_for_version(current: str) -> str:
  while True:
    candidate = input("New version (x.y.z): ").strip()
    error = validate_new_version(candidate, current)
    if error is None:
      return candidate
    print(f"error: {error}")


def prompt_for_confirmation(prompt: str) -> bool:
  while True:
    response = input(prompt).strip().lower()
    if response in {"y", "yes"}:
      return True
    if response in {"", "n", "no"}:
      return False
    print("error: please answer yes or no")


def run(command: list[str], cwd: Path = REPO_ROOT) -> str:
  result = subprocess.run(
    command,
    cwd=cwd,
    check=True,
    capture_output=True,
    text=True,
  )
  return result.stdout.strip()


def run_input(command: list[str], stdin: str, cwd: Path = REPO_ROOT) -> str:
  result = subprocess.run(
    command,
    cwd=cwd,
    check=True,
    capture_output=True,
    text=True,
    input=stdin,
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


def current_commit() -> str:
  return run(["git", "rev-parse", "HEAD"])


def generate_release_notes(tag: str, notes_path: Path, target_commitish: str) -> None:
  repo = current_repository()
  previous_tag = previous_release_tag()
  command = [
    "gh",
    "api",
    f"repos/{repo}/releases/generate-notes",
    "-f",
    f"tag_name={tag}",
    "-f",
    f"target_commitish={target_commitish}",
  ]
  if previous_tag:
    command.extend(["-f", f"previous_tag_name={previous_tag}"])
  notes = run(command + ["--jq", ".body"])
  notes_path.write_text(notes, encoding="utf-8")


def edit_release_notes(notes_path: Path) -> None:
  editor = os.environ.get("EDITOR", "vim")
  run_interactive([*shlex.split(editor), str(notes_path)])


def current_branch_remote() -> str:
  branch = run(["git", "branch", "--show-current"])
  return run(["git", "config", f"branch.{branch}.remote"])


def release_state(tag: str) -> str:
  try:
    is_draft = run(["gh", "release", "view", tag, "--json", "isDraft", "--jq", ".isDraft"])
  except subprocess.CalledProcessError as error:
    stderr = error.stderr.lower()
    if "release not found" in stderr or "not_found" in stderr or "http 404" in stderr:
      return "missing"
    raise
  if is_draft == "true":
    return "draft"
  return "published"


def release_commit(tag: str) -> str:
  return run(["git", "log", "-1", "--format=%H", "--grep", f"^bump {re.escape(tag)}$"])


def pending_release() -> PendingRelease | None:
  current_state = read_version_state()
  latest_published_tag = previous_release_tag()
  if latest_published_tag and version_tuple(current_state.marketing_version) <= version_tuple(
    release_tag_version(latest_published_tag)
  ):
    return None
  tag = f"v{current_state.marketing_version}"
  try:
    commit = release_commit(tag)
  except subprocess.CalledProcessError:
    return None
  state = release_state(tag)
  if state == "published":
    return None
  return PendingRelease(tag=tag, release_state=state, commit=commit)


def sync_draft_release_notes(tag: str, notes_path: Path) -> None:
  run_interactive(["gh", "release", "edit", tag, "--notes-file", str(notes_path)])


def create_annotated_tag_command(
  tag: str,
  notes_path: Path,
  force: bool = False,
  commit: str | None = None,
) -> list[str]:
  command = ["git", "tag"]
  command.append("-fa" if force else "-a")
  command.extend([tag, "-F", str(notes_path)])
  if commit is not None:
    command.append(commit)
  return command


def create_annotated_tag(
  tag: str,
  notes_path: Path,
  force: bool = False,
  commit: str | None = None,
) -> None:
  run_interactive(create_annotated_tag_command(tag, notes_path, force=force, commit=commit))


def push_current_branch() -> None:
  run_interactive(["git", "push"])


def push_release_tag(tag: str, force: bool = False) -> None:
  command = ["git", "push"]
  if force:
    command.append("--force")
  command.extend([current_branch_remote(), tag])
  run_interactive(command)


def release_tag_version(tag: str) -> str:
  match = RELEASE_TAG_PATTERN.fullmatch(tag)
  if match is None:
    raise ValueError("release tag must be in vX.Y.Z format")
  return match.group(1)


def is_zero_object_name(object_name: str) -> bool:
  return ZERO_OID_PATTERN.fullmatch(object_name) is not None


def read_object_type(reference: str) -> str:
  try:
    return run(["git", "cat-file", "-t", reference])
  except subprocess.CalledProcessError as error:
    raise ValueError(f"{reference} could not be resolved locally") from error


def read_object_metadata(object_names: list[str]) -> dict[str, tuple[str, int]]:
  if not object_names:
    return {}
  output = run_input(
    ["git", "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    "\n".join(object_names),
  )
  metadata: dict[str, tuple[str, int]] = {}
  for line in output.splitlines():
    object_name, object_type, object_size = line.split(" ", 2)
    metadata[object_name] = (object_type, int(object_size))
  return metadata


def staged_blob_paths() -> dict[str, str]:
  output = run(["git", "diff", "--cached", "--raw", "-z", "--diff-filter=AM", "--no-abbrev"])
  if not output:
    return {}
  entries = output.split("\0")
  object_paths: dict[str, str] = {}
  for index in range(0, len(entries) - 1, 2):
    metadata, path = entries[index], entries[index + 1]
    if not metadata or not path:
      continue
    fields = metadata.split()
    if len(fields) < 5:
      continue
    object_paths[fields[3]] = path
  return object_paths


def oversized_staged_blobs() -> list[str]:
  object_paths = staged_blob_paths()
  metadata = read_object_metadata(list(object_paths))
  violations: list[str] = []
  for object_name, path in sorted(object_paths.items(), key=lambda item: item[1]):
    object_type, object_size = metadata[object_name]
    if object_type == "blob" and object_size > MAX_NON_LFS_BLOB_BYTES:
      violations.append(f"{path} ({object_size} bytes)")
  return violations


def validate_release_tag(tag: str, reference: str | None = None) -> None:
  expected_version = release_tag_version(tag)
  resolved_reference = reference or f"refs/tags/{tag}"
  if read_object_type(resolved_reference) != "tag":
    raise ValueError(f"{tag} must be an annotated tag")
  try:
    actual_version = read_version_state_at_revision(f"{resolved_reference}^{{commit}}").marketing_version
  except subprocess.CalledProcessError as error:
    raise ValueError(f"{tag} could not resolve a tagged commit") from error
  if actual_version != expected_version:
    raise ValueError(f"{tag} does not match MARKETING_VERSION {actual_version}")


def parse_push_update(line: str) -> PushUpdate:
  parts = line.rstrip("\n").split(" ")
  if len(parts) != 4:
    raise ValueError("invalid pre-push input")
  return PushUpdate(*parts)


def pushed_tag(update: PushUpdate) -> tuple[str, str] | None:
  if update.local_ref == "(delete)" or is_zero_object_name(update.local_object_name):
    return None
  if update.local_ref.startswith("refs/tags/"):
    return update.local_ref.removeprefix("refs/tags/"), update.local_ref
  if update.remote_ref.startswith("refs/tags/"):
    tag = update.remote_ref.removeprefix("refs/tags/")
    return tag, f"refs/tags/{tag}"
  return None


def validate_pre_push(stdin: TextIO) -> None:
  errors: list[str] = []
  for line in stdin:
    if not line.strip():
      continue
    update = parse_push_update(line)
    release_tag = pushed_tag(update)
    if release_tag is None:
      continue
    tag, reference = release_tag
    if not tag.startswith("v"):
      continue
    try:
      validate_release_tag(tag, reference)
    except ValueError as error:
      errors.append(f"{tag}: {error}")
  if errors:
    raise ValueError("\n".join(errors))


def validate_pre_commit() -> None:
  violations = oversized_staged_blobs()
  if violations:
    raise ValueError(
      "files larger than 2097152 bytes must be stored in Git LFS:\n" + "\n".join(violations)
    )


def publish_release_tag(tag: str, notes_path: Path, force: bool = False) -> None:
  create_annotated_tag(tag, notes_path, force=force)
  push_release_tag(tag, force=force)


def recover_pending_release(release: PendingRelease) -> None:
  print(f"Detected unreleased bump commit for {release.tag}.")
  if not prompt_for_confirmation(f"Re-tag and force-push {release.tag}? [y/N]: "):
    print("Aborted")
    return
  with tempfile.NamedTemporaryFile(
    mode="w+",
    encoding="utf-8",
    prefix=f"{release.tag}-",
    suffix="-release-notes.md",
    delete=False,
  ) as handle:
    notes_path = Path(handle.name)
  try:
    push_current_branch()
    generate_release_notes(release.tag, notes_path, release.commit)
    edit_release_notes(notes_path)
    create_annotated_tag(release.tag, notes_path, force=True, commit=release.commit)
    push_release_tag(release.tag, force=True)
    if release.release_state == "draft":
      sync_draft_release_notes(release.tag, notes_path)
  finally:
    notes_path.unlink(missing_ok=True)


def bump_and_release() -> None:
  release = pending_release()
  if release is not None:
    recover_pending_release(release)
    return
  version, _ = bump_version()
  tag = f"v{version}"
  with tempfile.NamedTemporaryFile(
    mode="w+",
    encoding="utf-8",
    prefix=f"{tag}-",
    suffix="-release-notes.md",
    delete=False,
  ) as handle:
    notes_path = Path(handle.name)
  try:
    push_current_branch()
    generate_release_notes(tag, notes_path, current_commit())
    edit_release_notes(notes_path)
    publish_release_tag(tag, notes_path)
  finally:
    notes_path.unlink(missing_ok=True)


def main() -> int:
  os.chdir(REPO_ROOT)
  parser = argparse.ArgumentParser()
  subparsers = parser.add_subparsers(dest="command")
  validate_release_tag_parser = subparsers.add_parser("validate-release-tag")
  validate_release_tag_parser.add_argument("tag")
  validate_release_tag_parser.add_argument("--ref")
  subparsers.add_parser("validate-pre-commit")
  subparsers.add_parser("validate-pre-push")
  args = parser.parse_args()
  try:
    if args.command == "validate-release-tag":
      validate_release_tag(args.tag, args.ref)
    elif args.command == "validate-pre-commit":
      validate_pre_commit()
    elif args.command == "validate-pre-push":
      validate_pre_push(sys.stdin)
    else:
      bump_and_release()
  except ValueError as error:
    print(f"error: {error}", file=sys.stderr)
    return 1
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
