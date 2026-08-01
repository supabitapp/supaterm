use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::{BRAND, Theme};

const LARGE_BOLT: [&str; 4] = ["   ▄█", "  ▄█ ", "▄██▄▄", "  █▀ "];

#[derive(Clone, Copy)]
enum Fill {
    Foreground,
    Shadow,
}

#[derive(Clone, Copy)]
struct Span {
    text: &'static str,
    fill: Fill,
}

impl Span {
    const fn foreground(text: &'static str) -> Self {
        Self {
            text,
            fill: Fill::Foreground,
        }
    }

    const fn shadow(text: &'static str) -> Self {
        Self {
            text,
            fill: Fill::Shadow,
        }
    }
}

const LARGE_LEFT: [&[Span]; 4] = [
    &[],
    &[Span::foreground("█▀▀▀▀ █   █ █▀▀▀▄ ▄▀▀▀▄")],
    &[
        Span::foreground("▀▀▀▀█ █"),
        Span::shadow("   "),
        Span::foreground("█ █"),
        Span::shadow("   "),
        Span::foreground("█ █"),
        Span::shadow("▀▀▀"),
        Span::foreground("█"),
    ],
    &[Span::foreground("▀▀▀▀▀ ▀▀▀▀▀ █▀▀▀▀ █   █")],
];
const LARGE_RIGHT: [&[Span]; 4] = [
    &[],
    &[Span::foreground("▀▀█▀▀ █▀▀▀▀ █▀▀▀▄ █▄ ▄█")],
    &[
        Span::foreground("  █   █"),
        Span::shadow("▀▀▀▀"),
        Span::foreground(" █"),
        Span::shadow("   "),
        Span::foreground("█ █ ▀ █"),
    ],
    &[Span::foreground("  ▀   ▀▀▀▀▀ █  ▀▄ █   █")],
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
        + span_rows_width(&LARGE_LEFT)
        + 1
        + span_rows_width(&LARGE_RIGHT)) as u16
}

fn text_rows_width(rows: &[&str]) -> usize {
    rows.iter().map(|row| row.width()).max().unwrap_or(0)
}

fn span_rows_width(rows: &[&[Span]]) -> usize {
    rows.iter()
        .map(|row| span_row_width(row))
        .max()
        .unwrap_or(0)
}

fn span_row_width(row: &[Span]) -> usize {
    row.iter().map(|span| span.text.width()).sum()
}

fn render_large(buffer: &mut Buffer, area: Rect, y: u16, theme: Theme) {
    let bolt_width = text_rows_width(&LARGE_BOLT);
    let left_width = span_rows_width(&LARGE_LEFT) as u16;
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
            theme.muted_shadow,
            false,
        );
        render_wordmark_row(
            buffer,
            right_x,
            row_y,
            LARGE_RIGHT[row],
            theme.text,
            theme.text_shadow,
            true,
        );
    }
}

fn render_wordmark_row(
    buffer: &mut Buffer,
    mut x: u16,
    y: u16,
    row: &[Span],
    foreground: Color,
    shadow: Color,
    bold: bool,
) {
    let modifier = if bold {
        Modifier::BOLD
    } else {
        Modifier::empty()
    };
    for span in row {
        let width = span.text.width();
        let style = Style::default().fg(foreground).add_modifier(modifier);
        let style = match span.fill {
            Fill::Foreground => style,
            Fill::Shadow => style.bg(shadow),
        };
        buffer.set_stringn(x, y, span.text, width, style);
        x = x.saturating_add(width as u16);
    }
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

    fn text(row: &[Span]) -> String {
        row.iter().map(|span| span.text).collect()
    }

    #[test]
    fn styled_rows_keep_the_visible_wordmark() {
        assert_eq!(text(LARGE_LEFT[2]), "▀▀▀▀█ █   █ █   █ █▀▀▀█");
        assert_eq!(text(LARGE_RIGHT[2]), "  █   █▀▀▀▀ █   █ █ ▀ █");
    }

    #[test]
    fn large_logo_width_uses_every_row_and_centers_the_result() {
        let bolt_width = text_rows_width(&LARGE_BOLT);
        let left_width = span_rows_width(&LARGE_LEFT);
        let right_width = span_rows_width(&LARGE_RIGHT);
        let width = large_width();

        assert!(LARGE_BOLT.iter().all(|row| row.width() <= bolt_width));
        assert!(
            LARGE_LEFT
                .iter()
                .all(|row| span_row_width(row) <= left_width)
        );
        assert!(
            LARGE_RIGHT
                .iter()
                .all(|row| span_row_width(row) <= right_width)
        );
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
    fn shadow_spans_use_the_shadow_surface() {
        let theme = Theme::dark();
        let mut buffer = Buffer::empty(Rect::new(0, 0, 30, 1));

        render_wordmark_row(
            &mut buffer,
            0,
            0,
            LARGE_LEFT[2],
            theme.muted,
            theme.muted_shadow,
            false,
        );

        assert_eq!(buffer[(7, 0)].bg, theme.muted_shadow);
        assert_eq!(buffer[(6, 0)].bg, Color::Reset);
    }
}
