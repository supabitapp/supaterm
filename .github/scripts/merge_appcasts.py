#!/usr/bin/env python3

from __future__ import annotations

import argparse
import copy
import xml.etree.ElementTree as ET
from datetime import date, datetime, time, timezone
from email.utils import format_datetime
from pathlib import Path


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


def parse_tree(path: Path) -> ET.ElementTree:
  return ET.parse(path)


def release_pub_date(value: str) -> str:
  try:
    day = date.fromisoformat(value)
  except ValueError as error:
    raise SystemExit("release day must use YYYY-MM-DD") from error
  if day.isoformat() != value:
    raise SystemExit("release day must use YYYY-MM-DD")
  return format_datetime(datetime.combine(day, time(), timezone.utc))


def version(item: ET.Element) -> str | None:
  return item.findtext(f"{{{SPARKLE_NAMESPACE}}}version")


def stamp_items(
  items: list[ET.Element],
  release_day: str,
  item_channel: str | None = None,
) -> None:
  pub_date = release_pub_date(release_day)
  for item in items:
    value = item.find("pubDate")
    if value is None:
      value = ET.SubElement(item, "pubDate")
    value.text = pub_date
    if item_channel is not None:
      value = item.find(f"{{{SPARKLE_NAMESPACE}}}channel")
      if value is None:
        value = ET.SubElement(item, f"{{{SPARKLE_NAMESPACE}}}channel")
      value.text = item_channel


def stamp_appcast(
  input_path: Path,
  output_path: Path,
  release_day: str,
  item_channel: str | None,
) -> None:
  tree = parse_tree(input_path)
  stamp_items(channel(tree.getroot()).findall("item"), release_day, item_channel)
  tree.write(output_path, xml_declaration=True, encoding="utf-8")


def merge_stable(
  current_path: Path,
  output_path: Path,
  release_day: str,
  previous_path: Path | None,
) -> None:
  current_tree = parse_tree(current_path)
  current_channel = channel(current_tree.getroot())
  current_items = current_channel.findall("item")
  if not current_items:
    raise SystemExit("stable appcast has no items")
  if any(is_tip_item(item) for item in current_items):
    raise SystemExit("stable appcast contains a tip item")

  current_versions = {version(item) for item in current_items}
  stamp_items(current_items, release_day)

  if previous_path is not None:
    previous_tree = parse_tree(previous_path)
    for item in channel(previous_tree.getroot()).findall("item"):
      if is_tip_item(item) or version(item) not in current_versions:
        current_channel.append(copy.deepcopy(item))

  current_tree.write(output_path, xml_declaration=True, encoding="utf-8")


def merge_tip(stable_path: Path, tip_path: Path, output_path: Path) -> None:
  stable_tree = parse_tree(stable_path)
  tip_tree = parse_tree(tip_path)
  stable_channel = channel(stable_tree.getroot())
  items = validated_tip_items(channel(tip_tree.getroot()))

  for item in list(stable_channel.findall("item")):
    if is_tip_item(item):
      stable_channel.remove(item)

  for item in items:
    stable_channel.append(copy.deepcopy(item))

  stable_tree.write(output_path, xml_declaration=True, encoding="utf-8")


def arguments() -> argparse.Namespace:
  parser = argparse.ArgumentParser()
  commands = parser.add_subparsers(dest="command", required=True)
  stable = commands.add_parser("stable")
  stable.add_argument("current", type=Path)
  stable.add_argument("output", type=Path)
  stable.add_argument("--release-day", required=True)
  stable.add_argument("--previous", type=Path)
  stamp = commands.add_parser("stamp")
  stamp.add_argument("input", type=Path)
  stamp.add_argument("output", type=Path)
  stamp.add_argument("--release-day", required=True)
  stamp.add_argument("--channel")
  tip = commands.add_parser("tip")
  tip.add_argument("stable", type=Path)
  tip.add_argument("tip", type=Path)
  tip.add_argument("output", type=Path)
  return parser.parse_args()


def main() -> None:
  args = arguments()

  ET.register_namespace("sparkle", SPARKLE_NAMESPACE)
  ET.register_namespace("dc", "http://purl.org/dc/elements/1.1/")

  if args.command == "stable":
    merge_stable(args.current, args.output, args.release_day, args.previous)
  elif args.command == "stamp":
    stamp_appcast(args.input, args.output, args.release_day, args.channel)
  else:
    merge_tip(args.stable, args.tip, args.output)


if __name__ == "__main__":
  main()
