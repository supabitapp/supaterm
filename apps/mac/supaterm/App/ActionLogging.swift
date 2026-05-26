import ComposableArchitecture
import Foundation
import OSLog
import Sentry

nonisolated enum AppLogCategory: String, Equatable, Sendable {
  case actions
  case settings
  case socket
  case terminal
  case update
}

nonisolated struct AppLogEvent: Equatable, Sendable {
  let addsBreadcrumb: Bool
  let category: AppLogCategory
  let label: String
}

nonisolated struct AppLogClient: Sendable {
  var action: @Sendable (AppLogEvent) -> Void
}

extension AppLogClient: DependencyKey {
  static let liveValue = Self(
    action: { event in
      Logger(
        subsystem: "app.supabit.supaterm",
        category: event.category.rawValue
      )
      .debug("\(event.label, privacy: .public)")

      guard event.addsBreadcrumb else { return }
      let breadcrumb = Breadcrumb(level: .debug, category: event.category.rawValue)
      breadcrumb.message = event.label
      SentrySDK.addBreadcrumb(breadcrumb)
    }
  )

  static let testValue = Self(
    action: { _ in }
  )
}

extension DependencyValues {
  var appLogClient: AppLogClient {
    get { self[AppLogClient.self] }
    set { self[AppLogClient.self] = newValue }
  }
}

extension Reducer where State: Equatable {
  @ReducerBuilder<State, Action>
  func logActions() -> some Reducer<State, Action> {
    #if DEBUG
      self._printChanges(.actionLabels)
    #else
      AppActionLogReducer(base: self)
    #endif
  }
}

struct AppActionLogReducer<Base: Reducer>: Reducer where Base.State: Equatable {
  @Dependency(AppLogClient.self) var appLogClient

  let base: Base

  func reduce(into state: inout Base.State, action: Base.Action) -> Effect<Base.Action> {
    let actionLabel = debugCaseOutput(action)
    let effects = base.reduce(into: &state, action: action)
    appLogClient.action(ActionLogPolicy.event(for: actionLabel))
    return effects
  }
}

nonisolated enum ActionLogPolicy {
  static func event(for actionLabel: String) -> AppLogEvent {
    let category = category(for: actionLabel)
    return AppLogEvent(
      addsBreadcrumb: shouldBreadcrumb(label: actionLabel, category: category),
      category: category,
      label: actionLabel
    )
  }

  static func category(for actionLabel: String) -> AppLogCategory {
    if actionLabel.contains("SocketControlFeature.Action") {
      return .socket
    }
    if actionLabel.contains("UpdateFeature.Action") || actionLabel.contains("AppFeature.Action.update") {
      return .update
    }
    if actionLabel.contains("SettingsFeature.Action") {
      return .settings
    }
    if actionLabel.contains("TerminalWindowFeature.Action") || actionLabel.contains("AppFeature.Action.terminal") {
      return .terminal
    }
    return .actions
  }

  private static func shouldBreadcrumb(label: String, category: AppLogCategory) -> Bool {
    switch category {
    case .actions:
      return false
    case .settings:
      return containsAny(label, settingsBreadcrumbFragments)
    case .socket:
      return containsAny(label, socketBreadcrumbFragments)
    case .terminal:
      return containsAny(label, terminalBreadcrumbFragments)
    case .update:
      return containsAny(label, updateBreadcrumbFragments)
    }
  }

  private static let settingsBreadcrumbFragments = [
    "analyticsEnabledChanged",
    "crashReportsEnabledChanged",
    "restoreTerminalLayoutEnabledChanged",
    "zmxSessionsEnabledChanged",
  ]

  private static let socketBreadcrumbFragments = [
    "requestReceived",
    "shutdown",
    "startFailed",
    "started",
    "task",
  ]

  private static let terminalBreadcrumbFragments = [
    "closeAllWindowsRequested",
    "closeConfirmationConfirmButtonTapped",
    "closeOtherTabsRequested",
    "closeRequested",
    "closeSurfaceRequested",
    "closeTabRequested",
    "closeTabsBelowRequested",
    "newTabButtonTapped",
    "newTabRequested",
    "nextSpaceRequested",
    "nextTabMenuItemSelected",
    "pinnedTabOrderChanged",
    "previousSpaceRequested",
    "previousTabMenuItemSelected",
    "regularTabOrderChanged",
    "selectLastTabMenuItemSelected",
    "selectSpaceButtonTapped",
    "selectSpaceMenuItemSelected",
    "selectTabMenuItemSelected",
    "sidebarTabMoveCommitted",
    "sidebarTabSplitRequested",
    "spaceCreateButtonTapped",
    "spaceDeleteConfirmButtonTapped",
    "spaceDeleteRequested",
    "spaceEditorSaveButtonTapped",
    "spaceRenameRequested",
    "splitOperationRequested",
    "tabSelected",
    "togglePinned",
    "windowCloseRequested",
  ]

  private static let updateBreadcrumbFragments = [
    "perform",
    "task",
    "updateClientSnapshotReceived",
  ]

  private static func containsAny(_ value: String, _ fragments: [String]) -> Bool {
    fragments.contains { value.contains($0) }
  }
}

func debugCaseOutput(
  _ value: Any,
  abbreviated: Bool = false
) -> String {
  func debugCaseOutputHelp(_ value: Any) -> String {
    let mirror = Mirror(reflecting: value)
    switch mirror.displayStyle {
    case .enum:
      guard let child = mirror.children.first else {
        let childOutput = "\(value)"
        return childOutput == "\(typeName(type(of: value)))" ? "" : ".\(childOutput)"
      }
      let childOutput = debugCaseOutputHelp(child.value)
      return ".\(child.label ?? "")\(childOutput.isEmpty ? "" : "(\(childOutput))")"
    case .tuple:
      return mirror.children.map { label, value in
        let childOutput = debugCaseOutputHelp(value)
        let labelValue = label.map { isUnlabeledArgument($0) ? "_:" : "\($0):" } ?? ""
        let suffix = childOutput.isEmpty ? "" : " \(childOutput)"
        return "\(labelValue)\(suffix)"
      }
      .joined(separator: ", ")
    default:
      return ""
    }
  }

  return (value as? any CustomDebugStringConvertible)?.debugDescription
    ?? "\(abbreviated ? "" : typeName(type(of: value)))\(debugCaseOutputHelp(value))"
}

private func isUnlabeledArgument(_ label: String) -> Bool {
  !label.contains { $0 != "." && !$0.isNumber }
}

private func typeName(
  _ type: Any.Type,
  qualified: Bool = true,
  genericsAbbreviated: Bool = true
) -> String {
  var name = _typeName(type, qualified: qualified)
    .replacing(#/\(unknown context at \$[0-9A-Fa-f]+\)\./#, with: "")
  for _ in 1...10 {
    let abbreviated =
      name
      .replacing(#/\bSwift\.Optional<([^><]+)>/#) { match in
        "\(match.1)?"
      }
      .replacing(#/\bSwift\.Array<([^><]+)>/#) { match in
        "[\(match.1)]"
      }
      .replacing(#/\bSwift\.Dictionary<([^,<]+), ([^><]+)>/#) { match in
        "[\(match.1): \(match.2)]"
      }
    if abbreviated == name { break }
    name = abbreviated
  }
  name = name.replacing(#/\w+\.([\w.]+)/#) { match in
    "\(match.1)"
  }
  if genericsAbbreviated {
    name = name.replacing(#/<.+>/#, with: "")
  }
  return name
}
