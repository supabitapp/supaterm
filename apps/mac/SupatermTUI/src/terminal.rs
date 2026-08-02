use std::io::{self, Stdout};
use std::panic;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use crossterm::cursor::{Hide, Show};
use crossterm::event::{
    self, DisableBracketedPaste, EnableBracketedPaste, KeyboardEnhancementFlags,
    PopKeyboardEnhancementFlags, PushKeyboardEnhancementFlags,
};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::{Backend, CrosstermBackend};

use crate::app::{Action, App};
use crate::icons::AgentIcons;
use crate::ui::{self, Theme};

type CrosstermTerminal = Terminal<CrosstermBackend<Stdout>>;
static KEYBOARD_ENHANCEMENT_ACTIVE: AtomicBool = AtomicBool::new(false);

pub(crate) fn run() -> io::Result<()> {
    install_panic_hook();
    let theme = Theme::detected();
    let mut session = TerminalSession::enter()?;
    let icons = AgentIcons::detected(theme.text_color());
    let mut app = App::default();
    draw(&mut session.terminal, &mut app, theme, icons.as_ref())?;
    loop {
        let event_ready = event::poll(Duration::from_millis(250))?;
        if event_ready {
            let prompt_width = ui::UiLayout::prompt_width(session.terminal.size()?.width);
            if app.handle_event(event::read()?, prompt_width) == Action::Quit {
                return Ok(());
            }
        }
        if event_ready || terminal_area_changed(&mut session.terminal)? {
            draw(&mut session.terminal, &mut app, theme, icons.as_ref())?;
        }
    }
}

fn draw<B: Backend>(
    terminal: &mut Terminal<B>,
    app: &mut App,
    theme: Theme,
    icons: Option<&AgentIcons>,
) -> Result<(), B::Error> {
    terminal.draw(|frame| {
        let layout = ui::UiLayout::new(frame.area(), &app.prompt);
        app.prompt_view = app
            .prompt_view
            .reconciled(layout.prompt_layout(), layout.prompt_viewport_height());
        ui::render(frame, app, &layout, theme, icons);
    })?;
    Ok(())
}

fn terminal_area_changed<B: Backend>(terminal: &mut Terminal<B>) -> Result<bool, B::Error> {
    let rendered = terminal.get_frame().area().as_size();
    Ok(rendered != terminal.size()?)
}

struct TerminalSession {
    terminal: CrosstermTerminal,
}

impl TerminalSession {
    fn enter() -> io::Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        let setup = (|| -> io::Result<()> {
            execute!(stdout, EnterAlternateScreen)?;
            execute!(
                stdout,
                PushKeyboardEnhancementFlags(KeyboardEnhancementFlags::DISAMBIGUATE_ESCAPE_CODES)
            )?;
            KEYBOARD_ENHANCEMENT_ACTIVE.store(true, Ordering::Release);
            execute!(stdout, EnableBracketedPaste, Hide)
        })();
        if let Err(error) = setup {
            restore_terminal(&mut stdout);
            return Err(error);
        }
        match Terminal::new(CrosstermBackend::new(stdout)) {
            Ok(terminal) => Ok(Self { terminal }),
            Err(error) => {
                let mut stdout = io::stdout();
                restore_terminal(&mut stdout);
                Err(error)
            }
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        restore_terminal(self.terminal.backend_mut());
    }
}

fn install_panic_hook() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |information| {
        let mut stdout = io::stdout();
        restore_terminal(&mut stdout);
        previous(information);
    }));
}

fn restore_terminal(output: &mut impl io::Write) {
    let _ = disable_raw_mode();
    if KEYBOARD_ENHANCEMENT_ACTIVE.swap(false, Ordering::AcqRel) {
        let _ = execute!(output, PopKeyboardEnhancementFlags);
    }
    let _ = execute!(output, DisableBracketedPaste, LeaveAlternateScreen, Show);
}

#[cfg(test)]
mod tests {
    use ratatui::backend::TestBackend;
    use ratatui::layout::Rect;

    use super::*;

    #[test]
    fn detects_and_draws_a_resize_without_an_input_event() {
        let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();

        assert!(!terminal_area_changed(&mut terminal).unwrap());

        terminal.backend_mut().resize(41, 13);

        assert!(terminal_area_changed(&mut terminal).unwrap());

        terminal.draw(|_| {}).unwrap();

        assert!(!terminal_area_changed(&mut terminal).unwrap());
        assert_eq!(terminal.get_frame().area(), Rect::new(0, 0, 41, 13));
    }
}
