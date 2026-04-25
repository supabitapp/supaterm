import Clocks
import Foundation
import SupatermCLIShared
import Testing

@testable import supaterm

@MainActor
struct TerminalBarRuntimeTests {
  @Test
  func debounceCoalescesGitProbes() async {
    let clock = TestClock()
    let recorder = TerminalBarGitRecorder(outputs: ["## main\n"])
    let runtime = makeRuntime(clock: clock, recorder: recorder)

    runtime.refresh(settings: .default, context: context(cwd: "/tmp/one"), reason: .focus)
    await clock.advance(by: .milliseconds(100))
    runtime.refresh(settings: .default, context: context(cwd: "/tmp/two"), reason: .focus)
    await clock.advance(by: .milliseconds(199))
    await flushEffects()
    #expect(await recorder.calls() == [])

    await clock.advance(by: .milliseconds(1))
    await flushEffects()

    #expect(await recorder.calls() == ["/tmp/two"])
  }

  @Test
  func freshCacheAvoidsGitProbe() async {
    let clock = TestClock()
    let recorder = TerminalBarGitRecorder(outputs: ["## main\n"])
    let runtime = makeRuntime(clock: clock, recorder: recorder)
    let now = Date()

    runtime.refresh(settings: .default, context: context(cwd: "/tmp/repo"), now: now, reason: .focus)
    await clock.advance(by: .milliseconds(200))
    await flushEffects()

    runtime.refresh(
      settings: .default,
      context: context(cwd: "/tmp/repo"),
      now: now.addingTimeInterval(1),
      reason: .focus
    )

    #expect(await recorder.calls() == ["/tmp/repo"])
  }

  @Test
  func expiredCacheRefreshesGitProbe() async {
    let clock = TestClock()
    let recorder = TerminalBarGitRecorder(outputs: ["## main\n", "## trunk\n"])
    let runtime = makeRuntime(clock: clock, recorder: recorder)
    let now = Date()

    runtime.refresh(settings: .default, context: context(cwd: "/tmp/repo"), now: now, reason: .focus)
    await clock.advance(by: .milliseconds(200))
    await flushEffects()

    runtime.refresh(
      settings: .default,
      context: context(cwd: "/tmp/repo"),
      now: now.addingTimeInterval(3),
      reason: .focus
    )
    await clock.advance(by: .milliseconds(200))
    await flushEffects()

    #expect(await recorder.calls() == ["/tmp/repo", "/tmp/repo"])
    #expect(runtime.presentation.left.map(\.text).contains("trunk"))
  }

  @Test
  func commandFinishedBypassesFreshCache() async {
    let clock = TestClock()
    let recorder = TerminalBarGitRecorder(outputs: ["## main\n", "## trunk\n"])
    let runtime = makeRuntime(clock: clock, recorder: recorder)
    let now = Date()

    runtime.refresh(settings: .default, context: context(cwd: "/tmp/repo"), now: now, reason: .focus)
    await clock.advance(by: .milliseconds(200))
    await flushEffects()

    runtime.refresh(
      settings: .default,
      context: context(cwd: "/tmp/repo"),
      now: now.addingTimeInterval(1),
      reason: .commandFinished
    )
    await clock.advance(by: .milliseconds(200))
    await flushEffects()

    #expect(await recorder.calls() == ["/tmp/repo", "/tmp/repo"])
    #expect(runtime.presentation.left.map(\.text).contains("trunk"))
  }

  @Test
  func timeoutHidesGitModules() async {
    let clock = TestClock()
    let client = TerminalBarGitClient(
      timeout: .seconds(1),
      sleep: { duration in try await clock.sleep(for: duration) },
      run: { _ in
        try await clock.sleep(for: .seconds(10))
        return "## main\n"
      }
    )
    let runtime = TerminalBarRuntime(
      gitClient: client,
      debounceDuration: .milliseconds(200),
      sleep: { duration in try await clock.sleep(for: duration) }
    )

    runtime.refresh(settings: .default, context: context(cwd: "/tmp/repo"), reason: .focus)
    await clock.advance(by: .milliseconds(200))
    await clock.advance(by: .seconds(1))
    await flushEffects()

    #expect(!runtime.presentation.left.map(\.id).contains("git_branch"))
  }

  private func makeRuntime(
    clock: TestClock<Duration>,
    recorder: TerminalBarGitRecorder
  ) -> TerminalBarRuntime {
    let client = TerminalBarGitClient(
      sleep: { duration in try await clock.sleep(for: duration) },
      run: { cwd in try await recorder.run(cwd) }
    )
    return TerminalBarRuntime(
      gitClient: client,
      debounceDuration: .milliseconds(200),
      sleep: { duration in try await clock.sleep(for: duration) }
    )
  }

  private func context(cwd: String) -> TerminalBarContext {
    TerminalBarContext(
      selectedSpaceID: UUID().uuidString,
      selectedTabID: UUID().uuidString,
      focusedPaneID: UUID().uuidString,
      paneTitle: "zsh",
      workingDirectoryPath: cwd,
      agentActivity: nil,
      commandExitCode: nil,
      commandDuration: nil
    )
  }
}

private actor TerminalBarGitRecorder {
  private var recordedCalls: [String] = []
  private var outputs: [String]

  init(outputs: [String]) {
    self.outputs = outputs
  }

  func run(_ cwd: String) throws -> String {
    recordedCalls.append(cwd)
    guard !outputs.isEmpty else {
      return "## main\n"
    }
    return outputs.removeFirst()
  }

  func calls() -> [String] {
    recordedCalls
  }
}
