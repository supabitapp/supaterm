import Foundation
import Testing

@testable import SupatermCLIShared

struct SupatermInstanceLockTests {
  @Test
  func claimIsGrantedWhenNoProcessOwnsTheName() {
    let directoryURL = Self.makeDirectoryURL()

    #expect(
      Self.isGranted(
        SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)
      )
    )
  }

  @Test
  func claimIsTakenWhileAnotherClaimHoldsTheName() {
    let directoryURL = Self.makeDirectoryURL()
    let held = SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)

    withExtendedLifetime(held) {
      #expect(
        Self.isTaken(
          SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)
        )
      )
    }
  }

  @Test
  func unnamedInstancesCollideWithTheDefaultName() {
    let directoryURL = Self.makeDirectoryURL()
    let held = SupatermInstanceLock.claim(instanceName: "", directoryURL: directoryURL)

    withExtendedLifetime(held) {
      #expect(
        Self.isTaken(
          SupatermInstanceLock.claim(
            instanceName: SupatermInstanceIdentity.defaultName,
            directoryURL: directoryURL
          )
        )
      )
    }
  }

  @Test
  func distinctNamesDoNotCollide() {
    let directoryURL = Self.makeDirectoryURL()
    let held = SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)

    withExtendedLifetime(held) {
      #expect(
        Self.isGranted(
          SupatermInstanceLock.claim(instanceName: "beta", directoryURL: directoryURL)
        )
      )
    }
  }

  @Test
  func nameIsReclaimableOnceTheLockIsReleased() {
    let directoryURL = Self.makeDirectoryURL()
    do {
      let held = SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)
      #expect(Self.isGranted(held))
    }

    #expect(
      Self.isGranted(
        SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)
      )
    )
  }

  private static func makeDirectoryURL() -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-instance-lock-\(UUID().uuidString)", isDirectory: true)
  }

  private static func isGranted(_ claim: SupatermInstanceClaim) -> Bool {
    if case .granted = claim {
      return true
    }
    return false
  }

  private static func isTaken(_ claim: SupatermInstanceClaim) -> Bool {
    if case .taken = claim {
      return true
    }
    return false
  }
}
