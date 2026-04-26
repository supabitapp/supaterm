import AppKit
import ApplicationServices
import Darwin
import Foundation
import SupatermCLIShared

@_silgen_name("_AXUIElementGetWindow")
private func _AXUIElementGetWindow(
  _ element: AXUIElement,
  _ windowID: UnsafeMutablePointer<CGWindowID>
) -> AXError

@MainActor
struct ComputerUsePageRuntime {
  func page(_ request: SupatermComputerUsePageRequest) async throws -> SupatermComputerUsePageResult {
    switch request.action {
    case .enableJavaScriptAppleEvents:
      return try await enableJavaScriptAppleEvents(request)
    case .executeJavaScript:
      return try await executeJavaScript(request)
    case .getText:
      return try await getText(request)
    case .queryDOM:
      return try await queryDOM(request)
    }
  }

  private func enableJavaScriptAppleEvents(
    _ request: SupatermComputerUsePageRequest
  ) async throws -> SupatermComputerUsePageResult {
    guard let browser = request.browser else {
      throw ComputerUseError.pageTargetRequired
    }
    let dispatch = try await enableJavaScriptAppleEvents(browser: browser)
    return .init(action: request.action, dispatch: dispatch, text: browser.rawValue)
  }

  private func executeJavaScript(
    _ request: SupatermComputerUsePageRequest
  ) async throws -> SupatermComputerUsePageResult {
    let target = try pageTarget(request)
    guard let javascript = clean(request.javascript) else {
      throw ComputerUseError.pageTargetRequired
    }
    let evaluation = try await executeJavaScript(
      javascript,
      bundleID: target.bundleID,
      pid: target.pid,
      windowID: target.windowID
    )
    if let json = Self.jsonValue(fromJSONString: evaluation.value) {
      return .init(action: request.action, dispatch: evaluation.dispatch, json: json)
    }
    return .init(action: request.action, dispatch: evaluation.dispatch, text: evaluation.value)
  }

  private func getText(_ request: SupatermComputerUsePageRequest) async throws -> SupatermComputerUsePageResult {
    let target = try pageTarget(request)
    if shouldUseAXFirst(bundleID: target.bundleID, pid: target.pid),
      let text = axText(pid: target.pid, windowID: target.windowID)
    {
      return .init(action: request.action, dispatch: "accessibility_tree", text: text)
    }
    do {
      let evaluation = try await executeJavaScript(
        "document.body.innerText",
        bundleID: target.bundleID,
        pid: target.pid,
        windowID: target.windowID
      )
      return .init(action: request.action, dispatch: evaluation.dispatch, text: evaluation.value)
    } catch {
      if shouldUseAXAfterJavaScriptFailure(bundleID: target.bundleID, pid: target.pid),
        let text = axText(pid: target.pid, windowID: target.windowID)
      {
        return .init(
          action: request.action,
          dispatch: "accessibility_tree",
          text: text
        )
      }
      throw error
    }
  }

  private func queryDOM(_ request: SupatermComputerUsePageRequest) async throws -> SupatermComputerUsePageResult {
    let target = try pageTarget(request)
    guard let selector = clean(request.cssSelector) else {
      throw ComputerUseError.pageTargetRequired
    }
    if shouldUseAXFirst(bundleID: target.bundleID, pid: target.pid),
      let json = axQuery(selector: selector, pid: target.pid, windowID: target.windowID)
    {
      return .init(action: request.action, dispatch: "accessibility_tree", json: json)
    }
    do {
      let js = try Self.queryDOMJavaScript(selector: selector, attributes: request.attributes)
      let evaluation = try await executeJavaScript(
        js,
        bundleID: target.bundleID,
        pid: target.pid,
        windowID: target.windowID
      )
      guard let json = Self.jsonValue(fromJSONString: evaluation.value) else {
        throw ComputerUseError.pageExecutionFailed("DOM query did not return valid JSON.")
      }
      return .init(action: request.action, dispatch: evaluation.dispatch, json: json)
    } catch {
      if shouldUseAXAfterJavaScriptFailure(bundleID: target.bundleID, pid: target.pid),
        let json = axQuery(selector: selector, pid: target.pid, windowID: target.windowID)
      {
        return .init(
          action: request.action,
          dispatch: "accessibility_tree",
          json: json
        )
      }
      throw error
    }
  }

  func setSafariSelectValue(
    _ value: String,
    windowID: UInt32
  ) async throws -> ComputerUseSelectResult {
    let js = try Self.selectValueJavaScript(value: value)
    let result = try await AppleEventsBrowser.execute(
      javascript: js,
      bundleID: "com.apple.Safari",
      windowID: windowID
    )
    guard let json = Self.jsonValue(fromJSONString: result),
      let object = json.objectValue,
      case .bool(let ok)? = object["ok"]
    else {
      throw ComputerUseError.pageExecutionFailed("Safari select JavaScript returned an unexpected result.")
    }
    if ok {
      return .selected(object["value"]?.stringValue ?? value)
    }
    let available = object["available"]?.arrayValue?.compactMap(\.stringValue) ?? []
    return .notFound(available)
  }

