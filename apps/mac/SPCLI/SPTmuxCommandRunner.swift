import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

struct SPTmuxCommandRunner {
  let transport: any SPTmuxTransport
  let environment: [String: String]

  var context: SupatermCLIContext? {
    SupatermCLIContext(environment: environment)
  }

  var homeDirectoryURL: URL {
    cliHomeDirectoryURL(environment: environment)
  }

  func run(arguments: [String]) throws {
    let (command, rawArguments) = try splitTmuxCommand(arguments)
    trace(
      "command",
      fields: [
        "command": command,
        "arguments": rawArguments.joined(separator: "\u{1f}"),
        "context_surface_id": context?.surfaceID.uuidString.lowercased(),
        "tmux": environment["TMUX"],
        "tmux_pane": environment["TMUX_PANE"],
      ]
    )

    guard
      try runSessionCommand(command, rawArguments)
        || runWindowCommand(command, rawArguments)
        || runPaneCommand(command, rawArguments)
        || runBufferCommand(command, rawArguments)
        || runClientCommand(command, rawArguments)
    else {
      throw ValidationError("Unsupported tmux compatibility command: \(command)")
    }
  }

  private func runSessionCommand(_ command: String, _ arguments: [String]) throws -> Bool {
    switch command {
    case "new-session", "new":
      try runNewSession(arguments)

    case "has-session", "has":
      _ = try topology().resolveSpace(raw: parsedTargetValue(arguments))

    default:
      return false
    }
    return true
  }

  private func runWindowCommand(_ command: String, _ arguments: [String]) throws -> Bool {
    switch command {
    case "new-window", "neww":
      try runNewWindow(arguments)

    case "select-window", "selectw":
      try runSelectWindow(arguments)

    case "kill-window", "killw":
      try runKillWindow(arguments)

    case "rename-window", "renamew":
      try runRenameWindow(arguments)

    case "list-windows", "lsw":
      try runListWindows(arguments)

    case "last-window":
      try runLastWindow(arguments)

    case "next-window":
      try runNextWindow(arguments)

    case "previous-window":
      try runPreviousWindow(arguments)

    default:
      return false
    }
    return true
  }

  private func runPaneCommand(_ command: String, _ arguments: [String]) throws -> Bool {
    switch command {
    case "split-window", "splitw":
      try runSplitWindow(arguments)

    case "select-pane", "selectp":
      try runSelectPane(arguments)

    case "kill-pane", "killp":
      try runKillPane(arguments)

    case "send-keys", "send":
      try runSendKeys(arguments)

    case "capture-pane", "capturep":
      try runCapturePane(arguments)

    case "list-panes", "lsp":
      try runListPanes(arguments)

    case "resize-pane", "resizep":
      try runResizePane(arguments)

    case "last-pane":
      try runLastPane(arguments)

    case "select-layout":
      try runSelectLayout(arguments)

    default:
      return false
    }
    return true
  }

  private func runBufferCommand(_ command: String, _ arguments: [String]) throws -> Bool {
    switch command {
    case "show-buffer", "showb":
      try runShowBuffer(arguments)

    case "save-buffer", "saveb":
      try runSaveBuffer(arguments)

    case "set-buffer":
      try runSetBuffer(arguments)

    case "list-buffers":
      try runListBuffers(arguments)

    case "paste-buffer":
      try runPasteBuffer(arguments)

    default:
      return false
    }
    return true
  }

  private func runClientCommand(_ command: String, _ arguments: [String]) throws -> Bool {
    switch command {
    case "display-message", "display", "displayp":
      try runDisplayMessage(arguments)

    case "wait-for":
      try runWaitFor(arguments)

    case "set-hook":
      try runSetHook(arguments)

    case "set-option", "set", "set-window-option", "setw", "source-file", "refresh-client",
      "attach-session", "detach-client":
      break

    default:
      return false
    }
    return true
  }

  func focusedContext() throws -> SPRunLauncher.FocusedContext {
    let current = try topology().current
    return SPRunLauncher.FocusedContext(
      spaceID: current.space.id,
      tabID: current.tab.id,
      paneID: current.pane.id
    )
  }

