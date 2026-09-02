#[cfg(target_os = "macos")]
#[test]
fn configured_ghostty_archive_is_present_in_the_host_binary() {
    if std::env::var_os("SUPATERM_GHOSTTY_VT_ARCHIVE").is_none() {
        return;
    }
    let output = std::process::Command::new("nm")
        .args(["-gU", env!("CARGO_BIN_EXE_supaterm-host")])
        .output()
        .expect("nm must run");
    assert!(output.status.success());
    let symbols = String::from_utf8(output.stdout).expect("nm output must be UTF-8");
    assert!(
        symbols
            .lines()
            .any(|line| line.split_whitespace().last() == Some("_ghostty_terminal_new"))
    );
}
