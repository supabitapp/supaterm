use std::io::{self, Stdout};
use std::panic;
use std::time::Duration;

use crossterm::cursor::{Hide, Show};
use crossterm::event::{self, DisableBracketedPaste, EnableBracketedPaste};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;

use crate::app::{Action, App};
use crate::ui::{self, Theme};

type CrosstermTerminal = Terminal<CrosstermBackend<Stdout>>;

pub(crate) fn run() -> io::Result<()> {
    install_panic_hook();
    let theme = Theme::detected();
    let mut session = TerminalSession::enter()?;
    let mut app = App::default();
    session
        .terminal
        .draw(|frame| ui::render(frame, &app, theme))?;
    loop {
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        if app.handle_event(event::read()?) == Action::Quit {
            return Ok(());
        }
        session
            .terminal
            .draw(|frame| ui::render(frame, &app, theme))?;
    }
}

struct TerminalSession {
    terminal: CrosstermTerminal,
}

impl TerminalSession {
    fn enter() -> io::Result<Self> {
        enable_raw_mode()?;
        let mut stdout = io::stdout();
        if let Err(error) = execute!(stdout, EnterAlternateScreen, EnableBracketedPaste, Hide) {
            restore_terminal();
            return Err(error);
        }
        match Terminal::new(CrosstermBackend::new(stdout)) {
            Ok(terminal) => Ok(Self { terminal }),
            Err(error) => {
                restore_terminal();
                Err(error)
            }
        }
    }
}

impl Drop for TerminalSession {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let _ = execute!(
            self.terminal.backend_mut(),
            DisableBracketedPaste,
            LeaveAlternateScreen,
            Show
        );
    }
}

fn install_panic_hook() {
    let previous = panic::take_hook();
    panic::set_hook(Box::new(move |information| {
        restore_terminal();
        previous(information);
    }));
}

fn restore_terminal() {
    let _ = disable_raw_mode();
    let _ = execute!(
        io::stdout(),
        DisableBracketedPaste,
        LeaveAlternateScreen,
        Show
    );
}
