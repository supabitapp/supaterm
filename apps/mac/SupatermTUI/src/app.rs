use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::prompt::Prompt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Action {
    Continue,
    Quit,
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct App {
    pub(crate) prompt: Prompt,
}

impl App {
    pub(crate) fn handle_event(&mut self, event: Event) -> Action {
        match event {
            Event::Key(key) if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) => {
                self.handle_key(key)
            }
            Event::Paste(text) => {
                self.prompt.insert_paste(&text);
                Action::Continue
            }
            _ => Action::Continue,
        }
    }

    fn handle_key(&mut self, key: KeyEvent) -> Action {
        if key.code == KeyCode::Esc
            || (key.modifiers.contains(KeyModifiers::CONTROL)
                && matches!(key.code, KeyCode::Char('c' | 'C')))
        {
            return Action::Quit;
        }

        if key.code == KeyCode::Enter {
            return Action::Continue;
        }

        match key.code {
            KeyCode::Left => self.prompt.move_left(),
            KeyCode::Right => self.prompt.move_right(),
            KeyCode::Home => self.prompt.move_to_start(),
            KeyCode::End => self.prompt.move_to_end(),
            KeyCode::Backspace if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.delete_word_left();
            }
            KeyCode::Backspace => self.prompt.delete_left(),
            KeyCode::Delete => self.prompt.delete_right(),
            KeyCode::Char('a' | 'A') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.move_to_start();
            }
            KeyCode::Char('e' | 'E') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.move_to_end();
            }
            KeyCode::Char('w' | 'W') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.delete_word_left();
            }
            KeyCode::Char('u' | 'U') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.delete_to_start();
            }
            KeyCode::Char('k' | 'K') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.prompt.delete_to_end();
            }
            KeyCode::Char(character)
                if !key.modifiers.intersects(
                    KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SUPER,
                ) =>
            {
                self.prompt.insert_char(character);
            }
            KeyCode::Tab | KeyCode::BackTab => self.prompt.insert_text("    "),
            _ => {}
        }
        Action::Continue
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn key(code: KeyCode, modifiers: KeyModifiers) -> Event {
        Event::Key(KeyEvent::new(code, modifiers))
    }

    #[test]
    fn types_and_edits_text() {
        let mut app = App::default();
        app.handle_event(key(KeyCode::Char('a'), KeyModifiers::NONE));
        app.handle_event(key(KeyCode::Char('界'), KeyModifiers::NONE));
        app.handle_event(key(KeyCode::Left, KeyModifiers::NONE));
        app.handle_event(key(KeyCode::Char('b'), KeyModifiers::NONE));

        assert_eq!(app.prompt.display_text(), "ab界");
    }

    #[test]
    fn enter_is_a_strict_no_op() {
        let mut app = App::default();
        app.prompt.insert_text("unchanged");
        app.prompt.move_left();
        let before = app.clone();

        let action = app.handle_event(key(KeyCode::Enter, KeyModifiers::NONE));

        assert_eq!(action, Action::Continue);
        assert_eq!(app, before);
    }

    #[test]
    fn escape_and_control_c_quit() {
        let mut app = App::default();

        assert_eq!(
            app.handle_event(key(KeyCode::Esc, KeyModifiers::NONE)),
            Action::Quit
        );
        assert_eq!(
            app.handle_event(key(KeyCode::Char('c'), KeyModifiers::CONTROL)),
            Action::Quit
        );
    }

    #[test]
    fn release_events_do_nothing() {
        let mut app = App::default();
        let event = Event::Key(KeyEvent::new_with_kind(
            KeyCode::Char('x'),
            KeyModifiers::NONE,
            KeyEventKind::Release,
        ));

        assert_eq!(app.handle_event(event), Action::Continue);
        assert!(app.prompt.is_empty());
    }

    #[test]
    fn paste_is_inserted_at_the_cursor() {
        let mut app = App::default();
        app.prompt.insert_text("ac");
        app.prompt.move_left();

        app.handle_event(Event::Paste("b".to_owned()));

        assert_eq!(app.prompt.display_text(), "abc");
    }
}
