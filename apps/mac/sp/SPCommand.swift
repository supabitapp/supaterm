import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

public struct SP: ParsableCommand {
  public static let configuration = CommandConfiguration(
    commandName: "sp",
    abstract: "Supaterm pane command-line interface.",
    discussion: SPHelp.rootDiscussion,
    subcommands: [Tree.self, Onboard.self, Debug.self, Instances.self, NewPane.self]
  )

  public init() {}

  public mutating func run() throws {
    print(Self.helpMessage())
  }
}

extension SP {
  struct Tree: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "tree",
      abstract: "Show the current Supaterm window, space, tab, and pane tree."
    )

    @Flag(name: .long, help: "Print the tree as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.tree())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermTreeSnapshot.self)
      if json {
        print(try jsonString(snapshot))
      } else {
        print(SPTreeRenderer.render(snapshot))
      }
    }
  }

  struct Onboard: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "onboard",
      abstract: "Show Supaterm's core onboarding shortcuts."
    )

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.onboarding())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermOnboardingSnapshot.self)
      print(SPOnboardingRenderer.render(snapshot))
    }
  }

  struct Debug: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "debug",
      abstract: "Show live Supaterm diagnostics for the current application."
    )

    @Flag(name: .long, help: "Print the report as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    mutating func run() throws {
      let context = SupatermCLIContext.current
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: connection.explicitSocketPath,
        instance: connection.instance,
        alwaysDiscover: true
      )
      var problems: [String] = []
      var socketStatus = SPDebugReport.Socket(
        path: diagnostics.resolvedTarget?.path,
        isReachable: false,
        requestSucceeded: false,
        error: nil
      )
      var appSnapshot: SupatermAppDebugSnapshot?

      if let resolvedTarget = diagnostics.resolvedTarget {
        do {
          let client = try SPSocketClient(path: resolvedTarget.path)
          let response = try client.send(
            .debug(.init(context: context))
          )
          socketStatus.isReachable = true

          if response.ok {
            do {
              appSnapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
              socketStatus.requestSucceeded = true
            } catch {
              let message = error.localizedDescription
              socketStatus.error = message
              problems.append(message)
            }
          } else {
            let message = response.error?.message ?? "Supaterm socket request failed."
            socketStatus.error = message
            problems.append(message)
          }
        } catch {
          let message = error.localizedDescription
          socketStatus.error = message
          problems.append(message)
        }
      } else {
        let message = diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path."
        socketStatus.error = message
        problems.append(message)
      }

      let report = SPDebugReport(
        invocation: .init(
          isRunningInsideSupaterm: context != nil,
          context: context,
          explicitSocketPath: diagnostics.explicitSocketPath,
          environmentSocketPath: diagnostics.environmentSocketPath,
          requestedInstance: diagnostics.requestedInstance,
          selectionSource: SPSocketSelection.selectionSourceDescription(
            diagnostics.resolvedTarget?.source
          ),
          resolvedSocketPath: diagnostics.resolvedTarget?.path
        ),
        discovery: .init(
          reachableInstances: diagnostics.discoveredEndpoints,
          removedStalePaths: diagnostics.removedStalePaths
        ),
        socket: socketStatus,
        app: appSnapshot,
        problems: problems
      )

      if json {
        print(try jsonString(report))
      } else {
        print(SPDebugRenderer.render(report))
      }

      if !socketStatus.requestSucceeded {
        throw ExitCode.failure
      }
    }
  }

  struct Instances: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "instances",
      abstract: "List reachable Supaterm instances."
    )

    @Flag(name: .long, help: "Print the instances as JSON.")
    var json = false

    mutating func run() throws {
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: nil,
        instance: nil,
        alwaysDiscover: true
      )
      let endpoints = diagnostics.discoveredEndpoints
      if json {
        print(try jsonString(endpoints))
        return
      }

      guard !endpoints.isEmpty else {
        throw ValidationError("No reachable Supaterm instances were found.")
      }

      print(endpoints.map(SPSocketSelection.formatEndpoint).joined(separator: "\n"))
    }
  }

  struct NewPane: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "new-pane",
      abstract: "Create a new pane beside an existing Supaterm pane.",
      discussion: SPHelp.newPaneDiscussion
    )

    enum PaneDirectionArgument: String, CaseIterable, ExpressibleByArgument {
      case down
      case left
      case right
      case up

      var direction: SupatermPaneDirection {
        switch self {
        case .down:
          return .down
        case .left:
          return .left
        case .right:
          return .right
        case .up:
          return .up
        }
      }
    }

    @Argument(help: "Direction for the new pane.")
    var direction: PaneDirectionArgument = .right

    @Option(name: .long, help: "Target a pane inside the specified tab by its 1-based index.")
    var pane: Int?

    @Option(name: .long, help: "Target a space by its 1-based index.")
    var space: Int?

    @Option(name: .long, help: "Target a tab inside the specified space by its 1-based index.")
    var tab: Int?

    @Option(name: .long, help: "Target a window by its 1-based index. Defaults to 1 when a space target is set.")
    var window: Int?

    @Flag(inversion: .prefixedNo, help: "Focus the new pane after creating it.")
    var focus = true

    @Flag(name: .long, help: "Print the result as JSON.")
    var json = false

    @OptionGroup
    var connection: SPConnectionOptions

    @Argument(help: "Optional shell command to run immediately in the new pane.")
    var command: [String] = []

    mutating func run() throws {
      try validate()

      let client = try socketClient(
        path: connection.explicitSocketPath,
        instance: connection.instance
      )
      let response = try client.send(.newPane(try requestPayload()))
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let result = try response.decodeResult(SupatermNewPaneResult.self)
      if json {
        print(try jsonString(result))
      } else {
        print(
          "window \(result.windowIndex) space \(result.spaceIndex) tab \(result.tabIndex) pane \(result.paneIndex)"
        )
      }
    }

    func validate() throws {
      if let window, window < 1 {
        throw ValidationError("--window must be 1 or greater.")
      }
      if let space, space < 1 {
        throw ValidationError("--space must be 1 or greater.")
      }
      if let tab, tab < 1 {
        throw ValidationError("--tab must be 1 or greater.")
      }
      if let pane, pane < 1 {
        throw ValidationError("--pane must be 1 or greater.")
      }
      if pane != nil && tab == nil {
        throw ValidationError("--pane requires --tab.")
      }
      if tab != nil && space == nil {
        throw ValidationError("--tab requires --space.")
      }
      if window != nil && space == nil {
        throw ValidationError("--window requires --space.")
      }
      if space != nil && tab == nil {
        throw ValidationError("--space requires --tab.")
      }
      if space == nil && tab == nil && pane == nil && SupatermCLIContext.current == nil {
        throw ValidationError("Run this command inside a Supaterm pane or provide --space and --tab.")
      }
    }

    private func requestPayload() throws -> SupatermNewPaneRequest {
      let command = shellCommandInput(command)

      if let tab {
        return SupatermNewPaneRequest(
          command: command,
          direction: direction.direction,
          focus: focus,
          targetWindowIndex: window ?? 1,
          targetSpaceIndex: space,
          targetTabIndex: tab,
          targetPaneIndex: pane
        )
      }

      guard let context = SupatermCLIContext.current else {
        throw ValidationError("Run this command inside a Supaterm pane or provide --space and --tab.")
      }

      return SupatermNewPaneRequest(
        command: command,
        contextPaneID: context.surfaceID,
        direction: direction.direction,
        focus: focus
      )
    }
  }
}

