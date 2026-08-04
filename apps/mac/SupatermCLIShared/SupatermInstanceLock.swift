import Darwin
import Foundation

public enum SupatermInstanceClaim: Sendable {
  case granted(SupatermInstanceLock)
  case taken
  case unchecked
}

public final class SupatermInstanceLock: Sendable {
  private let descriptor: Int32

  private init(descriptor: Int32) {
    self.descriptor = descriptor
  }

  deinit {
    Darwin.close(descriptor)
  }

  public static func claim(
    instanceName: String = SupatermInstanceIdentity.resolvedName(),
    directoryURL: URL = SupatermSocketPath.managedDirectoryURL()
  ) -> SupatermInstanceClaim {
    try? FileManager.default.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let path =
      directoryURL
      .appendingPathComponent(
        fileName(forInstanceName: instanceName),
        isDirectory: false
      )
      .path
    let descriptor = path.withCString { pointer in
      Darwin.open(pointer, O_CREAT | O_RDWR | O_CLOEXEC, 0o600)
    }
    guard descriptor >= 0 else {
      return .unchecked
    }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      let lockError = errno
      Darwin.close(descriptor)
      return lockError == EWOULDBLOCK ? .taken : .unchecked
    }
    return .granted(SupatermInstanceLock(descriptor: descriptor))
  }

  private static func fileName(forInstanceName instanceName: String) -> String {
    let normalizedName = SupatermInstanceIdentity.normalizedName(instanceName)
    let stem = SupatermInstanceIdentity.fileStem(for: normalizedName)
    let hash = SupatermInstanceIdentity.stableHash(for: normalizedName)
    return "instance-\(stem)-\(hash).lock"
  }
}
