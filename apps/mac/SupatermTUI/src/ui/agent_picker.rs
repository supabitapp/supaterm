use ratatui::buffer::Buffer;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use unicode_width::UnicodeWidthStr;

use super::Theme;
use crate::app::Agent;
use crate::icons::AgentIcons;

pub(super) fn width() -> u16 {
    Agent::ALL
        .iter()
        .map(|agent| option_width(*agent))
        .sum::<u16>()
        .saturating_add((Agent::ALL.len() as u16).saturating_sub(1) * 2)
}

pub(super) fn render(
    buffer: &mut Buffer,
    area: Rect,
    theme: Theme,
    selected_agent: Agent,
    agent_icons: Option<&AgentIcons>,
) {
    let mut x = area.x + area.width.saturating_sub(width()) / 2;
    for (index, agent) in Agent::ALL.iter().copied().enumerate() {
        let option_width = option_width(agent);
        let selected = agent == selected_agent;
        let background = if selected { theme.picker } else { theme.panel };
        let option_area = Rect::new(x, area.y, option_width, 1);
        buffer.set_style(option_area, Style::default().fg(theme.text).bg(background));
        let icon_area = Rect::new(x.saturating_add(1), area.y, 2, 1);
        if let Some(agent_icons) = agent_icons {
            agent_icons.render(agent, icon_area, buffer);
        } else {
            buffer.set_stringn(
                icon_area.x,
                icon_area.y,
                agent.fallback(),
                usize::from(icon_area.width),
                Style::default()
                    .fg(fallback_color(agent, theme))
                    .bg(background)
                    .bold(),
            );
        }
        let name_x = icon_area.right().saturating_add(1);
        buffer.set_stringn(
            name_x,
            area.y,
            agent.name(),
            agent.name().width(),
            Style::default()
                .fg(theme.text)
                .bg(background)
                .add_modifier(if selected {
                    Modifier::BOLD
                } else {
                    Modifier::empty()
                }),
        );
        x = x.saturating_add(option_width);
        if index + 1 < Agent::ALL.len() {
            x = x.saturating_add(2);
        }
    }
}

pub(super) fn render_hint(buffer: &mut Buffer, area: Rect, theme: Theme) {
    buffer.set_stringn(
        area.x,
        area.y,
        "tab",
        usize::from(area.width),
        Style::default().fg(theme.text),
    );
    if area.width > 4 {
        buffer.set_stringn(
            area.x.saturating_add(4),
            area.y,
            "agents",
            usize::from(area.width.saturating_sub(4)),
            Style::default().fg(theme.muted),
        );
    }
}

fn option_width(agent: Agent) -> u16 {
    1 + 2 + 1 + agent.name().width() as u16 + 1
}

fn fallback_color(agent: Agent, theme: Theme) -> Color {
    match agent {
        Agent::Codex => theme.codex,
        Agent::Claude => theme.claude,
        Agent::Pi => theme.pi,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn width_comes_from_the_declared_agent_order() {
        let options = Agent::ALL
            .iter()
            .map(|agent| option_width(*agent))
            .sum::<u16>();

        assert_eq!(width(), options + (Agent::ALL.len() as u16 - 1) * 2);
    }

    #[test]
    fn fallback_picker_marks_only_the_selected_agent() {
        let theme = Theme::dark();
        let mut buffer = Buffer::empty(Rect::new(0, 0, width(), 1));
        let area = buffer.area;

        render(&mut buffer, area, theme, Agent::Claude, None);

        let codex = find(&buffer, Agent::Codex.fallback());
        let claude = find(&buffer, Agent::Claude.fallback());
        let pi = find(&buffer, Agent::Pi.fallback());
        assert_eq!(buffer[codex].bg, theme.panel);
        assert_eq!(buffer[claude].bg, theme.picker);
        assert_eq!(buffer[pi].bg, theme.panel);
    }

    fn find(buffer: &Buffer, symbol: &str) -> (u16, u16) {
        (buffer.area.x..buffer.area.right())
            .find_map(|x| (buffer[(x, buffer.area.y)].symbol() == symbol).then_some((x, 0)))
            .unwrap()
    }
}