  private func pageTarget(_ request: SupatermComputerUsePageRequest) throws -> PageTarget {
    guard let pid = request.pid, let windowID = request.windowID else {
      throw ComputerUseError.pageTargetRequired
    }
    return .init(pid: pid, windowID: windowID, bundleID: bundleID(for: pid) ?? "")
  }

  private func bundleID(for pid: Int) -> String? {
    NSWorkspace.shared.runningApplications
      .first { Int($0.processIdentifier) == pid }?
      .bundleIdentifier
  }

  private func enableJavaScriptAppleEvents(browser: SupatermComputerUsePageBrowser) async throws -> String {
    switch browser {
    case .chrome:
      try await enableChromiumJavaScriptAppleEvents(bundleID: browser.bundleID)
      return "browser_preferences"
    case .safari:
      try await enableSafariJavaScriptAppleEvents()
      return "safari_develop_menu"
    }
  }

  private func enableChromiumJavaScriptAppleEvents(bundleID: String) async throws {
    guard let profileDirectory = AppleEventsBrowser.profileDirectory(bundleID: bundleID) else {
      throw ComputerUseError.pageUnsupported(
        "JavaScript from Apple Events can only be enabled automatically for Chrome."
      )
    }
    if let appName = AppleEventsBrowser.appName(bundleID: bundleID) {
      _ = try? await ProcessRunner.run(
        executable: "/usr/bin/osascript",
        arguments: ["-e", "tell application \(try Self.appleScriptString(appName)) to quit"],
        timeout: 3
      )
      try? await Task.sleep(for: .seconds(1))
    }

    let fileManager = FileManager.default
    let entries = (try? fileManager.contentsOfDirectory(atPath: profileDirectory)) ?? []
    let preferenceFiles =
      entries
      .map { (profileDirectory as NSString).appendingPathComponent($0).appending("/Preferences") }
      .filter { fileManager.fileExists(atPath: $0) }
    guard !preferenceFiles.isEmpty else {
      throw ComputerUseError.pageExecutionFailed("No browser Preferences files were found under \(profileDirectory).")
    }
    for path in preferenceFiles {
      guard let data = fileManager.contents(atPath: path),
        var json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
      else { continue }
      var browser = json["browser"] as? [String: Any] ?? [:]
      browser["allow_javascript_apple_events"] = true
      json["browser"] = browser
      var accountValues = json["account_values"] as? [String: Any] ?? [:]
      var accountBrowser = accountValues["browser"] as? [String: Any] ?? [:]
      accountBrowser["allow_javascript_apple_events"] = true
      accountValues["browser"] = accountBrowser
      json["account_values"] = accountValues
      let patched = try JSONSerialization.data(withJSONObject: json)
      try patched.write(to: URL(fileURLWithPath: path))
    }

    _ = try await ProcessRunner.run(
      executable: "/usr/bin/open",
      arguments: ["-b", bundleID],
      timeout: 3
    )
  }

  private func enableSafariJavaScriptAppleEvents() async throws {
    guard NSWorkspace.shared.runningApplications.contains(where: { $0.bundleIdentifier == "com.apple.Safari" }) else {
      throw ComputerUseError.pageUnsupported("Safari must be running before enabling JavaScript from Apple Events.")
    }

    let defaults = try await ProcessRunner.run(
      executable: "/usr/bin/defaults",
      arguments: ["write", "com.apple.Safari", "IncludeDevelopMenu", "-bool", "true"],
      timeout: 3
    )
    guard defaults.status == 0 else {
      throw ComputerUseError.pageExecutionFailed(
        cleanProcessFailure(defaults, fallback: "Could not enable Safari Develop menu."))
    }

    let script = """
      tell application "Safari" to activate
      delay 0.3
      tell application "System Events"
        if not (exists process "Safari") then error "Safari process not found."
        tell process "Safari"
          set frontmost to true
          if not (exists menu bar item "Develop" of menu bar 1) then error "Safari Develop menu is unavailable."
          click menu bar item "Develop" of menu bar 1
          delay 0.2
          set developMenu to menu 1 of menu bar item "Develop" of menu bar 1
          set menuItem to menu item "Allow JavaScript from Apple Events" of developMenu
          set markChar to ""
          try
            set markChar to value of attribute "AXMenuItemMarkChar" of menuItem
          end try
          if markChar is not "" then
            key code 53
            return "already_enabled"
          end if
          click menuItem
          delay 0.5
          if exists button "Allow" of window 1 then
            click button "Allow" of window 1
          else if exists button "OK" of window 1 then
            click button "OK" of window 1
          end if
          return "enabled"
        end tell
      end tell
      """
    let output = try await ProcessRunner.runAppleScript(script, timeout: 12)
    guard output.status == 0 else {
      throw safariEnableError(output)
    }
  }

