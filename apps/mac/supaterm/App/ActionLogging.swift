import ComposableArchitecture
import Foundation
import OSLog
import SupatermSupport

nonisolated enum AppLogCategory: String, Equatable, Sendable {
  case actions
  case settings
  case socket
  case terminal
  case update
  case zmx
}

nonisolated struct AppLogEvent: Equatable, Sendable {
  let addsExceptionStep: Bool
  let category: AppLogCategory
  let label: String
}

nonisolated struct AppLogClient: Sendable {
  var action: @Sendable (AppLogEvent) -> Void
}

extension AppLogClient: DependencyKey {
  static let liveValue = Self(
    action: { event in
      let logger = Logger(
        subsystem: SupatermLog.subsystem,
        category: event.category.rawValue
      )
      SupatermLog.debug(logger, event.label)

      guard event.addsExceptionStep else { return }
      AppPostHog.addExceptionStep(event.label, category: event.category)
    }
  )

  static let testValue = Self(action: { _ in })
}

extension DependencyValues {
  var appLogClient: AppLogClient {
    get { self[AppLogClient.self] }
    set { self[AppLogClient.self] = newValue }
  }
}

extension Reducer {
  func logActions() -> some Reducer<State, Action> {
    CombineReducers {
      self
      Reduce { _, action in
        @Dependency(AppLogClient.self) var appLogClient
        appLogClient.action(ActionLogPolicy.event(for: debugCaseOutput(action)))
        return .none
      }
    }
  }
}

nonisolated enum ActionLogPolicy {
  static func event(for actionLabel: String) -> AppLogEvent {
    let category = category(for: actionLabel)
    return AppLogEvent(
      addsExceptionStep: shouldAddExceptionStep(label: actionLabel, category: category),
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

  private static func shouldAddExceptionStep(label: String, category: AppLogCategory) -> Bool {
    switch category {
    case .actions:
      return false
    case .settings:
      return containsAny(label, settingsExceptionStepFragments)
    case .socket:
      return containsAny(label, socketExceptionStepFragments)
    case .terminal:
      return containsAny(label, terminalExceptionStepFragments)
    case .update:
      return containsAny(label, updateExceptionStepFragments)
    case .zmx:
      return false
    }
  }

  private static let settingsExceptionStepFragments = [
    "analyticsEnabledChanged",
    "crashReportsEnabledChanged",
    "restoreTerminalLayoutEnabledChanged",
    "verboseLoggingEnabledChanged",
    "zmxSessionsEnabledChanged",
  ]

  private static let socketExceptionStepFragments = [
    "requestReceived",
    "shutdown",
    "startFailed",
    "started",
    "task",
  ]

  private static let terminalExceptionStepFragments = [
    "closeAllWindowsRequested",
    "closeConfirmationConfirmButtonTapped",
    "closeGroupRequested",
    "closeOtherTabsRequested",
    "closeRequested",
    "closeSurfaceRequested",
    "closeTabRequested",
    "closeTabsBelowRequested",
    "createGroupRequested",
    "newTabButtonTapped",
    "newTabRequested",
    "nextSpaceRequested",
    "nextTabMenuItemSelected",
    "moveCommitted",
    "previousSpaceRequested",
    "previousTabMenuItemSelected",
    "removeTabFromGroupRequested",
    "renameGroupRequested",
    "selectLastTabMenuItemSelected",
    "selectSpaceButtonTapped",
    "selectSpaceMenuItemSelected",
    "selectTabMenuItemSelected",
    "setGroupColorRequested",
    "sidebarTabSplitRequested",
    "spaceCreateButtonTapped",
    "spaceDeleteConfirmButtonTapped",
    "spaceDeleteRequested",
    "spaceEditorSaveButtonTapped",
    "spaceRenameRequested",
    "splitOperationRequested",
    "tabSelected",
    "togglePinned",
    "toggleGroupCollapsedRequested",
    "togglePinnedRootItemRequested",
    "ungroupRequested",
    "windowCloseRequested",
  ]

  private static let updateExceptionStepFragments = [
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
