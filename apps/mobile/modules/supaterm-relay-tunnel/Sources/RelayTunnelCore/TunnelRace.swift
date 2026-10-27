import Foundation

public enum TunnelRoute: String {
  case relay, direct
}

let maxDirectCandidates = 8

func tunnelBaseURL(_ value: String) -> URL? {
  guard let url = URL(string: value), ["ws", "wss"].contains(url.scheme), url.host?.isEmpty == false,
        url.user == nil, url.password == nil, url.query == nil, url.fragment == nil else { return nil }
  return url
}

func directTunnelURLs(_ values: [String]) -> [URL] {
  var seen = Set<String>()
  return Array(values.compactMap(tunnelBaseURL).filter { seen.insert($0.absoluteString).inserted }
    .prefix(maxDirectCandidates))
}

struct TunnelRace<Failure> {
  private var open: [Int: TunnelRoute]
  private var relayFailure: Failure?
  private var firstFailure: Failure?
  private(set) var winner: Int?

  init(_ routes: [Int: TunnelRoute]) { open = routes }

  // nil means the candidate already failed or another one won first.
  mutating func welcome(_ id: Int) -> [Int]? {
    guard winner == nil, open.removeValue(forKey: id) != nil else { return nil }
    winner = id
    defer { open.removeAll() }
    return open.keys.sorted()
  }

  // The relay's reason is what users act on, so it outranks direct failures once all have failed.
  mutating func fail(_ id: Int, _ failure: Failure) -> Failure? {
    guard winner == nil, let route = open.removeValue(forKey: id) else { return nil }
    if route == .relay { relayFailure = failure }
    if firstFailure == nil { firstFailure = failure }
    return open.isEmpty ? relayFailure ?? firstFailure : nil
  }
}
