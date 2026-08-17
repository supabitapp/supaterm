import Foundation

nonisolated struct TerminalTabGroupTitleInput: Equatable, Sendable {
  let title: String
  let isTitleLocked: Bool
}

nonisolated enum TerminalTabGroupTitleSuggester {
  static let maximumLength = 48

  static func title(
    for tabs: [TerminalTabGroupTitleInput],
    sharedRepositoryName: String?,
    existingTitles: [String]
  ) -> String {
    let titles = tabs.map { normalized($0.title) }
    let completeTitles = titles.compactMap(\.self)
    let baseTitle: String

    if tabs.count == 1, tabs[0].isTitleLocked, let title = titles[0] {
      baseTitle = title
    } else if tabs.count > 1,
      tabs.allSatisfy(\.isTitleLocked),
      completeTitles.count == tabs.count,
      let stem = sharedStem(completeTitles)
    {
      baseTitle = stem
    } else if let sharedRepositoryName = normalized(sharedRepositoryName) {
      baseTitle = sharedRepositoryName
    } else if completeTitles.count == tabs.count,
      let stem = sharedStem(completeTitles)
    {
      baseTitle = stem
    } else if let firstTitle = completeTitles.first {
      baseTitle = tabs.count > 1 ? "\(firstTitle) + \(tabs.count - 1)" : firstTitle
    } else {
      baseTitle = tabs.count == 1 ? "Tab" : "\(tabs.count) Tabs"
    }

    return uniqueTitle(baseTitle, existingTitles: existingTitles)
  }

  static func sharedRepositoryName(
    workingDirectoryPathsByTab: [[String]]
  ) -> String? {
    sharedRepositoryRoot(
      workingDirectoryPathsByTab: workingDirectoryPathsByTab,
      repositoryRoot: repositoryRoot(for:)
    ).flatMap {
      normalized(URL(fileURLWithPath: $0, isDirectory: true).lastPathComponent)
    }
  }

  static func sharedRepositoryRoot(
    workingDirectoryPathsByTab: [[String]],
    repositoryRoot: (String) -> String?
  ) -> String? {
    guard !workingDirectoryPathsByTab.isEmpty else { return nil }
    var sharedRoot: String?

    for paths in workingDirectoryPathsByTab {
      guard !paths.isEmpty else { return nil }
      let roots = paths.compactMap(repositoryRoot)
      guard roots.count == paths.count, Set(roots).count == 1, let root = roots.first else {
        return nil
      }
      if let sharedRoot {
        guard sharedRoot == root else { return nil }
      } else {
        sharedRoot = root
      }
    }

    return sharedRoot
  }

  static func repositoryRoot(for path: String) -> String? {
    var directory = URL(fileURLWithPath: path, isDirectory: true)
      .standardizedFileURL
      .resolvingSymlinksInPath()

    while true {
      let marker = directory.appending(path: ".git").path(percentEncoded: false)
      if FileManager.default.fileExists(atPath: marker) {
        return directory.path(percentEncoded: false)
      }
      let parent = directory.deletingLastPathComponent()
      guard parent != directory else { return nil }
      directory = parent
    }
  }

  private static func sharedStem(_ titles: [String]) -> String? {
    guard let first = titles.first else { return nil }
    let characters = titles.map(Array.init)
    guard let shortestCount = characters.map(\.count).min(), shortestCount > 0 else {
      return nil
    }

    var commonCount = 0
    for index in 0..<shortestCount {
      let candidate = String(characters[0][index])
      guard
        characters.dropFirst().allSatisfy({
          candidate.compare(
            String($0[index]),
            options: [.caseInsensitive, .diacriticInsensitive]
          ) == .orderedSame
        })
      else {
        break
      }
      commonCount += 1
    }
    guard commonCount > 0 else { return nil }

    var stem = String(first.prefix(commonCount))
    if let last = stem.last, isWordCharacter(last) {
      let continuesInsideWord = characters.contains { title in
        title.count > commonCount && isWordCharacter(title[commonCount])
      }
      if continuesInsideWord {
        guard let boundary = stem.lastIndex(where: { !isWordCharacter($0) }) else {
          return nil
        }
        stem = String(stem[..<boundary])
      }
    }

    let trimmed = stem.trimmingCharacters(
      in: .whitespacesAndNewlines.union(.punctuationCharacters)
    )
    let alphanumericCount = trimmed.unicodeScalars.count {
      CharacterSet.alphanumerics.contains($0)
    }
    return alphanumericCount >= 2 ? trimmed : nil
  }

  private static func isWordCharacter(_ character: Character) -> Bool {
    character.unicodeScalars.allSatisfy(CharacterSet.alphanumerics.contains)
  }

  private static func uniqueTitle(_ title: String, existingTitles: [String]) -> String {
    let existing = Set(existingTitles.compactMap(normalized).map { $0.lowercased() })
    let base = truncated(title, maximumLength: maximumLength)
    guard existing.contains(base.lowercased()) else { return base }

    var index = 2
    while true {
      let suffix = " \(index)"
      let prefix = truncated(base, maximumLength: maximumLength - suffix.count)
      let candidate = prefix + suffix
      if !existing.contains(candidate.lowercased()) {
        return candidate
      }
      index += 1
    }
  }

  private static func truncated(_ value: String, maximumLength: Int) -> String {
    String(value.prefix(maximumLength))
      .trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private static func normalized(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.split(whereSeparator: \.isWhitespace).joined(separator: " ")
    return normalized.isEmpty ? nil : normalized
  }
}
