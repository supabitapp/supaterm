import os
import subprocess
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT_PATH = REPO_ROOT / "apps/mac/scripts/validate-release-day.sh"


class ReleaseBuildTest(unittest.TestCase):
  def test_release_build_requires_a_release_day(self) -> None:
    environment = os.environ | {"CONFIGURATION": "Release", "SUPATERM_RELEASE_DATE": ""}

    result = subprocess.run(
      [str(SCRIPT_PATH)],
      capture_output=True,
      env=environment,
      text=True,
    )

    self.assertNotEqual(result.returncode, 0)
    self.assertEqual(result.stderr, "error: SUPATERM_RELEASE_DATE is required for Release builds\n")

  def test_release_build_accepts_a_release_day(self) -> None:
    environment = os.environ | {
      "CONFIGURATION": "Release",
      "SUPATERM_RELEASE_DATE": "2026-08-21",
    }

    result = subprocess.run([str(SCRIPT_PATH)], env=environment)

    self.assertEqual(result.returncode, 0)

  def test_release_build_rejects_an_invalid_release_day(self) -> None:
    environment = os.environ | {
      "CONFIGURATION": "Release",
      "SUPATERM_RELEASE_DATE": "not-a-day",
    }

    result = subprocess.run(
      [str(SCRIPT_PATH)],
      capture_output=True,
      env=environment,
      text=True,
    )

    self.assertNotEqual(result.returncode, 0)
    self.assertEqual(result.stderr, "error: SUPATERM_RELEASE_DATE must use YYYY-MM-DD\n")

  def test_debug_build_does_not_require_a_release_day(self) -> None:
    environment = os.environ | {"CONFIGURATION": "Debug", "SUPATERM_RELEASE_DATE": ""}

    result = subprocess.run([str(SCRIPT_PATH)], env=environment)

    self.assertEqual(result.returncode, 0)


if __name__ == "__main__":
  unittest.main()
