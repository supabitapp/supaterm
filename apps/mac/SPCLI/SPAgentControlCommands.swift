import ArgumentParser
import Foundation
import SupatermCLIShared

struct SPAgentGuardOptions: ParsableArguments {
  @Option(name: .long, help: "Require this coding agent: claude, codex, or pi.")
  var expectAgent: SupatermAgentKind?

  @Option(name: .long, help: "Require the process identity PID:START_TIME_MICROSECONDS from an earlier wait.")
  var expectProcess: String?

  func validate() throws {
    if expectProcess != nil && expectAgent == nil {
      throw ValidationError("--expect-process requires --expect-agent.")
    }
    _ = try value()
  }

  func value() throws -> SupatermAgentGuard? {
    guard let expectAgent else { return nil }
    let process: SupatermAppDebugSnapshot.AgentProcess?
    if let expectProcess {
      let parts = expectProcess.split(separator: ":", omittingEmptySubsequences: false)
      guard parts.count == 2, let pid = Int32(parts[0]), pid > 0,
        let start = UInt64(parts[1]), start > 0
      else {
        throw ValidationError("--expect-process must be PID:START_TIME_MICROSECONDS with positive values.")
      }
      process = SupatermAppDebugSnapshot.AgentProcess(processID: pid, startTimeMicroseconds: start)
    } else {
      process = nil
    }
    return SupatermAgentGuard(kind: expectAgent, process: process)
  }
}

extension SP {
  struct WaitAgent: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "wait",
      abstract: "Wait for a coding agent's observed state in a pane.",
      discussion: """
        Waits bind to the first detected agent process, or --expect-process.
        Repeat --until to accept several states. Idle describes readiness,
        not successful completion of a submitted task.
        """
    )

    @Argument(help: "Optional pane target.")
    var pane: SPPaneReference?

    @Option(name: .long, help: "State to accept: idle, running, needs_input, exited. Defaults to idle or needs_input.")
    var until: [SupatermAgentWaitState] = []

    @Option(name: .long, help: "Maximum seconds to wait, greater than 0 and at most 3600.")
    var timeout: Double = 60

    @OptionGroup var agentGuard: SPAgentGuardOptions
    @OptionGroup var options: SPCommandOptions

    func validate() throws {
      try agentGuard.validate()
      guard timeout.isFinite, timeout > 0, timeout <= SupatermAgentWaitRequest.maximumTimeoutSeconds else {
        throw ValidationError("--timeout must be greater than 0 and at most 3600 seconds.")
      }
    }

    mutating func run() throws {
      try validate()
      applyOutputStyle(options.output)
      let client = try socketClient(
        path: options.connection.explicitSocketPath,
        instance: options.connection.instance,
        responseTimeout: timeout + SupatermAgentWaitRequest.clientResponseGraceSeconds
      )
      let target = try resolvePublicPaneTarget(
        pane, context: SupatermCLIContext.current, snapshot: try treeSnapshot(client)
      )
      let response = try client.send(
        .waitAgent(
          SupatermAgentWaitRequest(
            target: target,
            until: until.isEmpty ? [.idle, .needsInput] : until,
            timeoutSeconds: timeout,
            expectedAgent: try agentGuard.value()
          )))
      guard response.ok else {
        throw ValidationError(response.error.map { "\($0.code): \($0.message)" } ?? "Agent wait failed.")
      }
      let result = try response.decodeResult(SupatermAgentWaitResult.self)
      let summary = renderAgentWait(result)
      try emitCommandResult(result, options: options.output, plain: summary, human: summary)
      if !result.matched { throw ExitCode.failure }
    }
  }
}

extension SupatermAgentKind: @retroactive ExpressibleByArgument {}
extension SupatermAgentWaitState: @retroactive ExpressibleByArgument {}

private func renderAgentWait(_ result: SupatermAgentWaitResult) -> String {
  var parts = [result.outcome.rawValue, "pane=\(result.paneID.uuidString)"]
  if let identity = result.identity {
    parts.append("agent=\(identity.kind.rawValue)")
    parts.append("process=\(identity.process.processID):\(identity.process.startTimeMicroseconds)")
  }
  return parts.joined(separator: " ")
}