  private func executeJavaScript(
    _ javascript: String,
    bundleID: String,
    pid: Int,
    windowID: UInt32
  ) async throws -> PageEvaluation {
    if AppleEventsBrowser.supports(bundleID: bundleID) {
      return .init(
        dispatch: "apple_events",
        value: try await AppleEventsBrowser.execute(
          javascript: javascript,
          bundleID: bundleID,
          windowID: windowID
        )
      )
    }

    if ElectronPageRuntime.isElectron(pid: pid) {
      return .init(
        dispatch: "electron_cdp",
        value: try await ElectronPageRuntime.execute(javascript: javascript, pid: pid)
      )
    }

    let isWKWebViewApp = WebKitDetector.isWKWebViewApp(pid: pid)
    if let port = await WebKitTCPRuntime.availablePort(pid: pid, includeFallback: isWKWebViewApp) {
      return .init(
        dispatch: "webkit_cdp",
        value: try await CDPClient.evaluate(javascript: javascript, port: port)
      )
    }

    if isWKWebViewApp {
      throw ComputerUseError.pageUnsupported(
        "execute-javascript is unavailable for this WKWebView/Tauri app because the macOS WebKit "
          + "inspector requires a private entitlement. Use page get-text or page query-dom."
      )
    }

    throw ComputerUseError.pageUnsupported(
      "No supported browser page transport is available for \(bundleID.isEmpty ? "pid \(pid)" : bundleID)."
    )
  }

  private func shouldUseAXFirst(bundleID: String, pid: Int) -> Bool {
    !AppleEventsBrowser.supports(bundleID: bundleID)
      && !ElectronPageRuntime.isElectron(pid: pid)
      && WebKitDetector.isWKWebViewApp(pid: pid)
  }

  private func shouldUseAXAfterJavaScriptFailure(bundleID: String, pid: Int) -> Bool {
    shouldUseAXFirst(bundleID: bundleID, pid: pid)
  }

  private func axText(pid: Int, windowID: UInt32) -> String? {
    let elements = PageAXCollector.elements(pid: pid, windowID: windowID)
    let text = AXPageReader.extractText(from: elements)
    return text.isEmpty ? nil : text
  }

  private func axQuery(selector: String, pid: Int, windowID: UInt32) -> JSONValue? {
    let elements = AXPageReader.query(selector: selector, from: PageAXCollector.elements(pid: pid, windowID: windowID))
    guard !elements.isEmpty else { return nil }
    return .array(
      elements.map { element in
        var object: [String: JSONValue] = [
          "role": .string(element.role),
          "tag": .string(AXPageReader.tag(for: element.role)),
          "text": .string(element.text),
        ]
        if let description = clean(element.description) {
          object["description"] = .string(description)
        }
        if let identifier = clean(element.identifier) {
          object["identifier"] = .string(identifier)
        }
        return .object(object)
      })
  }

  private func clean(_ value: String?) -> String? {
    guard let value else { return nil }
    let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? nil : trimmed
  }

  private func cleanProcessFailure(_ output: ProcessOutput, fallback: String) -> String {
    clean(output.stderr) ?? clean(output.stdout) ?? fallback
  }

  private func safariEnableError(_ output: ProcessOutput) -> ComputerUseError {
    let detail = cleanProcessFailure(output, fallback: "Could not enable Safari JavaScript from Apple Events.")
    let lowercased = detail.lowercased()
    if lowercased.contains("assistive access")
      || lowercased.contains("not authorized")
      || lowercased.contains("not allowed")
      || lowercased.contains("not permitted")
    {
      return .accessibilityPermissionMissing
    }
    if detail.contains("Develop menu is unavailable") {
      return .pagePermissionRequired(
        "Safari Develop menu is unavailable. "
          + "Open Safari Settings > Advanced and enable web developer features, then retry."
      )
    }
    return .pageExecutionFailed(detail)
  }

  static func queryDOMJavaScript(selector: String, attributes: [String]) throws -> String {
    let selectorLiteral = try jsonLiteral(selector)
    let attributesLiteral = "[\(try attributes.map(jsonLiteral).joined(separator: ", "))]"
    return """
      (() => {
        const attrs = \(attributesLiteral);
        return JSON.stringify(
          Array.from(document.querySelectorAll(\(selectorLiteral))).map(el => {
            const obj = { tag: el.tagName.toLowerCase(), text: (el.innerText || '').trim() };
            for (const attr of attrs) obj[attr] = el.getAttribute(attr);
            return obj;
          })
        );
      })()
      """
  }

  static func selectValueJavaScript(value: String) throws -> String {
    let valueLiteral = try jsonLiteral(value.lowercased())
    return """
      (() => {
        const wanted = \(valueLiteral);
        const available = [];
        for (const select of document.querySelectorAll('select')) {
          for (const option of select.options) {
            const text = (option.text || '').toLowerCase();
            const current = (option.value || '').toLowerCase();
            available.push(`${option.text}|${option.value}`);
            if (text === wanted || current === wanted) {
              select.value = option.value;
              select.dispatchEvent(new Event('change', { bubbles: true }));
              return JSON.stringify({ ok: true, value: select.value });
            }
          }
        }
        return JSON.stringify({ ok: false, available });
      })()
      """
  }

