#!/usr/bin/env python3

import hashlib
import json
import sys
from pathlib import Path


def sha256(path: Path) -> str:
  digest = hashlib.sha256()
  with path.open("rb") as file:
    for chunk in iter(lambda: file.read(1024 * 1024), b""):
      digest.update(chunk)
  return digest.hexdigest()


def release_checksums(tag: str, paths: list[Path]) -> dict[str, object]:
  assets = {}
  for path in sorted(set(paths), key=lambda asset: (asset.name, str(asset))):
    if not path.is_file():
      raise SystemExit(f"asset not found: {path}")
    if path.name in assets:
      raise SystemExit(f"duplicate asset name: {path.name}")
    assets[path.name] = {
      "sha256": sha256(path),
      "size": path.stat().st_size,
    }
  return {"assets": assets, "tag": tag}


def main() -> None:
  if len(sys.argv) < 4:
    raise SystemExit("usage: generate_release_checksums.py TAG OUTPUT ASSET...")

  tag = sys.argv[1]
  output = Path(sys.argv[2])
  paths = [Path(path) for path in sys.argv[3:]]
  output.write_text(
    json.dumps(release_checksums(tag, paths), indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
  )


if __name__ == "__main__":
  main()
