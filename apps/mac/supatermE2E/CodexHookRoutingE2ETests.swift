import Darwin
import Foundation
import SupatermCLIShared
import Testing

@Suite(.enabled(if: codexE2EEnabled, "Run through make mac-test-e2e."))
struct CodexHookRoutingE2ETests {
  @Test(.timeLimit(.minutes(5)))
  func hooksBindSharedHostSessionsToLaunchingPanes() async throws {
    try await runCodexHookOwnership()
  }
}

private struct CodexHookBinding {
  let paneID: UUID
  let process: SupatermAppDebugSnapshot.AgentProcess
  let sessionID: String
}

private struct CodexCompetingPane {
  let target: SupatermPaneTargetRequest
  let workspace: URL
}

private struct CodexHookPrompts {
  let token: String

  var competing: String { "codex-hook-competing-\(token)" }
  var fork: String { "codex-hook-fork-\(token)" }
  var target: String { "codex-hook-target-\(token)" }
}

private final class CodexSharedAppServer {
  private let controlSocket: URL
  private let log: FileHandle
  private let logURL: URL
  private let process: Process

  init(
    executable: URL,
    codexHome: URL,
    apiKey: String,
    environment: [String: String],
    root: URL
  ) throws {
    let home = root.appendingPathComponent("home", isDirectory: true)
    let cwd = root.appendingPathComponent("cwd", isDirectory: true)
    let logURL = root.appendingPathComponent("app-server.log", isDirectory: false)
    try FileManager.default.createDirectory(at: home, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: cwd, withIntermediateDirectories: true)
    try Data().write(to: logURL)

    let log = try FileHandle(forWritingTo: logURL)
    let process = Process()
    process.executableURL = executable
    process.arguments = ["app-server", "--listen", "unix://"]
    process.currentDirectoryURL = cwd
    var processEnvironment = environment
    processEnvironment["CODEX_E2E_API_KEY"] = apiKey
    processEnvironment["CODEX_HOME"] = codexHome.path
    processEnvironment["HOME"] = home.path
    process.environment = processEnvironment
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = log
    process.standardError = log

    self.controlSocket =
      codexHome
      .appendingPathComponent("app-server-control", isDirectory: true)
      .appendingPathComponent("app-server-control.sock", isDirectory: false)
    self.log = log
    self.logURL = logURL
    self.process = process

    do {
      try process.run()
    } catch {
      try? log.close()
      throw SupatermE2EError(
        "Could not start shared Codex app-server at \(executable.path) from \(cwd.path): \(error)"
      )
    }
  }

  func waitUntilReady(timeout: TimeInterval = 30) async throws {
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      guard process.isRunning else {
        process.waitUntilExit()
        throw failure("The shared Codex app-server exited before accepting control connections.")
      }
      if canConnectToControlSocket() {
        return
      }
      try await Task.sleep(for: .milliseconds(100))
    }
    throw failure("Timed out waiting for the shared Codex app-server to accept control connections.")
  }

  func assertRunning(after launches: String) throws {
    guard process.isRunning else {
      process.waitUntilExit()
      throw failure("The shared Codex app-server exited after \(launches).")
    }
  }

  func failure(_ error: Error) -> SupatermE2EError {
    failure("Shared Codex app-server test failed: \(error)")
  }

  func stop() {
    if process.isRunning {
      process.terminate()
      waitForExit(timeout: 2)
    }
    if process.isRunning {
      kill(process.processIdentifier, SIGKILL)
      waitForExit(timeout: 2)
    }
    if !process.isRunning {
      process.waitUntilExit()
    }
    try? log.close()
  }

  private func failure(_ message: String) -> SupatermE2EError {
    try? log.synchronize()
    let output = (try? String(contentsOf: logURL, encoding: .utf8)) ?? "<unreadable>"
    let state =
      process.isRunning
      ? "running with pid \(process.processIdentifier)"
      : "exited with status \(process.terminationStatus)"
    return SupatermE2EError(
      """
      \(message)
      App-server state: \(state)
      Control socket: \(controlSocket.path)
      --- app-server output ---
      \(output.isEmpty ? "<empty>" : output)
      """
    )
  }

  private func canConnectToControlSocket() -> Bool {
    let socket = Darwin.socket(AF_UNIX, SOCK_STREAM, 0)
    guard socket >= 0 else { return false }
    defer { Darwin.close(socket) }

    var address = sockaddr_un()
    memset(&address, 0, MemoryLayout<sockaddr_un>.size)
    address.sun_family = sa_family_t(AF_UNIX)
    let maxLength = MemoryLayout.size(ofValue: address.sun_path)
    guard controlSocket.path.utf8.count < maxLength else { return false }
    controlSocket.path.withCString { pointer in
      withUnsafeMutablePointer(to: &address.sun_path) { pathPointer in
        let buffer = UnsafeMutableRawPointer(pathPointer).assumingMemoryBound(to: CChar.self)
        strncpy(buffer, pointer, maxLength - 1)
      }
    }
    return withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPointer in
        Darwin.connect(socket, sockaddrPointer, socklen_t(MemoryLayout<sockaddr_un>.size)) == 0
      }
    }
  }

  private func waitForExit(timeout: TimeInterval) {
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning, Date() < deadline {
      Thread.sleep(forTimeInterval: 0.05)
    }
  }
}

