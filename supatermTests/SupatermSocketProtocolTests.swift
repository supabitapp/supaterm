import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermSocketProtocolTests {
  @Test
  func defaultSocketURLUsesApplicationSupportDirectory() {
    let appSupportDirectory = URL(fileURLWithPath: "/tmp/SupatermTests/Application Support", isDirectory: true)

    #expect(
      SupatermSocketPath.defaultURL(appSupportDirectory: appSupportDirectory)
        == appSupportDirectory
        .appendingPathComponent("Supaterm", isDirectory: true)
        .appendingPathComponent("supaterm.sock", isDirectory: false)
    )
  }

  @Test
  func socketPathResolutionPrefersExplicitPathThenEnvironmentThenDefault() {
    let appSupportDirectory = URL(fileURLWithPath: "/tmp/SupatermTests/Application Support", isDirectory: true)
    let environmentPath = "/tmp/supaterm.environment.sock"
    let explicitPath = "/tmp/supaterm.explicit.sock"

    #expect(
      SupatermSocketPath.resolve(
        explicitPath: explicitPath,
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath],
        appSupportDirectory: appSupportDirectory
      ) == explicitPath
    )
    #expect(
      SupatermSocketPath.resolve(
        environment: [SupatermCLIEnvironment.socketPathKey: environmentPath],
        appSupportDirectory: appSupportDirectory
      ) == environmentPath
    )
    #expect(
      SupatermSocketPath.resolve(appSupportDirectory: appSupportDirectory)
        == appSupportDirectory
        .appendingPathComponent("Supaterm", isDirectory: true)
        .appendingPathComponent("supaterm.sock", isDirectory: false)
        .path
    )
  }

  @Test
  func requestAndResponseRoundTripAsJSON() throws {
    let encoder = JSONEncoder()
    let decoder = JSONDecoder()
    let request = SupatermSocketRequest(
      id: "request-1",
      method: SupatermSocketMethod.systemPing,
      params: [
        "nested": .object(["pong": .bool(true)]),
        "null": .null,
      ]
    )
    let response = SupatermSocketResponse.ok(
      id: "request-1",
      result: ["pong": .bool(true)]
    )

    #expect(
      try decoder.decode(
        SupatermSocketRequest.self,
        from: encoder.encode(request)
      ) == request
    )
    #expect(
      try decoder.decode(
        SupatermSocketResponse.self,
        from: encoder.encode(response)
      ) == response
    )
  }
}
