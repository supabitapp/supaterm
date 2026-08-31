from __future__ import annotations

import io
import subprocess
import tempfile
import unittest
from pathlib import Path

from affected_projects import (
  REPO_ROOT,
  affected_projects,
  diff_paths,
  git_environment,
  project_patterns,
  pushed_paths,
)
from pre_push import PrePushError, is_zero_object_name, parse_push_updates


def workflow_path_groups(path: Path) -> list[set[str]]:
  lines = path.read_text().splitlines()
  groups = []
  for index, line in enumerate(lines):
    if line != "    paths:":
      continue
    group = set()
    for entry in lines[index + 1 :]:
      if not entry.startswith("      - "):
        break
      group.add(entry.removeprefix("      - ").strip('"'))
    groups.append(group)
  return groups


class PrePushTests(unittest.TestCase):
  def test_parses_updates(self) -> None:
    updates = parse_push_updates(
      io.StringIO("\nrefs/heads/main 123  refs/heads/main 456\n")
    )
    self.assertEqual(len(updates), 1)
    self.assertEqual(updates[0].local_object_name, "123")
    self.assertEqual(updates[0].remote_object_name, "456")

  def test_rejects_invalid_input(self) -> None:
    with self.assertRaises(PrePushError):
      parse_push_updates(io.StringIO("refs/heads/main 123\n"))

  def test_identifies_zero_object_names(self) -> None:
    self.assertTrue(is_zero_object_name("0" * 40))
    self.assertFalse(is_zero_object_name("1" + "0" * 39))


class AffectedProjectsTests(unittest.TestCase):
  def test_project_paths(self) -> None:
    cases = {
      "README.md": set(),
      "apps/mac/README.md": set(),
      "apps/docs.supaterm.com/content/guide.md": {"docs"},
      "apps/supaterm.com/src/app.ts": {"web"},
      "apps/mac/supaterm/App.swift": {"mac"},
      "apps/ios/SupatermApp.swift": {"ios"},
      "apps/shared/Theme.swift": {"ios", "mac"},
      "Makefile": {"docs", "ios", "mac", "web"},
      "integrations/supaterm-skills": {"docs", "mac"},
      "apps/supaterm.com/public/logo-mark.svg": {"docs", "web"},
      "apps/supaterm.com/public/logo.svg": {"docs", "web"},
      "apps/mac/supatermSnapshotTests/__Snapshots__/SupatermSnapshotTests/catalogScenarios.sidebar-full-dark.png": {
        "docs",
        "mac",
      },
    }
    for path, expected in cases.items():
      with self.subTest(path=path):
        self.assertEqual(affected_projects({path}), expected)

  def test_deploy_workflow_paths_match_project_paths(self) -> None:
    for project in ("docs", "web"):
      groups = workflow_path_groups(REPO_ROOT / f".github/workflows/deploy-{project}.yml")
      self.assertEqual(len(groups), 2)
      for paths in groups:
        self.assertEqual(paths, project_patterns(project))


class GitChangesTests(unittest.TestCase):
  def setUp(self) -> None:
    self.temporary_directory = tempfile.TemporaryDirectory()
    self.repository = Path(self.temporary_directory.name)
    self.git("init", "--quiet")
    self.git("config", "user.email", "test@example.com")
    self.git("config", "user.name", "Test")
    source = self.repository / "apps/mac/source.swift"
    source.parent.mkdir(parents=True)
    source.write_text("let value = 1\n")
    self.git("add", source.relative_to(self.repository).as_posix())
    self.git("commit", "--quiet", "-m", "initial")
    self.initial_revision = self.git("rev-parse", "HEAD")

  def tearDown(self) -> None:
    self.temporary_directory.cleanup()

  def git(self, *arguments: str) -> str:
    result = subprocess.run(
      ["git", *arguments],
      cwd=self.repository,
      env=git_environment(),
      text=True,
      capture_output=True,
      check=True,
    )
    return result.stdout.strip()

  def test_deleted_path_is_affected(self) -> None:
    (self.repository / "apps/mac/source.swift").unlink()
    self.git("add", "--all")
    self.git("commit", "--quiet", "-m", "delete source")
    revision = self.git("rev-parse", "HEAD")
    self.assertEqual(
      diff_paths(self.repository, self.initial_revision, revision),
      {"apps/mac/source.swift"},
    )

  def test_gitlink_is_affected(self) -> None:
    self.git(
      "update-index",
      "--add",
      "--cacheinfo",
      f"160000,{self.initial_revision},integrations/supaterm-skills",
    )
    self.git("commit", "--quiet", "-m", "add integration")
    revision = self.git("rev-parse", "HEAD")
    self.assertEqual(
      affected_projects(diff_paths(self.repository, self.initial_revision, revision)),
      {"docs", "mac"},
    )

  def test_only_remote_main_is_affected(self) -> None:
    source = self.repository / "apps/mac/source.swift"
    source.write_text("let value = 2\n")
    self.git("add", source.relative_to(self.repository).as_posix())
    self.git("commit", "--quiet", "-m", "change source")
    revision = self.git("rev-parse", "HEAD")
    updates = io.StringIO(
      f"refs/heads/main {revision} refs/heads/main {self.initial_revision}\n"
      f"refs/heads/topic {revision} refs/heads/topic {self.initial_revision}\n"
    )
    self.assertEqual(
      affected_projects(pushed_paths(self.repository, updates)),
      {"mac"},
    )

  def test_new_main_compares_the_full_tree(self) -> None:
    updates = io.StringIO(
      f"refs/heads/main {self.initial_revision} refs/heads/main {'0' * 40}\n"
    )
    self.assertEqual(
      affected_projects(pushed_paths(self.repository, updates)),
      {"mac"},
    )

  def test_non_main_push_is_ignored(self) -> None:
    updates = io.StringIO(
      f"refs/heads/topic {self.initial_revision} refs/heads/topic {'0' * 40}\n"
    )
    self.assertEqual(pushed_paths(self.repository, updates), set())


if __name__ == "__main__":
  unittest.main()
