use supaterm_host::terminal::vt::{
    HostTerminal, TerminalEffect, TerminalProgress, TerminalProgressState, TerminalViewport,
};

fn viewport() -> TerminalViewport {
    TerminalViewport {
        rows: 24,
        columns: 80,
        cell_width: 10,
        cell_height: 20,
    }
}

#[test]
fn native_snapshot_restore_reencodes_exactly() {
    let mut terminal = HostTerminal::new(viewport()).unwrap();
    terminal.write(b"primary\r\n\x1b]2;host title\x07\x1b]7;file:///tmp/work\x07");
    terminal.write(b"\x1b[?1049halt\r\n\x1b[31mred\x1b[0m\r\n\x1b[?2004h");
    terminal.write(&[0xe2, 0x82]);
    let snapshot = terminal.snapshot().unwrap();

    let restored = HostTerminal::restore(&snapshot, viewport()).unwrap();

    assert_eq!(restored.snapshot().unwrap(), snapshot);
}

#[test]
fn headless_terminal_answers_queries_once() {
    let mut terminal = HostTerminal::new(viewport()).unwrap();

    let replies = terminal.write(b"\x1b[6n");

    assert_eq!(replies, [b"\x1b[1;1R".to_vec()]);
    assert!(terminal.take_replies().is_empty());
}

#[test]
fn restored_partial_utf8_accepts_the_first_live_byte() {
    let mut terminal = HostTerminal::new(viewport()).unwrap();
    terminal.write(&[0xe2, 0x82]);
    let snapshot = terminal.snapshot().unwrap();
    let mut restored = HostTerminal::restore(&snapshot, viewport()).unwrap();

    restored.write(&[0xac]);

    assert!(!restored.snapshot().unwrap().is_empty());
}

#[test]
fn native_parser_reports_title_directory_and_progress_effects() {
    let mut terminal = HostTerminal::new(viewport()).unwrap();

    let write = terminal
        .write_with_effects(b"\x1b]2;Build\x07\x1b]7;file:///tmp/work\x07\x1b]9;4;1;42\x07");

    assert_eq!(
        write.effects,
        [
            TerminalEffect::Title(Some("Build".into())),
            TerminalEffect::WorkingDirectory(Some("file:///tmp/work".into())),
            TerminalEffect::Progress(Some(TerminalProgress {
                state: TerminalProgressState::Set,
                percent: Some(42),
            })),
        ]
    );
}
