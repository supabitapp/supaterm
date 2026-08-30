import Darwin
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

  @Test
  func conflictingRuntimeEnvironmentsContendForSameLockDirectory() throws {
    let rootURL = Self.makeDirectoryURL()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let firstEnvironment = [
      "TMPDIR": "/tmp/first",
      "XDG_RUNTIME_DIR": "/run/first",
      SupatermCLIEnvironment.testHomeKey: "/tmp/first-home",
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let secondEnvironment = [
      "TMPDIR": "/tmp/second",
      "XDG_RUNTIME_DIR": "/run/second",
      SupatermCLIEnvironment.testHomeKey: "/tmp/second-home",
      SupatermCLIEnvironment.testSocketRootKey: rootURL.path,
    ]
    let firstDirectory = SupatermSocketPath.managedDirectoryURL(environment: firstEnvironment)
    let secondDirectory = SupatermSocketPath.managedDirectoryURL(environment: secondEnvironment)
    let held = SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: firstDirectory)

    withExtendedLifetime(held) {
      #expect(firstDirectory == secondDirectory)
      #expect(
        Self.isTaken(
          SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: secondDirectory)
        )
      )
    }
  }

  @Test
  func claimRejectsSymlinkedDirectory() throws {
    let rootURL = Self.makeDirectoryURL()
    defer { try? FileManager.default.removeItem(at: rootURL) }
    let actualURL = rootURL.appendingPathComponent("actual", isDirectory: true)
    let symlinkURL = rootURL.appendingPathComponent("link", isDirectory: true)
    try Self.createPrivateDirectory(at: actualURL)
    try FileManager.default.createSymbolicLink(at: symlinkURL, withDestinationURL: actualURL)

    #expect(Self.isUnchecked(SupatermInstanceLock.claim(directoryURL: symlinkURL)))
  }

  @Test
  func claimRejectsSharedDirectory() throws {
    let directoryURL = Self.makeDirectoryURL()
    defer { try? FileManager.default.removeItem(at: directoryURL) }
    try Self.createPrivateDirectory(at: directoryURL)
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755],
      ofItemAtPath: directoryURL.path
    )

    #expect(Self.isUnchecked(SupatermInstanceLock.claim(directoryURL: directoryURL)))
  }

  @Test
  func claimRejectsSymlinkedLockFile() throws {
    let directoryURL = Self.makeDirectoryURL()
    defer { try? FileManager.default.removeItem(at: directoryURL) }
    try Self.createPrivateDirectory(at: directoryURL)
    let targetURL = directoryURL.appendingPathComponent("target", isDirectory: false)
    #expect(FileManager.default.createFile(atPath: targetURL.path, contents: Data()))
    let lockURL = directoryURL.appendingPathComponent(
      "instance-alpha-\(SupatermInstanceIdentity.stableHash(for: "alpha")).lock",
      isDirectory: false
    )
    try FileManager.default.createSymbolicLink(at: lockURL, withDestinationURL: targetURL)

    #expect(
      Self.isUnchecked(
        SupatermInstanceLock.claim(instanceName: "alpha", directoryURL: directoryURL)
      )
    )
  }

  private static func makeDirectoryURL() -> URL {
    FileManager.default.temporaryDirectory
      .appendingPathComponent("supaterm-instance-lock-\(UUID().uuidString)", isDirectory: true)
  }

  private static func createPrivateDirectory(at url: URL) throws {
    try FileManager.default.createDirectory(
      at: url,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    guard chmod(url.path, 0o700) == 0 else {
      throw POSIXError(POSIXErrorCode(rawValue: errno) ?? .EIO)
    }
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

  private static func isUnchecked(_ claim: SupatermInstanceClaim) -> Bool {
    if case .unchecked = claim {
      return true
    }
    return false
  }
}
