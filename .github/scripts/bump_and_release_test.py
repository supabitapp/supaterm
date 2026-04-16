from io import StringIO
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

from bump_and_release import (
  MAX_NON_LFS_BLOB_BYTES,
  PendingRelease,
  PushUpdate,
  bump_and_release,
  create_annotated_tag_command,
  oversized_staged_blobs,
  pending_release,
  parse_version_state,
  parse_push_update,
  release_state,
  recover_pending_release,
  staged_blob_paths,
  validate_pre_commit,
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

  def test_create_annotated_tag_command_force_updates_existing_tag(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v1.4.0", Path("/tmp/release-notes.md"), force=True),
      [
        "git",
        "tag",
        "-fa",
        "v1.4.0",
        "-F",
        "/tmp/release-notes.md",
      ],
    )

  def test_create_annotated_tag_command_can_target_specific_commit(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v1.4.0", Path("/tmp/release-notes.md"), force=True, commit="abc123"),
      [
        "git",
        "tag",
        "-fa",
        "v1.4.0",
        "-F",
        "/tmp/release-notes.md",
        "abc123",
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

  @patch("bump_and_release.run")
  def test_release_state_returns_missing_for_absent_release(self, run_mock) -> None:
    run_mock.side_effect = subprocess.CalledProcessError(
      1,
      ["gh", "release", "view", "v1.4.0"],
      stderr="release not found",
    )

    self.assertEqual(release_state("v1.4.0"), "missing")

  @patch("bump_and_release.run")
  def test_release_state_returns_draft_for_draft_release(self, run_mock) -> None:
    run_mock.return_value = "true"

    self.assertEqual(release_state("v1.4.0"), "draft")

  @patch("bump_and_release.release_commit")
  @patch("bump_and_release.release_state")
  @patch("bump_and_release.previous_release_tag")
  @patch("bump_and_release.read_version_state")
  def test_pending_release_detects_unreleased_bump_commit(
    self,
    read_version_state_mock,
    previous_release_tag_mock,
    release_state_mock,
    release_commit_mock,
  ) -> None:
    read_version_state_mock.return_value = parse_version_state(
      "MARKETING_VERSION = 1.4.0\nCURRENT_PROJECT_VERSION = 27\n"
    )
    previous_release_tag_mock.return_value = "v1.3.9"
    release_state_mock.return_value = "missing"
    release_commit_mock.return_value = "abc123"

    self.assertEqual(
      pending_release(),
      PendingRelease(tag="v1.4.0", release_state="missing", commit="abc123"),
    )

  @patch("bump_and_release.release_commit")
  @patch("bump_and_release.release_state")
  @patch("bump_and_release.previous_release_tag")
  @patch("bump_and_release.read_version_state")
  def test_pending_release_ignores_published_release(
    self,
    read_version_state_mock,
    previous_release_tag_mock,
    release_state_mock,
    release_commit_mock,
  ) -> None:
    read_version_state_mock.return_value = parse_version_state(
      "MARKETING_VERSION = 1.4.0\nCURRENT_PROJECT_VERSION = 27\n"
    )
    previous_release_tag_mock.return_value = "v1.3.9"
    release_state_mock.return_value = "published"
    release_commit_mock.return_value = "abc123"

    self.assertIsNone(pending_release())

  @patch("bump_and_release.publish_release_tag")
  @patch("bump_and_release.edit_release_notes")
  @patch("bump_and_release.generate_release_notes")
  @patch("bump_and_release.push_current_branch")
  @patch("bump_and_release.current_commit")
  @patch("bump_and_release.bump_version")
  @patch("bump_and_release.pending_release")
  def test_bump_and_release_pushes_branch_before_generating_notes(
    self,
    pending_release_mock,
    bump_version_mock,
    current_commit_mock,
    push_current_branch_mock,
    generate_release_notes_mock,
    edit_release_notes_mock,
    publish_release_tag_mock,
  ) -> None:
    events: list[str] = []
    pending_release_mock.return_value = None
    bump_version_mock.return_value = ("1.4.0", 27)
    current_commit_mock.return_value = "abc123"
    push_current_branch_mock.side_effect = lambda: events.append("push")
    generate_release_notes_mock.side_effect = lambda *_: events.append("generate")
    edit_release_notes_mock.side_effect = lambda *_: events.append("edit")
    publish_release_tag_mock.side_effect = lambda *_: events.append("publish")

    bump_and_release()

    self.assertEqual(events, ["push", "generate", "edit", "publish"])

  @patch("bump_and_release.sync_draft_release_notes")
  @patch("bump_and_release.push_release_tag")
  @patch("bump_and_release.create_annotated_tag")
  @patch("bump_and_release.edit_release_notes")
  @patch("bump_and_release.generate_release_notes")
  @patch("bump_and_release.push_current_branch")
  @patch("bump_and_release.prompt_for_confirmation")
  def test_recover_pending_release_pushes_branch_before_generating_notes(
    self,
    prompt_for_confirmation_mock,
    push_current_branch_mock,
    generate_release_notes_mock,
    edit_release_notes_mock,
    create_annotated_tag_mock,
    push_release_tag_mock,
    sync_draft_release_notes_mock,
  ) -> None:
    events: list[str] = []
    prompt_for_confirmation_mock.return_value = True
    push_current_branch_mock.side_effect = lambda: events.append("push")
    generate_release_notes_mock.side_effect = lambda *_: events.append("generate")
    edit_release_notes_mock.side_effect = lambda *_: events.append("edit")
    create_annotated_tag_mock.side_effect = lambda *_args, **_kwargs: events.append("tag")
    push_release_tag_mock.side_effect = lambda *_args, **_kwargs: events.append("push-tag")
    sync_draft_release_notes_mock.side_effect = lambda *_: events.append("sync")

    recover_pending_release(PendingRelease(tag="v1.4.0", release_state="missing", commit="abc123"))

    self.assertEqual(events, ["push", "generate", "edit", "tag", "push-tag"])

  def test_parse_push_update_reads_all_fields(self) -> None:
    self.assertEqual(
      parse_push_update("refs/tags/v1.4.0 abc refs/tags/v1.4.0 def\n"),
      PushUpdate("refs/tags/v1.4.0", "abc", "refs/tags/v1.4.0", "def"),
    )

  @patch("bump_and_release.run")
  def test_staged_blob_paths_reads_added_and_modified_blob_oids(self, run_mock) -> None:
    run_mock.return_value = (
      ":100644 100644 old-blob new-blob M\0path/to/file.txt\0"
      ":000000 100644 " + ("0" * 40) + " fresh-blob A\0path/to/new.bin\0"
    )

    self.assertEqual(
      staged_blob_paths(),
      {
        "new-blob": "path/to/file.txt",
        "fresh-blob": "path/to/new.bin",
      },
    )

  @patch("bump_and_release.run")
  def test_staged_blob_paths_ignores_gitlinks(self, run_mock) -> None:
    run_mock.return_value = (
      ":160000 160000 old-submodule new-submodule M\0integrations/supaterm-skills\0"
      ":100644 100644 old-blob new-blob M\0path/to/file.txt\0"
    )

    self.assertEqual(
      staged_blob_paths(),
      {
        "new-blob": "path/to/file.txt",
      },
    )

  @patch("bump_and_release.read_object_metadata")
  @patch("bump_and_release.staged_blob_paths")
  def test_oversized_staged_blobs_reports_large_staged_blobs(
    self,
    staged_blob_paths_mock,
    read_object_metadata_mock,
  ) -> None:
    staged_blob_paths_mock.return_value = {
      "big-blob": "path/to/big.bin",
      "small-blob": "path/to/small.txt",
    }
    read_object_metadata_mock.return_value = {
      "big-blob": ("blob", MAX_NON_LFS_BLOB_BYTES + 1),
      "small-blob": ("blob", 128),
    }

    self.assertEqual(
      oversized_staged_blobs(),
      [f"path/to/big.bin ({MAX_NON_LFS_BLOB_BYTES + 1} bytes)"],
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
  def test_validate_pre_push_rejects_invalid_release_tags(self, _validate_release_tag) -> None:
    with self.assertRaisesRegex(ValueError, "v1.4: release tag must be in vX.Y.Z format"):
      validate_pre_push(StringIO("refs/tags/v1.4 abc refs/tags/v1.4 def\n"))

  @patch(
    "bump_and_release.oversized_staged_blobs",
    return_value=[f"path/to/big.bin ({MAX_NON_LFS_BLOB_BYTES + 1} bytes)"],
  )
  def test_validate_pre_commit_rejects_large_non_lfs_blobs(self, _) -> None:
    with self.assertRaisesRegex(
      ValueError,
      rf"files larger than {MAX_NON_LFS_BLOB_BYTES} bytes must be stored in Git LFS",
    ):
      validate_pre_commit()


if __name__ == "__main__":
  unittest.main()
