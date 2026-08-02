#!/usr/bin/env python3

import sys
import xml.etree.ElementTree as ET


SPARKLE_NAMESPACE = "http://www.andymatuschak.org/xml-namespaces/sparkle"


def channel(root: ET.Element) -> ET.Element:
  value = root.find(".//channel")
  if value is None:
    raise SystemExit("missing channel element")
  return value


def is_tip_item(item: ET.Element) -> bool:
  value = item.find(f"{{{SPARKLE_NAMESPACE}}}channel")
  return value is not None and value.text == "tip"


def validated_tip_items(channel: ET.Element) -> list[ET.Element]:
  items = channel.findall("item")
  if not items:
    raise SystemExit("tip appcast has no items")
  if any(not is_tip_item(item) for item in items):
    raise SystemExit("tip appcast contains an item without the tip channel")
  return items


def main() -> None:
  if len(sys.argv) != 4:
    raise SystemExit("usage: merge_appcasts.py stable.xml tip.xml out.xml")

  ET.register_namespace("sparkle", SPARKLE_NAMESPACE)
  ET.register_namespace("dc", "http://purl.org/dc/elements/1.1/")

  stable_tree = ET.parse(sys.argv[1])
  tip_tree = ET.parse(sys.argv[2])
  stable_channel = channel(stable_tree.getroot())
  tip_channel = channel(tip_tree.getroot())
  items = validated_tip_items(tip_channel)

  for item in list(stable_channel.findall("item")):
    if is_tip_item(item):
      stable_channel.remove(item)

  for item in items:
    stable_channel.append(item)

  stable_tree.write(sys.argv[3], xml_declaration=True, encoding="utf-8")


if __name__ == "__main__":
  main()
