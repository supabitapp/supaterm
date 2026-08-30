import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookCandidateDecisionTests {
  @Test
  func exactSessionTitleHasFirstPriority() {
    let matchingTitle = candidate(
      processID: 101,
      sessionIDMatchesTitle: true,
      processMatch: .different,
      workingDirectoryMatch: .different
    )
    let matchingProcess = candidate(
      processID: 202,
      processMatch: .matching,
      workingDirectoryMatch: .exact
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [matchingProcess, matchingTitle],
        processID: matchingProcess.processID,
        pollingComplete: true,
        retryExpired: false
      ) == .deliver(1)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [matchingTitle],
        processID: matchingProcess.processID,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(0)
    )
  }

  @Test
  func duplicateSessionTitlesUseProcessOwnershipOrReject() {
    let first = candidate(
      processID: 101,
      sessionIDMatchesTitle: true,
      processMatch: .different,
      workingDirectoryMatch: .exact
    )
    let second = candidate(
      processID: 202,
      sessionIDMatchesTitle: true,
      processMatch: .matching,
      workingDirectoryMatch: .exact
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [first, second],
        processID: second.processID,
        pollingComplete: true,
        retryExpired: false
      ) == .deliver(1)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [first, first],
        processID: 303,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [first, first],
        processID: 303,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }

  @Test
  func emitterProcessHasFirstPriority() {
    let exactWorkspace = candidate(
      processID: 202,
      processMatch: .different,
      workingDirectoryMatch: .exact
    )
    let emitter = candidate(
      processID: 303,
      processMatch: .matching,
      workingDirectoryMatch: .different
    )
    let exactEmitter = candidate(
      processID: 404,
      processMatch: .matching,
      workingDirectoryMatch: .different
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace, emitter],
        processID: emitter.processID,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(1)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exactEmitter],
        processID: exactEmitter.processID,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(0)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace],
        processID: emitter.processID,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace],
        processID: emitter.processID,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }

  @Test
  func earlierAppCandidateUsesExactEmitterProcessID() {
    let earlierAppCandidate = candidate(
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .different
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [earlierAppCandidate],
        processID: 303,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(0)
    )
  }

  @Test
  func unavailableEmitterProcessFallsBackToSoleUnknownCandidateAfterRetry() {
    let exactWorkspace = candidate(
      processID: 101,
      processMatch: .unknown,
      workingDirectoryMatch: .exact
    )
    let unknownWorkspace = candidate(
      processID: 202,
      processMatch: .unknown,
      workingDirectoryMatch: .unknown
    )
    let differentProcess = candidate(
      processID: 303,
      processMatch: .different,
      workingDirectoryMatch: .exact
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace],
        processID: 404,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace],
        processID: 404,
        pollingComplete: false,
        retryExpired: true
      ) == .reject
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exactWorkspace, unknownWorkspace, differentProcess],
        processID: 404,
        pollingComplete: true,
        retryExpired: true
      ) == .deliver(0)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknownWorkspace, differentProcess],
        processID: 404,
        pollingComplete: true,
        retryExpired: true
      ) == .deliver(0)
    )
  }

  @Test
  func unavailableEmitterProcessRejectsUnsafeFallbacks() {
    let differentProcess = candidate(
      processID: 101,
      processMatch: .different,
      workingDirectoryMatch: .exact
    )
    let firstUnknown = candidate(
      processID: 202,
      processMatch: .unknown,
      workingDirectoryMatch: .unknown
    )
    let secondUnknown = candidate(
      processID: 303,
      processMatch: .unknown,
      workingDirectoryMatch: .unknown
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [differentProcess],
        processID: 404,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [firstUnknown, secondUnknown],
        processID: 404,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }

  @Test
  func exactWorkingDirectoryHasSecondPriority() {
    let unknown = candidate(processID: 101, workingDirectoryMatch: .unknown)
    let exact = candidate(processID: 202, workingDirectoryMatch: .exact)

    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, exact],
        processID: nil,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(1)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, unknown, exact],
        processID: nil,
        pollingComplete: true,
        retryExpired: false
      ) == .deliver(2)
    )
  }

  @Test
  func unknownWorkingDirectoryIsTheOnlyFallback() {
    let unknown = candidate(processID: 101, workingDirectoryMatch: .unknown)
    let different = candidate(processID: 303, workingDirectoryMatch: .different)

    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, different],
        processID: nil,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, different],
        processID: nil,
        pollingComplete: true,
        retryExpired: true
      ) == .deliver(0)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknown],
        processID: nil,
        pollingComplete: false,
        retryExpired: true
      ) == .reject
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [different],
        processID: nil,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }

  @Test
  func ambiguousOwnershipRetriesThenRejects() {
    let unknown = candidate(processID: 101, workingDirectoryMatch: .unknown)
    let duplicateProcess = candidate(
      processID: 101,
      processMatch: .matching,
      workingDirectoryMatch: .exact
    )
    let relatedProcess = candidate(
      processID: 101,
      processMatch: .matching,
      workingDirectoryMatch: .unknown
    )

    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, unknown],
        processID: nil,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, unknown],
        processID: nil,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [relatedProcess, duplicateProcess],
        processID: 101,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [relatedProcess, duplicateProcess],
        processID: 101,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }
}

private func candidate(
  processID: Int32,
  sessionIDMatchesTitle: Bool = false,
  processMatch: SupatermAgentHookProcessMatch = .unknown,
  workingDirectoryMatch: SupatermAgentHookWorkingDirectoryMatch
) -> SupatermAgentHookCandidate {
  SupatermAgentHookCandidate(
    context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
    processID: processID,
    sessionIDMatchesTitle: sessionIDMatchesTitle,
    processMatch: processMatch,
    workingDirectoryMatch: workingDirectoryMatch
  )
}