  static func jsonLiteral(_ value: String) throws -> String {
    guard let literal = String(bytes: try JSONEncoder().encode(value), encoding: .utf8) else {
      throw ComputerUseError.pageExecutionFailed("Could not encode JSON string literal.")
    }
    return literal
  }

  static func jsonValue(fromJSONString string: String) -> JSONValue? {
    guard let data = string.data(using: .utf8) else { return nil }
    return try? JSONDecoder().decode(JSONValue.self, from: data)
  }

  static func appleEventsPermissionMessage(detail: String, appName: String, bundleID: String) -> String? {
    AppleEventsBrowser.permissionMessage(detail: detail, appName: appName, bundleID: bundleID)
  }

  static func appleScriptString(_ value: String) throws -> String {
    if !value.contains("\n") && !value.contains("\"") && !value.contains("\\") {
      return "\"\(value)\""
    }
    let lines = value.split(separator: "\n", omittingEmptySubsequences: false)
    let escaped = lines.map {
      let line = String($0)
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      return "\"\(line)\""
    }
    return escaped.joined(separator: " & (ASCII character 10) & ")
  }
}

enum ComputerUseSelectResult: Equatable {
  case selected(String)
  case notFound([String])
}

private struct PageTarget {
  let pid: Int
  let windowID: UInt32
  let bundleID: String
}

private struct PageEvaluation {
  let dispatch: String
  let value: String
}

private enum AppleEventsBrowser {
  struct Spec {
    let appName: String
    let script: (String, String) throws -> String
  }

  static func supports(bundleID: String) -> Bool {
    spec(bundleID: bundleID) != nil
  }

  static func appName(bundleID: String) -> String? {
    spec(bundleID: bundleID)?.appName
  }

  static func profileDirectory(bundleID: String) -> String? {
    let home = FileManager.default.homeDirectoryForCurrentUser.path
    switch bundleID {
    case "com.google.Chrome":
      return "\(home)/Library/Application Support/Google/Chrome"
    default:
      return nil
    }
  }

  static func execute(
    javascript: String,
    bundleID: String,
    windowID: UInt32
  ) async throws -> String {
    guard let spec = spec(bundleID: bundleID) else {
      throw ComputerUseError.pageUnsupported("Browser \(bundleID) does not support JavaScript through Apple Events.")
    }
    guard let title = windowTitle(windowID: windowID) else {
      throw ComputerUseError.windowNotFound(windowID)
    }
    let output = try await ProcessRunner.runAppleScript(
      try spec.script(javascript, title),
      timeout: 15
    )
    if output.status == 0 {
      return output.stdout.trimmingCharacters(in: .whitespacesAndNewlines)
    }
    let detail = output.stderr.isEmpty ? output.stdout : output.stderr
    if let message = permissionMessage(detail: detail, appName: spec.appName, bundleID: bundleID) {
      throw ComputerUseError.pagePermissionRequired(message)
    }
    throw ComputerUseError.pageExecutionFailed(detail.isEmpty ? "Apple Events JavaScript failed." : detail)
  }

  static func permissionMessage(detail: String, appName: String, bundleID: String) -> String? {
    let lowercased = detail.lowercased()
    guard
      lowercased.contains("allow javascript from apple events")
        || lowercased.contains("turned off")
        || lowercased.contains("not authorized")
        || lowercased.contains("not allowed")
        || lowercased.contains("not permitted")
    else {
      return nil
    }
    switch bundleID {
    case "com.google.Chrome":
      return
        "Google Chrome requires JavaScript from Apple Events. "
        + "Run `sp computer-use page enable-javascript-apple-events --browser chrome`, then retry."
    case "com.apple.Safari":
      return
        "Safari requires Allow JavaScript from Apple Events. "
        + "Run `sp computer-use page enable-javascript-apple-events --browser safari`, then retry."
    default:
      return "\(appName) requires JavaScript from Apple Events. Enable it in the browser, then retry."
    }
  }

  private static func spec(bundleID: String) -> Spec? {
    switch bundleID {
    case "com.google.Chrome":
      return chromiumSpec(appName: "Google Chrome")
    case "com.brave.Browser":
      return chromiumSpec(appName: "Brave Browser")
    case "com.microsoft.edgemac":
      return chromiumSpec(appName: "Microsoft Edge")
    case "com.apple.Safari":
      return safariSpec()
    default:
      return nil
    }
  }

