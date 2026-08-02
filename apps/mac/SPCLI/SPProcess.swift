import ArgumentParser
import Darwin

enum SPProcess {
  static func replaceCurrent(
    executablePath: String,
    arguments: [String],
    environment: [String: String]? = nil,
    failureDescription: String
  ) throws -> Never {
    let argv = makeCStringArray(arguments)
    defer {
      freeCStringArray(argv)
    }

    if let environment {
      let envp = makeCStringArray(
        environment.keys.sorted().map { key in
          "\(key)=\(environment[key] ?? "")"
        }
      )
      defer {
        freeCStringArray(envp)
      }
      execve(executablePath, argv, envp)
    } else {
      execv(executablePath, argv)
    }

    let message = String(cString: strerror(errno))
    throw ValidationError("\(failureDescription): \(message)")
  }
}

private func makeCStringArray(_ values: [String]) -> UnsafeMutablePointer<
  UnsafeMutablePointer<CChar>?
> {
  let pointer = UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>.allocate(
    capacity: values.count + 1)
  for (index, value) in values.enumerated() {
    pointer[index] = strdup(value)
  }
  pointer[values.count] = nil
  return pointer
}

private func freeCStringArray(_ pointer: UnsafeMutablePointer<UnsafeMutablePointer<CChar>?>) {
  var index = 0
  while let value = pointer[index] {
    free(value)
    index += 1
  }
  pointer.deallocate()
}
