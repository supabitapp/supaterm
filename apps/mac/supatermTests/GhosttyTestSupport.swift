import Foundation
import GhosttyKit

@testable import supaterm

private let ghosttyInitializedForTests: Void = {
  let macRootURL =
    URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent()
    .deletingLastPathComponent()
  let ghosttyResourcesURL = macRootURL.appendingPathComponent(".build/ghostty/share/ghostty", isDirectory: true)
  let terminfoURL = macRootURL.appendingPathComponent(".build/ghostty/share/terminfo", isDirectory: true)
  setenv("GHOSTTY_RESOURCES_DIR", ghosttyResourcesURL.path, 1)
  setenv("TERMINFO_DIRS", terminfoURL.path, 1)

  let argc = UInt(1)
  let argv0 = strdup("supaterm-tests")
  defer {
    free(argv0)
  }
  let argv = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(capacity: 2)
  argv.initialize(to: argv0)
  argv.advanced(by: 1).initialize(to: nil)
  defer {
    argv.advanced(by: 1).deinitialize(count: 1)
    argv.deinitialize(count: 1)
    argv.deallocate()
  }

  let result = ghostty_init(argc, argv)
  precondition(result == GHOSTTY_SUCCESS)
}()

func initializeGhosttyForTests() {
  _ = ghosttyInitializedForTests
}

func makeGhosttyRuntime(_ config: String) throws -> GhosttyRuntime {
  initializeGhosttyForTests()
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString)
    .appendingPathExtension("ghostty")
  try config.write(to: url, atomically: true, encoding: .utf8)
  defer {
    try? FileManager.default.removeItem(at: url)
  }
  return GhosttyRuntime(configPath: url.path)
}
