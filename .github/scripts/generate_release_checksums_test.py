import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from generate_release_checksums import main, release_checksums


class GenerateReleaseChecksumsTest(unittest.TestCase):
  def test_manifest_is_deterministic_and_records_asset_metadata(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      directory = Path(temporary_directory)
      dmg = directory / "supaterm.dmg"
      zip_path = directory / "supaterm.app.zip"
      dmg.write_bytes(b"dmg")
      zip_path.write_bytes(b"zip contents")

      first = release_checksums("v26.4.0", [zip_path, dmg, dmg])
      second = release_checksums("v26.4.0", [dmg, zip_path])

      self.assertEqual(first, second)
      self.assertEqual(list(first["assets"]), ["supaterm.app.zip", "supaterm.dmg"])
      self.assertEqual(
        first["assets"]["supaterm.dmg"],
        {
          "sha256": hashlib.sha256(b"dmg").hexdigest(),
          "size": 3,
        },
      )

  def test_main_writes_canonical_json_with_trailing_newline(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      directory = Path(temporary_directory)
      asset = directory / "supaterm.dmg"
      output = directory / "checksums.json"
      asset.write_bytes(b"dmg")

      with patch.object(
        sys,
        "argv",
        ["generate_release_checksums.py", "tip", str(output), str(asset)],
      ):
        main()

      manifest = {
        "assets": {
          "supaterm.dmg": {
            "sha256": hashlib.sha256(b"dmg").hexdigest(),
            "size": 3,
          }
        },
        "tag": "tip",
      }
      self.assertEqual(
        output.read_text(encoding="utf-8"),
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
      )

  def test_missing_asset_fails(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      missing = Path(temporary_directory) / "missing.dmg"

      with self.assertRaisesRegex(SystemExit, f"asset not found: {missing}"):
        release_checksums("tip", [missing])

  def test_duplicate_asset_names_fail(self) -> None:
    with tempfile.TemporaryDirectory() as temporary_directory:
      directory = Path(temporary_directory)
      first = directory / "first" / "supaterm.dmg"
      second = directory / "second" / "supaterm.dmg"
      first.parent.mkdir()
      second.parent.mkdir()
      first.write_bytes(b"first")
      second.write_bytes(b"second")

      with self.assertRaisesRegex(SystemExit, "duplicate asset name: supaterm.dmg"):
        release_checksums("tip", [second, first])


if __name__ == "__main__":
  unittest.main()
