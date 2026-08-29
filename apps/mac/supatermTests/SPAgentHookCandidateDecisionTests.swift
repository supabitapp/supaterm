import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPAgentHookCandidateDecisionTests {
  @Test
  func emitterProcessHasFirstPriority() {
    let exact = candidate(processID: 202, workingDirectoryMatch: .exact)
    let different = candidate(processID: 303, workingDirectoryMatch: .different)

    #expect(
      agentHookCandidateDecision(
        candidates: [exact, different],
        processID: different.processID,
        pollingComplete: false,
        retryExpired: false
      ) == .deliver(1)
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exact],
        processID: different.processID,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [exact],
        processID: different.processID,
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
    let duplicateProcess = candidate(processID: 101, workingDirectoryMatch: .exact)

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
        candidates: [unknown, duplicateProcess],
        processID: 101,
        pollingComplete: true,
        retryExpired: false
      ) == .retry
    )
    #expect(
      agentHookCandidateDecision(
        candidates: [unknown, duplicateProcess],
        processID: 101,
        pollingComplete: true,
        retryExpired: true
      ) == .reject
    )
  }
}

private func candidate(
  processID: Int32,
  workingDirectoryMatch: SupatermAgentHookWorkingDirectoryMatch
) -> SupatermAgentHookCandidate {
  SupatermAgentHookCandidate(
    context: SupatermCLIContext(surfaceID: UUID(), tabID: UUID()),
    processID: processID,
    workingDirectoryMatch: workingDirectoryMatch
  )
}
