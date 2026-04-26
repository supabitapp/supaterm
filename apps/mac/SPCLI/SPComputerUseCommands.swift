import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct ComputerUse: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "computer-use",
      abstract: "Control apps through macOS computer use.",
      discussion: SPHelp.computerUseDiscussion,
      subcommands: [
        ComputerUsePermissions.self,
        ComputerUseApps.self,
        ComputerUseLaunch.self,
        ComputerUseWindows.self,
        ComputerUseSnapshot.self,
        ComputerUseClick.self,
        ComputerUseType.self,
        ComputerUseKey.self,
        ComputerUseScroll.self,
        ComputerUseSetValue.self,
        ComputerUsePage.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }
}

extension SP {
  struct ComputerUsePermissions: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "permissions",
      abstract: "Show computer-use permission status."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUsePermissionsResult = try computerUseResult(
        .computerUsePermissions(),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: "\(result.accessibility.rawValue)\t\(result.screenRecording.rawValue)",
        human: """
          Accessibility: \(result.accessibility.rawValue)
          Screen Recording: \(result.screenRecording.rawValue)
          """
      )
    }
  }

  struct ComputerUseApps: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "apps",
      abstract: "List running GUI apps."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseAppsResult = try computerUseResult(.computerUseApps(), options: options)
      try emitCommandResult(
        result,
        options: options.output,
        plain: result.apps.map { "\($0.pid)\t\($0.bundleID ?? "")\t\($0.name)" }.joined(separator: "\n"),
        human: result.apps.map { "\($0.pid)  \($0.name)  \($0.bundleID ?? "-")" }.joined(separator: "\n")
      )
    }
  }

  struct ComputerUseLaunch: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "launch",
      abstract: "Launch an app in the background."
    )

    @Option(name: .customLong("bundle-id"), help: "Bundle ID to launch.")
    var bundleID: String?

    @Option(name: .long, help: "Application name to launch.")
    var name: String?

    @Option(name: .long, help: "URL or file path to hand to the app.")
    var url: [String] = []

    @Option(name: .long, help: "Argument passed to the app.")
    var argument: [String] = []

    @Option(name: .long, help: "Environment override in KEY=VALUE form.")
    var env: [ComputerUseEnvironmentArgument] = []

    @Option(name: .customLong("electron-debugging-port"), help: "Launch Electron with --remote-debugging-port.")
    var electronDebuggingPort: Int?

    @Option(name: .customLong("webkit-inspector-port"), help: "Launch WKWebView/Tauri with WEBKIT_INSPECTOR_SERVER.")
    var webkitInspectorPort: Int?

    @Flag(name: .customLong("new-instance"), help: "Create a new app instance.")
    var createsNewInstance = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if bundleID == nil && name == nil {
        throw ValidationError("Provide --bundle-id or --name.")
      }
      try validatePort(electronDebuggingPort, name: "--electron-debugging-port")
      try validatePort(webkitInspectorPort, name: "--webkit-inspector-port")
    }

    mutating func run() throws {
      let result: SupatermComputerUseLaunchResult = try computerUseResult(
        .computerUseLaunch(
          .init(
            bundleID: bundleID,
            name: name,
            urls: url,
            arguments: argument,
            environment: Dictionary(uniqueKeysWithValues: env.map { ($0.key, $0.value) }),
            electronDebuggingPort: electronDebuggingPort,
            webkitInspectorPort: webkitInspectorPort,
            createsNewInstance: createsNewInstance
          )
        ),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: "\(result.pid)\t\(result.bundleID ?? "")\t\(result.name)",
        human: "\(result.pid)  \(result.name)  \(result.bundleID ?? "-")"
      )
    }
  }

  struct ComputerUseWindows: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "windows",
      abstract: "List app windows."
    )

    @Option(name: .long, help: "Filter by bundle ID, app name, or pid.")
    var app: String?

    @Flag(name: .customLong("on-screen-only"), help: "Only include on-screen windows.")
    var onScreenOnly = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseWindowsResult = try computerUseResult(
        .computerUseWindows(.init(app: app, onScreenOnly: onScreenOnly)),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: result.windows.map { "\($0.id)\t\($0.pid)\t\($0.appName)\t\($0.title ?? "")" }.joined(separator: "\n"),
        human: result.windows.map { "\($0.id)  pid \($0.pid)  \($0.appName)  \($0.title ?? "-")" }
          .joined(separator: "\n")
      )
    }
  }

  struct ComputerUseSnapshot: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "snapshot",
      abstract: "Capture a window snapshot and element list."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID from `sp computer-use windows`.")
    var window: UInt32

    @Option(name: .customLong("image-out"), help: "Write a PNG screenshot to this path.")
    var imageOutputPath: String?

    @Option(name: .long, help: "Filter returned elements without changing indices.")
    var query: String?

    @Option(name: .long, help: "Snapshot mode.")
    var mode: SupatermComputerUseSnapshotMode?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseSnapshotResult = try computerUseResult(
        .computerUseSnapshot(
          .init(
            pid: pid,
            windowID: window,
            imageOutputPath: imageOutputPath,
            query: query,
            mode: mode
          )
        ),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: result.elements.map { "\($0.elementIndex)\t\($0.role)\t\($0.displayText ?? "")" }
          .joined(separator: "\n"),
        human: "Snapshot \(result.windowID): \(result.elements.count) elements"
      )
    }
  }

  struct ComputerUseClick: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "click",
      abstract: "Click an element or coordinate."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int?

    @Option(name: .long, help: "Window screenshot x coordinate.")
    var x: Double?

    @Option(name: .long, help: "Window screenshot y coordinate.")
    var y: Double?

    @Option(name: .long, help: "Mouse button.")
    var button: SupatermComputerUseClickButton = .left

    @Option(name: .long, help: "Click count.")
    var count = 1

    @Option(name: .long, help: "Click modifier.")
    var modifier: [SupatermComputerUseClickModifier] = []

    @Option(name: .long, help: "Element action.")
    var action: SupatermComputerUseClickAction = .press

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if element == nil && (x == nil || y == nil) {
        throw ValidationError("Provide --element or both --x and --y.")
      }
      if element != nil && (x != nil || y != nil) {
        throw ValidationError("--element cannot be combined with --x or --y.")
      }
      if !(1...3).contains(count) {
        throw ValidationError("--count must be between 1 and 3.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseClick(
          .init(
            pid: pid,
            windowID: window,
            elementIndex: element,
            x: x,
            y: y,
            button: button,
            count: count,
            modifiers: modifier,
            action: action
          )
        ),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUseType: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "type",
      abstract: "Type text into an app."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32?

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int?

    @Option(name: .customLong("delay-ms"), help: "Delay between fallback characters.")
    var delayMilliseconds = 30

    @Argument(help: "Text to type.")
    var text: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if element != nil && window == nil {
        throw ValidationError("--window is required with --element.")
      }
      if !(0...200).contains(delayMilliseconds) {
        throw ValidationError("--delay-ms must be between 0 and 200.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseType(
          .init(
            pid: pid,
            windowID: window,
            elementIndex: element,
            text: text,
            delayMilliseconds: delayMilliseconds
          )
        ),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUseKey: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "key",
      abstract: "Send a key press to an app."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32?

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int?

    @Option(name: .long, help: "Modifier: command, shift, option, control.")
    var modifier: [SupatermComputerUseKeyModifier] = []

    @Argument(help: "Key name or single character.")
    var key: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if element != nil && window == nil {
        throw ValidationError("--window is required with --element.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseKey(.init(pid: pid, windowID: window, elementIndex: element, key: key, modifiers: modifier)),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUseScroll: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "scroll",
      abstract: "Scroll a window."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int?

    @Option(name: .long, help: "Scroll direction.")
    var direction: SupatermComputerUseScrollDirection

    @Option(name: .long, help: "Scroll unit.")
    var unit: SupatermComputerUseScrollUnit = .line

    @Option(name: .long, help: "Scroll amount in lines.")
    var amount = 5

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseScroll(
          .init(
            pid: pid,
            windowID: window,
            elementIndex: element,
            direction: direction,
            unit: unit,
            amount: amount
          )
        ),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUseSetValue: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "set-value",
      abstract: "Set an accessibility element value."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int

    @Argument(help: "Value to set.")
    var value: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseSetValue(.init(pid: pid, windowID: window, elementIndex: element, value: value)),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUsePage: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "page",
      abstract: "Read and operate browser page content.",
      discussion: SPHelp.computerUsePageDiscussion,
      subcommands: [
        ComputerUsePageGetText.self,
        ComputerUsePageQueryDOM.self,
        ComputerUsePageExecuteJavaScript.self,
        ComputerUsePageEnableJavaScriptAppleEvents.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ComputerUsePageGetText: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "get-text",
      abstract: "Read text from a browser page."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUsePageResult = try computerUseResult(
        .computerUsePage(.init(pid: pid, windowID: window, action: .getText)),
        options: options
      )
      try emitPageResult(result, options: options.output)
    }
  }

  struct ComputerUsePageQueryDOM: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "query-dom",
      abstract: "Query browser page elements with a CSS selector."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Option(name: .long, help: "CSS selector.")
    var selector: String

    @Option(name: .long, help: "Attribute to include in each result.")
    var attribute: [String] = []

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUsePageResult = try computerUseResult(
        .computerUsePage(
          .init(
            pid: pid,
            windowID: window,
            action: .queryDOM,
            cssSelector: selector,
            attributes: attribute
          )
        ),
        options: options
      )
      try emitPageResult(result, options: options.output)
    }
  }

  struct ComputerUsePageExecuteJavaScript: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "execute-javascript",
      abstract: "Run JavaScript in a browser page."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Argument(help: "JavaScript to execute.")
    var javascript: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUsePageResult = try computerUseResult(
        .computerUsePage(
          .init(
            pid: pid,
            windowID: window,
            action: .executeJavaScript,
            javascript: javascript
          )
        ),
        options: options
      )
      try emitPageResult(result, options: options.output)
    }
  }

  struct ComputerUsePageEnableJavaScriptAppleEvents: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "enable-javascript-apple-events",
      abstract: "Enable browser JavaScript from Apple Events."
    )

    @Option(name: .long, help: "Browser to configure: chrome or safari.")
    var browser: SupatermComputerUsePageBrowser

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUsePageResult = try computerUseResult(
        .computerUsePage(
          .init(
            action: .enableJavaScriptAppleEvents,
            browser: browser
          )
        ),
        options: options
      )
      try emitPageResult(result, options: options.output)
    }
  }
}

