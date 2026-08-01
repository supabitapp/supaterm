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
use ratatui::backend::CrosstermBackend;

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
    session
        .terminal
        .draw(|frame| ui::render(frame, &app, theme, icons.as_ref()))?;
    loop {
        if !event::poll(Duration::from_millis(250))? {
            continue;
        }
        if app.handle_event(event::read()?) == Action::Quit {
            return Ok(());
        }
        session
            .terminal
            .draw(|frame| ui::render(frame, &app, theme, icons.as_ref()))?;
    }
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
