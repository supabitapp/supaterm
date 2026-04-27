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
        ComputerUseScreenSize.self,
        ComputerUseCursor.self,
        ComputerUseLaunch.self,
        ComputerUseWindows.self,
        ComputerUseSnapshot.self,
        ComputerUseScreenshot.self,
        ComputerUseZoom.self,
        ComputerUseClick.self,
        ComputerUseType.self,
        ComputerUseTypeChars.self,
        ComputerUseKey.self,
        ComputerUseHotkey.self,
        ComputerUseScroll.self,
        ComputerUseSetValue.self,
        ComputerUsePage.self,
        ComputerUseRecording.self,
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

  struct ComputerUseScreenSize: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "screen-size",
      abstract: "Show the main display size."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseScreenSizeResult = try computerUseResult(
        .computerUseScreenSize(),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: "\(result.width)\t\(result.height)\t\(result.scale)",
        human: "\(Int(result.width)) x \(Int(result.height)) @\(result.scale)x"
      )
    }
  }

  struct ComputerUseCursor: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "cursor",
      abstract: "Inspect and configure the agent cursor.",
      subcommands: [
        ComputerUseCursorPosition.self,
        ComputerUseCursorMove.self,
        ComputerUseCursorState.self,
        ComputerUseCursorSet.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ComputerUseCursorPosition: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "position",
      abstract: "Show the cursor position."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseCursorPositionResult = try computerUseResult(
        .computerUseCursorPosition(),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: "\(result.x)\t\(result.y)",
        human: "\(Int(result.x)), \(Int(result.y))"
      )
    }
  }

  struct ComputerUseCursorMove: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "move",
      abstract: "Move the system cursor."
    )

    @Option(name: .long, help: "Screen x coordinate.")
    var x: Double

    @Option(name: .long, help: "Screen y coordinate.")
    var y: Double

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseMoveCursor(.init(x: x, y: y)),
        options: options
      )
      try emitActionResult(result, options: options.output)
    }
  }

  struct ComputerUseCursorState: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "state",
      abstract: "Show agent cursor settings."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseCursorResult = try computerUseResult(
        .computerUseCursorState(),
        options: options
      )
      try emitCursorResult(result, options: options.output)
    }
  }

  struct ComputerUseCursorSet: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "set",
      abstract: "Update agent cursor settings."
    )

    @Flag(name: .customLong("enable"), help: "Show the agent cursor.")
    var enable = false

    @Flag(name: .customLong("disable"), help: "Hide the agent cursor.")
    var disable = false

    @Flag(name: .customLong("always-float"), help: "Keep the cursor overlay above all windows.")
    var alwaysFloat = false

    @Flag(name: .customLong("normal-level"), help: "Pin the cursor overlay near the target window.")
    var normalLevel = false

    @Option(name: .customLong("start-handle"), help: "Bezier start handle.")
    var startHandle: Double?

    @Option(name: .customLong("end-handle"), help: "Bezier end handle.")
    var endHandle: Double?

    @Option(name: .customLong("arc-size"), help: "Bezier arc size in points.")
    var arcSize: Double?

    @Option(name: .customLong("arc-flow"), help: "Bezier arc flow multiplier.")
    var arcFlow: Double?

    @Option(name: .long, help: "Spring overshoot.")
    var spring: Double?

    @Option(name: .customLong("glide-ms"), help: "Cursor glide duration.")
    var glideMilliseconds: Int?

    @Option(name: .customLong("dwell-ms"), help: "Post-click dwell duration.")
    var dwellMilliseconds: Int?

    @Option(name: .customLong("idle-hide-ms"), help: "Idle hide duration.")
    var idleHideMilliseconds: Int?

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if enable && disable {
        throw ValidationError("--enable cannot be combined with --disable.")
      }
      if alwaysFloat && normalLevel {
        throw ValidationError("--always-float cannot be combined with --normal-level.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseCursorResult = try computerUseResult(
        .computerUseCursorSet(
          .init(
            enabled: enable ? true : disable ? false : nil,
            alwaysFloat: alwaysFloat ? true : normalLevel ? false : nil,
            startHandle: startHandle,
            endHandle: endHandle,
            arcSize: arcSize,
            arcFlow: arcFlow,
            spring: spring,
            glideDurationMilliseconds: glideMilliseconds,
            dwellAfterClickMilliseconds: dwellMilliseconds,
            idleHideMilliseconds: idleHideMilliseconds
          )
        ),
        options: options
      )
      try emitCursorResult(result, options: options.output)
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

    @Option(name: .long, help: "JavaScript to run with the snapshot.")
    var javascript: String?

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
            mode: mode,
            javascript: javascript
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

  struct ComputerUseScreenshot: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "screenshot",
      abstract: "Capture a screenshot."
    )

    @Option(name: .long, help: "Window ID to capture.")
    var window: UInt32?

    @Option(name: .customLong("image-out"), help: "Output path.")
    var imageOutputPath: String

    @Option(name: .long, help: "Image format.")
    var format: SupatermComputerUseImageFormat = .png

    @Option(name: .long, help: "JPEG quality from 0 to 1.")
    var quality: Double?

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if let quality, !(0...1).contains(quality) {
        throw ValidationError("--quality must be between 0 and 1.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseScreenshot = try computerUseResult(
        .computerUseScreenshot(
          .init(
            windowID: window,
            imageOutputPath: imageOutputPath,
            format: format,
            quality: quality
          )
        ),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: result.path ?? "",
        human: result.path ?? "Captured"
      )
    }
  }

  struct ComputerUseZoom: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "zoom",
      abstract: "Crop a native-resolution region from a window."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32

    @Option(name: .long, help: "Snapshot x coordinate.")
    var x: Double

    @Option(name: .long, help: "Snapshot y coordinate.")
    var y: Double

    @Option(name: .long, help: "Snapshot region width.")
    var width: Double

    @Option(name: .long, help: "Snapshot region height.")
    var height: Double

    @Option(name: .customLong("image-out"), help: "Output PNG path.")
    var imageOutputPath: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if width <= 0 || height <= 0 {
        throw ValidationError("--width and --height must be positive.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseZoomResult = try computerUseResult(
        .computerUseZoom(
          .init(
            pid: pid,
            windowID: window,
            x: x,
            y: y,
            width: width,
            height: height,
            imageOutputPath: imageOutputPath
          )
        ),
        options: options
      )
      try emitCommandResult(
        result,
        options: options.output,
        plain: result.screenshot.path ?? "",
        human: result.screenshot.path ?? "Zoom captured"
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

    @Flag(name: .customLong("from-zoom"), help: "Interpret coordinates inside the latest zoom crop.")
    var fromZoom = false

    @Option(name: .customLong("debug-image-out"), help: "Write a click marker debug image.")
    var debugImageOutputPath: String?

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if element == nil && (x == nil || y == nil) {
        throw ValidationError("Provide --element or both --x and --y.")
      }
      if element != nil && (x != nil || y != nil) {
        throw ValidationError("--element cannot be combined with --x or --y.")
      }
      if element != nil && debugImageOutputPath != nil {
        throw ValidationError("--debug-image-out requires coordinate click.")
      }
      if fromZoom && debugImageOutputPath != nil {
        throw ValidationError("--from-zoom cannot be combined with --debug-image-out.")
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
            action: action,
            fromZoom: fromZoom,
            debugImageOutputPath: debugImageOutputPath
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

  struct ComputerUseTypeChars: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "type-chars",
      abstract: "Type text as raw key events."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .customLong("delay-ms"), help: "Delay between characters.")
    var delayMilliseconds = 30

    @Argument(help: "Text to type.")
    var text: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if !(0...200).contains(delayMilliseconds) {
        throw ValidationError("--delay-ms must be between 0 and 200.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseType(
          .init(
            pid: pid,
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

  struct ComputerUseHotkey: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "hotkey",
      abstract: "Send a key combo to an app."
    )

    @Option(name: .long, help: "Target process ID.")
    var pid: Int

    @Option(name: .long, help: "Target window ID.")
    var window: UInt32?

    @Option(name: .long, help: "Element index from `snapshot`.")
    var element: Int?

    @Argument(help: "Combo such as command+shift+p.")
    var combo: String

    @OptionGroup
    var options: SPCommandOptions

    mutating func validate() throws {
      if element != nil && window == nil {
        throw ValidationError("--window is required with --element.")
      }
    }

    mutating func run() throws {
      let result: SupatermComputerUseActionResult = try computerUseResult(
        .computerUseHotkey(.init(pid: pid, windowID: window, elementIndex: element, keys: [combo])),
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

    @Option(name: .long, help: "Browser to configure: chrome, brave, edge, or safari.")
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

  struct ComputerUseRecording: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "recording",
      abstract: "Record, replay, and render computer-use actions.",
      subcommands: [
        ComputerUseRecordingStart.self,
        ComputerUseRecordingStop.self,
        ComputerUseRecordingStatus.self,
        ComputerUseRecordingReplay.self,
        ComputerUseRecordingRender.self,
      ]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct ComputerUseRecordingStart: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "start",
      abstract: "Start recording computer-use actions."
    )

    @Option(name: .long, help: "Recording directory.")
    var directory: String?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseRecordingResult = try computerUseResult(
        .computerUseRecording(.init(action: .start, directory: directory)),
        options: options
      )
      try emitRecordingResult(result, options: options.output)
    }
  }

  struct ComputerUseRecordingStop: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "stop",
      abstract: "Stop recording computer-use actions."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseRecordingResult = try computerUseResult(
        .computerUseRecording(.init(action: .stop)),
        options: options
      )
      try emitRecordingResult(result, options: options.output)
    }
  }

  struct ComputerUseRecordingStatus: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "status",
      abstract: "Show recording status."
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseRecordingResult = try computerUseResult(
        .computerUseRecording(.init(action: .status)),
        options: options
      )
      try emitRecordingResult(result, options: options.output)
    }
  }

  struct ComputerUseRecordingReplay: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "replay",
      abstract: "Replay recorded actions."
    )

    @Option(name: .long, help: "Recording directory.")
    var directory: String

    @Option(name: .customLong("delay-ms"), help: "Delay between turns.")
    var delayMilliseconds = 120

    @Flag(name: .customLong("keep-going"), help: "Continue after replay failures.")
    var keepGoing = false

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseRecordingResult = try computerUseResult(
        .computerUseRecording(
          .init(
            action: .replay,
            directory: directory,
            delayMilliseconds: delayMilliseconds,
            keepGoing: keepGoing
          )
        ),
        options: options
      )
      try emitRecordingResult(result, options: options.output)
    }
  }

  struct ComputerUseRecordingRender: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "render",
      abstract: "Render recorded screenshots to MP4."
    )

    @Option(name: .long, help: "Recording directory.")
    var directory: String

    @Option(name: .customLong("output"), help: "Output MP4 path.")
    var outputPath: String?

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      let result: SupatermComputerUseRecordingResult = try computerUseResult(
        .computerUseRecording(
          .init(
            action: .render,
            directory: directory,
            outputPath: outputPath
          )
        ),
        options: options
      )
      try emitRecordingResult(result, options: options.output)
    }
  }
}

