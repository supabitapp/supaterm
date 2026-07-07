import SupaTheme
import SwiftUI

struct ReleaseAnnouncementCardView: View {
  let announcement: ReleaseAnnouncement
  let palette: Palette
  let dismiss: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack(alignment: .top, spacing: 8) {
        Image(announcement.imageName)
          .renderingMode(.template)
          .resizable()
          .scaledToFit()
          .foregroundStyle(palette.primaryText)
          .frame(width: 24, height: 24, alignment: .leading)
          .accessibilityHidden(true)

        Spacer(minLength: 0)

        Button(action: dismiss) {
          Image(systemName: "xmark")
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(palette.secondaryText)
            .frame(width: 22, height: 22)
            .contentShape(.rect)
            .accessibilityHidden(true)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Dismiss")
        .help("Dismiss")
      }

      VStack(alignment: .leading, spacing: 4) {
        Text(announcement.title)
          .font(.system(size: 13, weight: .semibold))
          .foregroundStyle(palette.primaryText)
          .fixedSize(horizontal: false, vertical: true)

        Text(announcement.message)
          .font(.system(size: 12, weight: .medium))
          .foregroundStyle(palette.secondaryText)
          .fixedSize(horizontal: false, vertical: true)

        Text(announcement.footer)
          .font(.system(size: 11, weight: .semibold))
          .foregroundStyle(palette.secondaryText.opacity(0.7))
          .padding(.top, 2)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.horizontal, TerminalSidebarLayout.tabRowHorizontalPadding)
    .padding(.vertical, TerminalSidebarLayout.tabRowVerticalPadding)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
      .fill(palette.unselectedFill)
    )
    .contentShape(
      RoundedRectangle(
        cornerRadius: TerminalSidebarLayout.tabRowCornerRadius,
        style: .continuous
      )
    )
  }
}
