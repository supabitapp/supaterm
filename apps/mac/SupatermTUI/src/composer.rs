use std::cmp::Reverse;

use ratatui::layout::Position;
use unicode_width::UnicodeWidthStr;

use crate::prompt::{Atom, Prompt};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RunKind {
    Text,
    Image,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct Run {
    pub(crate) line: u16,
    pub(crate) column: u16,
    pub(crate) text: String,
    pub(crate) kind: RunKind,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PromptLayout {
    pub(crate) runs: Vec<Run>,
    pub(crate) cursor: Position,
    pub(crate) rows: u16,
}

impl PromptLayout {
    pub(crate) fn new(prompt: &Prompt, width: u16) -> Self {
        let built = PromptLayoutBuilder::build(prompt, width, BuildKind::Render);
        Self {
            runs: built.runs,
            cursor: built.geometry.cursor,
            rows: built.geometry.rows,
        }
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct PromptGeometry {
    cursor: Position,
    rows: u16,
    boundaries: Vec<Position>,
}

impl PromptGeometry {
    fn new(prompt: &Prompt, width: u16) -> Self {
        PromptLayoutBuilder::build(prompt, width, BuildKind::Navigate).geometry
    }

    fn nearest_boundary(&self, line: u16, column: u16) -> Option<usize> {
        self.boundaries
            .iter()
            .enumerate()
            .filter(|(_, position)| position.y == line)
            .min_by_key(|(index, position)| (position.x.abs_diff(column), Reverse(*index)))
            .map(|(index, _)| index)
    }
}

struct PromptLayoutBuilder {
    runs: Option<Vec<Run>>,
    boundaries: Option<Vec<Position>>,
    cursor: Option<Position>,
    line: u16,
    column: u16,
    width: u16,
}

enum BuildKind {
    Render,
    Navigate,
}

struct PromptBuild {
    runs: Vec<Run>,
    geometry: PromptGeometry,
}

impl PromptLayoutBuilder {
    fn build(prompt: &Prompt, width: u16, kind: BuildKind) -> PromptBuild {
        let mut builder = Self {
            runs: matches!(kind, BuildKind::Render).then(Vec::new),
            boundaries: matches!(kind, BuildKind::Navigate)
                .then(|| Vec::with_capacity(prompt.atoms().len().saturating_add(1))),
            cursor: None,
            line: 0,
            column: 0,
            width: width.max(1),
        };
        builder.capture_boundary(prompt.cursor() == 0);
        let mut image_number = 0;
        for (index, atom) in prompt.atoms().iter().enumerate() {
            match atom {
                Atom::Text(text) => builder.push_text(text),
                Atom::Image(_) => {
                    image_number += 1;
                    builder.push_image(&format!("[Image {image_number}]"));
                }
            }
            builder.capture_boundary(prompt.cursor() == index + 1);
        }
        builder.finish()
    }

    fn capture_boundary(&mut self, cursor: bool) {
        let position = self.position();
        if let Some(boundaries) = &mut self.boundaries {
            boundaries.push(position);
        }
        if cursor {
            self.cursor = Some(position);
        }
    }

    fn push_text(&mut self, text: &str) {
        if text == "\n" {
            self.line = self.line.saturating_add(1);
            self.column = 0;
            return;
        }
        if text == "\t" {
            let spaces = 4 - usize::from(self.column % 4);
            for _ in 0..spaces {
                self.push_visible(" ", RunKind::Text);
            }
            return;
        }
        let display = if text.width() == 0 { "�" } else { text };
        let display_width = display.width().min(usize::from(u16::MAX)) as u16;
        if display_width > self.width {
            self.push_visible("�", RunKind::Text);
        } else {
            self.push_visible(display, RunKind::Text);
        }
    }

    fn push_image(&mut self, label: &str) {
        let label_width = label.width() as u16;
        self.wrap_if_full();
        if label_width <= self.width {
            if self.column > 0 && self.column.saturating_add(label_width) > self.width {
                self.line = self.line.saturating_add(1);
                self.column = 0;
            }
            self.push_visible(label, RunKind::Image);
            return;
        }
        for character in label.chars() {
            let mut encoded = [0; 4];
            let text = character.encode_utf8(&mut encoded);
            self.push_visible(text, RunKind::Image);
        }
    }

    fn push_visible(&mut self, text: &str, kind: RunKind) {
        let width = text.width().min(usize::from(u16::MAX)) as u16;
        self.wrap_if_full();
        if self.column > 0 && self.column.saturating_add(width) > self.width {
            self.line = self.line.saturating_add(1);
            self.column = 0;
        }
        if let Some(runs) = &mut self.runs {
            runs.push(Run {
                line: self.line,
                column: self.column,
                text: text.to_owned(),
                kind,
            });
        }
        self.column = self.column.saturating_add(width);
    }

    fn wrap_if_full(&mut self) {
        if self.column >= self.width {
            self.line = self.line.saturating_add(1);
            self.column = 0;
        }
    }

    fn position(&self) -> Position {
        if self.column >= self.width {
            Position::new(0, self.line.saturating_add(1))
        } else {
            Position::new(self.column, self.line)
        }
    }

    fn finish(self) -> PromptBuild {
        let cursor = self.cursor.unwrap_or_default();
        let last_run_line = self
            .runs
            .as_ref()
            .and_then(|runs| runs.last())
            .map_or(0, |run| run.line);
        let rows = last_run_line
            .max(cursor.y)
            .max(self.position().y)
            .saturating_add(1);
        PromptBuild {
            runs: self.runs.unwrap_or_default(),
            geometry: PromptGeometry {
                cursor,
                rows,
                boundaries: self.boundaries.unwrap_or_default(),
            },
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum VerticalDirection {
    Up,
    Down,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct PromptViewState {
    scroll_row: u16,
    preferred_column: Option<PreferredColumn>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct PreferredColumn {
    width: u16,
    column: u16,
}

impl PromptViewState {
    pub(crate) fn move_cursor(
        &mut self,
        prompt: &mut Prompt,
        width: u16,
        direction: VerticalDirection,
    ) {
        let width = width.max(1);
        let geometry = PromptGeometry::new(prompt, width);
        let column = match self.preferred_column {
            Some(preferred) if preferred.width == width => preferred.column,
            _ => {
                self.preferred_column = Some(PreferredColumn {
                    width,
                    column: geometry.cursor.x,
                });
                geometry.cursor.x
            }
        };
        let mut line = geometry.cursor.y;
        loop {
            line = match direction {
                VerticalDirection::Up => {
                    let Some(line) = line.checked_sub(1) else {
                        return;
                    };
                    line
                }
                VerticalDirection::Down => {
                    if line.saturating_add(1) >= geometry.rows {
                        return;
                    }
                    line + 1
                }
            };
            if let Some(cursor) = geometry.nearest_boundary(line, column) {
                prompt.set_cursor(cursor);
                return;
            }
        }
    }

    pub(crate) fn reset_preferred_column(&mut self) {
        self.preferred_column = None;
    }

    pub(crate) fn reconciled(&self, layout: &PromptLayout, height: u16) -> Self {
        let height = height.max(1);
        let mut state = self.clone();
        state.scroll_row = state.scroll_row.min(layout.rows.saturating_sub(height));
        if layout.cursor.y < state.scroll_row {
            state.scroll_row = layout.cursor.y;
        } else if layout.cursor.y >= state.scroll_row.saturating_add(height) {
            state.scroll_row = layout.cursor.y.saturating_add(1).saturating_sub(height);
        }
        state
    }

    pub(crate) fn scroll_row(&self) -> u16 {
        self.scroll_row
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_the_viewport_stable_while_the_cursor_remains_visible() {
        let mut prompt = Prompt::default();
        prompt.insert_text("0\n1\n2\n3\n4\n5\n6\n7\n8\n9");
        let mut state = PromptViewState::default();

        state = state.reconciled(&PromptLayout::new(&prompt, 20), 3);
        assert_eq!(state.scroll_row(), 7);

        state.move_cursor(&mut prompt, 20, VerticalDirection::Up);
        state = state.reconciled(&PromptLayout::new(&prompt, 20), 3);
        assert_eq!(state.scroll_row(), 7);

        state.move_cursor(&mut prompt, 20, VerticalDirection::Up);
        state = state.reconciled(&PromptLayout::new(&prompt, 20), 3);
        assert_eq!(state.scroll_row(), 7);

        state.move_cursor(&mut prompt, 20, VerticalDirection::Up);
        state = state.reconciled(&PromptLayout::new(&prompt, 20), 3);
        assert_eq!(state.scroll_row(), 6);
    }

    #[test]
    fn keeps_the_preferred_column_across_short_logical_lines() {
        let mut prompt = Prompt::default();
        prompt.insert_text("abcd\nx\nabcd");
        let mut state = PromptViewState::default();

        state.move_cursor(&mut prompt, 20, VerticalDirection::Up);
        assert_eq!(prompt.cursor(), 6);

        state.move_cursor(&mut prompt, 20, VerticalDirection::Up);
        assert_eq!(prompt.cursor(), 4);

        state.move_cursor(&mut prompt, 20, VerticalDirection::Down);
        assert_eq!(prompt.cursor(), 6);
    }

    #[test]
    fn moves_across_soft_wraps_with_wide_graphemes() {
        let mut prompt = Prompt::default();
        prompt.insert_text("ab界cd");
        let mut state = PromptViewState::default();

        state.move_cursor(&mut prompt, 4, VerticalDirection::Up);
        assert_eq!(prompt.cursor(), 2);

        state.move_cursor(&mut prompt, 4, VerticalDirection::Down);
        assert_eq!(prompt.cursor(), 5);
    }

    #[test]
    fn prefers_the_boundary_after_a_newline_at_an_exact_wrap() {
        let mut prompt = Prompt::default();
        prompt.insert_text("abcd\nx");
        prompt.move_to_start();
        let mut state = PromptViewState::default();

        state.move_cursor(&mut prompt, 4, VerticalDirection::Down);
        prompt.insert_char('Y');

        assert_eq!(prompt.display_text(), "abcd\nYx");
    }

    #[test]
    fn resets_the_preferred_column_after_width_reflow() {
        let mut prompt = Prompt::default();
        prompt.insert_text("abcdefghijklmnopqrstuvwxyz");
        let mut state = PromptViewState::default();

        state.move_cursor(&mut prompt, 10, VerticalDirection::Up);
        assert_eq!(prompt.cursor(), 16);

        state.move_cursor(&mut prompt, 7, VerticalDirection::Up);
        assert_eq!(prompt.cursor(), 9);
    }

    #[test]
    fn clamps_the_viewport_after_width_reflow() {
        let mut prompt = Prompt::default();
        prompt.insert_text("12345678901234567890123456789");
        let mut state = PromptViewState::default();

        state = state.reconciled(&PromptLayout::new(&prompt, 5), 3);
        assert_eq!(state.scroll_row(), 3);
        state = state.reconciled(&PromptLayout::new(&prompt, 10), 3);
        assert_eq!(state.scroll_row(), 0);
    }
}
