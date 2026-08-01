use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::{BRAND, Theme};

const LARGE_BOLT: [&str; 4] = ["   ▄█", "  ▄█ ", "▄██▄▄", "  █▀ "];
const LARGE_LEFT: [&str; 4] = [
    "",
    "█▀▀▀▀ █   █ █▀▀▀▄ ▄▀▀▀▄",
    "▀▀▀▀█ █   █ █   █ █▀▀▀█",
    "▀▀▀▀▀ ▀▀▀▀▀ █▀▀▀▀ █   █",
];
const LARGE_RIGHT: [&str; 4] = [
    "",
    "▀▀█▀▀ █▀▀▀▀ █▀▀▀▄ █▄ ▄█",
    "  █   █▀▀▀▀ █   █ █ ▀ █",
    "  ▀   ▀▀▀▀▀ █  ▀▄ █   █",
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(super) enum Logo {
    Large,
    Compact,
    Hidden,
}

impl Logo {
    pub(super) fn select(panel_width: u16, area_height: u16, picker_height: u16) -> Self {
        if panel_width >= large_width()
            && area_height >= Self::Large.height() + Self::Large.gap() + picker_height + 4
        {
            Self::Large
        } else if panel_width >= 14
            && area_height >= Self::Compact.height() + Self::Compact.gap() + 4
        {
            Self::Compact
        } else {
            Self::Hidden
        }
    }

    pub(super) const fn height(self) -> u16 {
        match self {
            Self::Large => LARGE_BOLT.len() as u16,
            Self::Compact => 1,
            Self::Hidden => 0,
        }
    }

    pub(super) const fn gap(self) -> u16 {
        match self {
            Self::Large => 2,
            Self::Compact => 1,
            Self::Hidden => 0,
        }
    }

    pub(super) fn render(self, buffer: &mut Buffer, area: Rect, y: u16, theme: Theme) {
        match self {
            Self::Large => render_large(buffer, area, y, theme),
            Self::Compact => render_compact(buffer, area, y, theme),
            Self::Hidden => {}
        }
    }
}

fn large_width() -> u16 {
    (text_rows_width(&LARGE_BOLT)
        + 2
        + text_rows_width(&LARGE_LEFT)
        + 1
        + text_rows_width(&LARGE_RIGHT)) as u16
}

fn text_rows_width(rows: &[&str]) -> usize {
    rows.iter().map(|row| row.width()).max().unwrap_or(0)
}

fn render_large(buffer: &mut Buffer, area: Rect, y: u16, theme: Theme) {
    let bolt_width = text_rows_width(&LARGE_BOLT);
    let left_width = text_rows_width(&LARGE_LEFT) as u16;
    let x = area.x + area.width.saturating_sub(large_width()) / 2;
    let wordmark_x = x.saturating_add(bolt_width as u16 + 2);
    let right_x = wordmark_x.saturating_add(left_width + 1);
    for row in 0..LARGE_BOLT.len() {
        let row_y = y.saturating_add(row as u16);
        if row_y >= area.bottom() {
            break;
        }
        buffer.set_stringn(
            x,
            row_y,
            LARGE_BOLT[row],
            LARGE_BOLT[row].width(),
            Style::default().fg(BRAND).bold(),
        );
        render_wordmark_row(
            buffer,
            wordmark_x,
            row_y,
            LARGE_LEFT[row],
            theme.muted,
            false,
        );
        render_wordmark_row(buffer, right_x, row_y, LARGE_RIGHT[row], theme.text, true);
    }
}

fn render_wordmark_row(
    buffer: &mut Buffer,
    x: u16,
    y: u16,
    row: &str,
    foreground: Color,
    bold: bool,
) {
    if row.is_empty() {
        return;
    }
    let modifier = if bold {
        Modifier::BOLD
    } else {
        Modifier::empty()
    };
    buffer.set_stringn(
        x,
        y,
        row,
        row.width(),
        Style::default().fg(foreground).add_modifier(modifier),
    );
}

fn render_compact(buffer: &mut Buffer, area: Rect, y: u16, theme: Theme) {
    let bolt_width = "⚡".width() as u16;
    let width = bolt_width + 1 + "Supaterm".width() as u16;
    let x = area.x + area.width.saturating_sub(width) / 2;
    buffer.set_stringn(
        x,
        y,
        "⚡",
        usize::from(bolt_width),
        Style::default().fg(BRAND).bold(),
    );
    buffer.set_stringn(
        x.saturating_add(bolt_width + 1),
        y,
        "Supaterm",
        8,
        Style::default().fg(theme.text).bold(),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn large_logo_width_uses_every_row_and_centers_the_result() {
        let bolt_width = text_rows_width(&LARGE_BOLT);
        let left_width = text_rows_width(&LARGE_LEFT);
        let right_width = text_rows_width(&LARGE_RIGHT);
        let width = large_width();

        assert!(LARGE_BOLT.iter().all(|row| row.width() <= bolt_width));
        assert!(LARGE_LEFT.iter().all(|row| row.width() <= left_width));
        assert!(LARGE_RIGHT.iter().all(|row| row.width() <= right_width));
        assert_eq!(
            usize::from(width),
            bolt_width + 2 + left_width + 1 + right_width
        );
        for area_width in [width, width + 1, width + 12] {
            let x = 7 + area_width.saturating_sub(width) / 2;
            let left_gap = x - 7;
            let right_gap = 7 + area_width - x - width;
            assert!(left_gap.abs_diff(right_gap) <= 1);
        }
    }

    #[test]
    fn large_logo_has_no_background_cells() {
        let theme = Theme::dark();
        let area = Rect::new(0, 0, large_width(), Logo::Large.height());
        let mut buffer = Buffer::empty(area);

        Logo::Large.render(&mut buffer, area, 0, theme);

        assert!(buffer.content.iter().all(|cell| cell.bg == Color::Reset));
    }
}
