import Clocks
import Foundation
import SupatermCLIShared
import SupatermTerminalCore
import Testing

@testable import supaterm

@MainActor
struct TerminalAgentControlTests {
  private let paneID = UUID()
  private let identity = SupatermAgentIdentity(
    kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 100)
  )

  @Test(arguments: [SupatermAppDebugSnapshot.AgentPhase.idle, .running])
  func guardedSubmissionAcceptsLiveKnownState(_ phase: SupatermAppDebugSnapshot.AgentPhase) throws {
    try sample(phase).validateSubmission(expected: SupatermAgentGuard(kind: .codex, process: identity.process))
  }

  @Test
  func guardedSubmissionRejectsBlockersUncertaintyAndReusedPIDs() {
    let expected = SupatermAgentGuard(kind: .codex, process: identity.process)
    #expect(throws: SupatermAgentControlError.blocked) {
      try sample(.needsInput).validateSubmission(expected: expected)
    }
    #expect(throws: SupatermAgentControlError.unknown) {
      try sample(.unknown).validateSubmission(expected: expected)
    }
    #expect(throws: SupatermAgentControlError.replaced) {
      try sample(.idle).validateSubmission(
        expected: SupatermAgentGuard(
          kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 99)
        ))
    }
    #expect(throws: SupatermAgentControlError.replaced) {
      try sample(.idle).validateSubmission(expected: SupatermAgentGuard(kind: .claude))
    }
    #expect(throws: SupatermAgentControlError.notRunning) {
      try TerminalAgentControlSample(identity: nil, phase: nil, expectedProcessIsAlive: false)
        .validateSubmission(expected: expected)
    }
  }

  @Test
  func standaloneWaitReturnsAnExistingMatch() async throws {
    let result = try await TerminalAgentWaiter.wait(request(), clock: TestClock()) { _ in sample(.idle) }
    #expect(result.outcome == .idle)
    #expect(result.matched)
    #expect(result.identity == identity)
  }

  @Test
  func waitAcquiresStartupProcessThenWaitsThroughUnknown() async throws {
    let clock = TestClock()
    var reads = 0
    let task = Task {
      try await TerminalAgentWaiter.wait(request(), clock: clock) { expected in
        reads += 1
        switch reads {
        case 1:
          #expect(expected == nil)
          return TerminalAgentControlSample(identity: nil, phase: nil, expectedProcessIsAlive: false)
        case 2: return sample(.unknown)
        case 3:
          #expect(expected == identity)
          return sample(.running)
        default: return sample(.idle)
        }
      }
    }
    await flushEffects()
    await clock.run()
    let result = try await task.value
    #expect(result.outcome == .idle)
    #expect(reads == 4)
  }

  @Test
  func waitDoesNotFollowSameKindReplacementOrReusedPID() async throws {
    let result = try await TerminalAgentWaiter.wait(request(pinned: true), clock: TestClock()) { _ in
      TerminalAgentControlSample(
        identity: SupatermAgentIdentity(
          kind: .codex, process: SupatermAppDebugSnapshot.AgentProcess(processID: 42, startTimeMicroseconds: 101)),
        phase: .idle,
        expectedProcessIsAlive: false
      )
    }
    #expect(result.outcome == .replaced)
    #expect(!result.matched)
    #expect(result.identity == identity)
  }

  @Test(arguments: [false, true])
  func exitIsSuccessfulOnlyWhenRequested(_ untilExited: Bool) async throws {
    let result = try await TerminalAgentWaiter.wait(
      request(until: untilExited ? [.exited] : [.idle], pinned: true), clock: TestClock()
    ) { _ in
      TerminalAgentControlSample(identity: nil, phase: .idle, expectedProcessIsAlive: false)
    }
    #expect(result.outcome == .exited)
    #expect(result.matched == untilExited)
  }

  @Test
  func closingBoundPaneReportsExit() async throws {
    let result = try await TerminalAgentWaiter.wait(request(pinned: true), clock: TestClock()) { _ in
      throw TerminalControlError.contextPaneNotFound
    }
    #expect(result.outcome == .exited)
    #expect(!result.matched)
  }

  @Test(arguments: [SupatermAppDebugSnapshot.AgentPhase.unknown, .running])
  func deadlineDistinguishesUncertaintyFromUnmatchedState(_ phase: SupatermAppDebugSnapshot.AgentPhase) async throws {
    let clock = TestClock()
    let task = Task {
      try await TerminalAgentWaiter.wait(request(), clock: clock) { _ in sample(phase) }
    }
    await flushEffects()
    await clock.run()
    let result = try await task.value
    #expect(result.outcome == (phase == .unknown ? .unknown : .timeout))
    #expect(!result.matched)
  }

  @Test
  func cancellationEndsWait() async throws {
    let clock = TestClock()
    let task = Task {
      try await TerminalAgentWaiter.wait(request(), clock: clock) { _ in sample(.running) }
    }
    await flushEffects()
    task.cancel()
    await #expect(throws: CancellationError.self) { try await task.value }
  }

  @Test
  func undetectedStartupTimesOutWithoutClaimingExit() async throws {
    let clock = TestClock()
    let task = Task {
      try await TerminalAgentWaiter.wait(request(until: [.exited]), clock: clock) { _ in
        TerminalAgentControlSample(identity: nil, phase: nil, expectedProcessIsAlive: false)
      }
    }
    await flushEffects()
    await clock.run()
    let result = try await task.value
    #expect(result.outcome == .timeout)
    #expect(!result.matched)
    #expect(result.identity == nil)
  }

  @Test(arguments: [0.0, -1, .infinity, .nan, 3601])
  func invalidTimeoutIsRejected(_ timeout: Double) {
    #expect(throws: SupatermAgentControlError.self) {
      try SupatermAgentWaitRequest(target: SupatermPaneTargetRequest(paneID: paneID), timeoutSeconds: timeout)
        .validate()
    }
  }

  private func request(until: [SupatermAgentWaitState] = [.idle], pinned: Bool = false) -> SupatermAgentWaitRequest {
    SupatermAgentWaitRequest(
      target: SupatermPaneTargetRequest(paneID: paneID), until: until, timeoutSeconds: 1,
      expectedAgent: pinned ? SupatermAgentGuard(kind: identity.kind, process: identity.process) : nil
    )
  }

  private func sample(_ phase: SupatermAppDebugSnapshot.AgentPhase) -> TerminalAgentControlSample {
    TerminalAgentControlSample(identity: identity, phase: phase, expectedProcessIsAlive: true)
  }
}
