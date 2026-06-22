import AppKit
import Testing

@testable import SupatermTerminalFeature
@testable import SupatermTerminalModels
@testable import supaterm

struct SessionPersistenceStateTests {
  private let liveCatalog = TerminalSessionCatalog(
    windows: [
      TerminalWindowSession(
        selectedSpaceID: TerminalSpaceID(),
        spaces: []
      )
    ]
  )

  @Test
  func cancelledTerminationReturnsToActive() {
    let state = SessionPersistenceState.afterTerminationDecision(
      reply: .terminateCancel,
      terminatesSessions: false,
      liveCatalog: liveCatalog
    )

    #expect(state == .active)
    #expect(state.allowsLiveSave)
  }

  @Test
  func quitPreservingSessionsFreezesLiveCatalog() {
    let state = SessionPersistenceState.afterTerminationDecision(
      reply: .terminateNow,
      terminatesSessions: false,
      liveCatalog: liveCatalog
    )

    #expect(state == .quitting(liveCatalog))
    #expect(!state.allowsLiveSave)
    #expect(!state.shortCircuitsTerminateReply)
    #expect(state.catalogToPersist(liveCatalog: TerminalSessionCatalog(windows: [])) == liveCatalog)
  }

  @Test
  func quitTerminatingSessionsPersistsDefaultCatalogAndShortCircuits() {
    let state = SessionPersistenceState.afterTerminationDecision(
      reply: .terminateNow,
      terminatesSessions: true,
      liveCatalog: liveCatalog
    )

    #expect(state == .quittingAfterSessionTermination)
    #expect(!state.allowsLiveSave)
    #expect(state.shortCircuitsTerminateReply)
    #expect(state.catalogToPersist(liveCatalog: liveCatalog) == .default)
  }

  @Test
  func restoringSuppressesLiveSavesButPersistsLiveCatalog() {
    let state = SessionPersistenceState.restoring

    #expect(!state.allowsLiveSave)
    #expect(!state.shortCircuitsTerminateReply)
    #expect(state.catalogToPersist(liveCatalog: liveCatalog) == liveCatalog)
  }

  @Test
  func activeAllowsLiveSavesAndPersistsLiveCatalog() {
    let state = SessionPersistenceState.active

    #expect(state.allowsLiveSave)
    #expect(state.catalogToPersist(liveCatalog: liveCatalog) == liveCatalog)
  }
}