  private func runNewSession(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-n", "-s", "-t"],
      boolFlags: ["-A", "-d", "-P"]
    )
    if parsed.hasFlag("-A") {
      throw ValidationError("new-session -A is not supported.")
    }

    guard
      let name = trimmedNonEmpty(parsed.value("-n") ?? parsed.value("-s"))
    else {
      throw ValidationError("new-session requires -n or -s for the new space name.")
    }
    let created = try send(
      .createSpace(
        SupatermCreateSpaceRequest(color: nil, name: name, context: SupatermCLIContext.current)
      ),
      as: SupatermCreateSpaceResult.self
    )

    if let text = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c")) {
      let wrappedText = wrappedRunPaneCommand(
        text,
        spaceID: created.target.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "new_session_send_text",
        target: SupatermPaneTargetRequest(paneID: created.paneID),
        text: wrappedText,
        sourceText: text
      )
      _ = try send(
        .sendText(
          SupatermSendTextRequest(
            target: SupatermPaneTargetRequest(paneID: created.paneID),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.target.windowIndex,
        spaceIndex: created.target.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = "$\(created.target.spaceID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runNewWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-n", "-t"],
      boolFlags: ["-d", "-P"]
    )
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    let command = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c"))
    let created = try send(
      .newTab(
        SupatermNewTabRequest(
          startupCommand: nil,
          cwd: try resolvedWorkingDirectory(parsed.value("-c")),
          focus: false,
          target: .space(targetSpace.space.id),
          context: SupatermCLIContext.current
        )
      ),
      as: SupatermNewTabResult.self
    )

    if let title = trimmedNonEmpty(parsed.value("-n")) {
      _ = try send(
        .renameTab(
          SupatermRenameTabRequest(
            target: SupatermTabTargetRequest(tabID: created.tabID),
            title: title
          )
        ),
        as: SupatermRenameTabResult.self
      )
    }

    if let command {
      let wrappedText = wrappedRunPaneCommand(
        command,
        spaceID: created.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "new_window_send_text",
        target: SupatermPaneTargetRequest(paneID: created.paneID),
        text: wrappedText,
        sourceText: command
      )
      _ = try send(
        .sendText(
          SupatermSendTextRequest(
            target: SupatermPaneTargetRequest(paneID: created.paneID),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.windowIndex,
        spaceIndex: created.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = context["window_id"] ?? "@\(created.tabID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runSplitWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-c", "-F", "-l", "-t"],
      boolFlags: ["-P", "-b", "-d", "-h", "-v"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let command = tmuxShellCommandText(commandTokens: parsed.positional, cwd: parsed.value("-c"))
    let direction: SupatermPaneDirection =
      if parsed.hasFlag("-h") {
        parsed.hasFlag("-b") ? .left : .right
      } else {
        parsed.hasFlag("-b") ? .up : .down
      }

    let created = try send(
      .newPane(
        SupatermNewPaneRequest(
          startupCommand: nil,
          direction: direction,
          focus: false,
          equalize: false,
          target: .pane(targetPane.pane.id)
        )
      ),
      as: SupatermNewPaneResult.self
    )

    if let sizeRequest = try tmuxSetPaneSizeRequest(
      rawAmount: parsed.value("-l"),
      axis: tmuxPaneAxis(for: direction),
      target: SupatermPaneTargetRequest(paneID: created.paneID)
    ) {
      _ = try send(
        .setPaneSize(sizeRequest),
        as: SupatermSetPaneSizeResult.self
      )
    }

    if let command {
      let wrappedText = wrappedRunPaneCommand(
        command,
        spaceID: created.spaceID,
        tabID: created.tabID,
        paneID: created.paneID,
        environment: environment
      )
      traceSendText(
        event: "split_window_send_text",
        target: SupatermPaneTargetRequest(paneID: created.paneID),
        text: wrappedText,
        sourceText: command
      )
      _ = try send(
        .sendText(
          SupatermSendTextRequest(
            target: SupatermPaneTargetRequest(paneID: created.paneID),
            text: wrappedText
          )
        ),
        as: SupatermSendTextResult.self
      )
    }

    if parsed.hasFlag("-P") {
      let createdPane = try topology().locatePane(
        windowIndex: created.windowIndex,
        spaceIndex: created.spaceIndex,
        tabIndex: created.tabIndex,
        paneIndex: created.paneIndex
      )
      let context = formatContext(for: createdPane)
      let fallback = context["pane_id"] ?? "%\(created.paneID.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runSelectWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    if let target = parsed.value("-t"), isLastSelector(target) {
      try runLastWindow([])
      return
    }
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .selectTab(
        targetTab.targetRequest
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runSelectPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-P", "-T", "-t"], boolFlags: [])
    if parsed.value("-P") != nil || parsed.value("-T") != nil {
      return
    }
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .focusPane(
        targetPane.targetRequest
      ),
      as: SupatermFocusPaneResult.self
    )
  }

  private func runKillWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .closeTab(
        targetTab.targetRequest
      ),
      as: SupatermCloseTabResult.self
    )
  }

  private func runKillPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .closePane(
        targetPane.targetRequest
      ),
      as: SupatermClosePaneResult.self
    )
  }

