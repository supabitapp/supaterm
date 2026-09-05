import copy
import importlib.util
import json
import os
import plistlib
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("ci_e2e_products", ROOT / "apps/mac/scripts/ci_e2e_products.py")
products_tool = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(products_tool)


def test_run(version=2):
  target = {
    "BlueprintName": "supatermE2E",
    "TestBundlePath": "__TESTROOT__/Debug/supatermE2E.xctest",
    "EnvironmentVariables": {"CODEX_E2E_BINARY": "/producer/codex", "KEEP": "yes"},
    "OnlyTestIdentifiers": ["CodexE2ETests"],
    "ParallelizationEnabled": True,
  }
  if version == 1:
    return {"supatermE2E": target}
  return {
    "__xctestrun_metadata__": {"FormatVersion": version},
    "TestConfigurations": [{"TestTargets": [target]}],
    "CodeCoverageBuildableInfos": [{"SourceFilesCommonPathPrefix": "/checkout/apps/mac"}],
  }


class E2EProductsTest(unittest.TestCase):
  def setUp(self):
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.root = Path(self.directory.name).resolve()
    self.products = self.root / "producer" / "Products"
    self.products.mkdir(parents=True)
    (self.products / "Debug/supatermE2E.xctest").mkdir(parents=True)

  def write_run(self, run, name="supatermE2E_macosx26.2-arm64.xctestrun"):
    path = self.products / name
    with path.open("wb") as file:
      plistlib.dump(run, file)
    return path

  def test_archive_relocates_products_and_preserves_executables_and_symlinks(self):
    framework = self.products / "Debug/Support.framework"
    binary = framework / "Versions/A/Support"
    binary.parent.mkdir(parents=True)
    binary.write_text("fixture binary")
    binary.chmod(0o755)
    (framework / "Versions/Current").symlink_to("A")
    (framework / "Support").symlink_to("Versions/Current/Support")
    run = test_run()
    target = products_tool.test_targets(run)[0]
    target["TestingEnvironmentVariables"] = {"DYLD_FRAMEWORK_PATH": f"{self.products}/Debug"}
    self.write_run(run)
    prepared = products_tool.prepare(self.products)
    archive = self.root / "products.tar.gz"
    subprocess.run(["tar", "-czf", str(archive), "-C", str(self.products.parent), "Products"], check=True)
    shutil.rmtree(self.products.parent)
    consumer = self.root / "different consumer path"
    consumer.mkdir()
    subprocess.run(["tar", "-xzf", str(archive), "-C", str(consumer)], check=True)
    relocated = consumer / "Products"
    with (relocated / prepared.name).open("rb") as file:
      restored = plistlib.load(file)
    self.assertEqual(products_tool.test_targets(restored)[0]["TestingEnvironmentVariables"], {
      "DYLD_FRAMEWORK_PATH": "__TESTROOT__/Debug",
    })
    self.assertEqual(restored["CodeCoverageBuildableInfos"], run["CodeCoverageBuildableInfos"])
    linked_binary = relocated / "Debug/Support.framework/Support"
    self.assertTrue(linked_binary.is_symlink())
    self.assertEqual(linked_binary.read_text(), "fixture binary")
    self.assertTrue(os.access(linked_binary, os.X_OK))

  def test_rejects_missing_or_ambiguous_test_runs(self):
    with self.assertRaisesRegex(ValueError, "found 0"):
      products_tool.prepare(self.products)
    self.write_run(test_run())
    self.write_run(test_run(), "other.xctestrun")
    with self.assertRaisesRegex(ValueError, "found 2"):
      products_tool.prepare(self.products)

  def test_rejects_symlinks_to_producer_cache(self):
    self.write_run(test_run())
    dependency = self.root / "outside"
    dependency.write_text("cache dependency")
    (self.products / "dependency").symlink_to(dependency)
    with self.assertRaisesRegex(ValueError, "escapes artifact"):
      products_tool.prepare(self.products)

  def test_rejects_dependencies_missing_from_artifact(self):
    run = test_run()
    target = products_tool.test_targets(run)[0]
    target["DependentProductPaths"] = ["/producer/cache/Dependency.framework"]
    self.write_run(run)
    with self.assertRaisesRegex(ValueError, "outside the artifact"):
      products_tool.prepare(self.products)
    target["DependentProductPaths"] = ["__TESTROOT__/Debug/Dependency.framework"]
    self.write_run(run)
    with self.assertRaises(FileNotFoundError):
      products_tool.prepare(self.products)

  def test_runtime_configuration_preserves_selection_coverage_and_source_for_both_formats(self):
    for version in (1, 2):
      with self.subTest(version=version):
        original = test_run(version)
        source = self.write_run(original)
        agents = {"CODEX_E2E_BINARY": "/consumer with spaces/codex", "CLAUDE_E2E_BINARY": "", "PI_E2E_BINARY": ""}
        output = products_tool.configure(source, agents)
        expected = copy.deepcopy(original)
        for target in products_tool.test_targets(expected):
          target["EnvironmentVariables"].update(agents)
        self.assertEqual(output.parent, source.parent)
        with output.open("rb") as file:
          self.assertEqual(plistlib.load(file), expected)
        with source.open("rb") as file:
          self.assertEqual(plistlib.load(file), original)

  def test_runtime_configuration_clears_producer_agent_paths(self):
    source = self.write_run(test_run())
    output = products_tool.configure(source, {
      "CLAUDE_E2E_BINARY": "", "CODEX_E2E_BINARY": "", "PI_E2E_BINARY": "",
    })
    with output.open("rb") as file:
      environment = products_tool.test_targets(plistlib.load(file))[0]["EnvironmentVariables"]
    self.assertEqual(environment, {
      "KEEP": "yes", "CLAUDE_E2E_BINARY": "", "CODEX_E2E_BINARY": "", "PI_E2E_BINARY": "",
    })

  def test_rejects_wrong_scheme_and_unknown_format(self):
    run = test_run()
    products_tool.test_targets(run)[0]["BlueprintName"] = "supatermTests"
    with self.assertRaisesRegex(ValueError, "only supatermE2E"):
      products_tool.test_targets(run)
    with self.assertRaisesRegex(ValueError, "Unsupported"):
      products_tool.test_targets(test_run(3))

  def test_make_consumer_passes_filters_without_building_or_resolving_tools(self):
    source = self.write_run(test_run())
    bin_dir = self.root / "fake tools"
    bin_dir.mkdir()
    capture = self.root / "arguments.json"
    xcodebuild = bin_dir / "xcodebuild"
    xcodebuild.write_text('#!/usr/bin/env python3\nimport json, os, sys\nwith open(os.environ["CAPTURE"], "w") as f: json.dump(sys.argv[1:], f)\n')
    xcodebuild.chmod(0o755)
    environment = dict(os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", CAPTURE=str(capture))
    for agent in ("CODEX", "CLAUDE", "PI"):
      environment[f"{agent}_E2E_BINARY"] = str(xcodebuild)
    subprocess.run([
      "make", "-C", str(ROOT / "apps/mac"), "test-e2e-xcodebuild", "E2E_AGENT=all",
      f"E2E_XCTESTRUN_PATH={source}",
      "XCODEBUILD_FLAGS=-parallel-testing-enabled NO -only-testing:supatermE2E/CodexE2ETests",
    ], env=environment, check=True, capture_output=True, text=True)
    arguments = json.loads(capture.read_text())
    self.assertEqual(arguments[:3], ["test-without-building", "-xctestrun", f"{source}.runtime.xctestrun"])
    self.assertIn("-only-testing:supatermE2E/CodexE2ETests", arguments)
    self.assertIn("-parallel-testing-enabled", arguments)
    self.assertNotIn("-workspace", arguments)
    self.assertFalse(any("CODEX_E2E_BINARY=" in arg for arg in arguments))
    with Path(arguments[2]).open("rb") as file:
      for target in products_tool.test_targets(plistlib.load(file)):
        for agent in ("CODEX", "CLAUDE", "PI"):
          self.assertEqual(target["EnvironmentVariables"][f"{agent}_E2E_BINARY"], str(xcodebuild))

  def test_make_authenticates_agent_download_without_exposing_token_to_tests(self):
    source = self.write_run(test_run())
    bin_dir = self.root / "fake tools"
    bin_dir.mkdir()
    capture = self.root / "runtime-checked"
    xcodebuild = bin_dir / "xcodebuild"
    xcodebuild.write_text(
      '#!/usr/bin/env python3\nimport os\nfrom pathlib import Path\n'
      'assert "MISE_GITHUB_TOKEN" not in os.environ\n'
      'Path(os.environ["CAPTURE"]).write_text("checked")\n'
    )
    xcodebuild.chmod(0o755)
    mise = bin_dir / "mise"
    mise.write_text(
      '#!/usr/bin/env python3\nimport os\n'
      'assert os.environ["MISE_GITHUB_TOKEN"] == "test-download-token"\n'
      'print(os.environ["FAKE_CODEX_BINARY"])\n'
    )
    mise.chmod(0o755)
    environment = dict(
      os.environ, PATH=f"{bin_dir}:{os.environ['PATH']}", CAPTURE=str(capture),
      FAKE_CODEX_BINARY=str(xcodebuild), MISE_GITHUB_TOKEN="test-download-token",
    )
    environment.pop("CODEX_E2E_BINARY", None)
    subprocess.run([
      "make", "-C", str(ROOT / "apps/mac"), "test-e2e-xcodebuild", "E2E_AGENT=codex",
      f"E2E_XCTESTRUN_PATH={source}",
    ], env=environment, check=True, capture_output=True, text=True)
    self.assertEqual(capture.read_text(), "checked")


if __name__ == "__main__":
  unittest.main()
