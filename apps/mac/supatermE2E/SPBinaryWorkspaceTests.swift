import Foundation
import SupatermCLIShared
import Testing

extension SupatermE2ESuite.SPBinaryTests {
  @Test(.timeLimit(.minutes(5)))
  func spaceTabAndPaneCommandsMutateLiveAppState() async throws {
    try await withTestSpace { app, space in
      try await app.waitForShellPrompt(space.pane)
      let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
      let cliSpace = try await exerciseSpaceCommands(app: app, space: space, runner: runner)
      let cliTab = try await exerciseTabCommands(app: app, space: space, cliSpace: cliSpace)
      try await exercisePaneCommands(app: app, space: space, cliSpace: cliSpace, cliTab: cliTab)
    }
  }

  @Test(.timeLimit(.minutes(5)))
  func paneWaitReadyReturnsExpectedExitCodes() async throws {
    try await withTestSpace { app, space in
      try await app.waitForShellPrompt(space.pane)
      let runner = SPBinaryRunner(app: app, tabID: space.tab.tabID, paneID: space.tab.paneID)
      let ready = try requireSuccessfulSPResult(
        try runner.run(
          [
            "pane", "wait-ready", "--socket", app.socketPath, space.tab.paneID.uuidString,
            "--timeout", "5", "--plain",
          ],
          cwd: space.directory
        )
      )
      #expect(ready.stdout.contains("ready"))

      let missing = try runner.run(
        [
          "pane", "wait-ready", "--socket", app.socketPath,
          "00000000-0000-0000-0000-000000000000", "--timeout", "0.1", "--plain",
        ],
        cwd: space.directory
      )
      #expect(missing.exitCode != 0)
      #expect(missing.stderr.contains("No pane exists with UUID"))
    }
  }
}

private struct CLISpaceE2E {
  let result: SupatermCreateSpaceResult
  let runner: SPBinaryRunner
}

private struct CLITabE2E {
  let result: SupatermNewTabResult
  let runner: SPBinaryRunner
}

