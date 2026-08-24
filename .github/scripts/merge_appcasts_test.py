import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path

from merge_appcasts import validated_tip_items


SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
SCRIPT_PATH = Path(__file__).with_name("merge_appcasts.py")


class MergeAppcastsTest(unittest.TestCase):
  def test_stamp_sets_tip_release_day_and_channel(self) -> None:
    appcast = f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">
  <channel>
    <item>
      <title>Supaterm Tip</title>
      <pubDate>Mon, 24 Aug 2026 13:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>
"""

    with tempfile.TemporaryDirectory() as temp_dir:
      temp_path = Path(temp_dir)
      input_path = temp_path / "input.xml"
      output_path = temp_path / "output.xml"
      input_path.write_text(appcast, encoding="utf-8")

      subprocess.run(
        [
          "python3",
          str(SCRIPT_PATH),
          "stamp",
          str(input_path),
          str(output_path),
          "--release-day",
          "2026-08-21",
          "--channel",
          "tip",
        ],
        check=True,
      )

      item = ET.parse(output_path).find(".//channel/item")

      self.assertIsNotNone(item)
      self.assertEqual(item.findtext("pubDate"), "Fri, 21 Aug 2026 00:00:00 +0000")
      self.assertEqual(item.findtext(f"{{{SPARKLE_NAMESPACE}}}channel"), "tip")

  def test_stable_feed_accumulates_prior_releases_and_stamps_release_day(self) -> None:
    previous = f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">
  <channel>
    <item>
      <title>Supaterm 26.3.0</title>
      <pubDate>Mon, 17 Aug 2026 12:30:00 +0000</pubDate>
      <sparkle:version>39</sparkle:version>
    </item>
    <item>
      <title>Supaterm Tip</title>
      <sparkle:channel>tip</sparkle:channel>
      <sparkle:version>39000042</sparkle:version>
    </item>
  </channel>
</rss>
"""
    current = f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">
  <channel>
    <item>
      <title>Supaterm 26.4.0</title>
      <pubDate>Mon, 24 Aug 2026 13:00:00 +0000</pubDate>
      <sparkle:version>40</sparkle:version>
    </item>
  </channel>
</rss>
"""

    with tempfile.TemporaryDirectory() as temp_dir:
      temp_path = Path(temp_dir)
      previous_path = temp_path / "previous.xml"
      current_path = temp_path / "current.xml"
      merged_path = temp_path / "merged.xml"
      previous_path.write_text(previous, encoding="utf-8")
      current_path.write_text(current, encoding="utf-8")

      subprocess.run(
        [
          "python3",
          str(SCRIPT_PATH),
          "stable",
          str(current_path),
          str(merged_path),
          "--release-day",
          "2026-08-21",
          "--previous",
          str(previous_path),
        ],
        check=True,
      )

      tree = ET.parse(merged_path)
      items = tree.findall(".//channel/item")

      self.assertEqual(
        [item.findtext("title") for item in items],
        ["Supaterm 26.4.0", "Supaterm 26.3.0"],
      )
      self.assertEqual(items[0].findtext("pubDate"), "Fri, 21 Aug 2026 00:00:00 +0000")
      self.assertEqual(items[1].findtext("pubDate"), "Mon, 17 Aug 2026 12:30:00 +0000")

  def test_rejects_empty_tip_appcast(self) -> None:
    with self.assertRaisesRegex(SystemExit, "tip appcast has no items"):
      validated_tip_items(ET.fromstring("<channel />"))

  def test_rejects_tip_item_without_tip_channel(self) -> None:
    tip_channel = ET.fromstring("<channel><item><title>Unmarked Tip</title></item></channel>")

    with self.assertRaisesRegex(SystemExit, "tip appcast contains an item without the tip channel"):
      validated_tip_items(tip_channel)

  def test_replaces_tip_items_and_preserves_stable_items(self) -> None:
    stable = f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">
  <channel>
    <item>
      <title>Stable</title>
    </item>
    <item>
      <title>Old Tip</title>
      <sparkle:channel>tip</sparkle:channel>
    </item>
  </channel>
</rss>
"""
    tip = f"""<?xml version="1.0" encoding="utf-8"?>
<rss xmlns:sparkle="{SPARKLE_NAMESPACE}" version="2.0">
  <channel>
    <item>
      <title>New Tip</title>
      <pubDate>Mon, 24 Aug 2026 13:00:00 +0000</pubDate>
      <sparkle:channel>tip</sparkle:channel>
    </item>
  </channel>
</rss>
"""

    with tempfile.TemporaryDirectory() as temp_dir:
      temp_path = Path(temp_dir)
      stable_path = temp_path / "stable.xml"
      tip_path = temp_path / "tip.xml"
      merged_path = temp_path / "merged.xml"
      stable_path.write_text(stable, encoding="utf-8")
      tip_path.write_text(tip, encoding="utf-8")

      subprocess.run(
        [
          "python3",
          str(SCRIPT_PATH),
          "tip",
          str(stable_path),
          str(tip_path),
          str(merged_path),
        ],
        check=True,
      )

      tree = ET.parse(merged_path)
      items = tree.findall(".//channel/item")
      titles = [item.findtext("title") for item in items]

      self.assertEqual(titles, ["Stable", "New Tip"])
      self.assertEqual(items[1].findtext("pubDate"), "Mon, 24 Aug 2026 13:00:00 +0000")


if __name__ == "__main__":
  unittest.main()
