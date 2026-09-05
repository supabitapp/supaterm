#!/usr/bin/env python3
"""Prepare relocatable E2E products and set consumer-specific test environments."""

import argparse
import plistlib
from pathlib import Path


def test_targets(run: dict) -> list[dict]:
  version = run.get("__xctestrun_metadata__", {}).get("FormatVersion", 1)
  if version == 2:
    targets = [
      target
      for configuration in run["TestConfigurations"]
      for target in configuration["TestTargets"]
    ]
  elif version == 1:
    targets = [value for value in run.values() if isinstance(value, dict) and "TestBundlePath" in value]
  else:
    raise ValueError(f"Unsupported xctestrun format: {version}")
  if not targets or any(target.get("BlueprintName") != "supatermE2E" for target in targets):
    raise ValueError("Expected only supatermE2E test targets")
  return targets


def relocate(value, products: Path):
  if isinstance(value, str):
    return value.replace(f"{products}/", "__TESTROOT__/")
  if isinstance(value, list):
    return [relocate(item, products) for item in value]
  if isinstance(value, dict):
    return {key: relocate(item, products) for key, item in value.items()}
  return value


def prepare(products: Path) -> Path:
  products = products.resolve()
  runs = list(products.glob("*.xctestrun"))
  if len(runs) != 1:
    raise ValueError(f"Expected one E2E xctestrun in {products}, found {len(runs)}")
  with runs[0].open("rb") as file:
    run = relocate(plistlib.load(file), products)
  for target in test_targets(run):
    # Every test dependency must travel with the archive, including resources
    # and frameworks; consumers do not restore the producer's Tuist cache.
    for reference in [target["TestBundlePath"], *target.get("DependentProductPaths", [])]:
      if not reference.startswith("__TESTROOT__/"):
        raise ValueError(f"Test product is outside the artifact: {reference}")
      path = products / reference.removeprefix("__TESTROOT__/")
      if not path.resolve(strict=True).is_relative_to(products):
        raise ValueError(f"Test product escapes artifact: {reference}")
  # Framework version symlinks must survive tar, but no link may depend on the
  # producer's DerivedData, checkout, or Tuist cache outside this artifact.
  for path in products.rglob("*"):
    if path.is_symlink():
      resolved = path.resolve(strict=True)
      if not resolved.is_relative_to(products):
        raise ValueError(f"Build product symlink escapes artifact: {path}")
      if Path(path.readlink()).is_absolute():
        raise ValueError(f"Build product symlink is not relocatable: {path}")
  output = products / "supatermE2E.xctestrun"
  with output.open("wb") as file:
    plistlib.dump(run, file)
  if runs[0] != output:
    runs[0].unlink()
  return output


def configure(source: Path, agents: dict[str, str]) -> Path:
  with source.open("rb") as file:
    run = plistlib.load(file)
  for target in test_targets(run):
    # Build settings were expanded on the producer. Passing them to
    # test-without-building does not replace the saved scheme environment.
    target.setdefault("EnvironmentVariables", {}).update(agents)
  output = Path(f"{source}.runtime.xctestrun")
  with output.open("wb") as file:
    plistlib.dump(run, file)
  return output


def main() -> None:
  parser = argparse.ArgumentParser(description=__doc__)
  commands = parser.add_subparsers(dest="command", required=True)
  prepare_parser = commands.add_parser("prepare")
  prepare_parser.add_argument("products", type=Path)
  configure_parser = commands.add_parser("configure")
  configure_parser.add_argument("xctestrun", type=Path)
  for agent in ("claude", "codex", "pi"):
    configure_parser.add_argument(f"--{agent}", required=True)
  args = parser.parse_args()
  if args.command == "prepare":
    prepare(args.products)
  else:
    configure(args.xctestrun, {
      "CLAUDE_E2E_BINARY": args.claude,
      "CODEX_E2E_BINARY": args.codex,
      "PI_E2E_BINARY": args.pi,
    })


if __name__ == "__main__":
  main()
