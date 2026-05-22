import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPDiagnosticSocketProbeResult {
  let socket: SPDebugReport.Socket
  let appSnapshot: SupatermAppDebugSnapshot?
  let problems: [String]
}

enum SPDiagnosticSocketProbe {
  typealias SendDebugRequest =
    (SupatermResolvedSocketTarget, SupatermCLIContext?) throws -> SupatermSocketResponse

  static func probe(
    target: SupatermResolvedSocketTarget?,
    resolutionErrorMessage: String?,
    context: SupatermCLIContext?,
    sendDebugRequest: SendDebugRequest = defaultSendDebugRequest
  ) -> SPDiagnosticSocketProbeResult {
    var socket = SPDebugReport.Socket(
      path: target?.path,
      isReachable: false,
      requestSucceeded: false,
      error: nil
    )

    guard let target else {
      return failed(
        socket: socket,
        message: resolutionErrorMessage ?? "Unable to resolve a Supaterm socket path."
      )
    }

    do {
      let response = try sendDebugRequest(target, context)
      socket.isReachable = true

      guard response.ok else {
        return failed(
          socket: socket,
          message: response.error?.message ?? "Supaterm socket request failed."
        )
      }

      do {
        let snapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
        socket.requestSucceeded = true
        return .init(socket: socket, appSnapshot: snapshot, problems: [])
      } catch {
        return failed(socket: socket, message: error.localizedDescription)
      }
    } catch {
      return failed(socket: socket, message: error.localizedDescription)
    }
  }

  private static func defaultSendDebugRequest(
    target: SupatermResolvedSocketTarget,
    context: SupatermCLIContext?
  ) throws -> SupatermSocketResponse {
    let client = try SPSocketClient(path: target.path)
    return try client.send(.debug(.init(context: context)))
  }

  private static func failed(
    socket: SPDebugReport.Socket,
    message: String
  ) -> SPDiagnosticSocketProbeResult {
    var socket = socket
    socket.error = message
    return .init(socket: socket, appSnapshot: nil, problems: [message])
  }
}

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
      switch options.output.mode {
      case .json:
        let response = try client.send(.tree())
        guard response.ok else {
          throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
        }

        let snapshot = try response.decodeResult(SupatermTreeSnapshot.self)
        print(try jsonString(snapshot))
      case .plain, .human:
        let response = try client.send(.debug(.init(context: SupatermCLIContext.current)))
        guard response.ok else {
          throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
        }

        let snapshot = try response.decodeResult(SupatermAppDebugSnapshot.self)
        switch options.output.mode {
        case .plain:
          print(SPTreeRenderer.renderPlain(snapshot))
        case .human:
          print(SPTreeRenderer.render(snapshot))
        case .json:
          break
        }
      }
    }
  }

  struct Onboard: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "onboard",
      abstract: "Show Supaterm onboarding, shortcuts, and setup commands.",
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
        discoveryPolicy: .always
      )
      let probe = SPDiagnosticSocketProbe.probe(
        target: diagnostics.resolvedTarget,
        resolutionErrorMessage: diagnostics.errorMessage,
        context: context
      )

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
        socket: probe.socket,
        app: probe.appSnapshot,
        problems: probe.problems
      )

      switch options.output.mode {
      case .json:
        print(try jsonString(report))
      case .plain, .human:
        print(SPDebugRenderer.render(report))
      }

      if !probe.socket.requestSucceeded {
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
        discoveryPolicy: .always
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