  private static func chromiumSpec(appName: String) -> Spec {
    .init(appName: appName) { javascript, title in
      let escapedTitle =
        title
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      return """
        tell application "\(appName)"
          set matchedWindow to missing value
          repeat with w in windows
            if name of w contains "\(escapedTitle)" then
              set matchedWindow to w
              exit repeat
            end if
          end repeat
          if matchedWindow is missing value then
            set matchedWindow to front window
          end if
          tell active tab of matchedWindow
            execute javascript \(try ComputerUsePageRuntime.appleScriptString(javascript))
          end tell
        end tell
        """
    }
  }

  private static func safariSpec() -> Spec {
    .init(appName: "Safari") { javascript, title in
      let escapedTitle =
        title
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
      return """
        tell application "Safari"
          set matchedDoc to missing value
          repeat with d in documents
            if name of d contains "\(escapedTitle)" then
              set matchedDoc to d
              exit repeat
            end if
          end repeat
          if matchedDoc is missing value then
            set matchedDoc to document 1
          end if
          do JavaScript \(try ComputerUsePageRuntime.appleScriptString(javascript)) in matchedDoc
        end tell
        """
    }
  }

  private static func windowTitle(windowID: UInt32) -> String? {
    for options in [CGWindowListOption.optionOnScreenOnly, CGWindowListOption.optionAll] {
      let list =
        CGWindowListCopyWindowInfo(
          [options, .excludeDesktopElements],
          kCGNullWindowID
        ) as? [[String: Any]] ?? []
      for entry in list {
        guard let id = entry[kCGWindowNumber as String] as? NSNumber, id.uint32Value == windowID else {
          continue
        }
        return entry[kCGWindowName as String] as? String ?? ""
      }
    }
    return nil
  }
}

private enum ElectronPageRuntime {
  static func isElectron(pid: Int) -> Bool {
    guard let bundleURL = runningApp(pid: pid)?.bundleURL else { return false }
    return FileManager.default.fileExists(
      atPath: bundleURL.appendingPathComponent("Contents/Frameworks/Electron Framework.framework").path
    )
  }

  static func execute(javascript: String, pid: Int) async throws -> String {
    guard isElectron(pid: pid) else {
      throw ComputerUseError.pageUnsupported("pid \(pid) is not an Electron app.")
    }
    if let pagePort = await pageTargetPort(pid: pid) {
      return try await CDPClient.evaluate(javascript: javascript, port: pagePort)
    }
    if let existingPort = await activeInspectorPort(pid: pid) {
      return try await CDPClient.evaluate(javascript: javascript, port: existingPort)
    }
    let portsBefore = await ProcessRunner.listeningTCPPorts(pid: pid)
    kill(pid_t(pid), SIGUSR1)
    for _ in 0..<10 {
      try await Task.sleep(for: .milliseconds(200))
      let portsAfter = await ProcessRunner.listeningTCPPorts(pid: pid)
      for port in portsAfter.subtracting(portsBefore) where await CDPClient.isAvailable(port: port) {
        return try await CDPClient.evaluate(javascript: javascript, port: port)
      }
      if let port = await scanInspectorPorts() {
        return try await CDPClient.evaluate(javascript: javascript, port: port)
      }
    }
    throw ComputerUseError.pageUnsupported("Electron inspector did not become available for pid \(pid).")
  }

  private static func pageTargetPort(pid: Int) async -> Int? {
    let candidates = [9222, 9223, 9224, 9225, 9230]
    let ownedPorts = await ProcessRunner.listeningTCPPorts(pid: pid)
    let ports = ownedPorts.isEmpty ? candidates : candidates.filter { ownedPorts.contains($0) }
    return await CDPClient.findPageTarget(ports: ports)
  }

  private static func activeInspectorPort(pid: Int) async -> Int? {
    for port in await ProcessRunner.listeningTCPPorts(pid: pid) where await CDPClient.isAvailable(port: port) {
      return port
    }
    return nil
  }

  private static func scanInspectorPorts() async -> Int? {
    for port in 9229...9249 where await CDPClient.isAvailable(port: port) {
      return port
    }
    return nil
  }

  private static func runningApp(pid: Int) -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { Int($0.processIdentifier) == pid }
  }
}

private enum WebKitTCPRuntime {
  static func availablePort(pid: Int, includeFallback: Bool) async -> Int? {
    for port in await ProcessRunner.listeningTCPPorts(pid: pid) where await CDPClient.isAvailable(port: port) {
      return port
    }
    guard includeFallback else { return nil }
    for port in 9226...9228 where await CDPClient.isAvailable(port: port) {
      return port
    }
    return nil
  }
}

private enum WebKitDetector {
  static func isWKWebViewApp(pid: Int) -> Bool {
    guard let app = NSWorkspace.shared.runningApplications.first(where: { Int($0.processIdentifier) == pid }),
      let bundleURL = app.bundleURL
    else {
      return false
    }
    let electronFramework = bundleURL.appendingPathComponent("Contents/Frameworks/Electron Framework.framework")
    if FileManager.default.fileExists(atPath: electronFramework.path) {
      return false
    }
    let bundlePath = bundleURL.path.lowercased()
    if bundlePath.contains("tauri") {
      return true
    }
    let webKitFramework = bundleURL.appendingPathComponent("Contents/Frameworks/WebKit.framework")
    if FileManager.default.fileExists(atPath: webKitFramework.path) {
      return true
    }
    guard let executableURL = app.executableURL,
      let output = try? ProcessRunner.runSync(
        executable: "/usr/bin/otool",
        arguments: ["-L", executableURL.path],
        timeout: 1
      )
    else {
      return false
    }
    return output.stdout.contains("WebKit.framework") || output.stdout.contains("libwebkit")
  }
}