private func runCodexHookOwnership() async throws {
  let environment = try CodexE2EEnvironment()
  let apiKey = "test"
  let app = try await SupatermE2EApp.launch(
    environment: ["CODEX_E2E_API_KEY": apiKey],
    pathDirectories: [environment.executable.deletingLastPathComponent()],
    temporaryDirectory: URL(fileURLWithPath: "/tmp", isDirectory: true)
  )
  var spaceID: UUID?
  var server: FakeModelServer?
  var appServer: CodexSharedAppServer?
  defer {
    if let spaceID {
      try? closeTestSpace(app, spaceID: spaceID)
    }
    appServer?.stop()
    app.terminate()
    server?.stop()
  }

  let space = try await makeTestSpace(app)
  spaceID = space.spaceID
  let competingPane = try await makeCodexCompetingPane(app: app, space: space)

  let staleSocketPath = "/tmp/supaterm-codex-hook-stale-\(space.token).sock"
  try #require(!FileManager.default.fileExists(atPath: staleSocketPath))
  let staleAppServerThreadID = UUID().uuidString
  let prompts = CodexHookPrompts(token: space.token)
  let startedServer = try makeCodexHookModelServer(
    app: app,
    space: space,
    competingPane: competingPane,
    prompts: prompts
  )
  server = startedServer
  try installCodexHooks(app: app, space: space)

  let startedAppServer = try CodexSharedAppServer(
    executable: environment.executable,
    codexHome: app.cliHome.appendingPathComponent(".codex", isDirectory: true),
    apiKey: apiKey,
    environment: [
      SupatermCLIEnvironment.socketPathKey: staleSocketPath,
      SupatermCLIEnvironment.surfaceIDKey: competingPane.target.paneID.uuidString,
      SupatermCLIEnvironment.tabIDKey: space.tab.tabID.uuidString,
      SupatermCLIEnvironment.testHomeKey: app.cliHome.path,
      SupatermCLIEnvironment.testSocketRootKey: app.testSocketRoot.path,
      SupatermCodexEnvironment.threadIDKey: staleAppServerThreadID,
    ],
    root: app.stateHome.appendingPathComponent("codex-app-server", isDirectory: true)
  )
  appServer = startedAppServer
  try await startedAppServer.waitUntilReady()

  do {
    let competingBinding = try await launchHookedCodex(
      app: app,
      executable: environment.executable,
      pane: competingPane.target,
      workspace: competingPane.workspace,
      prompt: prompts.competing
    )
    #expect(competingBinding.sessionID != staleAppServerThreadID)
    _ = try app.send(
      .focusPane(competingPane.target),
      as: SupatermFocusPaneResult.self
    )
    #expect(try app.debugPane(space.tab.paneID)?.isFocused == false)
    #expect(try app.debugPane(competingPane.target.paneID)?.isFocused == true)

    let targetBinding = try await launchHookedCodex(
      app: app,
      executable: environment.executable,
      pane: space.pane,
      workspace: space.directory,
      prompt: prompts.target,
      inheritedContext: app.context(
        tabID: space.tab.tabID,
        paneID: competingPane.target.paneID
      ),
      inheritedSessionID: competingBinding.sessionID
    )
    #expect(targetBinding.process != competingBinding.process)
    #expect(targetBinding.sessionID != competingBinding.sessionID)
    #expect(targetBinding.sessionID != staleAppServerThreadID)
    try expectCodexHookBinding(
      targetBinding,
      app: app
    )
    try expectCodexHookBinding(
      competingBinding,
      app: app
    )

    try await verifyCodexForkRouting(
      app: app,
      space: space,
      targetBinding: targetBinding,
      competingBinding: competingBinding,
      fork: (executable: environment.executable, prompt: prompts.fork)
    )
    try startedAppServer.assertRunning(after: "all Codex launches")
    try await waitForCodexHookModelExchanges(app: app, server: startedServer)
  } catch {
    throw startedAppServer.failure(error)
  }
}

