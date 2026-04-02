from io import StringIO
from pathlib import Path
import unittest
from unittest.mock import patch

from bump_and_release import (
  PushUpdate,
  create_annotated_tag_command,
  parse_version_state,
  parse_push_update,
  update_version_state,
  validate_pre_push,
  validate_release_tag,
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

  def test_create_annotated_tag_command_uses_release_notes_file(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v1.4.0", Path("/tmp/release-notes.md")),
      [
        "git",
        "tag",
        "-a",
        "v1.4.0",
        "-F",
        "/tmp/release-notes.md",
      ],
    )

  def test_validate_release_tag_requires_stable_format(self) -> None:
    with self.assertRaisesRegex(ValueError, "release tag must be in vX.Y.Z format"):
      validate_release_tag("v1.4")

  @patch("bump_and_release.run")
  def test_validate_release_tag_requires_annotated_tag(self, run_mock) -> None:
    run_mock.return_value = "commit"

    with self.assertRaisesRegex(ValueError, "v1.4.0 must be an annotated tag"):
      validate_release_tag("v1.4.0")

  @patch("bump_and_release.run")
  def test_validate_release_tag_requires_matching_marketing_version(self, run_mock) -> None:
    run_mock.side_effect = [
      "tag",
      "MARKETING_VERSION = 1.3.0\nCURRENT_PROJECT_VERSION = 27\nSPARKLE_PUBLIC_ED_KEY = key\n",
    ]

    with self.assertRaisesRegex(ValueError, "v1.4.0 does not match MARKETING_VERSION 1.3.0"):
      validate_release_tag("v1.4.0")

  @patch("bump_and_release.run")
  def test_validate_release_tag_accepts_matching_annotated_tag(self, run_mock) -> None:
    run_mock.side_effect = [
      "tag",
      "MARKETING_VERSION = 1.4.0\nCURRENT_PROJECT_VERSION = 27\nSPARKLE_PUBLIC_ED_KEY = key\n",
    ]

    validate_release_tag("v1.4.0")

  def test_parse_push_update_reads_all_fields(self) -> None:
    self.assertEqual(
      parse_push_update("refs/tags/v1.4.0 abc refs/tags/v1.4.0 def\n"),
      PushUpdate("refs/tags/v1.4.0", "abc", "refs/tags/v1.4.0", "def"),
    )

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_ignores_branch_pushes(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("refs/heads/main abc refs/heads/main def\n"))

    validate_release_tag_mock.assert_not_called()

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_ignores_tag_deletions(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("(delete) 0000000000000000000000000000000000000000 refs/tags/v1.4.0 def\n"))

    validate_release_tag_mock.assert_not_called()

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_validates_release_tag_pushes(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("refs/tags/v1.4.0 abc refs/tags/v1.4.0 def\n"))

    validate_release_tag_mock.assert_called_once_with("v1.4.0", "refs/tags/v1.4.0")

  @patch("bump_and_release.validate_release_tag", side_effect=ValueError("release tag must be in vX.Y.Z format"))
  def test_validate_pre_push_rejects_invalid_release_tags(self, _) -> None:
    with self.assertRaisesRegex(ValueError, "v1.4: release tag must be in vX.Y.Z format"):
      validate_pre_push(StringIO("refs/tags/v1.4 abc refs/tags/v1.4 def\n"))


if __name__ == "__main__":
  unittest.main()
