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
    let userID = getuid()
    try? FileManager.default.createDirectory(
      at: directoryURL,
      withIntermediateDirectories: true,
      attributes: [.posixPermissions: 0o700]
    )
    let directoryDescriptor = directoryURL.path.withCString { pointer in
      Darwin.open(pointer, O_RDONLY | O_DIRECTORY | O_CLOEXEC | O_NOFOLLOW)
    }
    guard directoryDescriptor >= 0 else {
      return .unchecked
    }
    defer { Darwin.close(directoryDescriptor) }
    guard
      SupatermSocketPath.isPrivateDirectory(
        descriptor: directoryDescriptor,
        userID: userID
      )
    else {
      return .unchecked
    }

    let lockFileName = fileName(forInstanceName: instanceName)
    let descriptor = lockFileName.withCString { pointer in
      Darwin.openat(
        directoryDescriptor,
        pointer,
        O_CREAT | O_RDWR | O_CLOEXEC | O_NOFOLLOW,
        0o600
      )
    }
    guard descriptor >= 0 else {
      return .unchecked
    }
    guard prepareLockFile(descriptor, userID: userID) else {
      Darwin.close(descriptor)
      return .unchecked
    }
    guard flock(descriptor, LOCK_EX | LOCK_NB) == 0 else {
      let lockError = errno
      Darwin.close(descriptor)
      return lockError == EWOULDBLOCK ? .taken : .unchecked
    }
    return .granted(SupatermInstanceLock(descriptor: descriptor))
  }

  private static func prepareLockFile(_ descriptor: Int32, userID: uid_t) -> Bool {
    var fileStatus = stat()
    guard fstat(descriptor, &fileStatus) == 0 else {
      return false
    }
    guard
      (fileStatus.st_mode & S_IFMT) == S_IFREG,
      fileStatus.st_uid == userID,
      fileStatus.st_nlink == 1
    else {
      return false
    }
    return fchmod(descriptor, 0o600) == 0
  }

  private static func fileName(forInstanceName instanceName: String) -> String {
    let normalizedName = SupatermInstanceIdentity.normalizedName(instanceName)
    let stem = SupatermInstanceIdentity.fileStem(for: normalizedName)
    let hash = SupatermInstanceIdentity.stableHash(for: normalizedName)
    return "instance-\(stem)-\(hash).lock"
  }
}
