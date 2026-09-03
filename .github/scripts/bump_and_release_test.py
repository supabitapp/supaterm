from datetime import date
import unittest

from bump_and_release import next_calver_version, update_version_state


class CalVerTest(unittest.TestCase):
  def test_regular_release_increments_release_and_resets_patch(self) -> None:
    self.assertEqual(
      next_calver_version("26.3.7", "regular", date(2026, 12, 31)),
      "26.4.0",
    )

  def test_regular_release_resets_series_at_year_rollover(self) -> None:
    self.assertEqual(
      next_calver_version("26.8.4", "regular", date(2027, 1, 1)),
      "27.0.0",
    )

  def test_hotfix_increments_only_patch(self) -> None:
    self.assertEqual(
      next_calver_version("26.3.9", "hotfix", date(2026, 8, 1)),
      "26.3.10",
    )

  def test_hotfix_rejects_previous_year_release(self) -> None:
    with self.assertRaisesRegex(
      ValueError,
      "hotfix requires current version to be in 26.x.x",
    ):
      next_calver_version("25.3.0", "hotfix", date(2026, 1, 1))

  def test_release_rejects_version_ahead_of_calendar(self) -> None:
    with self.assertRaisesRegex(
      ValueError,
      "current version 27.0.0 is ahead of CalVer year 26",
    ):
      next_calver_version("27.0.0", "regular", date(2026, 12, 31))


class VersionStateUpdateTest(unittest.TestCase):
  def test_rewrites_exactly_the_version_state_lines(self) -> None:
    content = (
      "MARKETING_VERSION = 26.3.0\n"
      "CURRENT_PROJECT_VERSION = 39\n"
      "SPARKLE_PUBLIC_ED_KEY = unchanged\n"
    )

    self.assertEqual(
      update_version_state(content, "26.4.0", 40),
      "MARKETING_VERSION = 26.4.0\n"
      "CURRENT_PROJECT_VERSION = 40\n"
      "SPARKLE_PUBLIC_ED_KEY = unchanged\n",
    )

  def test_rejects_missing_marketing_version(self) -> None:
    with self.assertRaisesRegex(ValueError, "expected one MARKETING_VERSION, found 0"):
      update_version_state("CURRENT_PROJECT_VERSION = 39\n", "26.4.0", 40)

  def test_rejects_missing_build_number(self) -> None:
    with self.assertRaisesRegex(
      ValueError,
      "expected one CURRENT_PROJECT_VERSION, found 0",
    ):
      update_version_state("MARKETING_VERSION = 26.3.0\n", "26.4.0", 40)

  def test_rejects_duplicate_version_state_lines(self) -> None:
    content = (
      "MARKETING_VERSION = 26.3.0\n"
      "MARKETING_VERSION = 26.2.0\n"
      "CURRENT_PROJECT_VERSION = 39\n"
    )

    with self.assertRaisesRegex(ValueError, "expected one MARKETING_VERSION, found 2"):
      update_version_state(content, "26.4.0", 40)


if __name__ == "__main__":
  unittest.main()
