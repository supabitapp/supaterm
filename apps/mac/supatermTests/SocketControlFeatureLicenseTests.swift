import ComposableArchitecture
import Foundation
import SupatermCLIShared
import SupatermSocketFeature
import SupatermTerminalCore
import Testing

@MainActor
struct SocketControlFeatureLicenseTests {
  @Test
  func activationDispatchesTheLicenseRequestAndReturnsStatus() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let expected = SupatermLicenseStatusResult(
      mode: .paid,
      updatesThrough: "2027-08-21",
      deviceName: "Test Mac",
      openTabCount: 3,
      freeTabLimit: 5
    )
    let request = SocketControlClient.Request(
      handle: handle,
      payload: try .licenseActivate(
        SupatermLicenseActivationRequest(key: "license-key"),
        id: "license-activate-1"
      )
    )
    let store = makeStore(
      updateDependencies: {
        $0.socketControlClient.reply = { handle, response in
          await recorder.record(handle: handle, response: response)
        }
      },
      executeLicense: { request in
        #expect(request == .activate("license-key"))
        return .status(expected)
      }
    )

    await store.send(.requestReceived(request))

    let response = try #require(await recorder.snapshot().first?.response)
    #expect(try response.decodeResult(SupatermLicenseStatusResult.self) == expected)
  }

  @Test
  func licenseFailureUsesTheSocketErrorEnvelope() async throws {
    let recorder = SocketReplyRecorder()
    let handle = UUID()
    let request = SocketControlClient.Request(
      handle: handle,
      payload: .licenseDeactivate(id: "license-deactivate-1")
    )
    let store = makeStore(
      updateDependencies: {
        $0.socketControlClient.reply = { handle, response in
          await recorder.record(handle: handle, response: response)
        }
      },
      executeLicense: { _ in
        throw LicenseControlError(
          code: "connection_required",
          message: "Deactivation needs a connection."
        )
      }
    )

    await store.send(.requestReceived(request))

    #expect(
      await recorder.snapshot().first
        == SocketReplyRecorder.Record(
          handle: handle,
          response: .error(
            id: "license-deactivate-1",
            code: "connection_required",
            message: "Deactivation needs a connection."
          )
        )
    )
  }
}
