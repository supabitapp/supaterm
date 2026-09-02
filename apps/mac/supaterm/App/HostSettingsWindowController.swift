import AppKit
import SupatermHostClient

enum HostSettingsTab: String, CaseIterable {
  case general = "General"
  case terminal = "Terminal"
  case notifications = "Notifications"
  case codingAgents = "Coding Agents"
  case license = "License"
  case about = "About"
}

@MainActor
final class HostSettingsWindowController: NSWindowController {
  private let host: HostWorkspaceApplicationController
  private let checkForUpdates: () -> Void
  private let tabSelector = NSPopUpButton()
  private let content = NSView()
  private var selectedTab = HostSettingsTab.general
  private var shellField: NSTextField?
  private var licenseKeyField: NSSecureTextField?

  init(host: HostWorkspaceApplicationController, checkForUpdates: @escaping () -> Void) {
    self.host = host
    self.checkForUpdates = checkForUpdates
    let window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 560, height: 420),
      styleMask: [.titled, .closable],
      backing: .buffered,
      defer: false
    )
    window.title = "Supaterm Settings"
    window.tabbingMode = .disallowed
    window.isReleasedWhenClosed = false
    super.init(window: window)
    buildWindow()
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  func show(tab: HostSettingsTab) {
    selectedTab = tab
    tabSelector.selectItem(withTitle: tab.rawValue)
    rebuild()
    window?.center()
    window?.makeKeyAndOrderFront(nil)
    NSApp.activate(ignoringOtherApps: true)
  }

  private func buildWindow() {
    guard let root = window?.contentView else { return }
    tabSelector.addItems(withTitles: HostSettingsTab.allCases.map(\.rawValue))
    tabSelector.target = self
    tabSelector.action = #selector(tabChanged)
    tabSelector.frame = NSRect(x: 20, y: 374, width: 180, height: 26)
    content.frame = NSRect(x: 20, y: 20, width: 520, height: 340)
    root.addSubview(tabSelector)
    root.addSubview(content)
    rebuild()
  }

  private func rebuild() {
    content.subviews.forEach { $0.removeFromSuperview() }
    shellField = nil
    licenseKeyField = nil
    switch selectedTab {
    case .general:
      showGeneral()
    case .terminal:
      showTerminal()
    case .notifications:
      showNotifications()
    case .codingAgents:
      showCodingAgents()
    case .license:
      showLicense()
    case .about:
      showAbout()
    }
  }

  private func showGeneral() {
    let appearance = NSPopUpButton()
    appearance.addItems(withTitles: ["System", "Dark", "Light"])
    appearance.selectItem(withTitle: HostClientPreferences.appearance.capitalized)
    appearance.target = self
    appearance.action = #selector(appearanceChanged)
    setContent(
      title: "General",
      views: [row(label: "Appearance", control: appearance)]
    )
  }

  private func showTerminal() {
    let field = NSTextField()
    field.placeholderString = "/bin/zsh"
    shellField = field
    let apply = NSButton(title: "Apply", target: self, action: #selector(applyTerminal))
    setContent(
      title: "Terminal",
      views: [
        label("The host applies this shell to new terminals on this machine."),
        row(label: "Shell", control: field),
        apply,
      ]
    )
    Task { [weak self, weak field] in
      guard let self, let field else { return }
      do {
        let settings = try await host.settings()
        if case .array(let values) = settings["terminal.shell"],
          case .string(let shell) = values.first
        {
          field.stringValue = shell
        }
      } catch {
        present(error)
      }
    }
  }

  private func showNotifications() {
    let toggle = NSButton(
      checkboxWithTitle: "Show system notifications",
      target: self,
      action: #selector(notificationsChanged)
    )
    toggle.state = HostClientPreferences.systemNotificationsEnabled ? .on : .off
    setContent(
      title: "Notifications",
      views: [
        label("The host owns notification records. This Mac controls system banners."),
        toggle,
      ]
    )
  }

  private func showCodingAgents() {
    let stack = NSStackView()
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 12
    for kind in ["codex", "claude"] {
      let title = kind.prefix(1).uppercased() + kind.dropFirst()
      let setup = NSButton(title: "Set Up \(title)", target: self, action: #selector(setupAgent(_:)))
      setup.identifier = NSUserInterfaceItemIdentifier(kind)
      let remove = NSButton(title: "Remove", target: self, action: #selector(removeAgent(_:)))
      remove.identifier = NSUserInterfaceItemIdentifier(kind)
      let row = NSStackView(views: [setup, remove])
      row.orientation = .horizontal
      row.spacing = 8
      stack.addArrangedSubview(row)
    }
    setContent(
      title: "Coding Agents",
      views: [label("The host installs and repairs integrations on this machine."), stack]
    )
  }

  private func showLicense() {
    let status = label("Loading…")
    status.identifier = NSUserInterfaceItemIdentifier("license-status")
    let field = NSSecureTextField()
    field.placeholderString = "SUPATERM-…"
    licenseKeyField = field
    let activate = NSButton(title: "Activate", target: self, action: #selector(activateLicense))
    let deactivate = NSButton(title: "Deactivate", target: self, action: #selector(deactivateLicense))
    let buy = NSButton(title: "Buy", target: self, action: #selector(buyLicense))
    let actions = NSStackView(views: [activate, deactivate, buy])
    actions.orientation = .horizontal
    actions.spacing = 8
    setContent(
      title: "License",
      views: [status, row(label: "License key", control: field), actions]
    )
    loadLicenseStatus(status)
  }

  private func showAbout() {
    let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    let check = NSButton(title: "Check for Updates…", target: self, action: #selector(checkUpdates))
    setContent(
      title: "Supaterm",
      views: [label("Version \(version ?? "Unknown")"), check]
    )
  }

  private func setContent(title: String, views: [NSView]) {
    let heading = label(title)
    heading.font = .systemFont(ofSize: 22, weight: .semibold)
    let stack = NSStackView(views: [heading] + views)
    stack.orientation = .vertical
    stack.alignment = .leading
    stack.spacing = 16
    stack.frame = content.bounds
    stack.autoresizingMask = [.width, .height]
    content.addSubview(stack)
  }

  private func row(label title: String, control: NSView) -> NSView {
    let title = label(title)
    title.frame.size.width = 110
    control.frame.size.width = 320
    let stack = NSStackView(views: [title, control])
    stack.orientation = .horizontal
    stack.spacing = 12
    return stack
  }

  private func label(_ value: String) -> NSTextField {
    NSTextField(wrappingLabelWithString: value)
  }

  private func loadLicenseStatus(_ label: NSTextField) {
    Task { [weak self, weak label] in
      guard let self, let label else { return }
      do {
        update(label, status: try await host.licenseStatus())
      } catch {
        present(error)
      }
    }
  }

  private func update(_ label: NSTextField, status: HostLicenseStatus) {
    label.stringValue =
      switch status.mode {
      case .free:
        "Free — \(status.openTabCount) of \(status.freeTabLimit) tabs"
      case .paid:
        "Active through \(status.updatesThrough ?? "Unknown")"
      case .expired:
        "Updates ended \(status.updatesThrough ?? "Unknown")"
      }
  }

  private func performLicense(_ operation: @escaping () async throws -> HostLicenseStatus) {
    Task { [weak self] in
      guard let self else { return }
      do {
        let status = try await operation()
        if let label = content.subviews
          .flatMap(\.subviews)
          .compactMap({ $0 as? NSTextField })
          .first(where: { $0.identifier?.rawValue == "license-status" })
        {
          update(label, status: status)
        }
      } catch {
        present(error)
      }
    }
  }

  private func performIntegration(_ method: String, sender: NSButton) {
    guard let kind = sender.identifier?.rawValue else { return }
    Task { [weak self] in
      guard let self else { return }
      do {
        _ = try await host.integration(method: method, kind: kind)
      } catch {
        present(error)
      }
    }
  }

  private func present(_ error: any Error) {
    guard let window else { return }
    NSAlert(error: error).beginSheetModal(for: window)
  }

  @objc private func tabChanged() {
    guard let title = tabSelector.selectedItem?.title,
      let tab = HostSettingsTab(rawValue: title)
    else { return }
    selectedTab = tab
    rebuild()
  }

  @objc private func appearanceChanged(_ sender: NSPopUpButton) {
    HostClientPreferences.appearance = sender.titleOfSelectedItem?.lowercased() ?? "dark"
  }

  @objc private func applyTerminal() {
    guard let shell = shellField?.stringValue.trimmingCharacters(in: .whitespacesAndNewlines) else {
      return
    }
    Task { [weak self] in
      guard let self else { return }
      do {
        _ = try await host.setSetting(
          "terminal.shell",
          value: shell.isEmpty ? .array([]) : .array([.string(shell)])
        )
      } catch {
        present(error)
      }
    }
  }

  @objc private func notificationsChanged(_ sender: NSButton) {
    HostClientPreferences.systemNotificationsEnabled = sender.state == .on
    host.refreshNotificationDelivery()
  }

  @objc private func setupAgent(_ sender: NSButton) {
    performIntegration("integration.setup", sender: sender)
  }

  @objc private func removeAgent(_ sender: NSButton) {
    performIntegration("integration.remove", sender: sender)
  }

  @objc private func activateLicense() {
    guard let key = licenseKeyField?.stringValue, !key.isEmpty else { return }
    performLicense { [host] in try await host.activateLicense(key) }
  }

  @objc private func deactivateLicense() {
    performLicense { [host] in try await host.deactivateLicense() }
  }

  @objc private func buyLicense() {
    Task { [weak self] in
      guard let self else { return }
      do {
        NSWorkspace.shared.open(try await host.licenseURL(renew: false))
      } catch {
        present(error)
      }
    }
  }

  @objc private func checkUpdates() {
    checkForUpdates()
  }
}
