import ArgumentParser
import Darwin
import Foundation
import SupatermCLIShared

struct SPTmuxArgumentParser {
  struct ParsedArguments: Equatable {
    var flags: Set<String> = []
    var options: [String: [String]] = [:]
    var positional: [String] = []

    func hasFlag(_ flag: String) -> Bool {
      flags.contains(flag)
    }

    func value(_ flag: String) -> String? {
      options[flag]?.last
    }
  }

  static func parse(
    _ arguments: [String],
    valueFlags: Set<String>,
    boolFlags: Set<String>
  ) throws -> ParsedArguments {
    var parsed = ParsedArguments()
    var index = 0

    while index < arguments.count {
      let argument = arguments[index]

      if argument == "--" {
        parsed.positional.append(contentsOf: arguments.dropFirst(index + 1))
        break
      }

      if argument.hasPrefix("--"), argument.count > 2 {
        if let equalsIndex = argument.firstIndex(of: "=") {
          let flag = String(argument[..<equalsIndex])
          let value = String(argument[argument.index(after: equalsIndex)...])
          if valueFlags.contains(flag) {
            parsed.options[flag, default: []].append(value)
            index += 1
            continue
          }
        }

        if boolFlags.contains(argument) {
          parsed.flags.insert(argument)
          index += 1
          continue
        }

        if valueFlags.contains(argument) {
          guard index + 1 < arguments.count else {
            throw ValidationError("\(argument) requires a value.")
          }
          parsed.options[argument, default: []].append(arguments[index + 1])
          index += 2
          continue
        }
      }

      if argument.hasPrefix("-"), argument.count > 1, argument != "-" {
        let scalars = Array(argument)
        var scalarIndex = 1
        var recognized = true

        while scalarIndex < scalars.count {
          let flag = "-\(scalars[scalarIndex])"
          if boolFlags.contains(flag) {
            parsed.flags.insert(flag)
            scalarIndex += 1
            continue
          }
          if valueFlags.contains(flag) {
            let value: String
            if scalarIndex + 1 < scalars.count {
              value = String(scalars[(scalarIndex + 1)...])
            } else {
              guard index + 1 < arguments.count else {
                throw ValidationError("\(flag) requires a value.")
              }
              index += 1
              value = arguments[index]
            }
            parsed.options[flag, default: []].append(value)
            scalarIndex = scalars.count
            continue
          }
          recognized = false
          break
        }

        if recognized {
          index += 1
          continue
        }
      }

      parsed.positional.append(argument)
      index += 1
    }

    return parsed
  }
}