private func exerciseSpaceCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) async throws -> CLISpaceE2E {
  try exerciseSpaceCreationAndListing(app: app, space: space, runner: runner)

  let created = try decodeSPJSON(
    SupatermCreateSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "space", "new", "--socket", app.socketPath, "--json",
          "cli-space-\(space.token)",
        ],
        cwd: space.directory
      )
    )
  )
  #expect(created.isSelectedSpace)
  let createdRunner = SPBinaryRunner(app: app, tabID: created.tabID, paneID: created.paneID)
  try await app.waitForShellOutput(SupatermPaneTargetRequest(paneID: created.paneID))

  let renamed = try decodeSPJSON(
    SupatermSpaceTarget.self,
    from: try requireSuccessfulSPResult(
      try createdRunner.run(
        [
          "space", "rename", "--socket", app.socketPath, "--json",
          "renamed-\(space.token)", created.target.spaceID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(renamed.name == "renamed-\(space.token)")

  let duplicateRename = try requireFailedSPResult(
    try createdRunner.run(
      [
        "space", "rename", "e2e-\(space.token)", created.target.spaceID.uuidString,
        "--socket", app.socketPath, "--plain",
      ],
      cwd: space.directory
    )
  )
  #expect(duplicateRename.stderr.contains("already in use"))
  let afterDuplicateRename = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  #expect(
    afterDuplicateRename.windows.flatMap(\.spaces)
      .first { $0.id == created.target.spaceID }?.name == "renamed-\(space.token)"
  )

  let focusedBase = try decodeSPJSON(
    SupatermSelectSpaceResult.self,
    from: try requireSuccessfulSPResult(
      try createdRunner.run(
        [
          "space", "focus", "--socket", app.socketPath, "--json",
          try listedRef(
            .space,
            id: space.spaceID,
            app: app,
            runner: createdRunner,
            cwd: space.directory
          ),
        ],
        cwd: space.directory
      )
    )
  )
  #expect(focusedBase.target.spaceID == space.spaceID)

  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "next", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "prev", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try runner.run(["space", "last", "--socket", app.socketPath, "--plain"], cwd: space.directory)
  )
  return CLISpaceE2E(result: created, runner: createdRunner)
}

private func exerciseSpaceCreationAndListing(
  app: SupatermE2EApp,
  space: TestSpace,
  runner: SPBinaryRunner
) throws {
  let backgroundName = "background-\(space.token)"
  let background: SupatermCreateSpaceResult = try runSPJSON(
    ["space", "new", backgroundName],
    app: app,
    runner: runner,
    cwd: space.directory
  )
  #expect(background.isSelectedSpace)
  #expect(background.isSelectedTab)
  let backgroundTree = try app.send(.tree(), as: SupatermTreeSnapshot.self)
  let backgroundWindow = try #require(
    backgroundTree.windows.first { $0.displayedSpaceID == background.target.spaceID }
  )
  let backgroundSpace = try #require(
    backgroundWindow.spaces.first { $0.id == background.target.spaceID }
  )
  #expect(backgroundSpace.isWarm)
  #expect(backgroundSpace.flattenedTabs.count == 1)
  let listed = try requireSuccessfulSPResult(
    try runner.run(
      ["space", "ls", "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(listed.stdout.contains(background.target.spaceID.uuidString.lowercased()))
  #expect(listed.stdout.contains("displayed"))
  let duplicateCreate = try requireFailedSPResult(
    try runner.run(
      ["space", "new", backgroundName, "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(duplicateCreate.stderr.contains("already in use"))
  _ =
    try runSPJSON(
      ["space", "destroy", "--yes", background.target.spaceID.uuidString],
      app: app,
      runner: runner,
      cwd: space.directory
    ) as SupatermCloseSpaceResult
}

private func exerciseTabCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E
) async throws -> CLITabE2E {
  let created = try decodeSPJSON(
    SupatermNewTabResult.self,
    from: try requireSuccessfulSPResult(
      try cliSpace.runner.run(
        [
          "tab", "new", "--socket", app.socketPath, "--json", "--focus",
          "--cwd", space.directory.path, "--in", cliSpace.result.target.spaceID.uuidString,
          "--",
        ] + hermeticShellArguments,
        cwd: space.directory
      )
    )
  )
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: created.paneID))
  let runner = SPBinaryRunner(app: app, tabID: created.tabID, paneID: created.paneID)
  let tabRef = try listedRef(
    .tab,
    id: created.tabID,
    app: app,
    runner: runner,
    cwd: space.directory
  )

  let renamed = try decodeSPJSON(
    SupatermRenameTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        [
          "tab", "rename", "--socket", app.socketPath, "--json",
          "cli-tab-\(space.token)", tabRef,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(renamed.isTitleLocked)
  #expect(renamed.target.title == "cli-tab-\(space.token)")

  let title = try requireSuccessfulSPResult(
    try runner.run(
      ["tab", "title", "--socket", app.socketPath, "--plain"],
      cwd: space.directory
    )
  )
  #expect(title.stdout == "cli-tab-\(space.token)\n")

  let cleared = try decodeSPJSON(
    SupatermRenameTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "rename", "--socket", app.socketPath, "--json", "", tabRef],
        cwd: space.directory
      )
    )
  )
  #expect(!cleared.isTitleLocked)

  let pinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "pin", "--socket", app.socketPath, "--json", created.tabID.uuidString],
        cwd: space.directory)
    )
  )
  #expect(pinned.isPinned)

  let unpinned = try decodeSPJSON(
    SupatermPinTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "unpin", "--socket", app.socketPath, "--json", created.tabID.uuidString],
        cwd: space.directory)
    )
  )
  #expect(!unpinned.isPinned)

  try exerciseTabNavigation(app: app, space: space, cliSpace: cliSpace, runner: runner)
  return CLITabE2E(result: created, runner: runner)
}

private func exerciseTabNavigation(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  runner: SPBinaryRunner
) throws {
  let focusedOriginalTab = try decodeSPJSON(
    SupatermSelectTabResult.self,
    from: try requireSuccessfulSPResult(
      try runner.run(
        ["tab", "focus", "--socket", app.socketPath, "--json", cliSpace.result.tabID.uuidString],
        cwd: space.directory
      )
    )
  )
  #expect(focusedOriginalTab.target.tabID == cliSpace.result.tabID)

  for command in ["next", "prev", "last"] {
    _ = try requireSuccessfulSPResult(
      try cliSpace.runner.run(
        [
          "tab", command, "--socket", app.socketPath, "--plain",
          cliSpace.result.target.spaceID.uuidString,
        ],
        cwd: space.directory
      )
    )
  }
}

private func exercisePaneCommands(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  cliTab: CLITabE2E
) async throws {
  let created = cliTab.result
  let split = try decodeSPJSON(
    SupatermNewPaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "split", "--socket", app.socketPath, "--json", "right",
          "--in", created.paneID.uuidString, "--cwd", space.directory.path,
          "--layout", "keep", "--",
        ] + hermeticShellArguments,
        cwd: space.directory
      )
    )
  )
  #expect(split.direction == .right)
  try await app.waitForShellPrompt(SupatermPaneTargetRequest(paneID: split.paneID))
  try await exercisePaneIO(app: app, space: space, cliTab: cliTab)
  try await closeCLIResources(
    app: app, space: space, cliSpace: cliSpace, cliTab: cliTab, splitPaneID: split.paneID)
}

