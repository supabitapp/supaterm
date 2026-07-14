import ComposableArchitecture
import CoreGraphics
import Foundation
import SupatermSettingsFeature
import SupatermSocketFeature
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
      terminalEvent(for: .newTabButtonTapped(projectID: nil, inheritingFromSurfaceID: nil)).category
        == .terminal
    )
    #expect(
      appLogEvent(for: SettingsFeature.Action.zmxSessionsEnabledChanged(true)).category == .settings
    )
    #expect(
      appLogEvent(for: SocketControlFeature.Action.startFailed("boom")).category == .socket
    )
    #expect(
      appLogEvent(for: UpdateFeature.Action.perform(.checkForUpdates)).category == .update
    )
    #expect(AppLogCategory.zmx.rawValue == "zmx")
  }

  @Test
  func allowlistedActionLabelsCreateExceptionSteps() {
    let events = [
      terminalEvent(for: .newTabButtonTapped(projectID: nil, inheritingFromSurfaceID: nil)),
      terminalEvent(for: .closeTabRequested(TerminalTabID())),
      appLogEvent(for: SettingsFeature.Action.zmxSessionsEnabledChanged(true)),
      appLogEvent(for: SocketControlFeature.Action.startFailed("boom")),
      appLogEvent(for: UpdateFeature.Action.perform(.checkForUpdates)),
    ]

    for event in events {
      #expect(event.addsExceptionStep)
    }
  }

  @Test
  func noisyActionLabelsStayLocalOnly() {
    let events = [
      terminalEvent(for: .commandPaletteQueryChanged("secret")),
      terminalEvent(for: .sidebarFractionChanged(0.42)),
      terminalEvent(for: .spaceEditorTextChanged("secret")),
      terminalEvent(for: .windowActivityChanged(.inactive)),
    ]

    for event in events {
      #expect(!event.addsExceptionStep)
      #expect(!event.label.contains("secret"))
    }
  }

  @Test
  func actionReducerLogsAfterBaseReducer() async {
    enum TestAction {
      case increment
    }

    let events = LockIsolated<[String]>([])

    let store = await TestStore(initialState: 0) {
      Reduce<Int, TestAction> { state, _ in
        let stateValue = state
        events.withValue { $0.append("base:\(stateValue)") }
        state += 1
        return .none
      }
      .logActions()
    } withDependencies: {
      $0.appLogClient.action = { event in
        events.withValue { $0.append("log:\(event.label):\(event.addsExceptionStep)") }
      }
    }

    await store.send(.increment) { $0 = 1 }

    #expect(events.value == ["base:0", "log:ActionLoggingTests.TestAction.increment:false"])
  }

  private func appLogEvent(for action: Any) -> AppLogEvent {
    ActionLogPolicy.event(for: debugCaseOutput(action))
  }

  private func terminalEvent(for action: TerminalWindowFeature.Action) -> AppLogEvent {
    appLogEvent(for: AppFeature.Action.terminal(action))
  }
}
