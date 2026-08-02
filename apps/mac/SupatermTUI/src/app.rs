use crossterm::event::{Event, KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::composer::{PromptViewState, VerticalDirection};
use crate::prompt::Prompt;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Action {
    Continue,
    Quit,
}

macro_rules! define_agents {
    ($default:ident => ($default_name:literal, $default_fallback:literal), $($agent:ident => ($name:literal, $fallback:literal)),+ $(,)?) => {
        #[repr(usize)]
        #[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
        pub(crate) enum Agent {
            #[default]
            $default,
            $($agent),+
        }

        impl Agent {
            pub(crate) const ALL: &'static [Self] = &[Self::$default, $(Self::$agent),+];

            pub(crate) const fn name(self) -> &'static str {
                match self {
                    Self::$default => $default_name,
                    $(Self::$agent => $name),+
                }
            }

            pub(crate) const fn fallback(self) -> &'static str {
                match self {
                    Self::$default => $default_fallback,
                    $(Self::$agent => $fallback),+
                }
            }

            pub(crate) const fn position(self) -> usize {
                self as usize
            }
        }
    };
}

define_agents! {
    Codex => ("Codex", "C"),
    Claude => ("Claude", "A"),
    Pi => ("Pi", "P"),
}

impl Agent {
    fn next(self) -> Self {
        Self::ALL[(self.position() + 1) % Self::ALL.len()]
    }

    fn previous(self) -> Self {
        Self::ALL[(self.position() + Self::ALL.len() - 1) % Self::ALL.len()]
    }
}

#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub(crate) struct App {
    pub(crate) prompt: Prompt,
    pub(crate) prompt_view: PromptViewState,
    pub(crate) selected_agent: Agent,
}