private enum CDPClient {
  static func isAvailable(port: Int) async -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/json") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 0.5
    return (try? await URLSession.shared.data(for: request)) != nil
  }

  static func findPageTarget(ports: [Int]) async -> Int? {
    for port in ports {
      guard let targets = await targets(port: port),
        targets.contains(where: { ($0["type"] as? String) == "page" })
      else {
        continue
      }
      return port
    }
    return nil
  }

  static func evaluate(javascript: String, port: Int) async throws -> String {
    guard let targets = await targets(port: port) else {
      throw ComputerUseError.pageUnsupported("No CDP target list was available on port \(port).")
    }
    let target =
      targets.first { ($0["type"] as? String) == "page" }
      ?? targets.first { $0["webSocketDebuggerUrl"] != nil }
    guard let urlString = target?["webSocketDebuggerUrl"] as? String,
      let url = URL(string: urlString)
    else {
      throw ComputerUseError.pageUnsupported("No CDP WebSocket target was available on port \(port).")
    }

    let payload: [String: Any] = [
      "id": 1,
      "method": "Runtime.evaluate",
      "params": [
        "expression": javascript,
        "returnByValue": true,
        "awaitPromise": true,
      ],
    ]
    guard
      let payloadString = String(
        bytes: try JSONSerialization.data(withJSONObject: payload),
        encoding: .utf8
      )
    else {
      throw ComputerUseError.pageExecutionFailed("Could not encode CDP payload.")
    }
    return try await websocketEvaluate(url: url, payload: payloadString, requestID: 1)
  }

  private static func targets(port: Int) async -> [[String: Any]]? {
    guard let url = URL(string: "http://127.0.0.1:\(port)/json") else { return nil }
    var request = URLRequest(url: url)
    request.timeoutInterval = 1
    guard let (data, _) = try? await URLSession.shared.data(for: request) else { return nil }
    return try? JSONSerialization.jsonObject(with: data) as? [[String: Any]]
  }

  private static func websocketEvaluate(
    url: URL,
    payload: String,
    requestID: Int
  ) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      let task = URLSession.shared.webSocketTask(with: url)
      let state = CDPEvaluationState(task: task, continuation: continuation)
      let resume: @Sendable (Result<String, Error>) -> Void = { result in
        state.resume(result)
      }

      task.resume()
      DispatchQueue.global().asyncAfter(deadline: .now() + 10) {
        resume(.failure(ComputerUseError.pageTimedOut("CDP response timed out after 10 seconds.")))
      }
      task.send(.string(payload)) { error in
        if let error {
          resume(.failure(ComputerUseError.pageExecutionFailed(error.localizedDescription)))
          return
        }
        receiveMatchingFrame(task: task, requestID: requestID, resume: resume)
      }
    }
  }

  nonisolated private static func receiveMatchingFrame(
    task: URLSessionWebSocketTask,
    requestID: Int,
    resume: @escaping @Sendable (Result<String, Error>) -> Void
  ) {
    task.receive { result in
      switch result {
      case .failure(let error):
        resume(.failure(ComputerUseError.pageExecutionFailed(error.localizedDescription)))
      case .success(let message):
        let text: String
        switch message {
        case .string(let string):
          text = string
        case .data(let data):
          text = String(bytes: data, encoding: .utf8) ?? ""
        @unknown default:
          receiveMatchingFrame(task: task, requestID: requestID, resume: resume)
          return
        }
        guard let data = text.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else {
          receiveMatchingFrame(task: task, requestID: requestID, resume: resume)
          return
        }
        if object["method"] != nil {
          receiveMatchingFrame(task: task, requestID: requestID, resume: resume)
          return
        }
        guard object["id"] as? Int == requestID else {
          receiveMatchingFrame(task: task, requestID: requestID, resume: resume)
          return
        }
        resume(Result { try parseResult(text) })
      }
    }
  }

  nonisolated private static func parseResult(_ json: String) throws -> String {
    guard let data = json.data(using: .utf8),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      return json
    }
    if let error = object["error"] as? [String: Any] {
      throw ComputerUseError.pageExecutionFailed(error["message"] as? String ?? json)
    }
    guard let result = object["result"] as? [String: Any],
      let inner = result["result"] as? [String: Any]
    else {
      return json
    }
    if let exception = result["exceptionDetails"] as? [String: Any] {
      throw ComputerUseError.pageExecutionFailed(exception["text"] as? String ?? "JavaScript threw an exception.")
    }
    if let value = inner["value"] {
      if let string = value as? String {
        return string
      }
      if let number = value as? NSNumber {
        return number.stringValue
      }
      if JSONSerialization.isValidJSONObject(value),
        let data = try? JSONSerialization.data(withJSONObject: value),
        let string = String(data: data, encoding: .utf8)
      {
        return string
      }
      return "\(value)"
    }
    return inner["description"] as? String ?? "undefined"
  }

  nonisolated private final class CDPEvaluationState: @unchecked Sendable {
    private let lock = NSLock()
    private var finished = false
    private let task: URLSessionWebSocketTask
    private let continuation: CheckedContinuation<String, Error>

    init(task: URLSessionWebSocketTask, continuation: CheckedContinuation<String, Error>) {
      self.task = task
      self.continuation = continuation
    }

    func resume(_ result: Result<String, Error>) {
      lock.lock()
      let shouldResume = !finished
      finished = true
      lock.unlock()
      guard shouldResume else { return }
      task.cancel()
      continuation.resume(with: result)
    }
  }
}

