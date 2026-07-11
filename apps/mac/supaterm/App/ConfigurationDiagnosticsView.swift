import SwiftUI

struct ConfigurationDiagnosticsView: View {
  let messages: [String]
  let onIgnore: () -> Void
  let onReload: () -> Void

  var body: some View {
    VStack(spacing: 0) {
      HStack {
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundStyle(.yellow)
          .font(.system(size: 52))
          .padding()
          .accessibilityHidden(true)

        Text(summary)
          .frame(maxWidth: .infinity, alignment: .leading)
          .padding()
      }

      GeometryReader { geometry in
        ScrollView {
          VStack(alignment: .leading, spacing: 8) {
            ForEach(messages.indices, id: \.self) { index in
              Text(messages[index])
                .lineLimit(nil)
                .font(.system(size: 12, design: .monospaced))
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
            }

            Spacer()
          }
          .padding()
          .frame(minHeight: geometry.size.height)
        }
        .background(Color(nsColor: .controlBackgroundColor))
      }

      HStack {
        Spacer()
        Button("Ignore", action: onIgnore)
        Button("Reload Configuration", action: onReload)
      }
      .padding()
    }
    .frame(minWidth: 480, maxWidth: 960, minHeight: 270)
  }

  private var summary: String {
    let count = messages.count
    let countText = count == 1 ? "1 error was" : "\(count) errors were"
    return
      "\(countText) found while loading the terminal configuration. "
      + "Review the errors below, then reload your configuration or ignore the erroneous lines."
  }
}