  private func runSendKeys(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: ["-l"])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let text = tmuxSendKeysText(from: parsed.positional, literal: parsed.hasFlag("-l"))
    guard !text.isEmpty else {
      return
    }
    let target = targetPane.targetRequest
    traceSendText(
      event: "send_keys_text",
      target: target,
      text: text
    )
    _ = try send(
      .sendText(
        SupatermSendTextRequest(
          target: target,
          text: text
        )
      ),
      as: SupatermSendTextResult.self
    )
  }

  private func runCapturePane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-E", "-S", "-t"],
      boolFlags: ["-J", "-N", "-p"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let lines: Int? = {
      guard let start = parsed.value("-S"), let value = Int(start), value < 0 else {
        return nil
      }
      return abs(value)
    }()
    let result = try send(
      .capturePane(
        SupatermCapturePaneRequest(
          lines: lines,
          scope: .scrollback,
          target: targetPane.targetRequest
        )
      ),
      as: SupatermCapturePaneResult.self
    )

    if parsed.hasFlag("-p") {
      print(result.text)
    } else {
      var store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)
      store.buffers["default"] = result.text
      try saveTmuxCompatStore(store, homeDirectoryURL: homeDirectoryURL)
    }
  }

  private func runDisplayMessage(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-F", "-t"], boolFlags: ["-p"])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let format =
      parsed.positional.isEmpty ? parsed.value("-F") : parsed.positional.joined(separator: " ")
    let rendered = renderFormat(format, context: formatContext(for: targetPane), fallback: "")
    if parsed.hasFlag("-p") || !rendered.isEmpty {
      print(rendered)
    }
  }

  private func runListWindows(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-F", "-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    for tab in targetSpace.space.flattenedTabs {
      let location = SPTmuxTopology.TabLocation(
        window: targetSpace.window,
        space: targetSpace.space,
        tab: tab
      )
      let context = formatContext(for: location)
      let fallback = "\(location.tabIndex) \(tab.title)"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runListPanes(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-F", "-t"], boolFlags: [])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    for pane in targetTab.tab.panes {
      let location = SPTmuxTopology.PaneLocation(
        window: targetTab.window,
        space: targetTab.space,
        tab: targetTab.tab,
        pane: pane
      )
      let context = formatContext(for: location)
      let fallback = context["pane_id"] ?? "%\(pane.id.uuidString.lowercased())"
      print(renderFormat(parsed.value("-F"), context: context, fallback: fallback))
    }
  }

  private func runRenameWindow(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let title = parsed.positional.joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !title.isEmpty else {
      throw ValidationError("rename-window requires a title.")
    }
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    _ = try send(
      .renameTab(
        SupatermRenameTabRequest(
          target: targetTab.targetRequest,
          title: title
        )
      ),
      as: SupatermRenameTabResult.self
    )
  }

  private func runResizePane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["-t", "-x", "-y"],
      boolFlags: ["-D", "-L", "-R", "-U"]
    )
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    let target = targetPane.targetRequest
    let sizeRequest =
      try tmuxSetPaneSizeRequest(
        rawAmount: parsed.value("-x"),
        axis: .horizontal,
        target: target
      )
      ?? tmuxSetPaneSizeRequest(
        rawAmount: parsed.value("-y"),
        axis: .vertical,
        target: target
      )
    if let sizeRequest {
      _ = try send(
        .setPaneSize(sizeRequest),
        as: SupatermSetPaneSizeResult.self
      )
      return
    }
    guard let direction = tmuxResizeDirection(flags: parsed.flags) else {
      return
    }
    let rawAmount = (parsed.value("-x") ?? parsed.value("-y") ?? "5")
      .replacingOccurrences(of: "%", with: "")
      .trimmingCharacters(in: .whitespacesAndNewlines)
    let amount = min(UInt16.max, UInt16(max(1, Int(rawAmount) ?? 5)))
    _ = try send(
      .resizePane(
        SupatermResizePaneRequest(
          amount: amount,
          direction: direction,
          target: target
        )
      ),
      as: SupatermResizePaneResult.self
    )
  }

  private func runSelectLayout(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: ["-E"])
    let targetTab = try topology().resolveTab(raw: parsed.value("-t"))
    let target = targetTab.targetRequest
    let layout = parsed.positional.first?.trimmingCharacters(in: .whitespacesAndNewlines)
      .lowercased()
    switch layout {
    case nil, "", "tile", "tiled":
      _ = try send(
        .tilePanes(target),
        as: SupatermTilePanesResult.self
      )
    case "main-vertical":
      _ = try send(
        .mainVerticalPanes(target),
        as: SupatermMainVerticalPanesResult.self
      )
    default:
      _ = try send(
        .equalizePanes(target),
        as: SupatermEqualizePanesResult.self
      )
    }
  }

  private func tmuxSetPaneSizeRequest(
    rawAmount: String?,
    axis: SupatermPaneAxis,
    target: SupatermPaneTargetRequest
  ) throws -> SupatermSetPaneSizeRequest? {
    guard let rawAmount = rawAmount?.trimmingCharacters(in: .whitespacesAndNewlines),
      !rawAmount.isEmpty
    else {
      return nil
    }
    let unit: SupatermPaneSizeUnit = rawAmount.hasSuffix("%") ? .percent : .cells
    let amountString =
      unit == .percent
      ? String(rawAmount.dropLast())
      : rawAmount
    guard let amount = Double(amountString), amount > 0 else {
      throw ValidationError("Invalid pane size: \(rawAmount).")
    }
    return SupatermSetPaneSizeRequest(amount: amount, axis: axis, target: target, unit: unit)
  }

  private func runWaitFor(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: ["--timeout"],
      boolFlags: ["-S", "--signal"]
    )
    guard let name = parsed.positional.first.flatMap(trimmedNonEmpty) else {
      throw ValidationError("wait-for requires a name.")
    }
    let signalURL = tmuxWaitForSignalURL(name: name, homeDirectoryURL: homeDirectoryURL)
    if parsed.hasFlag("-S") || parsed.hasFlag("--signal") {
      try FileManager.default.createDirectory(
        at: signalURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: signalURL.path, contents: Data())
      print("OK")
      return
    }

    let timeout = Double(parsed.value("--timeout") ?? "30") ?? 30
    let deadline = Date().addingTimeInterval(timeout)
    while Date() < deadline {
      if FileManager.default.fileExists(atPath: signalURL.path) {
        try? FileManager.default.removeItem(at: signalURL)
        print("OK")
        return
      }
      usleep(50_000)
    }

    if FileManager.default.fileExists(atPath: signalURL.path) {
      try? FileManager.default.removeItem(at: signalURL)
      print("OK")
      return
    }

    throw ValidationError("wait-for timed out waiting for '\(name)'.")
  }

  private func runLastPane(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .lastPane(
        targetPane.targetRequest
      ),
      as: SupatermFocusPaneResult.self
    )
  }

  private func runShowBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    if let buffer = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL).buffers[name] {
      print(buffer)
    }
  }

  private func runSaveBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    let store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)
    guard let buffer = store.buffers[name] else {
      throw ValidationError("Buffer not found: \(name).")
    }
    if let path = parsed.positional.last.flatMap(trimmedNonEmpty) {
      try buffer.write(toFile: resolvePath(path), atomically: true, encoding: .utf8)
    } else {
      print(buffer)
    }
  }

  private func runSetBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments, valueFlags: ["-b", "--name"], boolFlags: [])
    let name = parsed.value("-b") ?? parsed.value("--name") ?? "default"
    let content = parsed.positional.joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !content.isEmpty else {
      throw ValidationError("set-buffer requires text.")
    }
    var store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)
    store.buffers[name] = content
    try saveTmuxCompatStore(store, homeDirectoryURL: homeDirectoryURL)
    print("OK")
  }

  private func runListBuffers(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: [], boolFlags: [])
    guard parsed.positional.isEmpty else {
      throw ValidationError("list-buffers does not accept positional arguments.")
    }
    let store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)
    if store.buffers.isEmpty {
      print("No buffers")
      return
    }
    for name in store.buffers.keys.sorted() {
      let size = store.buffers[name]?.count ?? 0
      print("\(name)\t\(size)")
    }
  }

  private func runPasteBuffer(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-b", "-t"], boolFlags: [])
    let name = parsed.value("-b") ?? "default"
    let store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)
    guard let buffer = store.buffers[name] else {
      throw ValidationError("Buffer not found: \(name).")
    }
    let targetPane = try topology().resolvePane(raw: parsed.value("-t"))
    _ = try send(
      .sendText(
        SupatermSendTextRequest(
          target: targetPane.targetRequest,
          text: buffer
        )
      ),
      as: SupatermSendTextResult.self
    )
  }

  private func runLastWindow(_ arguments: [String]) throws {
    try runWindowNavigation(arguments) { try .lastTab($0) }
  }

  private func runNextWindow(_ arguments: [String]) throws {
    try runWindowNavigation(arguments) { try .nextTab($0) }
  }

  private func runPreviousWindow(_ arguments: [String]) throws {
    try runWindowNavigation(arguments) { try .previousTab($0) }
  }

  private func runWindowNavigation(
    _ arguments: [String],
    request: (SupatermTabNavigationRequest) throws -> SupatermSocketRequest
  ) throws {
    let parsed = try SPTmuxArgumentParser.parse(arguments, valueFlags: ["-t"], boolFlags: [])
    let targetSpace = try topology().resolveSpace(raw: parsed.value("-t"))
    _ = try send(
      try request(
        SupatermTabNavigationRequest(
          spaceID: targetSpace.space.id,
          context: SupatermCLIContext.current
        )
      ),
      as: SupatermSelectTabResult.self
    )
  }

  private func runSetHook(_ arguments: [String]) throws {
    let parsed = try SPTmuxArgumentParser.parse(
      arguments,
      valueFlags: [],
      boolFlags: ["--list", "--unset"]
    )
    var store = loadTmuxCompatStore(homeDirectoryURL: homeDirectoryURL)

    if parsed.hasFlag("--list") {
      if store.hooks.isEmpty {
        print("No hooks configured")
        return
      }
      for event in store.hooks.keys.sorted() {
        print("\(event) -> \(store.hooks[event] ?? "")")
      }
      return
    }

    if parsed.hasFlag("--unset") {
      guard let event = parsed.positional.last.flatMap(trimmedNonEmpty) else {
        throw ValidationError("set-hook --unset requires an event name.")
      }
      store.hooks.removeValue(forKey: event)
      try saveTmuxCompatStore(store, homeDirectoryURL: homeDirectoryURL)
      print("OK")
      return
    }

    guard let event = parsed.positional.first.flatMap(trimmedNonEmpty) else {
      throw ValidationError("set-hook requires <event> <command>.")
    }
    let commandText = parsed.positional.dropFirst().joined(separator: " ").trimmingCharacters(
      in: .whitespacesAndNewlines)
    guard !commandText.isEmpty else {
      throw ValidationError("set-hook requires <event> <command>.")
    }
    store.hooks[event] = commandText
    try saveTmuxCompatStore(store, homeDirectoryURL: homeDirectoryURL)
    print("OK")
  }

  private func topology() throws -> SPTmuxTopology {
    let snapshot = try send(
      .debug(SupatermDebugRequest(context: context)),
      as: SupatermAppDebugSnapshot.self
    )
    return try SPTmuxTopology(snapshot: snapshot, contextPaneID: context?.surfaceID)
  }

  private func formatContext(for pane: SPTmuxTopology.PaneLocation) -> [String: String] {
    [
      "session_id": "$\(pane.space.id.uuidString.lowercased())",
      "session_name": pane.space.name,
      "session_uuid": pane.space.id.uuidString.lowercased(),
      "window_active": pane.tab.isSelected ? "1" : "0",
      "window_id": "@\(pane.tab.id.uuidString.lowercased())",
      "window_index": String(pane.tabIndex),
      "window_name": pane.tab.title,
      "window_uuid": pane.tab.id.uuidString.lowercased(),
      "pane_active": pane.pane.isFocused ? "1" : "0",
      "pane_id": "%\(pane.pane.id.uuidString.lowercased())",
      "pane_index": String(pane.pane.index),
      "pane_title": pane.pane.displayTitle,
      "pane_uuid": pane.pane.id.uuidString.lowercased(),
    ]
  }

  private func formatContext(for tab: SPTmuxTopology.TabLocation) -> [String: String] {
    [
      "session_id": "$\(tab.space.id.uuidString.lowercased())",
      "session_name": tab.space.name,
      "session_uuid": tab.space.id.uuidString.lowercased(),
      "window_active": tab.tab.isSelected ? "1" : "0",
      "window_id": "@\(tab.tab.id.uuidString.lowercased())",
      "window_index": String(tab.tabIndex),
      "window_name": tab.tab.title,
      "window_uuid": tab.tab.id.uuidString.lowercased(),
    ]
  }

  private func renderFormat(
    _ format: String?,
    context: [String: String],
    fallback: String
  ) -> String {
    guard let format, !format.isEmpty else {
      return fallback
    }
    var rendered = format
    for (key, value) in context {
      rendered = rendered.replacingOccurrences(of: "#{\(key)}", with: value)
    }
    rendered = rendered.replacingOccurrences(
      of: "#\\{[^}]+\\}",
      with: "",
      options: .regularExpression
    )
    let trimmed = rendered.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? fallback : trimmed
  }

  private func send<Result: Decodable>(
    _ request: SupatermSocketRequest,
    as type: Result.Type
  ) throws -> Result {
    trace(
      "socket_request",
      fields: [
        "method": request.method,
        "request_id": request.id,
      ]
    )
    let response = try transport.send(request)
    guard response.ok else {
      trace(
        "socket_error",
        fields: [
          "method": request.method,
          "request_id": request.id,
          "message": response.error?.message,
        ]
      )
      throw ValidationError(response.error?.message ?? "Supaterm socket request failed.")
    }
    trace(
      "socket_response",
      fields: [
        "method": request.method,
        "request_id": request.id,
      ]
    )
    return try response.decodeResult(type)
  }

  private func trace(_ event: String, fields: [String: String?] = [:]) {
    SPTmuxTrace.write(
      category: "sp.tmux",
      event: event,
      fields: fields,
      environment: environment
    )
  }

  private func traceSendText(
    event: String,
    target: SupatermPaneTargetRequest,
    text: String,
    sourceText: String? = nil
  ) {
    trace(
      event,
      fields: sendTextTraceFields(
        target: target,
        text: text,
        sourceText: sourceText
      )
    )
  }
}
