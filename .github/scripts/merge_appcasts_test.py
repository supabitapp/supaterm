import subprocess
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path


SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle"
SCRIPT_PATH = Path(__file__).with_name("merge_appcasts.py")


class MergeAppcastsTest(unittest.TestCase):
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
        ["python3", str(SCRIPT_PATH), str(stable_path), str(tip_path), str(merged_path)],
        check=True,
      )

      tree = ET.parse(merged_path)
      titles = [item.findtext("title") for item in tree.findall(".//channel/item")]

      self.assertEqual(titles, ["Stable", "New Tip"])


if __name__ == "__main__":
  unittest.main()
