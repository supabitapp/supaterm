mod agent_picker;
mod logo;

use std::env;

use ratatui::Frame;
use ratatui::buffer::Buffer;
use ratatui::layout::{Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Widget};
use terminal_colorsaurus::{QueryOptions, color_palette};
use unicode_width::UnicodeWidthStr;

use crate::app::App;
use crate::composer::{PromptLayout, RunKind};
use crate::icons::AgentIcons;
use crate::prompt::Prompt;

const BRAND: Color = Color::Rgb(255, 168, 45);
const MIN_PROMPT_VIEWPORT_HEIGHT: u16 = 6;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct Theme {
    panel: Color,
    picker: Color,
    text: Color,
    muted: Color,
    image_text: Color,
    codex: Color,
    claude: Color,
    pi: Color,
}

impl Theme {
    pub(crate) fn detected() -> Self {
        let mut options = QueryOptions::default();
        options.timeout = std::time::Duration::from_millis(80);
        color_palette(options).map_or_else(
            |_| Self::fallback(),
            |palette| {
                Self::from_colors(
                    palette.background.scale_to_8bit(),
                    palette.foreground.scale_to_8bit(),
                )
            },
        )
    }

    fn dark() -> Self {
        Self::from_colors((18, 18, 20), (232, 232, 234))
    }

    fn light() -> Self {
        Self::from_colors((252, 252, 252), (47, 47, 52))
    }

    fn fallback() -> Self {
        if terminal_has_light_background() {
            Self::light()
        } else {
            Self::dark()
        }
    }

    fn from_colors(background: (u8, u8, u8), foreground: (u8, u8, u8)) -> Self {
        let light = is_light(background);
        let panel = blend(
            if light { (0, 0, 0) } else { (255, 255, 255) },
            background,
            if light { 0.045 } else { 0.07 },
        );
        let muted = blend(foreground, background, if light { 0.48 } else { 0.56 });
        let picker = blend((255, 168, 45), panel, if light { 0.16 } else { 0.2 });
        Self {
            panel: Color::Rgb(panel.0, panel.1, panel.2),
            picker: Color::Rgb(picker.0, picker.1, picker.2),
            text: Color::Rgb(foreground.0, foreground.1, foreground.2),
            muted: Color::Rgb(muted.0, muted.1, muted.2),
            image_text: Color::Rgb(36, 25, 6),
            codex: if light {
                Color::Rgb(57, 65, 255)
            } else {
                Color::Rgb(122, 157, 255)
            },
            claude: if light {
                Color::Rgb(185, 83, 53)
            } else {
                Color::Rgb(217, 119, 87)
            },
            pi: Color::Rgb(foreground.0, foreground.1, foreground.2),
        }
    }

    pub(crate) fn text_color(self) -> Color {
        self.text
    }
}

pub(crate) struct UiLayout {
    area: Rect,
    logo: logo::Logo,
    logo_y: u16,
    prompt_area: Rect,
    prompt_inner: Rect,
    prompt: PromptLayout,
    picker_hint: Option<Rect>,
}

impl UiLayout {
    pub(crate) fn new(area: Rect, prompt: &Prompt) -> Self {
        let panel_width = panel_width(area.width);
        let panel_x = area.x + area.width.saturating_sub(panel_width) / 2;
        let prompt = PromptLayout::new(prompt, prompt_content_width(panel_width));
        let show_agent_picker =
            panel_width >= agent_picker::width().saturating_add(5) && area.height >= 6;
        let picker_hint_height = u16::from(show_agent_picker);
        let logo = logo::Logo::select(panel_width, area.height, picker_hint_height);
        let fixed_height = logo.height() + logo.gap();
        let max_prompt_height = area
            .height
            .saturating_sub(fixed_height + picker_hint_height)
            .max(2);
        let prompt_chrome_height = 2 + u16::from(show_agent_picker);
        let viewport_height = prompt
            .rows
            .min((area.height / 3).max(MIN_PROMPT_VIEWPORT_HEIGHT));
        let prompt_height = viewport_height
            .saturating_add(prompt_chrome_height)
            .max(3 + u16::from(show_agent_picker))
            .min(max_prompt_height);
        let group_height = fixed_height
            .saturating_add(prompt_height)
            .saturating_add(picker_hint_height);
        let logo_y = area.y + area.height.saturating_sub(group_height) / 2;
        let prompt_y = logo_y.saturating_add(fixed_height);
        let prompt_area = Rect::new(panel_x, prompt_y, panel_width, prompt_height);
        let prompt_inner = prompt_inner(prompt_area, show_agent_picker);
        let picker_hint = show_agent_picker.then(|| {
            Rect::new(
                panel_x,
                prompt_area.bottom(),
                panel_width,
                picker_hint_height,
            )
        });
        Self {
            area,
            logo,
            logo_y,
            prompt_area,
            prompt_inner,
            prompt,
            picker_hint,
        }
    }