impl App {
    pub(crate) fn handle_event(&mut self, event: Event, prompt_width: u16) -> Action {
        match event {
            Event::Key(key) if matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) => {
                self.handle_key(key, prompt_width)
            }
            Event::Paste(text) => {
                self.update_prompt(|prompt| prompt.insert_paste(&text));
                Action::Continue
            }
            _ => Action::Continue,
        }
    }

    fn handle_key(&mut self, key: KeyEvent, prompt_width: u16) -> Action {
        if key.code == KeyCode::Esc
            || (key.modifiers.contains(KeyModifiers::CONTROL)
                && matches!(key.code, KeyCode::Char('c' | 'C')))
        {
            return Action::Quit;
        }

        if key.code == KeyCode::Enter {
            if key.modifiers.contains(KeyModifiers::SHIFT) {
                self.update_prompt(|prompt| prompt.insert_char('\n'));
            }
            return Action::Continue;
        }

        match key.code {
            KeyCode::Up => {
                self.prompt_view
                    .move_cursor(&mut self.prompt, prompt_width, VerticalDirection::Up)
            }
            KeyCode::Down => self.prompt_view.move_cursor(
                &mut self.prompt,
                prompt_width,
                VerticalDirection::Down,
            ),
            KeyCode::Left => self.update_prompt(Prompt::move_left),
            KeyCode::Right => self.update_prompt(Prompt::move_right),
            KeyCode::Home => self.update_prompt(Prompt::move_to_start),
            KeyCode::End => self.update_prompt(Prompt::move_to_end),
            KeyCode::Backspace if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::delete_word_left);
            }
            KeyCode::Backspace => self.update_prompt(Prompt::delete_left),
            KeyCode::Delete => self.update_prompt(Prompt::delete_right),
            KeyCode::Char('a' | 'A') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::move_to_start);
            }
            KeyCode::Char('e' | 'E') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::move_to_end);
            }
            KeyCode::Char('p' | 'P') if key.modifiers.contains(KeyModifiers::CONTROL) => self
                .prompt_view
                .move_cursor(&mut self.prompt, prompt_width, VerticalDirection::Up),
            KeyCode::Char('n' | 'N') if key.modifiers.contains(KeyModifiers::CONTROL) => self
                .prompt_view
                .move_cursor(&mut self.prompt, prompt_width, VerticalDirection::Down),
            KeyCode::Char('w' | 'W') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::delete_word_left);
            }
            KeyCode::Char('u' | 'U') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::delete_to_start);
            }
            KeyCode::Char('k' | 'K') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                self.update_prompt(Prompt::delete_to_end);
            }
            KeyCode::Char(character)
                if !key.modifiers.intersects(
                    KeyModifiers::CONTROL | KeyModifiers::ALT | KeyModifiers::SUPER,
                ) =>
            {
                self.update_prompt(|prompt| prompt.insert_char(character));
            }
            KeyCode::BackTab => self.selected_agent = self.selected_agent.previous(),
            KeyCode::Tab if key.modifiers.contains(KeyModifiers::SHIFT) => {
                self.selected_agent = self.selected_agent.previous();
            }
            KeyCode::Tab => self.selected_agent = self.selected_agent.next(),
            _ => {}
        }
        Action::Continue
    }

    fn update_prompt(&mut self, update: impl FnOnce(&mut Prompt)) {
        self.prompt_view.reset_preferred_column();
        update(&mut self.prompt);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PROMPT_WIDTH: u16 = 20;

    fn key(code: KeyCode, modifiers: KeyModifiers) -> Event {
        Event::Key(KeyEvent::new(code, modifiers))
    }

    #[test]
    fn types_and_edits_text() {
        let mut app = App::default();
        app.handle_event(key(KeyCode::Char('a'), KeyModifiers::NONE), PROMPT_WIDTH);
        app.handle_event(key(KeyCode::Char('界'), KeyModifiers::NONE), PROMPT_WIDTH);
        app.handle_event(key(KeyCode::Left, KeyModifiers::NONE), PROMPT_WIDTH);
        app.handle_event(key(KeyCode::Char('b'), KeyModifiers::NONE), PROMPT_WIDTH);

        assert_eq!(app.prompt.display_text(), "ab界");
    }

    #[test]
    fn plain_enter_is_a_strict_no_op() {
        let mut app = App::default();
        app.prompt.insert_text("unchanged");
        app.prompt.move_left();
        app.selected_agent = Agent::Pi;
        let before = app.clone();

        let action = app.handle_event(key(KeyCode::Enter, KeyModifiers::NONE), PROMPT_WIDTH);

        assert_eq!(action, Action::Continue);
        assert_eq!(app, before);
    }

    #[test]
    fn shift_enter_inserts_newline_at_the_cursor() {
        let mut app = App::default();
        app.prompt.insert_text("ac");
        app.prompt.move_left();

        let action = app.handle_event(key(KeyCode::Enter, KeyModifiers::SHIFT), PROMPT_WIDTH);

        assert_eq!(action, Action::Continue);
        assert_eq!(app.prompt.display_text(), "a\nc");
    }

    #[test]
    fn codex_is_selected_by_default() {
        assert_eq!(App::default().selected_agent, Agent::Codex);
    }

    #[test]
    fn agent_data_follows_the_declared_order() {
        assert_eq!(
            Agent::ALL
                .iter()
                .copied()
                .map(Agent::position)
                .collect::<Vec<_>>(),
            [0, 1, 2]
        );
        assert_eq!(
            Agent::ALL
                .iter()
                .copied()
                .map(Agent::name)
                .collect::<Vec<_>>(),
            ["Codex", "Claude", "Pi"]
        );
        assert_eq!(
            Agent::ALL
                .iter()
                .copied()
                .map(Agent::fallback)
                .collect::<Vec<_>>(),
            ["C", "A", "P"]
        );
    }

    #[test]
    fn tab_cycles_agents_forward_with_wrap() {
        let mut app = App::default();

        app.handle_event(key(KeyCode::Tab, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Claude);

        app.handle_event(key(KeyCode::Tab, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Pi);

        app.handle_event(key(KeyCode::Tab, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Codex);
    }

    #[test]
    fn backtab_and_shift_tab_cycle_agents_backward_with_wrap() {
        let mut app = App::default();

        app.handle_event(key(KeyCode::BackTab, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Pi);

        app.handle_event(key(KeyCode::Tab, KeyModifiers::SHIFT), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Claude);

        app.handle_event(key(KeyCode::BackTab, KeyModifiers::SHIFT), PROMPT_WIDTH);
        assert_eq!(app.selected_agent, Agent::Codex);
    }

    #[test]
    fn escape_and_control_c_quit() {
        let mut app = App::default();

        assert_eq!(
            app.handle_event(key(KeyCode::Esc, KeyModifiers::NONE), PROMPT_WIDTH),
            Action::Quit
        );
        assert_eq!(
            app.handle_event(key(KeyCode::Char('c'), KeyModifiers::CONTROL), PROMPT_WIDTH,),
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

        assert_eq!(app.handle_event(event, PROMPT_WIDTH), Action::Continue);
        assert!(app.prompt.is_empty());
    }

    #[test]
    fn paste_is_inserted_at_the_cursor() {
        let mut app = App::default();
        app.prompt.insert_text("ac");
        app.prompt.move_left();

        app.handle_event(Event::Paste("b".to_owned()), PROMPT_WIDTH);

        assert_eq!(app.prompt.display_text(), "abc");
    }

    #[test]
    fn arrow_and_control_keys_move_through_visual_rows() {
        let mut app = App::default();
        app.prompt.insert_text("abcd\nx\nabcd");

        app.handle_event(key(KeyCode::Up, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.prompt.cursor(), 6);

        app.handle_event(key(KeyCode::Char('p'), KeyModifiers::CONTROL), PROMPT_WIDTH);
        assert_eq!(app.prompt.cursor(), 4);

        app.handle_event(key(KeyCode::Char('n'), KeyModifiers::CONTROL), PROMPT_WIDTH);
        assert_eq!(app.prompt.cursor(), 6);

        app.handle_event(key(KeyCode::Down, KeyModifiers::NONE), PROMPT_WIDTH);
        assert_eq!(app.prompt.cursor(), 11);
    }
}