private func waitForCodexHookModelExchanges(
  app: SupatermE2EApp,
  server: FakeModelServer
) async throws {
  try await app.waitUntil("the Codex model exchanges complete", timeout: 60) {
    try server.verifyComplete()
    return true
  }
}

private func makeCodexCompetingPane(
  app: SupatermE2EApp,
  space: TestSpace
) async throws -> CodexCompetingPane {
  let workspace = app.stateHome.appendingPathComponent(
    "scratch-\(space.token)-other",
    isDirectory: true
  )
  try FileManager.default.createDirectory(at: workspace, withIntermediateDirectories: true)
  let pane = try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: hermeticShellStartup,
        cwd: workspace.path,
        direction: .right,
        focus: true,
        equalize: true,
        target: .pane(space.tab.paneID)
      )
    ),
    as: SupatermNewPaneResult.self
  )
  let target = SupatermPaneTargetRequest(paneID: pane.paneID)
  try await app.waitForShellPrompt(target)
  return CodexCompetingPane(target: target, workspace: workspace)
}

private func makeCodexHookModelServer(
  app: SupatermE2EApp,
  space: TestSpace,
  competingPane: CodexCompetingPane,
  prompts: CodexHookPrompts
) throws -> FakeModelServer {
  let server = try FakeModelServer(script: [
    codexHookExchange(prompt: prompts.competing),
    codexHookExchange(prompt: prompts.target),
    codexHookExchange(prompt: prompts.fork),
  ])
  do {
    try writeCodexConfig(
      baseURL: server.responsesBaseURL,
      hooksEnabled: true,
      home: app.cliHome,
      trustedWorkspaces: [space.directory, competingPane.workspace]
    )
    return server
  } catch {
    server.stop()
    throw error
  }
}

private func installCodexHooks(
  app: SupatermE2EApp,
  space: TestSpace
) throws {
  try setupAgentIntegrations(
    runner: SPBinaryRunner(
      app: app,
      tabID: space.tab.tabID,
      paneID: space.tab.paneID
    ),
    socketPath: app.socketPath,
    workspace: space.directory
  )
}

private func launchHookedCodex(
  app: SupatermE2EApp,
  executable: URL,
  pane: SupatermPaneTargetRequest,
  workspace: URL,
  prompt: String,
  inheritedContext: SupatermCLIContext? = nil,
  inheritedSessionID: String? = nil
) async throws -> CodexHookBinding {
  try app.type(
    makeCodexCommand(
      app: app,
      executable: executable,
      workspace: workspace,
      inheritedContext: inheritedContext,
      inheritedSessionID: inheritedSessionID,
      strictConfig: false
    ) + "\n",
    into: pane
  )
  let detected = try await waitForAgentSnapshot(
    app,
    paneID: pane.paneID,
    kind: .codex,
    phase: .idle,
    ruleIDs: CodexRuleID.idleTitle
  )
  let process = try requireValue(
    detected.process,
    "Codex detection has no process identity."
  )
  try await waitForCodexInput(app: app, pane: pane)
  try await runCodexHookTurn(app: app, pane: pane, prompt: prompt)
  return try await waitForCodexHookBinding(
    app: app,
    paneID: pane.paneID,
    process: process
  )
}

