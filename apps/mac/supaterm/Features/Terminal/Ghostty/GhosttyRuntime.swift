import AppKit
import Foundation
import GhosttyKit
import SupatermCLIShared
import SwiftUI

struct GhosttyShellIntegrationPlan: Equatable {
  var environmentVariables: [SupatermCLIEnvironmentVariable]
  var plannedCommand: String?

  static let empty = Self(environmentVariables: [], plannedCommand: nil)
}

final class GhosttyRuntime {
  final class CallbackState {
    weak var runtime: GhosttyRuntime?
  }

  final class SurfaceReference {
    let surface: ghostty_surface_t
    var isValid = true

    init(_ surface: ghostty_surface_t) {
      self.surface = surface
    }

    func invalidate() {
      isValid = false
    }
  }

  private var config: ghostty_config_t?
  private let configPath: String?
  private let includeCLIArgs: Bool
  private let callbackState = CallbackState()
  private let clipboard: GhosttyClipboard
  private(set) var app: ghostty_app_t?
  private var observers: [NSObjectProtocol] = []
  private var surfaceRefs: [SurfaceReference] = []
  private var lastColorScheme: ghostty_color_scheme_e?

  private static let notificationAttentionPaletteIndexes = [4, 12]
  private static let minNotificationContrastRatio = 2.2
  private static let minNotificationSaturation = 0.12

  convenience init(
    applicationIsActive: () -> Bool = { NSApp.isActive },
    pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard? = {
      NSPasteboard.ghostty($0)
    }
  ) {
    guard let config = Self.loadConfig(includeCLIArgs: true) else {
      preconditionFailure("ghostty_config_new failed")
    }
    self.init(
      loadedConfig: config,
      configPath: nil,
      includeCLIArgs: true,
      applicationIsActive: applicationIsActive,
      pasteboardProvider: pasteboardProvider
    )
  }

  convenience init(
    configPath: String,
    applicationIsActive: () -> Bool = { NSApp.isActive },
    pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard? = {
      NSPasteboard.ghostty($0)
    }
  ) {
    guard let config = Self.loadConfig(at: configPath, includeCLIArgs: false) else {
      preconditionFailure("ghostty_config_new failed")
    }
    self.init(
      loadedConfig: config,
      configPath: configPath,
      includeCLIArgs: false,
      applicationIsActive: applicationIsActive,
      pasteboardProvider: pasteboardProvider
    )
  }

