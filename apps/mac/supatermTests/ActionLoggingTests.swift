import ComposableArchitecture
import CoreGraphics
import Foundation
import SupatermSocketFeature
import SupatermSettingsFeature
import SupatermUpdateFeature
import Testing

@testable import supaterm

struct ActionLoggingTests {
  @Test
  func formatsNestedAppFeatureActions() {
    #expect(
      debugCaseOutput(AppFeature.Action.terminal(.spaceCreateButtonTapped))
        == "AppFeature.Action.terminal(.spaceCreateButtonTapped)"
    )
  }

  @Test
  func formatsSettingsActions() {
    #expect(
      debugCaseOutput(SettingsFeature.Action.tabSelected(.about))
        == "SettingsFeature.Action.tabSelected(.about)"
    )
  }

  @Test
  func actionLabelsDoNotContainPayloadValues() {
    let surfaceID = UUID(uuidString: "2DC0F07A-B84E-4DA0-A7D1-008A7DA92147")!
    let query = "super secret query"

    let surfaceLabel = debugCaseOutput(
      TerminalWindowFeature.Action.closeSurfaceRequested(surfaceID)
    )
    let queryLabel = debugCaseOutput(
      TerminalWindowFeature.Action.commandPaletteQueryChanged(query)
    )

    #expect(surfaceLabel.contains("closeSurfaceRequested"))
    #expect(!surfaceLabel.contains(surfaceID.uuidString))
    #expect(queryLabel.contains("commandPaletteQueryChanged"))
    #expect(!queryLabel.contains(query))
  }

  @Test
  func categorizesActionLabels() {
    #expect(
      ActionLogPolicy.event(
        for: debugCaseOutput(AppFeature.Action.terminal(.newTabButtonTapped(inheritingFromSurfaceID: nil)))
      )
      .category == .terminal
    )
    #expect(
      ActionLogPolicy.event(
        for: debugCaseOutput(SettingsFeature.Action.zmxSessionsEnabledChanged(true))
      )
      .category == .settings
    )
    #expect(
      ActionLogPolicy.event(
        for: debugCaseOutput(SocketControlFeature.Action.startFailed("boom"))
      )
      .category == .socket
    )
    #expect(
      ActionLogPolicy.event(
        for: debugCaseOutput(UpdateFeature.Action.perform(.checkForUpdates))
      )
      .category == .update
    )
  }

  @Test
  func allowlistedActionLabelsCreateBreadcrumbs() {
    let labels = [
      debugCaseOutput(AppFeature.Action.terminal(.newTabButtonTapped(inheritingFromSurfaceID: nil))),
      debugCaseOutput(AppFeature.Action.terminal(.closeTabRequested(TerminalTabID()))),
      debugCaseOutput(SettingsFeature.Action.zmxSessionsEnabledChanged(true)),
      debugCaseOutput(SocketControlFeature.Action.startFailed("boom")),
      debugCaseOutput(UpdateFeature.Action.perform(.checkForUpdates)),
    ]

    for label in labels {
      #expect(ActionLogPolicy.event(for: label).addsBreadcrumb)
    }
  }

  @Test
  func noisyActionLabelsStayLocalOnly() {
    let labels = [
      debugCaseOutput(AppFeature.Action.terminal(.commandPaletteQueryChanged("secret"))),
      debugCaseOutput(AppFeature.Action.terminal(.sidebarFractionChanged(0.42))),
      debugCaseOutput(AppFeature.Action.terminal(.spaceEditorTextChanged("secret"))),
      debugCaseOutput(AppFeature.Action.terminal(.windowActivityChanged(.inactive))),
    ]

    for label in labels {
      #expect(!ActionLogPolicy.event(for: label).addsBreadcrumb)
      #expect(!label.contains("secret"))
    }
  }

  @Test
  func releaseActionReducerLogsAfterBaseReducer() {
    enum TestAction {
      case increment
    }

    let events = LockIsolated<[String]>([])

    withDependencies {
      $0.appLogClient.action = { event in
        events.withValue { $0.append("log:\(event.label):\(event.addsBreadcrumb)") }
      }
    } operation: {
      var state = 0
      let reducer = AppActionLogReducer(
        base: Reduce<Int, TestAction> { state, _ in
          let stateValue = state
          events.withValue { $0.append("base:\(stateValue)") }
          state += 1
          return .none
        }
      )

      _ = reducer.reduce(into: &state, action: .increment)

      #expect(state == 1)
    }

    #expect(events.value == ["base:0", "log:ActionLoggingTests.TestAction.increment:false"])
  }
}
