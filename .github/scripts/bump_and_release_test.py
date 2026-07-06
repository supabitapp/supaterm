from datetime import date
from io import StringIO
from pathlib import Path
import subprocess
import unittest
from unittest.mock import call, patch

from bump_and_release import (
  PendingRelease,
  PushUpdate,
  bump_and_release,
  create_annotated_tag_command,
  next_calver_version,
  parse_release_kind,
  parse_version_state,
  parse_push_update,
  branch_pre_push_checks_required,
  run_pre_push_branch_checks,
  release_state,
  recover_pending_release,
  stable_build_number,
  tip_build_number,
  update_version_state,
  validate_pre_push,
  validate_release_tag,
  validate_new_version,
  version_tuple,
  pending_release,
)


class BumpAndReleaseTest(unittest.TestCase):
  def test_parse_version_state(self) -> None:
    state = parse_version_state(
      "MARKETING_VERSION = 26.0.0\nCURRENT_PROJECT_VERSION = 35\nSPARKLE_PUBLIC_ED_KEY = key\n"
    )

    self.assertEqual(state.marketing_version, "26.0.0")
    self.assertEqual(state.build_number, 35)

  def test_parse_version_state_rejects_malformed_marketing_version(self) -> None:
    with self.assertRaisesRegex(ValueError, "MARKETING_VERSION must be in YY.release.patch format"):
      parse_version_state("MARKETING_VERSION = 26.0\nCURRENT_PROJECT_VERSION = 35\n")

  def test_validate_new_version_requires_calendar_shape(self) -> None:
    self.assertEqual(validate_new_version("26.0", "1.3.7"), "version must be in YY.release.patch format")

  def test_validate_new_version_requires_greater_version(self) -> None:
    self.assertEqual(validate_new_version("26.0.0", "26.0.0"), "version must be greater than 26.0.0")
    self.assertEqual(validate_new_version("26.0.0", "26.0.1"), "version must be greater than 26.0.1")

  def test_validate_new_version_accepts_greater_calendar_version(self) -> None:
    self.assertIsNone(validate_new_version("26.0.0", "1.3.7"))
    self.assertIsNone(validate_new_version("26.1.0", "26.0.9"))

  def test_version_tuple_sorts_numeric_components(self) -> None:
    self.assertGreater(version_tuple("26.10.0"), version_tuple("26.2.9"))
    self.assertGreater(version_tuple("26.0.0"), version_tuple("1.3.7"))

  def test_parse_release_kind_accepts_supported_kinds(self) -> None:
    self.assertEqual(parse_release_kind("regular"), "regular")
    self.assertEqual(parse_release_kind("hotfix"), "hotfix")

  def test_parse_release_kind_rejects_unknown_kind(self) -> None:
    with self.assertRaisesRegex(ValueError, "release kind must be regular or hotfix"):
      parse_release_kind("minor")

  def test_next_regular_release_starts_current_year_series(self) -> None:
    self.assertEqual(next_calver_version("1.3.7", "regular", date(2026, 6, 18)), "26.0.0")

  def test_next_regular_release_increments_release_within_year(self) -> None:
    self.assertEqual(next_calver_version("26.1.9", "regular", date(2026, 8, 1)), "26.2.0")

  def test_next_regular_release_resets_for_new_year(self) -> None:
    self.assertEqual(next_calver_version("26.8.4", "regular", date(2027, 1, 1)), "27.0.0")

  def test_next_hotfix_release_increments_patch(self) -> None:
    self.assertEqual(next_calver_version("26.1.9", "hotfix", date(2026, 8, 1)), "26.1.10")

  def test_next_hotfix_rejects_previous_year_version(self) -> None:
    with self.assertRaisesRegex(ValueError, "hotfix requires current version to be in 26.x.x"):
      next_calver_version("25.3.0", "hotfix", date(2026, 8, 1))

  def test_next_release_rejects_future_year_version(self) -> None:
    with self.assertRaisesRegex(ValueError, "current version 27.0.0 is ahead of CalVer year 26"):
      next_calver_version("27.0.0", "regular", date(2026, 8, 1))

  def test_update_version_state_rewrites_version_lines(self) -> None:
    content = "MARKETING_VERSION = 1.3.7\nCURRENT_PROJECT_VERSION = 34\nSPARKLE_PUBLIC_ED_KEY = key\n"

    updated = update_version_state(content, version="26.0.0", build=35)

    self.assertEqual(
      updated,
      "MARKETING_VERSION = 26.0.0\nCURRENT_PROJECT_VERSION = 35\nSPARKLE_PUBLIC_ED_KEY = key\n",
    )

  def test_stable_build_number_uses_private_monotonic_build(self) -> None:
    self.assertEqual(stable_build_number(35), 35000)

  def test_tip_build_number_adds_run_offset(self) -> None:
    self.assertEqual(tip_build_number(35, 42), 35042)

  def test_tip_build_number_rejects_exhausted_offset_range(self) -> None:
    with self.assertRaisesRegex(ValueError, "tip run_number \\(1000\\) exceeds 999"):
      tip_build_number(35, 1000)

  def test_create_annotated_tag_command_uses_release_notes_file(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v26.0.0", Path("/tmp/release-notes.md")),
      [
        "git",
        "tag",
        "-a",
        "v26.0.0",
        "-F",
        "/tmp/release-notes.md",
      ],
    )

  def test_create_annotated_tag_command_force_updates_existing_tag(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v26.0.0", Path("/tmp/release-notes.md"), force=True),
      [
        "git",
        "tag",
        "-fa",
        "v26.0.0",
        "-F",
        "/tmp/release-notes.md",
      ],
    )

  def test_create_annotated_tag_command_can_target_specific_commit(self) -> None:
    self.assertEqual(
      create_annotated_tag_command("v26.0.0", Path("/tmp/release-notes.md"), force=True, commit="abc123"),
      [
        "git",
        "tag",
        "-fa",
        "v26.0.0",
        "-F",
        "/tmp/release-notes.md",
        "abc123",
      ],
    )

  def test_validate_release_tag_requires_stable_format(self) -> None:
    with self.assertRaisesRegex(ValueError, "release tag must be in vYY.release.patch format"):
      validate_release_tag("v26.0")

  @patch("bump_and_release.run")
  def test_validate_release_tag_requires_annotated_tag(self, run_mock) -> None:
    run_mock.return_value = "commit"

    with self.assertRaisesRegex(ValueError, "v26.0.0 must be an annotated tag"):
      validate_release_tag("v26.0.0")

  @patch("bump_and_release.run")
  def test_validate_release_tag_requires_matching_marketing_version(self, run_mock) -> None:
    run_mock.side_effect = [
      "tag",
      "MARKETING_VERSION = 26.0.1\nCURRENT_PROJECT_VERSION = 35\nSPARKLE_PUBLIC_ED_KEY = key\n",
    ]

    with self.assertRaisesRegex(ValueError, "v26.0.0 does not match MARKETING_VERSION 26.0.1"):
      validate_release_tag("v26.0.0")

  @patch("bump_and_release.run")
  def test_validate_release_tag_accepts_matching_annotated_tag(self, run_mock) -> None:
    run_mock.side_effect = [
      "tag",
      "MARKETING_VERSION = 26.0.0\nCURRENT_PROJECT_VERSION = 35\nSPARKLE_PUBLIC_ED_KEY = key\n",
    ]

    validate_release_tag("v26.0.0")

  @patch("bump_and_release.run")
  def test_release_state_returns_missing_for_absent_release(self, run_mock) -> None:
    run_mock.side_effect = subprocess.CalledProcessError(
      1,
      ["gh", "release", "view", "v26.0.0"],
      stderr="release not found",
    )

    self.assertEqual(release_state("v26.0.0"), "missing")

  @patch("bump_and_release.run")
  def test_release_state_returns_draft_for_draft_release(self, run_mock) -> None:
    run_mock.return_value = "true"

    self.assertEqual(release_state("v26.0.0"), "draft")

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
      "MARKETING_VERSION = 26.0.0\nCURRENT_PROJECT_VERSION = 35\n"
    )
    previous_release_tag_mock.return_value = "v1.3.7"
    release_state_mock.return_value = "missing"
    release_commit_mock.return_value = "abc123"

    self.assertEqual(
      pending_release(),
      PendingRelease(tag="v26.0.0", release_state="missing", commit="abc123"),
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
      "MARKETING_VERSION = 26.0.0\nCURRENT_PROJECT_VERSION = 35\n"
    )
    previous_release_tag_mock.return_value = "v1.3.7"
    release_state_mock.return_value = "published"
    release_commit_mock.return_value = "abc123"

    self.assertIsNone(pending_release())

  @patch("bump_and_release.publish_release_tag")
  @patch("bump_and_release.write_release_notes")
  @patch("bump_and_release.push_current_branch")
  @patch("bump_and_release.bump_version")
  @patch("bump_and_release.pending_release")
  def test_bump_and_release_pushes_branch_before_generating_notes(
    self,
    pending_release_mock,
    bump_version_mock,
    push_current_branch_mock,
    write_release_notes_mock,
    publish_release_tag_mock,
  ) -> None:
    events: list[str] = []
    pending_release_mock.return_value = None
    bump_version_mock.return_value = ("26.0.0", 35)
    push_current_branch_mock.side_effect = lambda: events.append("push")
    write_release_notes_mock.side_effect = lambda *_: events.append("write")
    publish_release_tag_mock.side_effect = lambda *_: events.append("publish")

    bump_and_release()

    self.assertEqual(events, ["push", "write", "publish"])

  @patch("bump_and_release.sync_draft_release_notes")
  @patch("bump_and_release.push_release_tag")
  @patch("bump_and_release.create_annotated_tag")
  @patch("bump_and_release.write_release_notes")
  @patch("bump_and_release.push_current_branch")
  @patch("bump_and_release.prompt_for_confirmation")
  def test_recover_pending_release_pushes_branch_before_generating_notes(
    self,
    prompt_for_confirmation_mock,
    push_current_branch_mock,
    write_release_notes_mock,
    create_annotated_tag_mock,
    push_release_tag_mock,
    sync_draft_release_notes_mock,
  ) -> None:
    events: list[str] = []
    prompt_for_confirmation_mock.return_value = True
    push_current_branch_mock.side_effect = lambda: events.append("push")
    write_release_notes_mock.side_effect = lambda *_: events.append("write")
    create_annotated_tag_mock.side_effect = lambda *_args, **_kwargs: events.append("tag")
    push_release_tag_mock.side_effect = lambda *_args, **_kwargs: events.append("push-tag")
    sync_draft_release_notes_mock.side_effect = lambda *_: events.append("sync")

    with patch("builtins.print"):
      recover_pending_release(PendingRelease(tag="v26.0.0", release_state="missing", commit="abc123"))

    self.assertEqual(events, ["push", "write", "tag", "push-tag"])

  def test_parse_push_update_reads_all_fields(self) -> None:
    self.assertEqual(
      parse_push_update("refs/tags/v26.0.0 abc refs/tags/v26.0.0 def\n"),
      PushUpdate("refs/tags/v26.0.0", "abc", "refs/tags/v26.0.0", "def"),
    )

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_ignores_branch_pushes(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("refs/heads/main abc refs/heads/main def\n"))

    validate_release_tag_mock.assert_not_called()

  def test_branch_pre_push_checks_required_accepts_branch_pushes(self) -> None:
    self.assertTrue(
      branch_pre_push_checks_required(StringIO("refs/heads/main abc refs/heads/main def\n"))
    )

  def test_branch_pre_push_checks_required_ignores_tag_pushes(self) -> None:
    self.assertFalse(
      branch_pre_push_checks_required(StringIO("refs/tags/v26.0.0 abc refs/tags/v26.0.0 def\n"))
    )

  @patch("bump_and_release.run_interactive")
  def test_run_pre_push_branch_checks_runs_full_checks_for_branch_push(self, run_interactive_mock) -> None:
    run_pre_push_branch_checks(StringIO("refs/heads/main abc refs/heads/main def\n"))

    self.assertEqual(
      run_interactive_mock.call_args_list,
      [
        call(["make", "web-check"]),
        call(["make", "web-test"]),
        call(["make", "mac-scan-dead-code"]),
        call(["make", "mac-test"]),
      ],
    )

  @patch("bump_and_release.run_interactive")
  def test_run_pre_push_branch_checks_skips_tag_pushes(self, run_interactive_mock) -> None:
    run_pre_push_branch_checks(StringIO("refs/tags/v26.0.0 abc refs/tags/v26.0.0 def\n"))

    run_interactive_mock.assert_not_called()

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_ignores_tag_deletions(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("(delete) 0000000000000000000000000000000000000000 refs/tags/v26.0.0 def\n"))

    validate_release_tag_mock.assert_not_called()

  @patch("bump_and_release.validate_release_tag")
  def test_validate_pre_push_validates_release_tag_pushes(self, validate_release_tag_mock) -> None:
    validate_pre_push(StringIO("refs/tags/v26.0.0 abc refs/tags/v26.0.0 def\n"))

    validate_release_tag_mock.assert_called_once_with("v26.0.0", "refs/tags/v26.0.0")

  @patch("bump_and_release.validate_release_tag", side_effect=ValueError("release tag must be in vYY.release.patch format"))
  def test_validate_pre_push_rejects_invalid_release_tags(self, _validate_release_tag) -> None:
    with self.assertRaisesRegex(ValueError, "v26.0: release tag must be in vYY.release.patch format"):
      validate_pre_push(StringIO("refs/tags/v26.0 abc refs/tags/v26.0 def\n"))


if __name__ == "__main__":
  unittest.main()