extension SupatermComputerUseClickButton: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseClickAction: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseSnapshotMode: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseScrollDirection: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseScrollUnit: @retroactive ExpressibleByArgument {}
extension SupatermComputerUsePageBrowser: @retroactive ExpressibleByArgument {}
extension SupatermComputerUseImageFormat: @retroactive ExpressibleByArgument {}

extension SupatermComputerUseKeyModifier: @retroactive ExpressibleByArgument {
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

private func emitCursorResult(
  _ result: SupatermComputerUseCursorResult,
  options: SPOutputOptions
) throws {
  let human =
    "enabled=\(result.enabled) always_float=\(result.alwaysFloat) glide_ms=\(result.motion.glideDurationMilliseconds)"
  try emitCommandResult(
    result,
    options: options,
    plain: human,
    human: human
  )
}

private func emitRecordingResult(
  _ result: SupatermComputerUseRecordingResult,
  options: SPOutputOptions
) throws {
  let parts = [
    "active=\(result.active)",
    "turns=\(result.turns)",
    result.directory.map { "directory=\($0)" },
    result.renderedPath.map { "rendered=\($0)" },
  ]
  .compactMap(\.self)
  .joined(separator: " ")
  try emitCommandResult(
    result,
    options: options,
    plain: parts,
    human: parts
  )
}

private func validatePort(_ port: Int?, name: String) throws {
  guard let port else { return }
  if !(1...65_535).contains(port) {
    throw ValidationError("\(name) must be between 1 and 65535.")
  }
}