    pub(crate) fn prompt_width(area_width: u16) -> u16 {
        prompt_content_width(panel_width(area_width))
    }

    pub(crate) fn prompt_layout(&self) -> &PromptLayout {
        &self.prompt
    }

    pub(crate) fn prompt_viewport_height(&self) -> u16 {
        self.prompt_inner.height
    }

    fn shows_agent_picker(&self) -> bool {
        self.picker_hint.is_some()
    }
}

pub(crate) fn render(
    frame: &mut Frame,
    app: &App,
    layout: &UiLayout,
    theme: Theme,
    agent_icons: Option<&AgentIcons>,
) {
    if layout.area.width < 2 || layout.area.height < 2 {
        return;
    }

    layout
        .logo
        .render(frame.buffer_mut(), layout.area, layout.logo_y, theme);
    let cursor = render_prompt(frame.buffer_mut(), layout, app, theme, agent_icons);
    if let Some(area) = layout.picker_hint {
        agent_picker::render_hint(frame.buffer_mut(), area, theme);
    }
    if let Some(cursor) = cursor {
        frame.set_cursor_position(cursor);
    }
}

fn render_prompt(
    buffer: &mut Buffer,
    layout: &UiLayout,
    app: &App,
    theme: Theme,
    agent_icons: Option<&AgentIcons>,
) -> Option<Position> {
    let area = layout.prompt_area;
    if area.width < 2 || area.height < 2 {
        return None;
    }
    Block::default()
        .style(Style::default().bg(theme.panel).fg(theme.text))
        .render(area, buffer);
    buffer.set_style(
        Rect::new(area.x, area.y, 1, area.height),
        Style::default().bg(BRAND),
    );
    let inner = layout.prompt_inner;
    let viewport_start = app.prompt_view.scroll_row();
    if app.prompt.is_empty() {
        buffer.set_stringn(
            inner.x,
            inner.y,
            "Type a prompt or drop files",
            usize::from(inner.width),
            Style::default().fg(theme.muted).bg(theme.panel),
        );
    } else {
        for run in &layout.prompt.runs {
            let Some(visible_line) = run.line.checked_sub(viewport_start) else {
                continue;
            };
            if visible_line >= inner.height {
                continue;
            }
            let style = match run.kind {
                RunKind::Text => Style::default().fg(theme.text).bg(theme.panel),
                RunKind::Image => Style::default()
                    .fg(theme.image_text)
                    .bg(BRAND)
                    .add_modifier(Modifier::BOLD),
            };
            buffer.set_stringn(
                inner.x.saturating_add(run.column),
                inner.y.saturating_add(visible_line),
                &run.text,
                run.text.width(),
                style,
            );
        }
    }
    let cursor_line = layout.prompt.cursor.y.checked_sub(viewport_start)?;
    if cursor_line >= inner.height {
        return None;
    }
    if layout.shows_agent_picker() {
        agent_picker::render(
            buffer,
            Rect::new(
                area.x.saturating_add(3),
                area.bottom().saturating_sub(2),
                area.width.saturating_sub(5),
                1,
            ),
            theme,
            app.selected_agent,
            agent_icons,
        );
    }
    Some(Position::new(
        inner
            .x
            .saturating_add(layout.prompt.cursor.x.min(inner.width.saturating_sub(1))),
        inner.y.saturating_add(cursor_line),
    ))
}

