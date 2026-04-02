from pathlib import Path
import unittest

from bump_and_release import (
  create_release_command,
  dispatch_release_workflow_command,
  parse_version_state,
  update_version_state,
  validate_new_version,
  version_tuple,
)


class BumpAndReleaseTest(unittest.TestCase):
  def test_parse_version_state(self) -> None:
    state = parse_version_state(
      "MARKETING_VERSION = 1.2.3\nCURRENT_PROJECT_VERSION = 45\nSPARKLE_PUBLIC_ED_KEY = key\n"
    )

    self.assertEqual(state.marketing_version, "1.2.3")
    self.assertEqual(state.build_number, 45)

  def test_validate_new_version_requires_semver(self) -> None:
    self.assertEqual(validate_new_version("1.2", "1.1.0"), "version must be in x.y.z format")

  def test_validate_new_version_requires_greater_version(self) -> None:
    self.assertEqual(validate_new_version("1.2.3", "1.2.3"), "version must be greater than 1.2.3")
    self.assertEqual(validate_new_version("1.2.2", "1.2.3"), "version must be greater than 1.2.3")

  def test_validate_new_version_accepts_greater_version(self) -> None:
    self.assertIsNone(validate_new_version("1.2.4", "1.2.3"))

  def test_update_version_state_rewrites_version_lines(self) -> None:
    content = "MARKETING_VERSION = 0.0.1\nCURRENT_PROJECT_VERSION = 1\nSPARKLE_PUBLIC_ED_KEY = key\n"

    updated = update_version_state(content, version="1.4.0", build=27)

    self.assertEqual(
      updated,
      "MARKETING_VERSION = 1.4.0\nCURRENT_PROJECT_VERSION = 27\nSPARKLE_PUBLIC_ED_KEY = key\n",
    )

  def test_version_tuple_sorts_semantic_parts_numerically(self) -> None:
    self.assertGreater(version_tuple("1.10.0"), version_tuple("1.2.9"))

  def test_create_release_command_creates_verified_draft_release(self) -> None:
    self.assertEqual(
      create_release_command("v1.4.0", Path("/tmp/release-notes.md")),
      [
        "gh",
        "release",
        "create",
        "v1.4.0",
        "--draft",
        "--verify-tag",
        "--notes-file",
        "/tmp/release-notes.md",
      ],
    )

  def test_dispatch_release_workflow_command_runs_on_the_tag(self) -> None:
    self.assertEqual(
      dispatch_release_workflow_command("v1.4.0"),
      ["gh", "workflow", "run", "release.yml", "--ref", "v1.4.0", "-f", "tag=v1.4.0"],
    )


if __name__ == "__main__":
  unittest.main()
