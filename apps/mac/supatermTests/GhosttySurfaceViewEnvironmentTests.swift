import AppKit
import Foundation
import GhosttyKit
import Testing

@testable import SupatermCLIShared
@testable import supaterm

@MainActor
struct GhosttySurfaceViewEnvironmentTests {
  @Test
  func directStartupUsesExactArgumentsAndCallerPath() throws {
    initializeGhosttyForTests()
    let secret = "startup-secret-\(UUID().uuidString.lowercased())"
    var command: String?
    var initialInput: String?
    var arguments: [String] = []
    var environment: [String: String] = [:]

    _ = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime("command = /usr/bin/false"),
      tabID: UUID(),
      workingDirectory: nil,
      shellPath: "/bin/bash",
      cliPath: "/usr/bin/true",
      startupCommand: .exec(
        ["tool", "", "two words", "line one\nline two", "$HOME; exit", secret],
        searchPath: "/caller/bin:/usr/bin"
      ),
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, config in
        command = config.pointee.command.map(String.init(cString:))
        initialInput = config.pointee.initial_input.map(String.init(cString:))
        if let commandArguments = config.pointee.command_argv {
          arguments = (0..<config.pointee.command_argv_count).compactMap { index in
            commandArguments[index].map(String.init(cString:))
          }
        }
        if let variables = config.pointee.env_vars {
          for index in 0..<config.pointee.env_var_count {
            let variable = variables[index]
            if let key = variable.key, let value = variable.value {
              environment[String(cString: key)] = String(cString: value)
            }
          }
        }
        return nil
      }
    )

    #expect(command == nil)
    #expect(initialInput == nil)
    #expect(arguments == ["tool", "", "two words", "line one\nline two", "$HOME; exit", secret])
    #expect(environment["PATH"] == "/caller/bin:/usr/bin")
    #expect(!environment.values.contains { $0.contains(secret) })
  }

  @Test
  func shellStartupWaitsForIntegratedShellPrompt() throws {
    initializeGhosttyForTests()
    let runtime = try makeGhosttyRuntime("")
    #expect(runtime.defersInitialInputUntilShellReady(shellPath: "/bin/zsh"))
    #expect(runtime.defersInitialInputUntilShellReady(shellPath: "/opt/homebrew/bin/fish"))
    #expect(!runtime.defersInitialInputUntilShellReady(shellPath: "/bin/bash"))

    let launch = GhosttySurfaceLaunch(
      shellPath: "/bin/zsh",
      startup: .shell("echo ready"),
      defersInputUntilShellReady: true
    )
    var config = ghostty_surface_config_new()
    launch.withConfiguration(&config) { config in
      #expect(config.command.map(String.init(cString:)) == "/bin/zsh")
      #expect(config.command_argv == nil)
      #expect(config.command_argv_count == 0)
      #expect(config.initial_input == nil)
    }
    #expect(config.initial_input == nil)
    #expect(launch.takeDeferredInput() == "echo ready\n")
    #expect(launch.takeDeferredInput() == nil)
  }

  @Test
  func shellStartupPreservesExistingTrailingNewline() {
    let launch = GhosttySurfaceLaunch(
      shellPath: "/bin/zsh",
      startup: .shell("echo ready\n"),
      defersInputUntilShellReady: true
    )

    #expect(launch.takeDeferredInput() == "echo ready\n")
    #expect(launch.takeDeferredInput() == nil)
  }

  @Test
  func shellWithoutPromptReadinessDisplaysAndSourcesPrivateOneShotInput() throws {
    let temporaryDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "supaterm-shell-transport-tests-\(UUID().uuidString.lowercased())",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: temporaryDirectory,
      withIntermediateDirectories: false
    )
    defer { try? FileManager.default.removeItem(at: temporaryDirectory) }
    let script = "echo \(String(repeating: "x", count: 2_048))"
    let launch = GhosttySurfaceLaunch(
      shellPath: "/bin/bash",
      startup: .shell(script),
      temporaryDirectory: temporaryDirectory
    )
    var initialInput: String?
    var config = ghostty_surface_config_new()

    launch.withConfiguration(&config) { config in
      initialInput = config.initial_input.map(String.init(cString:))
    }

    let scriptURLs = try FileManager.default.contentsOfDirectory(
      at: temporaryDirectory,
      includingPropertiesForKeys: nil
    )
    #expect(scriptURLs.count == 1)
    let scriptURL = try #require(scriptURLs.first)
    let attributes = try FileManager.default.attributesOfItem(atPath: scriptURL.path)
    #expect(!launch.preparationFailed)
    #expect(initialInput?.hasPrefix(". ") == true)
    #expect(initialInput?.hasSuffix("/\(scriptURL.lastPathComponent)\n") == true)
    #expect((initialInput?.utf8.count ?? 1_024) < 1_024)
    #expect(initialInput?.contains(script) == false)
    #expect(try String(contentsOf: scriptURL, encoding: .utf8).hasSuffix(script))
    #expect(attributes[FileAttributeKey.posixPermissions] as? Int == 0o600)

    let process = Process()
    let output = Pipe()
    process.executableURL = URL(fileURLWithPath: "/bin/bash")
    process.arguments = ["-c", try #require(initialInput)]
    process.standardOutput = output
    try process.run()
    process.waitUntilExit()

    let displayedText = try #require(
      String(bytes: output.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)
    )
    #expect(process.terminationStatus == 0)
    #expect(displayedText.contains(script))
    #expect(!FileManager.default.fileExists(atPath: scriptURL.path))
  }

  @Test
  func directArgumentPointersStayValidForTheSurfaceCreationCall() {
    let arguments = ["tool", "", "two words", "line one\nline two", "$HOME; exit", "東京"]
    let launch = GhosttySurfaceLaunch(
      shellPath: "/bin/zsh",
      startup: .exec(arguments, searchPath: "/usr/bin:/bin")
    )
    var config = ghostty_surface_config_new()
    var receivedArguments: [String] = []

    launch.withConfiguration(&config) { config in
      guard let commandArguments = config.command_argv else { return }
      receivedArguments = (0..<config.command_argv_count).compactMap { index in
        commandArguments[index].map(String.init(cString:))
      }
    }

    #expect(receivedArguments == arguments)
  }

  @Test
  func disabledShellIntegrationCannotReportPromptReadiness() throws {
    initializeGhosttyForTests()
    let runtime = try makeGhosttyRuntime("shell-integration = none")
    #expect(!runtime.defersInitialInputUntilShellReady(shellPath: "/bin/zsh"))
    #expect(!runtime.defersInitialInputUntilShellReady(shellPath: "/opt/homebrew/bin/fish"))
  }

  @Test
  func directStartupDoesNotRequireTheBundledCLI() throws {
    initializeGhosttyForTests()
    var createdSurface = false
    var arguments: [String] = []

    _ = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime(""),
      tabID: UUID(),
      workingDirectory: nil,
      shellPath: "/bin/zsh",
      cliPath: nil,
      startupCommand: .exec(["pwd"], searchPath: "/usr/bin:/bin"),
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, config in
        createdSurface = true
        if let commandArguments = config.pointee.command_argv {
          arguments = (0..<config.pointee.command_argv_count).compactMap { index in
            commandArguments[index].map(String.init(cString:))
          }
        }
        return nil
      }
    )

    #expect(createdSurface)
    #expect(arguments == ["pwd"])
  }

  @Test
  func invalidStartupDoesNotCreateASurface() throws {
    initializeGhosttyForTests()
    var createdSurface = false

    let surfaceView = GhosttySurfaceView(
      runtime: try makeGhosttyRuntime(""),
      tabID: UUID(),
      workingDirectory: nil,
      shellPath: "/bin/zsh",
      cliPath: nil,
      startupCommand: .exec([], searchPath: "/usr/bin:/bin"),
      context: GHOSTTY_SURFACE_CONTEXT_TAB,
      surfaceFactory: { _, _ in
        createdSurface = true
        return nil
      }
    )

    #expect(!createdSurface)
    #expect(surfaceView.bridge.state.failure == .startupConfigurationFailed)
  }

  @Test
  func directStartupPreservesAnEmptyCallerPath() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp",
      startup: .exec(["tool"], searchPath: ""),
      processEnvironment: ["PATH": "/app/bin"]
    )

    #expect(environmentVariables.last == SupatermCLIEnvironmentVariable(key: "PATH", value: ""))
  }

  @Test
  func supatermEnvironmentVariablesIncludePaneSocketCliAndPrependedPath() {
    let surfaceID = UUID(uuidString: "A72F7A7D-B5E8-497E-A5D5-D26A77A0A4C7")!
    let tabID = UUID(uuidString: "9F4EB4BE-9216-4DCA-A866-C8276D9EF2AA")!
    let path = [
      "/Applications/Supaterm.app/Contents/MacOS",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
    ].joined(separator: ":")
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: surfaceID,
      tabID: tabID,
      socketPath: "/tmp/supaterm.sock",
      cliPath: "/Applications/Supaterm.app/Contents/MacOS/sp",
      processEnvironment: ["PATH": "/usr/local/bin:/usr/bin:/bin"]
    )

    #expect(
      environmentVariables == [
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.surfaceIDKey, value: surfaceID.uuidString),
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.tabIDKey, value: tabID.uuidString),
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.socketPathKey, value: "/tmp/supaterm.sock"),
        SupatermCLIEnvironmentVariable(
          key: SupatermCLIEnvironment.cliPathKey,
          value: "/Applications/Supaterm.app/Contents/MacOS/sp"
        ),
        SupatermCLIEnvironmentVariable(
          key: SessionHostEnvironment.directoryKey,
          value: "/tmp/supaterm-host-\(getuid())"
        ),
        SupatermCLIEnvironmentVariable(key: "PATH", value: path),
      ]
    )
  }

  @Test
  func prependedPathMovesCliDirectoryToFrontWithoutDuplication() {
    #expect(
      GhosttySurfaceView.prependedPath(
        "/Applications/Supaterm.app/Contents/MacOS",
        currentPath: "/usr/local/bin:/Applications/Supaterm.app/Contents/MacOS:/usr/bin"
      ) == "/Applications/Supaterm.app/Contents/MacOS:/usr/local/bin:/usr/bin"
    )
  }

  @Test
  func prependedPathPreservesEmptyComponents() {
    #expect(
      GhosttySurfaceView.prependedPath(
        "/Applications/Supaterm.app/Contents/MacOS",
        currentPath: ":/usr/bin::/Applications/Supaterm.app/Contents/MacOS:"
      ) == "/Applications/Supaterm.app/Contents/MacOS::/usr/bin::"
    )
  }

  @Test
  func cliDirectoryReturnsBundledExecutableDirectory() {
    #expect(
      GhosttySurfaceView.cliDirectory("/Applications/Supaterm.app/Contents/MacOS/sp")
        == "/Applications/Supaterm.app/Contents/MacOS"
    )
  }

  @Test
  func supatermEnvironmentVariablesUseShortSessionHostDirectory() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      processEnvironment: [
        "SUPATERM_HOST_DIR": "/var/folders/" + String(repeating: "a", count: 80),
        "XDG_RUNTIME_DIR": "/var/folders/" + String(repeating: "b", count: 80),
        "TMPDIR": "/var/folders/" + String(repeating: "c", count: 80),
      ]
    )

    #expect(
      environmentVariables.contains(
        SupatermCLIEnvironmentVariable(
          key: SessionHostEnvironment.directoryKey,
          value: "/tmp/supaterm-host-\(getuid())"
        )
      )
    )
  }

  @Test
  func supatermEnvironmentVariablesOmitSessionHostDirectoryWhenSessionHostSessionsAreDisabled() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      sessionPersistenceEnabled: false
    )

    #expect(!environmentVariables.contains { $0.key == SessionHostEnvironment.directoryKey })
  }

  @Test
  func supatermEnvironmentVariablesIncludeStateHomeWhenPresent() {
    let environmentVariables = GhosttySurfaceView.supatermEnvironmentVariables(
      surfaceID: UUID(),
      tabID: UUID(),
      socketPath: nil,
      cliPath: nil,
      processEnvironment: [SupatermCLIEnvironment.stateHomeKey: "/tmp/supaterm-dev"]
    )

    #expect(
      environmentVariables.contains(
        SupatermCLIEnvironmentVariable(key: SupatermCLIEnvironment.stateHomeKey, value: "/tmp/supaterm-dev")
      )
    )
  }

  @Test
  func titleOverrideTreatsEmptyStringAsRestoreDefault() {
    #expect(GhosttySurfaceView.titleOverride(from: "") == nil)
  }

  @Test
  func titleOverridePreservesWhitespaceAndColons() {
    #expect(GhosttySurfaceView.titleOverride(from: "  ") == "  ")
    #expect(GhosttySurfaceView.titleOverride(from: "foo:bar") == "foo:bar")
  }

  @Test
  func workingDirectoryPathNormalizesRepeatedAndTrailingSeparators() {
    #expect(
      GhosttySurfaceView.normalizedWorkingDirectoryPath("/tmp//project///src/")
        == "/tmp/project/src"
    )
    #expect(GhosttySurfaceView.normalizedWorkingDirectoryPath("/") == "/")
  }

  @Test
  func scrollOnFocusedSurfaceCountsAsDirectInteraction() throws {
    initializeGhosttyForTests()

    let runtime = GhosttyRuntime()
    let view = GhosttySurfaceView(
      runtime: runtime,
      tabID: UUID(),
      workingDirectory: nil,
      context: GHOSTTY_SURFACE_CONTEXT_TAB
    )
    var interactionCount = 0
    view.onDirectInteraction = {
      interactionCount += 1
    }
    view.focusDidChange(true)
    let cgEvent = try #require(
      CGEvent(
        scrollWheelEvent2Source: nil,
        units: .pixel,
        wheelCount: 1,
        wheel1: 1,
        wheel2: 0,
        wheel3: 0
      )
    )
    let scrollEvent = try #require(NSEvent(cgEvent: cgEvent))

    view.scrollWheel(with: scrollEvent)

    #expect(interactionCount == 1)
  }
}
