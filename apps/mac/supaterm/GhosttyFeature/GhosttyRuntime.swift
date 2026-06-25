import AppKit
import GhosttyKit
import SupatermCLIShared
import SupatermSupport
import SwiftUI

struct GhosttyShellIntegrationPlan: Equatable {
  var environmentVariables: [SupatermCLIEnvironmentVariable]
  var plannedCommand: String?

  static let empty = Self(environmentVariables: [], plannedCommand: nil)
}

public final class GhosttyRuntime {
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

  var config: ghostty_config_t?
  private let configPath: String?
  private let includeCLIArgs: Bool
  private let callbackState = CallbackState()
  private(set) var app: ghostty_app_t?
  private var observers: [NSObjectProtocol] = []
  private var surfaceRefs: [SurfaceReference] = []
  private var lastColorScheme: ghostty_color_scheme_e?
  public var onConfigChange: (() -> Void)?

  public convenience init() {
    guard let config = Self.loadConfig(includeCLIArgs: true) else {
      preconditionFailure("ghostty_config_new failed")
    }
    self.init(loadedConfig: config, configPath: nil, includeCLIArgs: true)
  }

  public convenience init(configPath: String) {
    guard let config = Self.loadConfig(at: configPath, includeCLIArgs: false) else {
      preconditionFailure("ghostty_config_new failed")
    }
    self.init(loadedConfig: config, configPath: configPath, includeCLIArgs: false)
  }

  private init(
    loadedConfig config: ghostty_config_t,
    configPath: String?,
    includeCLIArgs: Bool
  ) {
    self.config = config
    self.configPath = configPath
    self.includeCLIArgs = includeCLIArgs
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

  public func setAppFocus(_ focused: Bool) {
    if let app {
      ghostty_app_set_focus(app, focused)
    }
  }

  public func tick() {
    if let app {
      ghostty_app_tick(app)
    }
  }

  public func needsConfirmQuit() -> Bool {
    guard let app else { return false }
    return ghostty_app_needs_confirm_quit(app)
  }

  public func setColorScheme(_ scheme: ColorScheme) {
    guard let app else { return }
    let ghosttyScheme: ghostty_color_scheme_e =
      scheme == .dark
      ? GHOSTTY_COLOR_SCHEME_DARK
      : GHOSTTY_COLOR_SCHEME_LIGHT
    lastColorScheme = ghosttyScheme
    ghostty_app_set_color_scheme(app, ghosttyScheme)
    applyColorSchemeToSurfaces(ghosttyScheme)
  }

  func registerSurface(_ surface: ghostty_surface_t) -> SurfaceReference {
    let ref = SurfaceReference(surface)
    surfaceRefs.append(ref)
    surfaceRefs = surfaceRefs.filter { $0.isValid }
    if let lastColorScheme {
      ghostty_surface_set_color_scheme(surface, lastColorScheme)
    }
    return ref
  }

  func unregisterSurface(_ ref: SurfaceReference) {
    ref.invalidate()
    surfaceRefs = surfaceRefs.filter { $0.isValid }
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

  public func reloadAppConfig() {
    reloadConfig(
      soft: false,
      target: ghostty_target_s(tag: GHOSTTY_TARGET_APP, target: ghostty_target_u())
    )
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
    for ref in surfaceRefs where ref.isValid {
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
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        wakeup(userdataBits: userdataBits)
      }
      return
    }
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        wakeup(userdataBits: userdataBits)
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
    guard let string else { return }
    let value = String(cString: string)
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
    DispatchQueue.main.async {
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
    _ = userdata
    guard let content, len > 0 else { return }
    let items: [(mime: String, data: String)] = (0..<len).compactMap { index in
      let item = content.advanced(by: index).pointee
      guard let mimePtr = item.mime, let dataPtr = item.data else { return nil }
      return (mime: String(cString: mimePtr), data: String(cString: dataPtr))
    }
    guard !items.isEmpty else { return }
    if Thread.isMainThread {
      MainActor.assumeIsolated {
        writeClipboard(
          location: location,
          items: items,
          confirm: confirm
        )
      }
      return
    }
    DispatchQueue.main.async {
      MainActor.assumeIsolated {
        writeClipboard(
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
        runtime.onConfigChange?()
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
    guard let bridge = surfaceBridge(fromUserdata: userdata), let surface = bridge.surface else {
      return false
    }
    guard
      let pasteboard = NSPasteboard.ghostty(location),
      let value = pasteboard.getOpinionatedStringContents()
    else {
      return false
    }
    value.withCString { ptr in
      ghostty_surface_complete_clipboard_request(surface, ptr, state, false)
    }
    return true
  }

  private static func confirmReadClipboard(
    userdataBits: UInt?,
    value: String,
    stateBits: UInt?,
    request: ghostty_clipboard_request_e
  ) {
    _ = request
    let userdata = userdataBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    let state = stateBits.flatMap { UnsafeMutableRawPointer(bitPattern: $0) }
    guard let bridge = surfaceBridge(fromUserdata: userdata), let surface = bridge.surface else {
      return
    }
    value.withCString { ptr in
      ghostty_surface_complete_clipboard_request(surface, ptr, state, true)
    }
  }

  private static func writeClipboard(
    location: ghostty_clipboard_e,
    items: [(mime: String, data: String)],
    confirm: Bool
  ) {
    _ = confirm

    guard let pasteboard = NSPasteboard.ghostty(location) else { return }
    let types = items.compactMap { NSPasteboard.PasteboardType(mimeType: $0.mime) }
    pasteboard.declareTypes(types, owner: nil)
    for item in items {
      guard let type = NSPasteboard.PasteboardType(mimeType: item.mime) else { continue }
      pasteboard.setString(item.data, forType: type)
    }
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
    ghostty_config_load_recursive_files(config)
    if includeCLIArgs {
      ghostty_config_load_cli_args(config)
    }
    ghostty_config_finalize(config)
    return config
  }

  public func hasGlobalKeybinds() -> Bool {
    guard let app else { return false }
    return ghostty_app_has_global_keybinds(app)
  }

  public func handleGlobalKeyEvent(_ event: GhosttyGlobalKeyEvent) -> Bool {
    guard let app else { return false }
    let key = GhosttyKeyEvent.make(
      event,
      action: GHOSTTY_ACTION_PRESS
    )
    return ghostty_app_key(app, key)
  }

  @MainActor
  public static func dispatchAppAction(_ action: ghostty_action_s) -> Bool {
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

}