fn prompt_inner(area: Rect, show_agent_picker: bool) -> Rect {
    let left_padding = if area.width >= 6 { 3 } else { 1 };
    let right_padding = if area.width >= 6 { 2 } else { 0 };
    Rect::new(
        area.x.saturating_add(left_padding),
        area.y.saturating_add(1),
        area.width
            .saturating_sub(left_padding + right_padding)
            .max(1),
        area.height
            .saturating_sub(2 + u16::from(show_agent_picker))
            .max(1),
    )
}

fn prompt_content_width(panel_width: u16) -> u16 {
    if panel_width >= 6 {
        panel_width - 5
    } else {
        panel_width.saturating_sub(1).max(1)
    }
}

fn panel_width(area_width: u16) -> u16 {
    if area_width < 2 {
        return area_width;
    }
    let responsive_width = (u32::from(area_width) * 9 / 10) as u16;
    area_width
        .saturating_sub(2)
        .min(responsive_width.max(agent_picker::width().saturating_add(5)))
        .max(2)
}

fn terminal_has_light_background() -> bool {
    env::var("COLORFGBG")
        .ok()
        .and_then(|value| value.split([';', ':']).next_back()?.parse::<u8>().ok())
        .is_some_and(|background| background >= 7)
}

fn is_light((red, green, blue): (u8, u8, u8)) -> bool {
    0.299 * f32::from(red) + 0.587 * f32::from(green) + 0.114 * f32::from(blue) > 128.0
}

fn blend(foreground: (u8, u8, u8), background: (u8, u8, u8), alpha: f32) -> (u8, u8, u8) {
    let channel = |foreground: u8, background: u8| {
        (f32::from(foreground) * alpha + f32::from(background) * (1.0 - alpha)).round() as u8
    };
    (
        channel(foreground.0, background.0),
        channel(foreground.1, background.1),
        channel(foreground.2, background.2),
    )
}

#[cfg(test)]
mod tests {
    use image::{ColorType, ImageFormat};
    use ratatui::Terminal;
    use ratatui::backend::TestBackend;
    use tempfile::tempdir;

    use super::*;
    use crate::app::Agent;

    fn draw(width: u16, height: u16, app: App, theme: Theme) -> Buffer {
        draw_with_icons(width, height, app, theme, None)
    }

    fn draw_with_icons(
        width: u16,
        height: u16,
        mut app: App,
        theme: Theme,
        agent_icons: Option<&AgentIcons>,
    ) -> Buffer {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        render_frame(&mut terminal, &mut app, theme, agent_icons);
        terminal.backend().buffer().clone()
    }

    fn render_frame(
        terminal: &mut Terminal<TestBackend>,
        app: &mut App,
        theme: Theme,
        agent_icons: Option<&AgentIcons>,
    ) {
        terminal
            .draw(|frame| {
                let layout = UiLayout::new(frame.area(), &app.prompt);
                app.prompt_view = app
                    .prompt_view
                    .reconciled(layout.prompt_layout(), layout.prompt_viewport_height());
                render(frame, app, &layout, theme, agent_icons);
            })
            .unwrap();
    }