  private init(
    loadedConfig config: ghostty_config_t,
    configPath: String?,
    includeCLIArgs: Bool,
    applicationIsActive: () -> Bool,
    pasteboardProvider: @escaping (ghostty_clipboard_e) -> NSPasteboard?
  ) {
    self.config = config
    self.configPath = configPath
    self.includeCLIArgs = includeCLIArgs
    self.clipboard = GhosttyClipboard(pasteboardProvider: pasteboardProvider)
    callbackState.runtime = self

    var runtimeConfig = ghostty_runtime_config_s(
      userdata: Unmanaged.passRetained(callbackState).toOpaque(),
      supports_selection_clipboard: true,
      wakeup_cb: { @Sendable userdata in
        GhosttyRuntime.wakeupCallback(userdata)
      },
      action_cb: { @Sendable app, target, action in
        GhosttyRuntime.actionCallback(app, target, action)
      },
      read_clipboard_cb: { @Sendable userdata, location, state in
        GhosttyRuntime.readClipboardCallback(userdata, location, state)
      },
      confirm_read_clipboard_cb: { @Sendable userdata, string, state, request in
        GhosttyRuntime.confirmReadClipboardCallback(userdata, string, state, request)
      },
      write_clipboard_cb: { @Sendable userdata, location, content, len, confirm in
        GhosttyRuntime.writeClipboardCallback(userdata, location, content, len, confirm)
      },
      close_surface_cb: { @Sendable userdata, processAlive in
        GhosttyRuntime.closeSurfaceCallback(userdata, processAlive)
      }
    )

    guard let app = ghostty_app_new(&runtimeConfig, config) else {
      preconditionFailure("ghostty_app_new failed")
    }
    self.app = app
    ghostty_app_set_focus(app, applicationIsActive())

    let center = NotificationCenter.default
    observers.append(
      center.addObserver(
        forName: NSApplication.didBecomeActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.setAppFocus(true)
        }
      })
    observers.append(
      center.addObserver(
        forName: NSApplication.didResignActiveNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.setAppFocus(false)
        }
      })
    observers.append(
      center.addObserver(
        forName: .ghosttyRuntimeReloadRequested,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          self?.reloadAppConfig()
        }
      })
    observers.append(
      center.addObserver(
        forName: NSTextInputContext.keyboardSelectionDidChangeNotification,
        object: nil,
        queue: .main
      ) { [weak self] _ in
        MainActor.assumeIsolated {
          guard let app = self?.app else { return }
          ghostty_app_keyboard_changed(app)
        }
      })
  }

  isolated deinit {
    clipboard.cancelAll()
    let center = NotificationCenter.default
    for observer in observers {
      center.removeObserver(observer)
    }
    callbackState.runtime = nil
    if let app {
      ghostty_app_free(app)
    }
    if let config {
      ghostty_config_free(config)
    }
    let callbackStateHandle = Unmanaged.passUnretained(callbackState).toOpaque()
    DispatchQueue.main.async {
      Unmanaged<CallbackState>.fromOpaque(callbackStateHandle).release()
    }
  }

  func setAppFocus(_ focused: Bool) {
    if let app {
      ghostty_app_set_focus(app, focused)
    }
  }

  func tick() {
    if let app {
      ghostty_app_tick(app)
    }
  }

  func needsConfirmQuit() -> Bool {
    guard let app else { return false }
    return ghostty_app_needs_confirm_quit(app)
  }

  func setColorScheme(_ scheme: ColorScheme) {
    guard let app else { return }
    let ghosttyScheme: ghostty_color_scheme_e =
      scheme == .dark
      ? GHOSTTY_COLOR_SCHEME_DARK
      : GHOSTTY_COLOR_SCHEME_LIGHT
    guard lastColorScheme != ghosttyScheme else { return }
    lastColorScheme = ghosttyScheme
    ghostty_app_set_color_scheme(app, ghosttyScheme)
    applyColorSchemeToSurfaces(ghosttyScheme)
  }

  func registerSurface(_ surface: ghostty_surface_t) -> SurfaceReference {
    let ref = SurfaceReference(surface)
    surfaceRefs.append(ref)
    if let lastColorScheme {
      ghostty_surface_set_color_scheme(surface, lastColorScheme)
    }
    return ref
  }

  func unregisterSurface(_ ref: SurfaceReference) {
    clipboard.cancel(surface: ref)
    ref.invalidate()
    surfaceRefs.removeAll { $0 === ref }
  }

  func readClipboard(
    from view: GhosttySurfaceView,
    location: ghostty_clipboard_e,
    state: UnsafeMutableRawPointer?
  ) -> Bool {
    clipboard.read(from: view, location: location, state: state)
  }

  func confirmClipboardRead(
    from view: GhosttySurfaceView,
    surfaceReference: SurfaceReference?,
    value: String?,
    state: UnsafeMutableRawPointer?,
    request: ghostty_clipboard_request_e
  ) {
    clipboard.confirmRead(
      from: view,
      surfaceReference: surfaceReference,
      value: value,
      state: state,
      request: request
    )
  }

  func writeClipboard(
    from view: GhosttySurfaceView,
    surfaceReference: SurfaceReference?,
    location: ghostty_clipboard_e,
    items: [(mime: String, data: String)],
    confirm: Bool
  ) {
    clipboard.write(
      from: view,
      surfaceReference: surfaceReference,
      location: location,
      items: items,
      confirm: confirm
    )
  }

  func cancelClipboardConfirmation(for surfaceReference: SurfaceReference?) {
    guard let surfaceReference else { return }
    clipboard.cancel(surface: surfaceReference)
  }

  func reloadConfig(soft: Bool, target: ghostty_target_s) {
    guard let app else { return }
    if soft, let config {
      guard let clone = ghostty_config_clone(config) else { return }
      applyConfig(clone, target: target, app: app)
      ghostty_config_free(clone)
      return
    }
    guard let config = Self.loadConfig(at: configPath, includeCLIArgs: includeCLIArgs) else { return }
    applyConfig(config, target: target, app: app)
    ghostty_config_free(config)
  }

  func reloadAppConfig() {
    reloadConfig(
      soft: false,
      target: ghostty_target_s(tag: GHOSTTY_TARGET_APP, target: ghostty_target_u())
    )
  }

  func configurationDiagnostics() -> [String] {
    guard let config else { return [] }
    return GhosttyConfigDiagnostics.messages(in: config)
  }

  private func applyConfig(
    _ config: ghostty_config_t,
    target: ghostty_target_s,
    app: ghostty_app_t
  ) {
    switch target.tag {
    case GHOSTTY_TARGET_APP:
      ghostty_app_update_config(app, config)
    case GHOSTTY_TARGET_SURFACE:
      guard let surface = target.target.surface else { return }
      ghostty_surface_update_config(surface, config)
    default:
      return
    }
  }

  private func applyColorSchemeToSurfaces(_ scheme: ghostty_color_scheme_e) {
    for ref in surfaceRefs {
      ghostty_surface_set_color_scheme(ref.surface, scheme)
      ghostty_surface_refresh(ref.surface)
    }
  }

  private static func runtime(from userdata: UnsafeMutableRawPointer?) -> GhosttyRuntime? {
    guard let userdata else { return nil }
    return Unmanaged<CallbackState>.fromOpaque(userdata).takeUnretainedValue().runtime
  }

  private static func runtime(fromApp app: ghostty_app_t) -> GhosttyRuntime? {
    guard let userdata = ghostty_app_userdata(app) else { return nil }
    return runtime(from: userdata)
  }

  private static func surfaceBridge(fromUserdata userdata: UnsafeMutableRawPointer?)
    -> GhosttySurfaceBridge?
  {
    guard let userdata else { return nil }
    return Unmanaged<GhosttySurfaceBridge>.fromOpaque(userdata).takeUnretainedValue()
  }

  private static func surfaceBridge(fromSurface surface: ghostty_surface_t?)
    -> GhosttySurfaceBridge?
  {
    guard let surface, let userdata = ghostty_surface_userdata(surface) else { return nil }
    return Unmanaged<GhosttySurfaceBridge>.fromOpaque(userdata).takeUnretainedValue()
  }

  private nonisolated static func wakeupCallback(_ userdata: UnsafeMutableRawPointer?) {
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    scheduleWakeup(userdataBits: userdataBits)
  }

  private nonisolated static func scheduleWakeup(
    userdataBits: UInt?,
    onTick: (@MainActor @Sendable () -> Void)? = nil
  ) {
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        wakeup(userdataBits: userdataBits)
        onTick?()
      }
    }
  }

  private nonisolated static func actionCallback(
    _ app: ghostty_app_t?,
    _ target: ghostty_target_s,
    _ action: ghostty_action_s
  ) -> Bool {
    guard let app else { return false }
    let appBits = UInt(bitPattern: app)
    if Thread.isMainThread {
      return MainActor.assumeIsolated {
        handleAction(appBits: appBits, target: target, action: action)
      }
    }
    return DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        handleAction(appBits: appBits, target: target, action: action)
      }
    }
  }

  nonisolated static func actionCallbackForTesting(
    _ appBits: UInt?,
    _ target: ghostty_target_s,
    _ action: ghostty_action_s
  ) -> Bool {
    let app = appBits.flatMap(ghostty_app_t.init(bitPattern:))
    return actionCallback(app, target, action)
  }

  private nonisolated static func readClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ location: ghostty_clipboard_e,
    _ state: UnsafeMutableRawPointer?
  ) -> Bool {
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    let stateBits = state.map { UInt(bitPattern: $0) }
    if Thread.isMainThread {
      return MainActor.assumeIsolated {
        readClipboard(userdataBits: userdataBits, location: location, stateBits: stateBits)
      }
    }
    return DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        readClipboard(userdataBits: userdataBits, location: location, stateBits: stateBits)
      }
    }
  }

  private nonisolated static func confirmReadClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ string: UnsafePointer<CChar>?,
    _ state: UnsafeMutableRawPointer?,
    _ request: ghostty_clipboard_request_e
  ) {
    let value = string.flatMap(String.init(validatingCString:))
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    let stateBits = state.map { UInt(bitPattern: $0) }
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        confirmReadClipboard(
          userdataBits: userdataBits,
          value: value,
          stateBits: stateBits,
          request: request
        )
      }
      return
    }
    DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        confirmReadClipboard(
          userdataBits: userdataBits,
          value: value,
          stateBits: stateBits,
          request: request
        )
      }
    }
  }

  private nonisolated static func writeClipboardCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ location: ghostty_clipboard_e,
    _ content: UnsafePointer<ghostty_clipboard_content_s>?,
    _ len: Int,
    _ confirm: Bool
  ) {
    guard let content, len > 0 else { return }
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    let items: [(mime: String, data: String)] = (0..<len).compactMap { index in
      let item = content.advanced(by: index).pointee
      guard let mimePtr = item.mime, let dataPtr = item.data else { return nil }
      return (mime: String(cString: mimePtr), data: String(cString: dataPtr))
    }
    guard !items.isEmpty else { return }
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        writeClipboard(
          userdataBits: userdataBits,
          location: location,
          items: items,
          confirm: confirm
        )
      }
      return
    }
    DispatchQueue.main.sync {
      MainActor.assumeIsolated {
        writeClipboard(
          userdataBits: userdataBits,
          location: location,
          items: items,
          confirm: confirm
        )
      }
    }
  }

  private nonisolated static func closeSurfaceCallback(
    _ userdata: UnsafeMutableRawPointer?,
    _ processAlive: Bool
  ) {
    let userdataBits = userdata.map { UInt(bitPattern: $0) }
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        closeSurface(userdataBits: userdataBits, processAlive: processAlive)
      }
      return
    }
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        closeSurface(userdataBits: userdataBits, processAlive: processAlive)
      }
    }
  }

  private static func wakeup(userdataBits: UInt?) {
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let runtime = runtime(from: userdata) else { return }
    runtime.tick()
  }

  func appUserdataBitsForTesting() -> UInt? {
    UInt(bitPattern: Unmanaged.passUnretained(callbackState).toOpaque())
  }

  func appBitsForTesting() -> UInt? {
    app.map { UInt(bitPattern: $0) }
  }

  static func wakeupForTesting(userdataBits: UInt?) {
    wakeup(userdataBits: userdataBits)
  }

  static func wakeupForTesting(
    userdataBits: UInt?,
    onTick: @escaping @MainActor @Sendable () -> Void
  ) {
    scheduleWakeup(userdataBits: userdataBits, onTick: onTick)
  }

  private static func handleAction(
    appBits: UInt,
    target: ghostty_target_s,
    action: ghostty_action_s
  ) -> Bool {
    guard let app = ghostty_app_t(bitPattern: appBits) else { return false }
    if let runtime = runtime(fromApp: app) {
      if action.tag == GHOSTTY_ACTION_CONFIG_CHANGE, target.tag == GHOSTTY_TARGET_APP {
        let config = action.action.config_change.config
        guard let clone = ghostty_config_clone(config) else { return false }
        runtime.setConfig(clone)
        NotificationCenter.default.post(name: .ghosttyRuntimeConfigDidChange, object: runtime)
        return true
      }
      if action.tag == GHOSTTY_ACTION_RELOAD_CONFIG {
        let soft = action.action.reload_config.soft
        runtime.reloadConfig(soft: soft, target: target)
        if target.tag == GHOSTTY_TARGET_APP {
          return true
        }
      }
    }
    switch target.tag {
    case GHOSTTY_TARGET_APP:
      return dispatchAppAction(action)
    case GHOSTTY_TARGET_SURFACE:
      guard let surface = target.target.surface else { return false }
      guard let bridge = surfaceBridge(fromSurface: surface) else { return false }
      return bridge.handleAction(target: target, action: action)
    default:
      return false
    }
  }

  private static func readClipboard(
    userdataBits: UInt?,
    location: ghostty_clipboard_e,
    stateBits: UInt?
  ) -> Bool {
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    let state = stateBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let view = surfaceBridge(fromUserdata: userdata)?.surfaceView else { return false }
    return view.readClipboard(location: location, state: state)
  }

  private static func confirmReadClipboard(
    userdataBits: UInt?,
    value: String?,
    stateBits: UInt?,
    request: ghostty_clipboard_request_e
  ) {
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    let state = stateBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let bridge = surfaceBridge(fromUserdata: userdata), let surface = bridge.surface else {
      return
    }
    guard let view = bridge.surfaceView else {
      "".withCString { pointer in
        ghostty_surface_complete_clipboard_request(surface, pointer, state, true)
      }
      return
    }
    view.confirmClipboardRead(value: value, state: state, request: request)
  }

  private static func writeClipboard(
    userdataBits: UInt?,
    location: ghostty_clipboard_e,
    items: [(mime: String, data: String)],
    confirm: Bool
  ) {
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let view = surfaceBridge(fromUserdata: userdata)?.surfaceView else { return }
    view.writeClipboard(location: location, items: items, confirm: confirm)
  }

  private static func closeSurface(userdataBits: UInt?, processAlive: Bool) {
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let bridge = surfaceBridge(fromUserdata: userdata) else { return }
    bridge.closeSurface(processAlive: processAlive)
  }

  private func setConfig(_ config: ghostty_config_t) {
    if let existing = self.config {
      ghostty_config_free(existing)
    }
    self.config = config
  }

  private static func loadConfig(
    at path: String? = nil,
    includeCLIArgs: Bool = true
  ) -> ghostty_config_t? {
    guard let config = ghostty_config_new() else { return nil }
    if let path {
      ghostty_config_load_file(config, path)
    } else {
      ghostty_config_load_default_files(config)
    }
    if includeCLIArgs,
      ProcessInfo.processInfo.environment["__XCODE_BUILT_PRODUCTS_DIR_PATHS"] == nil
    {
      ghostty_config_load_cli_args(config)
    }
    ghostty_config_load_recursive_files(config)
    ghostty_config_finalize(config)
    return config
  }

  func keyboardShortcut(forAction action: String) -> KeyboardShortcut? {
    guard let config else { return nil }
    let trigger = ghostty_config_trigger(config, action, UInt(action.lengthOfBytes(using: .utf8)))
    return Self.keyboardShortcut(for: trigger)
  }

  func hasGlobalKeybinds() -> Bool {
    guard let app else { return false }
    return ghostty_app_has_global_keybinds(app)
  }

  func handleGlobalKeyEvent(_ event: GhosttyGlobalKeyEvent) -> Bool {
    guard let app else { return false }
    let key = GhosttyKeyEvent.make(
      event,
      action: GHOSTTY_ACTION_PRESS
    )
    return ghostty_app_key(app, key)
  }

  @MainActor
  static func dispatchAppAction(_ action: ghostty_action_s) -> Bool {
    let performer = NSApp.delegate as? any GhosttyAppActionPerforming
    switch action.tag {
    case GHOSTTY_ACTION_QUIT:
      if let performer {
        return performer.performQuit()
      }
      NSApp.terminate(nil)
      return true
    case GHOSTTY_ACTION_NEW_WINDOW:
      return performer?.performNewWindow() ?? false
    case GHOSTTY_ACTION_CLOSE_ALL_WINDOWS:
      return performer?.performCloseAllWindows() ?? false
    case GHOSTTY_ACTION_CHECK_FOR_UPDATES:
      return performer?.performCheckForUpdates() ?? false
    case GHOSTTY_ACTION_OPEN_CONFIG:
      return (NSApp.delegate as? any GhosttyOpenConfigPerforming)?.performOpenConfig() ?? false
    case GHOSTTY_ACTION_TOGGLE_VISIBILITY:
      return performer?.performToggleVisibility() ?? false
    default:
      return false
    }
  }

  func commandPaletteEntries() -> [GhosttyCommand] {
    guard let config else { return [] }
    var value = ghostty_config_command_list_s()
    let key = "command-palette-entry"
    guard ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return []
    }
    guard value.len > 0, let commands = value.commands else { return [] }
    let buffer = UnsafeBufferPointer(start: commands, count: Int(value.len))
    return buffer.map(GhosttyCommand.init(cValue:))
  }

  func shellIntegrationPlan(for shellCommand: String) -> GhosttyShellIntegrationPlan {
    guard let config else { return .empty }
    let rawPlan = ghostty_shell_integration_plan(config, shellCommand)
    defer {
      ghostty_shell_integration_plan_free(rawPlan)
    }
    guard rawPlan.applied else { return .empty }
    let plannedCommand: String?
    if rawPlan.command_changed, let command = rawPlan.command {
      plannedCommand = String(cString: command)
    } else {
      plannedCommand = nil
    }
    guard let envVars = rawPlan.env_vars, rawPlan.env_var_count > 0 else {
      return GhosttyShellIntegrationPlan(environmentVariables: [], plannedCommand: plannedCommand)
    }
    let buffer = UnsafeBufferPointer(start: envVars, count: Int(rawPlan.env_var_count))
    return GhosttyShellIntegrationPlan(
      environmentVariables: buffer.compactMap { envVar in
        guard let key = envVar.key, let value = envVar.value else { return nil }
        return SupatermCLIEnvironmentVariable(
          key: String(cString: key),
          value: String(cString: value)
        )
      },
      plannedCommand: plannedCommand
    )
  }

  func focusFollowsMouse() -> Bool {
    guard let config else { return false }
    var value = false
    let key = "focus-follows-mouse"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return value
  }

  func shouldShowScrollbar() -> Bool {
    guard let config else { return true }
    var valuePtr: UnsafePointer<CChar>?
    let key = "scrollbar"
    if ghostty_config_get(config, &valuePtr, key, UInt(key.lengthOfBytes(using: .utf8))),
      let ptr = valuePtr
    {
      return String(cString: ptr) != "never"
    }
    return true
  }

  func splitPreserveZoomOnNavigation() -> Bool {
    guard let config else { return false }
    var value: CUnsignedInt = 0
    let key = "split-preserve-zoom"
    guard ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return false
    }
    return value & (1 << 0) != 0
  }

  func backgroundOpacity() -> Double {
    guard let config else { return 1 }
    var value: Double = 1
    let key = "background-opacity"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return min(max(value, 0.001), 1)
  }

  func progressStyle() -> Bool {
    guard let config else { return true }
    var value = true
    let key = "progress-style"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return value
  }

  func backgroundColor() -> NSColor {
    color(forKey: "background") ?? NSColor.windowBackgroundColor
  }

  func splitDividerColor() -> NSColor {
    if let color = color(forKey: "split-divider-color") {
      return color
    }
    let background = backgroundColor()
    return background.darken(by: background.isLightColor ? 0.08 : 0.4)
  }

  func unfocusedSplitDimmingColor() -> NSColor {
    color(forKey: "unfocused-split-fill") ?? backgroundColor()
  }

  func unfocusedSplitDimmingOpacity() -> Double {
    guard let config else { return 0.3 }
    var value: Double = 0.7
    let key = "unfocused-split-opacity"
    _ = ghostty_config_get(config, &value, key, UInt(key.lengthOfBytes(using: .utf8)))
    return 1 - min(max(value, 0.15), 1)
  }

  func notificationAttentionColor() -> NSColor {
    let fallbackColor = color(forKey: "foreground") ?? .controlAccentColor
    guard
      let config,
      let background = color(forKey: "background")
    else {
      return fallbackColor
    }

    var palette = ghostty_config_palette_s()
    let key = "palette"
    guard ghostty_config_get(config, &palette, key, UInt(key.lengthOfBytes(using: .utf8))) else {
      return fallbackColor
    }

    let colors = withUnsafeBytes(of: palette) { buffer in
      Array(buffer.bindMemory(to: ghostty_config_color_s.self)).map { NSColor(ghostty: $0) }
    }

    return Self.notificationAttentionPaletteIndexes
      .compactMap { index -> NSColor? in
        guard colors.indices.contains(index) else { return nil }
        let color = colors[index]
        guard
          color.saturation >= Self.minNotificationSaturation,
          color.contrastRatio(with: background) >= Self.minNotificationContrastRatio
        else {
          return nil
        }
        return color
      }
      .max { lhs, rhs in
        lhs.relativeLuminance < rhs.relativeLuminance
      }
      ?? fallbackColor
  }

  func chromeColorScheme() -> ColorScheme {
    backgroundColor().isLightColor ? .light : .dark
  }

  func scrollbarAppearanceName() -> NSAppearance.Name {
    backgroundColor().isLightColor ? .aqua : .darkAqua
  }

  private func color(forKey key: String) -> NSColor? {
    guard let config else { return nil }
    var color: ghostty_config_color_s = ghostty_config_color_s()
    if !ghostty_config_get(config, &color, key, UInt(key.lengthOfBytes(using: .utf8))) {
      return nil
    }
    return NSColor(ghostty: color)
  }

  private static func keyboardShortcut(for trigger: ghostty_input_trigger_s) -> KeyboardShortcut? {
    let key: KeyEquivalent
    switch trigger.tag {
    case GHOSTTY_TRIGGER_PHYSICAL:
      guard let equiv = keyToEquivalent[trigger.key.physical] else { return nil }
      key = equiv
    case GHOSTTY_TRIGGER_UNICODE:
      guard let scalar = UnicodeScalar(trigger.key.unicode) else { return nil }
      key = KeyEquivalent(Character(scalar))
    case GHOSTTY_TRIGGER_CATCH_ALL:
      return nil
    default:
      return nil
    }
    return KeyboardShortcut(key, modifiers: eventModifiers(mods: trigger.mods))
  }

  private static func eventModifiers(mods: ghostty_input_mods_e) -> EventModifiers {
    var flags: EventModifiers = []
    if mods.rawValue & GHOSTTY_MODS_SHIFT.rawValue != 0 { flags.insert(.shift) }
    if mods.rawValue & GHOSTTY_MODS_CTRL.rawValue != 0 { flags.insert(.control) }
    if mods.rawValue & GHOSTTY_MODS_ALT.rawValue != 0 { flags.insert(.option) }
    if mods.rawValue & GHOSTTY_MODS_SUPER.rawValue != 0 { flags.insert(.command) }
    return flags
  }

  private static let keyToEquivalent: [ghostty_input_key_e: KeyEquivalent] = [
    GHOSTTY_KEY_ARROW_UP: .upArrow,
    GHOSTTY_KEY_ARROW_DOWN: .downArrow,
    GHOSTTY_KEY_ARROW_LEFT: .leftArrow,
    GHOSTTY_KEY_ARROW_RIGHT: .rightArrow,
    GHOSTTY_KEY_HOME: .home,
    GHOSTTY_KEY_END: .end,
    GHOSTTY_KEY_DELETE: .delete,
    GHOSTTY_KEY_PAGE_UP: .pageUp,
    GHOSTTY_KEY_PAGE_DOWN: .pageDown,
    GHOSTTY_KEY_ESCAPE: .escape,
    GHOSTTY_KEY_ENTER: .return,
    GHOSTTY_KEY_TAB: .tab,
    GHOSTTY_KEY_BACKSPACE: .delete,
    GHOSTTY_KEY_SPACE: .space,
  ]
}