struct PageAXElement: Equatable {
  let role: String
  let title: String?
  let value: String?
  let description: String?
  let identifier: String?
  let help: String?

  var text: String {
    title ?? value ?? description ?? identifier ?? help ?? ""
  }
}

enum PageAXCollector {
  static func elements(pid: Int, windowID: UInt32) -> [PageAXElement] {
    let app = AXUIElementCreateApplication(pid_t(pid))
    guard let window = targetWindow(in: app, windowID: windowID) else {
      return []
    }
    var result: [PageAXElement] = []
    collect(window, targetWindowID: windowID, depth: 0, result: &result)
    return result
  }

  private static func collect(
    _ element: AXUIElement,
    targetWindowID: UInt32,
    depth: Int,
    result: inout [PageAXElement]
  ) {
    guard depth <= 12, result.count < 1200 else { return }
    let role = axString(element, kAXRoleAttribute as CFString) ?? "unknown"
    let currentWindowID = elementWindowID(element)
    guard currentWindowID == nil || currentWindowID == targetWindowID else { return }
    result.append(
      .init(
        role: role,
        title: axString(element, kAXTitleAttribute as CFString),
        value: axString(element, kAXValueAttribute as CFString),
        description: axString(element, kAXDescriptionAttribute as CFString),
        identifier: axString(element, kAXIdentifierAttribute as CFString),
        help: axString(element, kAXHelpAttribute as CFString)
      )
    )

    for child in axArray(element, kAXChildrenAttribute as CFString) ?? [] {
      if axString(child, kAXRoleAttribute as CFString) == kAXWindowRole as String,
        elementWindowID(child) != targetWindowID
      {
        continue
      }
      collect(child, targetWindowID: targetWindowID, depth: depth + 1, result: &result)
    }
  }

  private static func targetWindow(in appElement: AXUIElement, windowID: UInt32) -> AXUIElement? {
    for window in axArray(appElement, kAXWindowsAttribute as CFString) ?? [] where elementWindowID(window) == windowID {
      return window
    }
    for child in axArray(appElement, kAXChildrenAttribute as CFString) ?? []
    where axString(child, kAXRoleAttribute as CFString) == kAXWindowRole as String && elementWindowID(child) == windowID
    {
      return child
    }
    return nil
  }

  private static func elementWindowID(_ element: AXUIElement) -> UInt32? {
    var windowID = CGWindowID(0)
    guard _AXUIElementGetWindow(element, &windowID) == .success, windowID != 0 else {
      return nil
    }
    return UInt32(windowID)
  }

  private static func axArray(_ element: AXUIElement, _ attribute: CFString) -> [AXUIElement]? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    return value as? [AXUIElement]
  }

  private static func axString(_ element: AXUIElement, _ attribute: CFString) -> String? {
    var value: CFTypeRef?
    guard AXUIElementCopyAttributeValue(element, attribute, &value) == .success else { return nil }
    if let string = value as? String {
      return string.isEmpty ? nil : string
    }
    if let attributed = value as? NSAttributedString {
      return attributed.string.isEmpty ? nil : attributed.string
    }
    return nil
  }
}

enum AXPageReader {
  static func extractText(from elements: [PageAXElement]) -> String {
    var lines: [String] = []
    for element in elements {
      let text = element.text.trimmingCharacters(in: .whitespacesAndNewlines)
      guard !text.isEmpty else { continue }
      switch element.role {
      case "AXStaticText", "AXHeading", "AXWebArea", "AXLink", "AXButton", "AXTextField", "AXTextArea", "AXComboBox",
        "AXPopUpButton", "AXImage", "AXCell", "AXRow":
        lines.append(text)
      default:
        if !structuralRoles.contains(element.role) {
          lines.append(text)
        }
      }
    }
    var deduped: [String] = []
    for line in lines where deduped.last != line {
      deduped.append(line)
    }
    return deduped.joined(separator: "\n")
  }