    fn text(buffer: &Buffer) -> String {
        let area = buffer.area;
        (area.y..area.bottom())
            .map(|y| {
                (area.x..area.right())
                    .map(|x| buffer[(x, y)].symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn renders_wide_interface_with_large_logo_prompt_and_agent_picker() {
        let theme = Theme::dark();
        let icons = AgentIcons::kitty(theme.pi);
        let buffer = draw_with_icons(100, 30, App::default(), theme, Some(&icons));
        let rendered = text(&buffer);

        assert!(rendered.contains("   ▄█"));
        assert!(rendered.contains("  █▀ "));
        assert!(rendered.contains("█▀▀▀▀ █   █ █▀▀▀▄ ▄▀▀▀▄"));
        assert!(rendered.contains("▀▀█▀▀ █▀▀▀▀ █▀▀▀▄ █▄ ▄█"));
        assert!(!rendered.contains("████"));
        assert!(rendered.contains("Type a prompt or drop files"));
        assert!(rendered.contains("Codex"));
        assert!(rendered.contains("Claude"));
        assert!(rendered.contains("Pi"));
        assert!(rendered.contains("tab agents"));
        let mut brand_rows = buffer
            .content
            .iter()
            .enumerate()
            .filter_map(|(index, cell)| {
                (cell.fg == BRAND && cell.symbol() != " ")
                    .then_some(index as u16 / buffer.area.width)
            })
            .collect::<Vec<_>>();
        brand_rows.sort_unstable();
        brand_rows.dedup();
        assert_eq!(brand_rows.len(), 4);
        let image_cells = buffer
            .content
            .iter()
            .filter(|cell| cell.symbol().contains('\u{10EEEE}'))
            .count();
        assert_eq!(image_cells, Agent::ALL.len());
        let codex_index = buffer
            .content
            .iter()
            .position(|cell| cell.symbol().contains('\u{10EEEE}'))
            .unwrap() as u16;
        let codex_x = codex_index % buffer.area.width;
        let codex_y = codex_index / buffer.area.width;
        assert_eq!(buffer[(codex_x, codex_y)].bg, theme.picker);
        let panel_x = buffer
            .area
            .width
            .saturating_sub(panel_width(buffer.area.width))
            / 2;
        assert_eq!(buffer[(panel_x, codex_y)].bg, BRAND);
    }

    #[test]
    fn renders_compact_title_in_a_narrow_terminal() {
        let buffer = draw(40, 12, App::default(), Theme::dark());
        let rendered = text(&buffer);

        assert!(rendered.contains("⚡"));
        assert!(rendered.contains("Supaterm"));
        assert!(!rendered.contains("█▀▀▀▀ █   █ █▀▀▀▄ ▄▀▀▀▄"));
        assert!(rendered.contains("Codex"));
    }

    #[test]
    fn moves_agent_picker_selection() {
        let app = App {
            selected_agent: Agent::Claude,
            ..App::default()
        };
        let buffer = draw(60, 14, app, Theme::dark());
        let (codex_x, codex_y) = find_symbol(&buffer, "C").unwrap();
        let (claude_x, claude_y) = find_symbol(&buffer, "A").unwrap();

        assert_eq!(buffer[(codex_x, codex_y)].bg, Theme::dark().panel);
        assert_eq!(buffer[(claude_x, claude_y)].bg, Theme::dark().picker);
    }

    #[test]
    fn renders_tiny_terminals_without_overflow() {
        for (width, height) in [(1, 1), (2, 2), (8, 3), (12, 4)] {
            let buffer = draw(width, height, App::default(), Theme::dark());
            assert_eq!(buffer.area.width, width);
            assert_eq!(buffer.area.height, height);
        }
    }

    #[test]
    fn prompt_width_tracks_the_terminal_width() {
        assert_eq!(panel_width(40), 37);
        assert_eq!(panel_width(100), 90);
        assert_eq!(panel_width(160), 144);
        assert!(UiLayout::prompt_width(160) > UiLayout::prompt_width(100));
    }

    #[test]
    fn live_resize_reflows_the_complete_interface() {
        let theme = Theme::dark();
        let mut app = App::default();
        app.prompt.insert_text(&"0123456789abcdef".repeat(50));
        let backend = TestBackend::new(120, 30);
        let mut terminal = Terminal::new(backend).unwrap();

        render_frame(&mut terminal, &mut app, theme, None);
        let wide = terminal.backend().buffer().clone();
        let wide_scroll = app.prompt_view.scroll_row();

        terminal.backend_mut().resize(44, 16);
        render_frame(&mut terminal, &mut app, theme, None);
        let narrow = terminal.backend().buffer().clone();

        assert_eq!(wide.area, Rect::new(0, 0, 120, 30));
        assert_eq!(narrow.area, Rect::new(0, 0, 44, 16));
        assert_eq!(surface_width(&wide, theme), usize::from(panel_width(120)));
        assert_eq!(surface_width(&narrow, theme), usize::from(panel_width(44)));
        assert!(text(&wide).contains("█▀▀▀▀ █   █ █▀▀▀▄ ▄▀▀▀▄"));
        assert!(text(&narrow).contains("⚡"));
        assert!(text(&narrow).contains("Supaterm"));
        assert!(text(&wide).contains("Codex"));
        assert!(text(&narrow).contains("Codex"));
        assert!(app.prompt_view.scroll_row() > wide_scroll);
    }

    #[test]
    fn wraps_wide_unicode_at_terminal_cell_boundaries() {
        let mut prompt = Prompt::default();
        prompt.insert_text("ab界c");
        let layout = PromptLayout::new(&prompt, 4);

        assert_eq!(layout.rows, 2);
        assert_eq!(layout.cursor, Position::new(1, 1));
        assert_eq!(layout.runs[2].text.width(), 2);
        assert_eq!(layout.runs[3].line, 1);
    }

    #[test]
    fn keeps_image_style_across_wrapped_atomic_labels() {
        let directory = tempdir().unwrap();
        let image = directory.path().join("sample.data");
        image::save_buffer_with_format(
            &image,
            &[255, 168, 45, 255],
            1,
            1,
            ColorType::Rgba8,
            ImageFormat::Png,
        )
        .unwrap();
        let mut prompt = Prompt::default();
        prompt.insert_paste(&image.display().to_string());
        let layout = PromptLayout::new(&prompt, 5);

        assert_eq!(prompt.display_text(), "[Image 1]");
        assert_eq!(layout.rows, 2);
        assert!(layout.runs.iter().all(|run| run.kind == RunKind::Image));
        let app = App {
            prompt,
            ..App::default()
        };
        let buffer = draw(32, 10, app, Theme::dark());
        let (image_x, image_y) = find_symbol(&buffer, "[").unwrap();
        assert_eq!(buffer[(image_x, image_y)].bg, BRAND);
    }

    #[test]
    fn keeps_trailing_logical_lines_when_the_cursor_moves_away() {
        let mut prompt = Prompt::default();
        prompt.insert_text("text\n");
        prompt.move_to_start();

        assert_eq!(PromptLayout::new(&prompt, 20).rows, 2);
    }

    #[test]
    fn caps_long_prompts_at_one_third_of_the_terminal_height() {
        let theme = Theme::dark();
        let mut app = App::default();
        app.prompt
            .insert_text("0\n1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12\n13\n14\n15");

        let buffer = draw(60, 30, app, theme);
        let panel_rows = (buffer.area.y..buffer.area.bottom())
            .filter(|y| {
                (buffer.area.x..buffer.area.right()).any(|x| buffer[(x, *y)].bg == theme.panel)
            })
            .count();

        assert_eq!(panel_rows, 13);
    }

    #[test]
    fn uses_distinct_prompt_surfaces_for_light_and_dark_terminals() {
        let dark = draw(40, 10, App::default(), Theme::dark());
        let light = draw(40, 10, App::default(), Theme::light());
        let dark_panel = dark
            .content
            .iter()
            .find(|cell| cell.bg == Theme::dark().panel)
            .unwrap();
        let light_panel = light
            .content
            .iter()
            .find(|cell| cell.bg == Theme::light().panel)
            .unwrap();

        assert_ne!(dark_panel.bg, light_panel.bg);
    }

    #[test]
    fn derives_panel_and_text_from_terminal_colors() {
        let theme = Theme::from_colors((10, 20, 30), (220, 210, 200));

        assert_eq!(theme.text, Color::Rgb(220, 210, 200));
        assert_eq!(theme.panel, Color::Rgb(27, 36, 46));
        assert_eq!(theme.pi, theme.text);
        assert_ne!(theme.picker, theme.panel);
    }

    fn find_symbol(buffer: &Buffer, symbol: &str) -> Option<(u16, u16)> {
        let area = buffer.area;
        for y in area.y..area.bottom() {
            for x in area.x..area.right() {
                if buffer[(x, y)].symbol() == symbol {
                    return Some((x, y));
                }
            }
        }
        None
    }

    fn surface_width(buffer: &Buffer, theme: Theme) -> usize {
        (buffer.area.y..buffer.area.bottom())
            .map(|y| {
                (buffer.area.x..buffer.area.right())
                    .filter(|x| {
                        matches!(buffer[(*x, y)].bg, color if color == BRAND || color == theme.panel || color == theme.picker)
                    })
                    .count()
            })
            .max()
            .unwrap_or_default()
    }
}
