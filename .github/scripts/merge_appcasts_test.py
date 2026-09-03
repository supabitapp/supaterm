from __future__ import annotations

import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from merge_appcasts import SPARKLE_NAMESPACE, merge_stable, merge_tip, stamp_appcast


def item(
  title: str,
  item_version: str | None = None,
  item_channel: str | None = None,
  pub_date: str | None = None,
) -> str:
  values = [f"<title>{title}</title>"]
  if pub_date is not None:
    values.append(f"<pubDate>{pub_date}</pubDate>")
  if item_channel is not None:
    values.append(f"<sparkle:channel>{item_channel}</sparkle:channel>")
  if item_version is not None:
    values.append(f"<sparkle:version>{item_version}</sparkle:version>")
  return f"<item>{''.join(values)}</item>"


def appcast(*items: str) -> str:
  return (
    '<?xml version="1.0" encoding="utf-8"?>'
    f'<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">'
    f"<channel>{''.join(items)}</channel>"
    "</rss>"
  )


class MergeAppcastsTest(unittest.TestCase):
  def setUp(self) -> None:
    self.temporary_directory = tempfile.TemporaryDirectory()
    self.directory = Path(self.temporary_directory.name)

  def tearDown(self) -> None:
    self.temporary_directory.cleanup()

  def write(self, name: str, content: str) -> Path:
    path = self.directory / name
    path.write_text(content, encoding="utf-8")
    return path

  def test_stamp_replaces_release_day_and_adds_channel_to_every_item(self) -> None:
    input_path = self.write(
      "input.xml",
      appcast(
        item("First", "40", pub_date="Mon, 24 Aug 2026 13:00:00 +0000"),
        item("Second", "41"),
      ),
    )
    output_path = self.directory / "output.xml"

    stamp_appcast(input_path, output_path, "2026-08-21", "tip")

    items = ET.parse(output_path).findall(".//channel/item")
    self.assertEqual(
      [value.findtext("pubDate") for value in items],
      ["Fri, 21 Aug 2026 00:00:00 +0000"] * 2,
    )
    self.assertEqual(
      [value.findtext(f"{{{SPARKLE_NAMESPACE}}}channel") for value in items],
      ["tip", "tip"],
    )

  def test_stamp_rejects_noncanonical_release_day(self) -> None:
    input_path = self.write("input.xml", appcast(item("Tip", "40")))

    with self.assertRaisesRegex(SystemExit, "release day must use YYYY-MM-DD"):
      stamp_appcast(input_path, self.directory / "output.xml", "2026-8-1", "tip")

  def test_malformed_xml_fails_without_writing_output(self) -> None:
    input_path = self.write("input.xml", "<rss><channel>")
    output_path = self.directory / "output.xml"

    with self.assertRaises(ET.ParseError):
      stamp_appcast(input_path, output_path, "2026-08-21", "tip")
    self.assertFalse(output_path.exists())

  def test_missing_channel_fails(self) -> None:
    input_path = self.write("input.xml", "<rss />")

    with self.assertRaisesRegex(SystemExit, "missing channel element"):
      stamp_appcast(input_path, self.directory / "output.xml", "2026-08-21", "tip")

  def test_stable_merge_stamps_current_and_skips_previous_duplicate(self) -> None:
    current_path = self.write("current.xml", appcast(item("Current", "40")))
    previous_path = self.write(
      "previous.xml",
      appcast(
        item("Retry of Current", "40"),
        item("Previous", "39", pub_date="Mon, 17 Aug 2026 12:30:00 +0000"),
        item("Tip", "39000042", "tip"),
      ),
    )
    output_path = self.directory / "output.xml"

    merge_stable(current_path, output_path, "2026-08-21", previous_path)

    items = ET.parse(output_path).findall(".//channel/item")
    self.assertEqual(
      [value.findtext("title") for value in items],
      ["Current", "Previous", "Tip"],
    )
    self.assertEqual(items[0].findtext("pubDate"), "Fri, 21 Aug 2026 00:00:00 +0000")
    self.assertEqual(items[1].findtext("pubDate"), "Mon, 17 Aug 2026 12:30:00 +0000")

  def test_stable_merge_rejects_duplicate_versions_within_input(self) -> None:
    current_path = self.write("current.xml", appcast(item("Current", "40")))
    previous_path = self.write(
      "previous.xml",
      appcast(item("First", "39"), item("Duplicate", "39")),
    )

    with self.assertRaisesRegex(
      SystemExit,
      "previous appcast contains duplicate versions: 39",
    ):
      merge_stable(
        current_path,
        self.directory / "output.xml",
        "2026-08-21",
        previous_path,
      )

  def test_tip_merge_replaces_existing_tip_and_preserves_stable_items(self) -> None:
    stable_path = self.write(
      "stable.xml",
      appcast(item("Stable", "40"), item("Old Tip", "40000012", "tip")),
    )
    tip_path = self.write("tip.xml", appcast(item("New Tip", "40000013", "tip")))
    output_path = self.directory / "output.xml"

    merge_tip(stable_path, tip_path, output_path)

    items = ET.parse(output_path).findall(".//channel/item")
    self.assertEqual(
      [value.findtext("title") for value in items],
      ["Stable", "New Tip"],
    )

  def test_tip_merge_rejects_unmarked_items(self) -> None:
    stable_path = self.write("stable.xml", appcast(item("Stable", "40")))
    tip_path = self.write("tip.xml", appcast(item("Not Tip", "40000013")))

    with self.assertRaisesRegex(
      SystemExit,
      "tip appcast contains an item without the tip channel",
    ):
      merge_tip(stable_path, tip_path, self.directory / "output.xml")

  def test_tip_merge_rejects_duplicate_versions(self) -> None:
    stable_path = self.write("stable.xml", appcast(item("Stable", "40")))
    tip_path = self.write(
      "tip.xml",
      appcast(
        item("First Tip", "40000013", "tip"),
        item("Duplicate Tip", "40000013", "tip"),
      ),
    )

    with self.assertRaisesRegex(
      SystemExit,
      "tip appcast contains duplicate versions: 40000013",
    ):
      merge_tip(stable_path, tip_path, self.directory / "output.xml")


if __name__ == "__main__":
  unittest.main()