private func waitForCodexHookBinding(
  app: SupatermE2EApp,
  paneID: UUID,
  process: SupatermAppDebugSnapshot.AgentProcess
) async throws -> CodexHookBinding {
  var sessionID: String?
  try await app.waitUntil("the Codex hook binds to its detected process", timeout: 90) {
    guard
      let agent = try app.debugPane(paneID)?.agent,
      agent.kind == .codex,
      agent.process == process,
      let boundSessionID = agent.sessionID,
      !boundSessionID.isEmpty
    else {
      return false
    }
    sessionID = boundSessionID
    return true
  }
  return CodexHookBinding(
    paneID: paneID,
    process: process,
    sessionID: try requireValue(sessionID, "The Codex hook has no session ID.")
  )
}

private func expectCodexHookBinding(
  _ binding: CodexHookBinding,
  app: SupatermE2EApp
) throws {
  let agent = try #require(try app.debugPane(binding.paneID)?.agent)
  #expect(agent.kind == .codex)
  #expect(agent.process == binding.process)
  #expect(agent.sessionID == binding.sessionID)
}

private func verifyCodexForkRouting(
  app: SupatermE2EApp,
  space: TestSpace,
  targetBinding: CodexHookBinding,
  competingBinding: CodexHookBinding,
  fork: (executable: URL, prompt: String)
) async throws {
  let forkPane = try app.send(
    .newPane(
      SupatermNewPaneRequest(
        startupCommand: codexForkStartupCommand(
          app: app,
          executable: fork.executable,
          sessionID: targetBinding.sessionID,
          workspace: space.directory,
          prompt: fork.prompt
        ),
        cwd: space.directory.path,
        direction: .right,
        focus: true,
        equalize: false,
        target: .pane(targetBinding.paneID)
      )
    ),
    as: SupatermNewPaneResult.self
  )
  let forkPaneID = forkPane.paneID
  try await app.waitUntil("the fork command uses the Codex workspace", timeout: 30) {
    try app.debugPane(forkPaneID)?.pwd == space.directory.path
  }
  let detected = try await waitForAgentSnapshot(
    app,
    paneID: forkPaneID,
    kind: .codex,
    phase: .idle,
    ruleIDs: CodexRuleID.idleTitle
  )
  let forkProcess = try requireValue(
    detected.process,
    "Forked Codex detection has no process identity."
  )
  let forkBinding = try await waitForCodexHookBinding(
    app: app,
    paneID: forkPaneID,
    process: forkProcess
  )
  #expect(forkBinding.process != targetBinding.process)
  #expect(forkBinding.process != competingBinding.process)
  #expect(forkBinding.sessionID != targetBinding.sessionID)
  #expect(forkBinding.sessionID != competingBinding.sessionID)
  try expectCodexHookBinding(
    forkBinding,
    app: app
  )
  try expectCodexHookBinding(
    targetBinding,
    app: app
  )
  try expectCodexHookBinding(
    competingBinding,
    app: app
  )
}

private func codexForkStartupCommand(
  app: SupatermE2EApp,
  executable: URL,
  sessionID: String,
  workspace: URL,
  prompt: String
) -> SupatermTerminalStartup {
  .shell(
    SupatermShellCommand.escapedCommand([
      "/usr/bin/env",
      "CODEX_HOME=\(app.cliHome.appendingPathComponent(".codex").path)",
      executable.path,
      "--no-alt-screen",
      "--cd",
      workspace.path,
      "fork",
      sessionID,
      prompt,
    ])
  )
}

private func codexHookExchange(prompt: String) -> FakeModelExchange {
  FakeModelExchange(
    request: .responsesInputText(prompt),
    response: .responsesMessage(codexHookCompletion(prompt: prompt))
  )
}

private func runCodexHookTurn(
  app: SupatermE2EApp,
  pane: SupatermPaneTargetRequest,
  prompt: String
) async throws {
  try await app.submit(prompt, waitingFor: prompt, into: pane)
  try await app.waitForCapture(
    pane,
    contains: codexHookCompletion(prompt: prompt),
    timeout: 60
  )
}

private func waitForCodexInput(
  app: SupatermE2EApp,
  pane: SupatermPaneTargetRequest
) async throws {
  try await app.waitForCapture(pane, contains: "gpt-5.6-luna low", timeout: 60)
}

private func codexHookCompletion(prompt: String) -> String {
  "done-\(prompt)"
}
