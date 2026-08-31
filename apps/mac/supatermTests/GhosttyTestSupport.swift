import AppKit
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
  _ = NSApplication.shared
  _ = ghosttyInitializedForTests
}

@MainActor
func makeFindPasteboard(_ string: String? = nil) -> NSPasteboard {
  let pasteboard = NSPasteboard(name: NSPasteboard.Name("supaterm-find-\(UUID().uuidString)"))
  replaceFindPasteboard(pasteboard, with: string)
  return pasteboard
}

@MainActor
func replaceFindPasteboard(_ pasteboard: NSPasteboard, with string: String?) {
  pasteboard.clearContents()
  if let string {
    _ = pasteboard.setString(string, forType: .string)
  }
}

func withStartSearchAction<T>(
  needle: String?,
  _ body: (ghostty_action_s) -> T
) -> T {
  var action = ghostty_action_s(tag: GHOSTTY_ACTION_START_SEARCH, action: ghostty_action_u())
  guard let needle else { return body(action) }
  return needle.withCString { pointer in
    action.action.start_search.needle = pointer
    return body(action)
  }
}

func withConfigChangeAction<T>(
  _ source: String,
  _ body: (ghostty_action_s) -> T
) throws -> T {
  try withGhosttyConfig(source) { config in
    var action = ghostty_action_s(tag: GHOSTTY_ACTION_CONFIG_CHANGE, action: ghostty_action_u())
    action.action.config_change.config = config
    return body(action)
  }
}

func ghosttyColorChangeAction(
  kind: ghostty_action_color_kind_e,
  red: UInt8,
  green: UInt8,
  blue: UInt8
) -> ghostty_action_s {
  var action = ghostty_action_s(tag: GHOSTTY_ACTION_COLOR_CHANGE, action: ghostty_action_u())
  action.action.color_change = ghostty_action_color_change_s(
    kind: kind,
    r: red,
    g: green,
    b: blue
  )
  return action
}

func ghosttySurfaceTarget() -> ghostty_target_s {
  ghostty_target_s(tag: GHOSTTY_TARGET_SURFACE, target: ghostty_target_u())
}

func makeGhosttyRuntime(
  _ config: String,
  applicationIsActive: () -> Bool = { NSApp.isActive },
  pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard? = {
    NSPasteboard.ghostty($0)
  },
  effectiveAppearanceObserver: GhosttyEffectiveAppearance.Observer? = nil
) throws -> GhosttyRuntime {
  try withGhosttyConfigFile(config) { url in
    GhosttyRuntime(
      configPath: url.path,
      applicationIsActive: applicationIsActive,
      pasteboardProvider: pasteboardProvider,
      effectiveAppearanceObserver: effectiveAppearanceObserver
    )
  }
}

private func withGhosttyConfig<T>(
  _ source: String,
  _ body: (ghostty_config_t) -> T
) throws -> T {
  try withGhosttyConfigFile(source) { url in
    guard let config = ghostty_config_new() else {
      preconditionFailure("ghostty_config_new failed")
    }
    defer {
      ghostty_config_free(config)
    }
    ghostty_config_load_file(config, url.path)
    ghostty_config_load_recursive_files(config)
    ghostty_config_finalize(config)
    return body(config)
  }
}

private func withGhosttyConfigFile<T>(
  _ source: String,
  _ body: (URL) throws -> T
) throws -> T {
  let url = try writeGhosttyConfigFile(source)
  defer {
    try? FileManager.default.removeItem(at: url)
  }
  return try body(url)
}

private func writeGhosttyConfigFile(_ source: String) throws -> URL {
  initializeGhosttyForTests()
  let url = FileManager.default.temporaryDirectory
    .appendingPathComponent(UUID().uuidString)
    .appendingPathExtension("ghostty")
  try source.write(to: url, atomically: true, encoding: .utf8)
  return url
}

struct GhosttyRuntimeFixture {
  let cleanup: () -> Void
  let configURL: URL
  let runtime: GhosttyRuntime
}

func makePersistentGhosttyRuntime(_ config: String) throws -> GhosttyRuntimeFixture {
  let url = try writeGhosttyConfigFile(config)
  return GhosttyRuntimeFixture(
    cleanup: {
      try? FileManager.default.removeItem(at: url)
    },
    configURL: url,
    runtime: GhosttyRuntime(configPath: url.path)
  )
}
