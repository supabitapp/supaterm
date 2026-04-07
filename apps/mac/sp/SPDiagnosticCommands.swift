import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Instance: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "instance",
      abstract: "Inspect reachable Supaterm instances.",
      discussion: SPHelp.instanceDiscussion,
      subcommands: [Instances.self]
    )

    mutating func run() throws {
      print(Self.helpMessage())
    }
  }

  struct Tree: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ls",
      abstract: "Show the current Supaterm window, space, tab, and pane tree.",
      discussion: SPHelp.treeDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.tree())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermTreeSnapshot.self)
      switch options.output.mode {
      case .json:
        print(try jsonString(snapshot))
      case .plain:
        print(SPTreeRenderer.renderPlain(snapshot))
      case .human:
        print(SPTreeRenderer.render(snapshot))
      }
    }
  }

  struct Onboard: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "onboard",
      abstract: "Interactively onboard Supaterm and show core shortcuts.",
      discussion: SPHelp.onboardDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance
      )
      let response = try client.send(.onboarding())
      guard response.ok else {
        throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
      }

      let snapshot = try response.decodeResult(SupatermOnboardingSnapshot.self)
      guard !options.output.quiet else { return }

      if shouldPromptInteractively(
        mode: options.output.mode,
        isQuiet: options.output.quiet
      ) {
        let result = SPOnboardingInteraction().run()
        if result.didWriteOutput {
          print("")
        }
      }

      switch options.output.mode {
      case .json:
        print(try jsonString(snapshot))
      case .plain, .human:
        print(SPOnboardingRenderer.render(snapshot))
      }
    }
  }

  struct Diagnostic: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "diagnostic",
      abstract: "Show live Supaterm diagnostics for the current application.",
      discussion: SPHelp.diagnosticDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let context = SupatermCLIContext.current
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: options.connection.explicitSocketPath,
        instance: options.connection.instance,
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

      switch options.output.mode {
      case .json:
        print(try jsonString(report))
      case .plain, .human:
        print(SPDebugRenderer.render(report))
      }

      if !socketStatus.requestSucceeded {
        throw ExitCode.failure
      }
    }
  }

  struct Instances: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "ls",
      abstract: "List reachable Supaterm instances.",
      discussion: SPHelp.instancesDiscussion
    )

    @OptionGroup
    var options: SPCommandOptions

    mutating func run() throws {
      applyOutputStyle(options.output)
      let diagnostics = SPSocketSelection.resolve(
        explicitPath: options.connection.explicitSocketPath,
        instance: options.connection.instance,
        alwaysDiscover: true
      )
      let endpoints = diagnostics.discoveredEndpoints
      switch options.output.mode {
      case .json:
        print(try jsonString(endpoints))
      case .plain:
        guard !endpoints.isEmpty else {
          throw ValidationError("No reachable Supaterm instances were found.")
        }
        print(
          endpoints.map {
            "\($0.name)\t\($0.id.uuidString.lowercased())\t\($0.pid)\t\($0.path)"
          }
          .joined(separator: "\n")
        )
      case .human:
        guard !endpoints.isEmpty else {
          throw ValidationError("No reachable Supaterm instances were found.")
        }
        print(endpoints.map(SPSocketSelection.formatEndpoint).joined(separator: "\n"))
      }
    }
  }
}

struct SPOnboardingInteraction {
  struct AgentIntegration {
    let agent: SupatermAgentKind
    let hasSupatermHooks: @Sendable () throws -> Bool
    let installSupatermHooks: @Sendable () throws -> Void
  }

  struct IO {
    let readLine: @Sendable () -> String?
    let write: @Sendable (String) -> Void

    static let live = Self(
      readLine: { Swift.readLine(strippingNewline: true) },
      write: { text in
        FileHandle.standardOutput.write(Data(text.utf8))
      }
    )
  }

  struct Result: Equatable {
    let didWriteOutput: Bool
  }

  let integrations: [AgentIntegration]
  let io: IO

  init(
    integrations: [AgentIntegration] = Self.liveIntegrations,
    io: IO = .live
  ) {
    self.integrations = integrations
    self.io = io
  }

  func run() -> Result {
    var didWriteOutput = false

    for integration in integrations {
      let hasSupatermHooks: Bool

      do {
        hasSupatermHooks = try integration.hasSupatermHooks()
      } catch {
        write(
          "Could not inspect \(integration.agent.notificationTitle) hooks: \(error.localizedDescription)\n",
          didWriteOutput: &didWriteOutput
        )
        continue
      }

      guard !hasSupatermHooks else { continue }
      guard shouldInstall(agent: integration.agent, didWriteOutput: &didWriteOutput) else { continue }

      do {
        try integration.installSupatermHooks()
        write(
          "Configured \(integration.agent.notificationTitle) hooks.\n",
          didWriteOutput: &didWriteOutput
        )
      } catch {
        write(
          "Could not configure \(integration.agent.notificationTitle) hooks: \(error.localizedDescription)\n",
          didWriteOutput: &didWriteOutput
        )
      }
    }

    return .init(didWriteOutput: didWriteOutput)
  }

  private func shouldInstall(
    agent: SupatermAgentKind,
    didWriteOutput: inout Bool
  ) -> Bool {
    while true {
      write(
        "Configure Supaterm hooks for \(agent.notificationTitle)? [y/N] ",
        didWriteOutput: &didWriteOutput
      )

      switch yesNoAnswer(from: io.readLine()) {
      case .yes:
        return true
      case .no:
        return false
      case .invalid:
        write("Enter y or n.\n", didWriteOutput: &didWriteOutput)
      }
    }
  }

  private func write(
    _ text: String,
    didWriteOutput: inout Bool
  ) {
    io.write(text)
    didWriteOutput = true
  }

  private func yesNoAnswer(from value: String?) -> YesNoAnswer {
    guard let normalizedValue = value?
      .trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    else {
      return .no
    }

    switch normalizedValue {
    case "", "n", "no":
      return .no
    case "y", "yes":
      return .yes
    default:
      return .invalid
    }
  }

  private enum YesNoAnswer {
    case no
    case yes
    case invalid
  }

  private static let liveIntegrations: [AgentIntegration] = SupatermAgentKind.allCases.map { agent in
    switch agent {
    case .claude:
      return .init(
        agent: agent,
        hasSupatermHooks: { try ClaudeSettingsInstaller().hasSupatermHooks() },
        installSupatermHooks: { try ClaudeSettingsInstaller().installSupatermHooks() }
      )
    case .codex:
      return .init(
        agent: agent,
        hasSupatermHooks: { try CodexSettingsInstaller().hasSupatermHooks() },
        installSupatermHooks: { try CodexSettingsInstaller().installSupatermHooks() }
      )
    }
  }
}