  static func query(selector: String, from elements: [PageAXElement]) -> [PageAXElement] {
    let roles = cssToAXRoles(selector)
    let matchesAll = roles.isEmpty
    return elements.filter { matchesAll || roles.contains($0.role) }
  }

  static func tag(for role: String) -> String {
    switch role {
    case "AXLink":
      return "a"
    case "AXButton":
      return "button"
    case "AXTextField", "AXCheckBox", "AXRadioButton", "AXSlider", "AXComboBox", "AXSearchField", "AXSecureTextField":
      return "input"
    case "AXPopUpButton":
      return "select"
    case "AXTextArea":
      return "textarea"
    case "AXImage":
      return "img"
    case "AXHeading":
      return "h"
    case "AXCell":
      return "td"
    case "AXRow":
      return "tr"
    case "AXTable":
      return "table"
    default:
      return role
    }
  }

  private static func cssToAXRoles(_ selector: String) -> Set<String> {
    let cleaned =
      selector
      .components(separatedBy: CharacterSet(charactersIn: ":>+~["))
      .first?
      .trimmingCharacters(in: .whitespacesAndNewlines) ?? selector
    if cleaned.hasPrefix(".") || cleaned.hasPrefix("#") || cleaned == "*" || cleaned.isEmpty {
      return []
    }
    let tag =
      cleaned
      .components(separatedBy: CharacterSet(charactersIn: ".#"))
      .first?
      .lowercased() ?? cleaned.lowercased()
    switch tag {
    case "a", "link":
      return ["AXLink"]
    case "button":
      return ["AXButton"]
    case "input":
      return [
        "AXTextField", "AXCheckBox", "AXRadioButton", "AXSlider", "AXComboBox", "AXSearchField", "AXSecureTextField",
      ]
    case "select":
      return ["AXComboBox", "AXPopUpButton"]
    case "textarea":
      return ["AXTextArea"]
    case "img", "image":
      return ["AXImage"]
    case "h1", "h2", "h3", "h4", "h5", "h6":
      return ["AXHeading"]
    case "p", "span", "div", "section", "article", "main", "header", "footer", "form":
      return ["AXStaticText", "AXGroup"]
    case "li":
      return ["AXCell", "AXStaticText"]
    case "table":
      return ["AXTable"]
    case "tr":
      return ["AXRow"]
    case "td", "th":
      return ["AXCell"]
    case "nav":
      return ["AXToolbar"]
    default:
      return []
    }
  }

  private static let structuralRoles: Set<String> = [
    "AXApplication",
    "AXWindow",
    "AXGroup",
    "AXScrollArea",
    "AXSplitGroup",
    "AXSplitter",
    "AXMenuBar",
    "AXMenu",
    "AXMenuBarItem",
    "AXUnknown",
  ]
}

private struct ProcessOutput {
  let status: Int32
  let stdout: String
  let stderr: String
}

private enum ProcessRunner {
  nonisolated static func runAppleScript(_ script: String, timeout: TimeInterval) async throws -> ProcessOutput {
    let url = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent(UUID().uuidString)
      .appendingPathExtension("applescript")
    try script.write(to: url, atomically: true, encoding: .utf8)
    defer { try? FileManager.default.removeItem(at: url) }
    return try await run(executable: "/usr/bin/osascript", arguments: [url.path], timeout: timeout)
  }

  nonisolated static func run(
    executable: String,
    arguments: [String],
    timeout: TimeInterval
  ) async throws -> ProcessOutput {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global().async {
        do {
          continuation.resume(returning: try runSync(executable: executable, arguments: arguments, timeout: timeout))
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  nonisolated static func runSync(
    executable: String,
    arguments: [String],
    timeout: TimeInterval
  ) throws -> ProcessOutput {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    try process.run()
    let deadline = Date().addingTimeInterval(timeout)
    while process.isRunning && Date() < deadline {
      Thread.sleep(forTimeInterval: 0.02)
    }
    if process.isRunning {
      process.terminate()
      throw ComputerUseError.pageTimedOut(
        "\(URL(fileURLWithPath: executable).lastPathComponent) timed out after \(Int(timeout)) seconds.")
    }
    return .init(
      status: process.terminationStatus,
      stdout: String(data: stdout.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? "",
      stderr: String(data: stderr.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    )
  }

  static func listeningTCPPorts(pid: Int) async -> Set<Int> {
    guard
      let result = try? await run(
        executable: "/usr/sbin/lsof",
        arguments: ["-p", "\(pid)", "-iTCP", "-sTCP:LISTEN", "-Fn", "-P"],
        timeout: 1
      )
    else {
      return []
    }
    var ports = Set<Int>()
    for line in result.stdout.split(separator: "\n") {
      guard line.hasPrefix("n"), let colon = line.lastIndex(of: ":") else { continue }
      if let port = Int(line[line.index(after: colon)...]) {
        ports.insert(port)
      }
    }
    return ports
  }
}
