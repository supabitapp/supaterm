import XCTest
@testable import RelayTunnelCore

final class TunnelRaceTests: XCTestCase {
  func testDirectCandidatesKeepOnlyPlainWebSocketBaseURLs() {
    let urls = directTunnelURLs([
      "ws://192.168.1.20:3773", "wss://host.tailnet.ts.net/base", "http://192.168.1.20:3773",
      "ws://user:secret@192.168.1.20:3773", "ws://192.168.1.20:3773/?token=1", "ws://192.168.1.20:3773/#x",
      "ws://", "not a url"
    ])
    XCTAssertEqual(urls.map(\.absoluteString), ["ws://192.168.1.20:3773", "wss://host.tailnet.ts.net/base"])
  }

  func testDirectCandidatesAreDeduplicatedAndCappedAtEight() {
    let urls = directTunnelURLs(["ws://10.0.0.1:3773"] + (1...12).map { "ws://10.0.0.\($0):3773" })
    XCTAssertEqual(urls.map(\.absoluteString), (1...8).map { "ws://10.0.0.\($0):3773" })
  }

  func testFirstWelcomeWinsAndCancelsTheOthers() {
    var race = TunnelRace<String>([0: .relay, 1: .direct, 2: .direct])
    XCTAssertNil(race.fail(1, "refused"))
    XCTAssertEqual(race.welcome(2), [0])
    XCTAssertEqual(race.winner, 2)
  }

  func testWelcomeAfterTheWinnerIsRefused() {
    var race = TunnelRace<String>([0: .relay, 1: .direct])
    XCTAssertEqual(race.welcome(0), [1])
    XCTAssertNil(race.welcome(1))
    XCTAssertNil(race.fail(1, "late"))
    XCTAssertEqual(race.winner, 0)
  }

  func testFailedCandidateCannotWinLater() {
    var race = TunnelRace<String>([0: .relay, 1: .direct])
    XCTAssertNil(race.fail(1, "identity mismatch"))
    XCTAssertNil(race.welcome(1))
    XCTAssertEqual(race.welcome(0), [])
  }

  func testRaceFailsOnlyOnceEveryCandidateFailedAndKeepsTheRelayReason() {
    var race = TunnelRace<String>([0: .relay, 1: .direct, 2: .direct])
    XCTAssertNil(race.fail(0, "host-offline"))
    XCTAssertNil(race.fail(2, "refused"))
    XCTAssertEqual(race.fail(1, "timeout"), "host-offline")
    XCTAssertNil(race.winner)
  }
}