private func exercisePaneIO(
  app: SupatermE2EApp,
  space: TestSpace,
  cliTab: CLITabE2E
) async throws {
  let created = cliTab.result
  let paneRef = try listedRef(
    .pane,
    id: created.paneID,
    app: app,
    runner: cliTab.runner,
    cwd: space.directory
  )
  let focusedPane = try decodeSPJSON(
    SupatermFocusPaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "focus", "--socket", app.socketPath, "--json", paneRef],
        cwd: space.directory
      )
    )
  )
  #expect(focusedPane.target.paneID == created.paneID)

  let marker = "pane-cli-\(space.token)"
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "send", "--socket", app.socketPath, "--newline", "--plain",
        paneRef, "printf '\(marker)\\n'",
      ],
      cwd: space.directory
    )
  )
  try await app.waitForCapture(SupatermPaneTargetRequest(paneID: created.paneID), contains: marker)

  let submittedMarker = "pane-submit-\(space.token)"
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "send", "--socket", app.socketPath, "--submit", "--plain",
        created.paneID.uuidString, "-",
      ],
      cwd: space.directory,
      stdin: Data("printf '\(submittedMarker)-one\\n'\nprintf '\(submittedMarker)-two\\n'".utf8)
    )
  )
  try await app.waitForCapture(
    SupatermPaneTargetRequest(paneID: created.paneID),
    contains: "\(submittedMarker)-two"
  )

  let capture = try decodeSPJSON(
    SupatermCapturePaneResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "capture", "--socket", app.socketPath, "--json",
          "--scope", "scrollback", "--lines", "12", created.paneID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(capture.text.contains(marker))
  #expect(capture.text.contains("\(submittedMarker)-one"))
  #expect(capture.text.contains("\(submittedMarker)-two"))
  try exercisePaneStatusAndActions(app: app, space: space, cliTab: cliTab)
}

private func exercisePaneStatusAndActions(
  app: SupatermE2EApp,
  space: TestSpace,
  cliTab: CLITabE2E
) throws {
  let created = cliTab.result
  let health = try decodeSPJSON(
    SupatermPaneHealthResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        ["pane", "health", "--socket", app.socketPath, "--json", created.paneID.uuidString],
        cwd: space.directory)
    )
  )
  #expect(health.isReady)

  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "wait-ready", "--socket", app.socketPath, "--plain", created.paneID.uuidString,
        "--timeout", "5",
      ],
      cwd: space.directory
    )
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      [
        "pane", "resize", "--socket", app.socketPath, "--plain", "right", "1",
        created.paneID.uuidString,
      ],
      cwd: space.directory
    )
  )
  for layout in ["equalize", "tile", "main-vertical"] {
    _ = try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "layout", "--socket", app.socketPath, "--plain", layout, created.tabID.uuidString,
        ],
        cwd: space.directory)
    )
  }

  let notification = try decodeSPJSON(
    SupatermNotifyResult.self,
    from: try requireSuccessfulSPResult(
      try cliTab.runner.run(
        [
          "pane", "notify", "--socket", app.socketPath, "--json",
          "--title", "CLI \(space.token)", "--body", "body", created.paneID.uuidString,
        ],
        cwd: space.directory
      )
    )
  )
  #expect(notification.resolvedTitle == "CLI \(space.token)")
  let invalidCapture = try requireFailedSPResult(
    try cliTab.runner.run(
      ["pane", "capture", "--socket", app.socketPath, "--lines", "0", created.paneID.uuidString],
      cwd: space.directory)
  )
  #expect(invalidCapture.stderr.contains("--lines must be 1 or greater"))
}

private func closeCLIResources(
  app: SupatermE2EApp,
  space: TestSpace,
  cliSpace: CLISpaceE2E,
  cliTab: CLITabE2E,
  splitPaneID: UUID
) async throws {
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["pane", "close", "--socket", app.socketPath, "--json", splitPaneID.uuidString],
      cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliTab.runner.run(
      ["tab", "close", "--socket", app.socketPath, "--json", cliTab.result.tabID.uuidString],
      cwd: space.directory)
  )
  _ = try requireSuccessfulSPResult(
    try cliSpace.runner.run(
      [
        "space", "destroy", "--socket", app.socketPath, "--json", "-y",
        cliSpace.result.target.spaceID.uuidString,
      ],
      cwd: space.directory)
  )
  try await app.waitForDebugSnapshot("CLI-created space closes") { snapshot in
    !snapshot.windows.flatMap(\.spaces).contains { $0.id == cliSpace.result.target.spaceID }
  }
}