extension SupatermComputerUseClickButton: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseClickAction: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseKeyModifier: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseSnapshotMode: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseScrollDirection: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseScrollUnit: @retroactive ExpressibleByArgument {}
extension SupatermComputerUsePageBrowser: @retroactive ExpressibleByArgument {}

extension SupatermComputerUseClickModifier: @retroactive ExpressibleByArgument {
  public init?(argument: String) {
    switch argument.lowercased() {
    case "command", "cmd":
      self = .command
    case "shift":
      self = .shift
    case "option", "alt", "opt":
      self = .option
    case "control", "ctrl":
      self = .control
    case "function", "fn":
      self = .function
    default:
      return nil
    }
  }
}

struct ComputerUseEnvironmentArgument: ExpressibleByArgument {
  let key: String
  let value: String

  init?(argument: String) {
    guard let separator = argument.firstIndex(of: "="), separator > argument.startIndex else {
      return nil
    }
    key = String(argument[..<separator])
    value = String(argument[argument.index(after: separator)...])
  }
}

private func computerUseResult<T: Decodable>(
  _ request: SupatermSocketRequest,
  options: SPCommandOptions
) throws -> T {
  applyOutputStyle(options.output)
  let client = try socketClient(
    path: options.connection.explicitSocketPath,
    instance: options.connection.instance
  )
  let response = try client.send(request)
  guard response.ok else {
    try emitComputerUseErrorResponse(response, options: options.output)
    throw ExitCode.failure
  }
  return try response.decodeResult(T.self)
}

private func emitComputerUseErrorResponse(
  _ response: SupatermSocketResponse,
  options: SPOutputOptions
) throws {
  guard !options.quiet else { return }
  switch options.mode {
  case .json:
    print(try jsonString(response))
  case .plain, .human:
    let message = response.error?.message ?? "Supaterm socket request failed."
    FileHandle.standardError.write(Data((message + "\n").utf8))
  }
}

private func emitActionResult(
  _ result: SupatermComputerUseActionResult,
  options: SPOutputOptions
) throws {
  try emitCommandResult(
    result,
    options: options,
    plain: result.dispatch,
    human: result.ok ? "OK (\(result.dispatch))" : "Failed (\(result.dispatch))"
  )
}

private func emitPageResult(
  _ result: SupatermComputerUsePageResult,
  options: SPOutputOptions
) throws {
  let plain = try result.text ?? result.json?.stableJSONString() ?? ""
  try emitCommandResult(
    result,
    options: options,
    plain: plain,
    human: plain.isEmpty ? result.dispatch : plain
  )
}

private func validatePort(_ port: Int?, name: String) throws {
  guard let port else { return }
  if !(1...65_535).contains(port) {
    throw ValidationError("\(name) must be between 1 and 65535.")
  }
}
