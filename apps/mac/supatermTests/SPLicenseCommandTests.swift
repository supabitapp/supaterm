import Foundation
import SupatermCLIShared
import Testing

@testable import SPCLI

struct SPLicenseCommandTests {
  @Test
  func statusRendersEveryOutputModeAndIsTheDefaultCommand() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()
    let status = paidStatus

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return try .ok(id: request.id, encodableResult: status)
      },
      run: { endpoint in
        let socket = ["--socket", endpoint.path]
        let implicit = try cli.run(["license"] + socket)
        let explicit = try cli.run(["license", "status"] + socket)
        let plain = try cli.run(["license", "status", "--plain"] + socket)
        let json = try cli.run(["license", "status", "--json"] + socket)

        #expect(implicit == explicit)
        #expect(
          implicit.stdout == """
            Mode: Licensed
            Updates through: 2027-08-21
            Device: Test Mac

            """
        )
        #expect(plain.stdout == "paid\t2027-08-21\tTest Mac\t3/-\n")
        #expect(
          json.stdout == """
            {"deviceName":"Test Mac","mode":"paid","openTabCount":3,\
            "updatesThrough":"2027-08-21"}

            """
        )
      }
    )

    #expect(log.requests.map(\.method) == Array(repeating: SupatermSocketMethod.licenseStatus, count: 4))
  }

  @Test
  func freeStatusMatchesTheSalesPolicy() {
    let status = SupatermLicenseStatusResult(
      mode: .free,
      updatesThrough: nil,
      deviceName: "Test Mac",
      openTabCount: 3
    )

    #expect(
      renderLicenseStatus(status, salesEnabled: false) == """
        Mode: Free
        Device: Test Mac
        Open tabs: 3
        Run `sp license activate` to activate an existing license.
        """
    )
    #expect(
      renderLicenseStatus(status, salesEnabled: true) == """
        Mode: Free
        Device: Test Mac
        Open tabs: 3 of 5
        Run `sp license buy` or `sp license activate` to unlock more tabs.
        """
    )
  }

  @Test
  func activateReadsTheKeyFromStdinAndNeverAcceptsItAsAnArgument() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()
    let status = paidStatus

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        return try .ok(id: request.id, encodableResult: status)
      },
      run: { endpoint in
        let result = try cli.run(
          ["license", "activate", "--socket", endpoint.path],
          standardInput: "license-key\n"
        )
        let rejected = try cli.run([
          "license", "activate", "license-key", "--socket", endpoint.path,
        ])

        #expect(result.exitCode == 0)
        #expect(!result.stdout.contains("license-key"))
        #expect(result.stderr.isEmpty)
        #expect(rejected.exitCode != 0)
      }
    )

    let request = try #require(log.requests.first)
    #expect(request.method == SupatermSocketMethod.licenseActivate)
    #expect(
      try request.decodeParams(SupatermLicenseActivationRequest.self)
        == SupatermLicenseActivationRequest(key: "license-key")
    )
  }

  @Test
  func buyAndRenewPrintTheURLReturnedByTheApp() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let log = SPSocketRequestLog()

    try await withSocketRuntime(
      replying: { request, _ in
        log.record(request)
        let url =
          request.method == SupatermSocketMethod.licenseBuy
          ? "https://license.supaterm.com/buy"
          : "https://license.supaterm.com/licenses/license-id"
        return try .ok(id: request.id, encodableResult: SupatermLicenseURLResult(url: url))
      },
      run: { endpoint in
        let socket = ["--socket", endpoint.path]
        let buy = try cli.run(["license", "buy"] + socket)
        let renew = try cli.run(["license", "renew"] + socket)

        #expect(buy.stdout == "https://license.supaterm.com/buy\n")
        #expect(renew.stdout == "https://license.supaterm.com/licenses/license-id\n")
      }
    )

    #expect(
      log.requests.map(\.method) == [
        SupatermSocketMethod.licenseBuy,
        SupatermSocketMethod.licenseRenew,
      ])
  }

  @Test
  func tabLimitErrorTellsTheUserHowToActivate() async throws {
    let cli = try SPCLIHarness()
    defer { cli.remove() }
    let spaceID = UUID(uuidString: "A6E57B1B-0A61-4F72-BD52-B26DC5D3C497")!
    let snapshot = SupatermTreeSnapshot(
      projects: [],
      windows: [
        SupatermTreeSnapshot.Window(
          index: 1,
          isKey: true,
          displayedSpaceID: spaceID,
          spaces: [
            SupatermTreeSnapshot.Space(
              index: 1,
              id: spaceID,
              name: "Work",
              color: .neutral,
              isWarm: true,
              collapsedProjectIDs: [],
              isUnassignedCollapsed: false,
              tabs: []
            )
          ]
        )
      ]
    )

    try await withSocketRuntime(
      replying: { request, _ in
        if request.method == SupatermSocketMethod.appTree {
          return try .ok(id: request.id, encodableResult: snapshot)
        }
        return .error(
          id: request.id,
          code: "license_required",
          message: "Free mode allows 5 open tabs. Run `sp license activate` to unlock more."
        )
      },
      run: { endpoint in
        let result = try cli.run([
          "tab", "new", "--in", spaceID.uuidString, "--socket", endpoint.path,
        ])

        #expect(result.exitCode != 0)
        #expect(result.stderr.contains("sp license activate"))
      }
    )
  }

  @Test
  func inputReaderUsesAHiddenPromptOrPipedInput() throws {
    var prompt = ""
    let interactive = try readLicenseKey(
      isInteractive: { true },
      readInteractiveInput: {
        prompt = $0
        return "  interactive-key  "
      }
    )
    let piped = try readLicenseKey(
      isInteractive: { false },
      readPipedInput: { Data("piped-key\n".utf8) }
    )

    #expect(prompt == "License key: ")
    #expect(interactive == "interactive-key")
    #expect(piped == "piped-key")
  }

  @Test
  func licenseKeyValidationNormalizesAndCapsInput() {
    #expect(SupatermLicensePolicy.validateLicenseKey(" \n ") == .empty)
    #expect(
      SupatermLicensePolicy.validateLicenseKey("  license-key\n")
        == .valid("license-key")
    )
    #expect(
      SupatermLicensePolicy.validateLicenseKey(
        String(repeating: "A", count: SupatermLicensePolicy.maximumLicenseKeyLength + 1)
      ) == .tooLong
    )
  }
}

private let paidStatus = SupatermLicenseStatusResult(
  mode: .paid,
  updatesThrough: "2027-08-21",
  deviceName: "Test Mac",
  openTabCount: 3
)