private func jsonString<T: Encodable>(_ value: T) throws -> String {
  let encoder = JSONEncoder()
  encoder.dateEncodingStrategy = .iso8601
  encoder.outputFormatting = [.sortedKeys]
  return String(decoding: try encoder.encode(value), as: UTF8.self)
}

private func resolvedSocketTarget(
  explicitPath: String?,
  instance: String?,
  alwaysDiscover: Bool = false
) throws -> SupatermResolvedSocketTarget {
  let diagnostics = SPSocketSelection.resolve(
    explicitPath: explicitPath,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )

  guard let resolvedTarget = diagnostics.resolvedTarget else {
    throw ValidationError(diagnostics.errorMessage ?? "Unable to resolve a Supaterm socket path.")
  }

  return resolvedTarget
}

private func shellCommandInput(_ tokens: [String]) -> String? {
  guard !tokens.isEmpty else { return nil }
  return tokens.map(shellEscapedToken).joined(separator: " ")
}

private func shellEscapedToken(_ token: String) -> String {
  guard !token.isEmpty else { return "''" }

  let safeScalars = CharacterSet(
    charactersIn: "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789@%_+=:,./-")
  if token.unicodeScalars.allSatisfy(safeScalars.contains) {
    return token
  }

  return "'\(token.replacingOccurrences(of: "'", with: "'\"'\"'"))'"
}

private func socketClient(
  path: String?,
  instance: String?,
  alwaysDiscover: Bool = false
) throws -> SPSocketClient {
  let resolvedTarget = try resolvedSocketTarget(
    explicitPath: path,
    instance: instance,
    alwaysDiscover: alwaysDiscover
  )
  return try SPSocketClient(path: resolvedTarget.path)
}

private enum SPTerminalStyle {
  private static let isEnabled = isatty(FileHandle.standardOutput.fileDescriptor) != 0

  static func bold(_ text: String) -> String {
    guard isEnabled else { return text }
    return "\u{001B}[1m\(text)\u{001B}[0m"
  }
}

private enum SPOnboardingRenderer {
  static func render(_ snapshot: SupatermOnboardingSnapshot) -> String {
    let shortcutWidth = snapshot.items.map(\.shortcut.count).max() ?? 0
    var lines = [SPTerminalStyle.bold("Common Shortcuts")]

    if !snapshot.items.isEmpty {
      lines.append("")
      lines.append(
        contentsOf: snapshot.items.map { item in
          "\(SPTerminalStyle.bold(item.shortcut.padding(toLength: shortcutWidth, withPad: " ", startingAt: 0)))  \(item.title)"
        }
      )
    }

    return lines.joined(separator: "\n")
  }
}
