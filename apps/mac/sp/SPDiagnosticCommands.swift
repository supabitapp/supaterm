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

    @Flag(name: .long, help: "Re-run interactive onboarding for all supported coding agents.")
    var force = false

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
        let result = SPOnboardingInteraction(force: force).run()
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
    let installCommand: String?
    let installFailureSubject: String
    let installVerb: String
    let isAvailable: @Sendable () throws -> Bool
    let isConfigured: @Sendable () throws -> Bool
    let prompt: String
    let inspectionSubject: String
    let successMessage: String
    let install: @Sendable () throws -> Void
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

  let force: Bool
  let integrations: [AgentIntegration]
  let io: IO

  init(
    force: Bool = false,
    integrations: [AgentIntegration] = Self.liveIntegrations,
    io: IO = .live
  ) {
    self.force = force
    self.integrations = integrations
    self.io = io
  }

  func run() -> Result {
    var didWriteOutput = false
    var didShowIntro = false

    for integration in integrations {
      let isAvailable: Bool

      do {
        isAvailable = try integration.isAvailable()
      } catch {
        write(
          "Could not inspect \(integration.inspectionSubject): \(error.localizedDescription)\n",
          didWriteOutput: &didWriteOutput
        )
        continue
      }

      guard isAvailable else { continue }

      if force {
        guard shouldInstall(
          integration: integration,
          didShowIntro: &didShowIntro,
          didWriteOutput: &didWriteOutput
        ) else { continue }
        install(integration, didWriteOutput: &didWriteOutput)
        continue
      }

      let isConfigured: Bool

      do {
        isConfigured = try integration.isConfigured()
      } catch {
        write(
          "Could not inspect \(integration.inspectionSubject): \(error.localizedDescription)\n",
          didWriteOutput: &didWriteOutput
        )
        continue
      }

      guard !isConfigured else { continue }
      guard shouldInstall(
        integration: integration,
        didShowIntro: &didShowIntro,
        didWriteOutput: &didWriteOutput
      ) else { continue }
      install(integration, didWriteOutput: &didWriteOutput)
    }

    return .init(didWriteOutput: didWriteOutput)
  }

  private func install(
    _ integration: AgentIntegration,
    didWriteOutput: inout Bool
  ) {
    do {
      if let installCommand = integration.installCommand {
        write("Running: \(installCommand)\n", didWriteOutput: &didWriteOutput)
      }
      try integration.install()
      write(integration.successMessage, didWriteOutput: &didWriteOutput)
    } catch {
      write(
        "Could not \(integration.installVerb) \(integration.installFailureSubject): \(error.localizedDescription)\n",
        didWriteOutput: &didWriteOutput
      )
    }
  }

  private func shouldInstall(
    integration: AgentIntegration,
    didShowIntro: inout Bool,
    didWriteOutput: inout Bool
  ) -> Bool {
    if !didShowIntro {
      write(
        "Glad to have you onboard with Supaterm, let's get you setup.\n",
        didWriteOutput: &didWriteOutput
      )
      didShowIntro = true
    }

    while true {
      write(integration.prompt, didWriteOutput: &didWriteOutput)

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

  private static let liveIntegrations: [AgentIntegration] = [
    .init(
      installCommand: nil,
      installFailureSubject: "Claude Code hooks",
      installVerb: "configure",
      isAvailable: { true },
      isConfigured: { try ClaudeSettingsInstaller().hasSupatermHooks() },
      prompt: "Configure Supaterm hooks for Claude Code? [y/N] ",
      inspectionSubject: "Claude Code hooks",
      successMessage: "Configured Claude Code hooks.\n",
      install: { try ClaudeSettingsInstaller().installSupatermHooks() }
    ),
    .init(
      installCommand: nil,
      installFailureSubject: "Codex hooks",
      installVerb: "configure",
      isAvailable: { true },
      isConfigured: { try CodexSettingsInstaller().hasSupatermHooks() },
      prompt: "Configure Supaterm hooks for Codex? [y/N] ",
      inspectionSubject: "Codex hooks",
      successMessage: "Configured Codex hooks.\n",
      install: { try CodexSettingsInstaller().installSupatermHooks() }
    ),
    .init(
      installCommand: PiSettingsInstaller.canonicalInstallDisplayCommand,
      installFailureSubject: "the Supaterm Pi package",
      installVerb: "install",
      isAvailable: { try PiSettingsInstaller().isPiAvailable() },
      isConfigured: { try PiSettingsInstaller().hasSupatermPackageInstalled() },
      prompt: "Install the Supaterm Pi package? [y/N] ",
      inspectionSubject: "Pi package",
      successMessage: "Installed the Supaterm Pi package.\n",
      install: { try PiSettingsInstaller().installSupatermPackage() }
    ),
  ]
}