extension Notification.Name {
  static let ghosttyRuntimeConfigDidChange = Notification.Name("ghosttyRuntimeConfigDidChange")
}

extension NSColor {
  fileprivate var isLightColor: Bool {
    luminance > 0.5
  }

  fileprivate var luminance: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    return (0.299 * red) + (0.587 * green) + (0.114 * blue)
  }

  fileprivate var relativeLuminance: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)

    func channel(_ value: CGFloat) -> Double {
      let component = Double(value)
      if component <= 0.03928 {
        return component / 12.92
      }
      return pow((component + 0.055) / 1.055, 2.4)
    }

    return (0.2126 * channel(red)) + (0.7152 * channel(green)) + (0.0722 * channel(blue))
  }

  fileprivate var saturation: Double {
    var red: CGFloat = 0
    var green: CGFloat = 0
    var blue: CGFloat = 0
    var alpha: CGFloat = 0
    guard let rgb = usingColorSpace(.sRGB) else { return 0 }
    rgb.getRed(&red, green: &green, blue: &blue, alpha: &alpha)
    let maximum = max(red, green, blue)
    let minimum = min(red, green, blue)
    guard maximum > 0 else { return 0 }
    return Double((maximum - minimum) / maximum)
  }

  fileprivate func contrastRatio(with other: NSColor) -> Double {
    let lighter = max(relativeLuminance, other.relativeLuminance)
    let darker = min(relativeLuminance, other.relativeLuminance)
    return (lighter + 0.05) / (darker + 0.05)
  }

  fileprivate func darken(by amount: CGFloat) -> NSColor {
    guard let rgb = usingColorSpace(.sRGB) else { return self }
    var hue: CGFloat = 0
    var saturation: CGFloat = 0
    var brightness: CGFloat = 0
    var alpha: CGFloat = 0
    rgb.getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha)
    return NSColor(
      hue: hue,
      saturation: saturation,
      brightness: max(min(brightness * (1 - amount), 1), 0),
      alpha: alpha
    )
  }

  fileprivate convenience init(ghostty: ghostty_config_color_s) {
    let red = Double(ghostty.r) / 255
    let green = Double(ghostty.g) / 255
    let blue = Double(ghostty.b) / 255
    self.init(red: red, green: green, blue: blue, alpha: 1)
  }
}
