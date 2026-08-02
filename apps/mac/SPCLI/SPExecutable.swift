import Darwin
import Foundation

enum SPExecutable {
  static func currentPath() -> String? {
    var size: UInt32 = 0
    _ = _NSGetExecutablePath(nil, &size)
    guard size > 0 else {
      return nil
    }

    let buffer = UnsafeMutablePointer<CChar>.allocate(capacity: Int(size))
    defer {
      buffer.deallocate()
    }

    guard _NSGetExecutablePath(buffer, &size) == 0 else {
      return nil
    }

    return canonicalPath(String(cString: buffer))
  }

  static func canonicalPath(_ path: String) -> String {
    let standardizedPath = standardizedPath(path)
    var buffer = [CChar](repeating: 0, count: Int(PATH_MAX))
    let resolved = standardizedPath.withCString { pointer in
      realpath(pointer, &buffer)
    }
    guard resolved != nil else {
      return standardizedPath
    }
    let bytes = buffer.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }
    return String(bytes: bytes, encoding: .utf8) ?? standardizedPath
  }

  static func standardizedPath(_ path: String) -> String {
    URL(fileURLWithPath: path, isDirectory: false)
      .standardizedFileURL
      .path
  }

  static func isExecutableFile(atPath path: String) -> Bool {
    var isDirectory = ObjCBool(false)
    return FileManager.default.fileExists(atPath: path, isDirectory: &isDirectory)
      && !isDirectory.boolValue
      && FileManager.default.isExecutableFile(atPath: path)
  }

  static func resolve(
    _ executable: String,
    searchPath: String? = nil,
    currentDirectoryPath: String = FileManager.default.currentDirectoryPath
  ) -> String? {
    let candidates: [String]
    if executable.contains("/") {
      candidates = [executable]
    } else {
      candidates =
        searchPath?.split(separator: ":", omittingEmptySubsequences: false).map { entry in
          let directory = entry.isEmpty ? currentDirectoryPath : String(entry)
          return URL(fileURLWithPath: directory, isDirectory: true)
            .appendingPathComponent(executable, isDirectory: false)
            .path
        } ?? []
    }

    for candidate in candidates {
      let standardizedCandidate = standardizedPath(candidate)
      if isExecutableFile(atPath: standardizedCandidate) {
        return standardizedCandidate
      }
    }
    return nil
  }
}
