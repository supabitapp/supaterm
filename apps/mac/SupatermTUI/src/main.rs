use std::env;
use std::ffi::OsString;
use std::process::ExitCode;

mod app;
mod icons;
mod prompt;
mod terminal;
mod ui;

const HELP: &str = "Supaterm prompt\n\nUsage: supaterm [OPTIONS]\n\nOptions:\n  -h, --help     Print help\n  -V, --version  Print version";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Command {
    Run,
    Help,
    Version,
}

fn main() -> ExitCode {
    let command = match parse_command(env::args_os().skip(1)) {
        Ok(command) => command,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    match command {
        Command::Help => {
            println!("{HELP}");
            ExitCode::SUCCESS
        }
        Command::Version => {
            println!("supaterm {}", env!("CARGO_PKG_VERSION"));
            ExitCode::SUCCESS
        }
        Command::Run => match terminal::run() {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("supaterm: {error}");
                ExitCode::FAILURE
            }
        },
    }
}

fn parse_command(arguments: impl IntoIterator<Item = OsString>) -> Result<Command, String> {
    let mut command = Command::Run;
    for argument in arguments {
        match argument.to_str() {
            Some("-h" | "--help") => command = Command::Help,
            Some("-V" | "--version") => command = Command::Version,
            Some(value) => return Err(format!("unknown argument: {value}\n\n{HELP}")),
            None => {
                return Err(format!(
                    "unknown non-Unicode argument: {}\n\n{HELP}",
                    argument.to_string_lossy()
                ));
            }
        }
    }
    Ok(command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_help_before_terminal_startup() {
        assert_eq!(parse_command([OsString::from("--help")]), Ok(Command::Help));
        assert_eq!(parse_command([OsString::from("-h")]), Ok(Command::Help));
    }

    #[test]
    fn parses_version_before_terminal_startup() {
        assert_eq!(
            parse_command([OsString::from("--version")]),
            Ok(Command::Version)
        );
        assert_eq!(parse_command([OsString::from("-V")]), Ok(Command::Version));
    }

    #[test]
    fn rejects_unknown_arguments() {
        let error = parse_command([OsString::from("prompt")]).unwrap_err();

        assert!(error.starts_with("unknown argument: prompt"));
        assert!(error.contains("Usage: supaterm [OPTIONS]"));
    }
}
