import ArgumentParser
import Foundation
import SupatermCLIShared

extension SP {
  struct Skills: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "skills",
      abstract: "List, retrieve, and install Supaterm skills.",
      discussion: SPHelp.skillsDiscussion,
      subcommands: [ListSkills.self, GetSkill.self, InstallSkill.self],
      defaultSubcommand: ListSkills.self
    )
  }

  struct ListSkills: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "list",
      abstract: "List bundled Supaterm skills.",
      discussion: SPHelp.listSkillsDiscussion
    )

    @Flag(name: .long, help: "Print command output as JSON.")
    var json = false

    mutating func run() throws {
      let skills = try runSkillsOperation(json: json) {
        try SupatermSkills(homeDirectoryURL: cliHomeDirectoryURL()).list()
      }
      if json {
        print(try jsonString(SPSkillsSuccess(data: skills)))
      } else {
        for skill in skills {
          print("\(skill.name)\t\(skill.description)")
        }
      }
    }
  }

  struct GetSkill: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "get",
      abstract: "Print a bundled Supaterm skill.",
      discussion: SPHelp.getSkillDiscussion
    )

    @Argument(help: "Bundled skill name.")
    var name: String

    @Flag(name: .long, help: "Include every bundled file for the skill.")
    var full = false

    @Flag(name: .long, help: "Print command output as JSON.")
    var json = false

    mutating func run() throws {
      let skill = try runSkillsOperation(json: json) {
        try SupatermSkills(homeDirectoryURL: cliHomeDirectoryURL())
          .get(name: name, full: full)
      }
      if json {
        print(try jsonString(SPSkillsSuccess(data: [skill])))
      } else {
        let output = renderSkill(skill)
        print(output, terminator: output.hasSuffix("\n") ? "" : "\n")
      }
    }
  }

  struct InstallSkill: ParsableCommand {
    static let configuration = CommandConfiguration(
      commandName: "install",
      abstract: "Install Supaterm's discovery skill.",
      discussion: SPHelp.installSkillDiscussion
    )

    @Flag(name: .long, help: "Print command output as JSON.")
    var json = false

    mutating func run() throws {
      let result = try runSkillsOperation(json: json) {
        try SupatermSkills(homeDirectoryURL: cliHomeDirectoryURL()).install()
      }
      if json {
        print(try jsonString(SPSkillsSuccess(data: [result])))
      } else {
        print(result.path)
      }
    }
  }
}

struct SPSkillsSuccess<Data: Encodable>: Encodable {
  let success = true
  let data: Data
}

struct SPSkillsFailure: Encodable {
  let error: String
  let success = false
}

func runSkillsOperation<Result>(json: Bool, operation: () throws -> Result) throws -> Result {
  do {
    return try operation()
  } catch {
    guard json else {
      throw error
    }
    print(try jsonString(SPSkillsFailure(error: error.localizedDescription)))
    throw ExitCode.failure
  }
}

func renderSkill(_ skill: SupatermSkillContent) -> String {
  var output = skill.content
  for file in skill.files ?? [] {
    if !output.hasSuffix("\n") {
      output += "\n"
    }
    output += "\n--- \(file.path) ---\n\n"
    output += file.content
  }
  return output
}
