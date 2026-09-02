use clap::{Parser, Subcommand, ValueEnum};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "sp", about = "Supaterm command-line interface")]
pub struct Arguments {
    #[arg(long, global = true)]
    pub socket: Option<PathBuf>,
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(long, global = true, conflicts_with = "json")]
    pub plain: bool,
    #[arg(long, global = true)]
    pub quiet: bool,
    #[arg(long, global = true)]
    pub expected_structure_revision: Option<u64>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Subcommand)]
pub enum Command {
    #[command(alias = "ls")]
    Tree,
    Snapshot,
    Diagnostic,
    Version,
    Onboard,
    Window {
        #[command(subcommand)]
        command: WindowCommand,
    },
    Space {
        #[command(subcommand)]
        command: SpaceCommand,
    },
    Group {
        #[command(subcommand)]
        command: GroupCommand,
    },
    Tab {
        #[command(subcommand)]
        command: TabCommand,
    },
    Pane {
        #[command(subcommand)]
        command: PaneCommand,
    },
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    Skills {
        #[command(subcommand)]
        command: SkillsCommand,
    },
    Agent {
        #[command(subcommand)]
        command: AgentCommand,
    },
    License {
        #[command(subcommand)]
        command: Option<LicenseCommand>,
    },
    Ssh {
        #[arg(long, default_value = "xterm-256color")]
        term: String,
        #[arg(long, default_value = "ssh")]
        ssh: String,
        #[arg(trailing_var_arg = true)]
        arguments: Vec<String>,
    },
}

#[derive(Subcommand)]
pub enum WindowCommand {
    New,
    Close {
        target: Option<String>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand)]
pub enum SpaceCommand {
    #[command(alias = "list")]
    Ls,
    New {
        name: String,
        #[arg(long, default_value = "neutral")]
        color: String,
    },
    #[command(alias = "select")]
    Focus {
        target: Option<String>,
    },
    #[command(alias = "delete", alias = "close")]
    Destroy {
        target: Option<String>,
        #[arg(long)]
        force: bool,
    },
    Rename {
        name: String,
        target: Option<String>,
    },
    Color {
        color: String,
        target: Option<String>,
    },
    Move {
        index: usize,
        target: Option<String>,
    },
    Next,
    #[command(alias = "previous")]
    Prev,
    Last,
}

#[derive(Subcommand)]
pub enum GroupCommand {
    New {
        name: String,
        #[arg(long = "in")]
        space: Option<String>,
        #[arg(long = "tab")]
        tabs: Vec<String>,
        #[arg(long, default_value = "neutral")]
        color: String,
    },
    Rename {
        name: String,
        target: Option<String>,
    },
    Color {
        color: String,
        target: Option<String>,
    },
    Pin {
        target: Option<String>,
    },
    Unpin {
        target: Option<String>,
    },
    Collapse {
        target: Option<String>,
    },
    Expand {
        target: Option<String>,
    },
    Move {
        destination_space: String,
        target: Option<String>,
        #[arg(long, default_value_t = 0)]
        index: usize,
        #[arg(long)]
        pinned: bool,
    },
    Ungroup {
        target: Option<String>,
    },
    Close {
        target: Option<String>,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Subcommand)]
pub enum TabCommand {
    New {
        #[arg(long = "in")]
        space: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        pinned: bool,
        #[arg(long)]
        script: Option<String>,
        #[arg(last = true)]
        argv: Vec<String>,
    },
    #[command(alias = "select")]
    Focus {
        target: Option<String>,
    },
    Close {
        target: Option<String>,
        #[arg(long)]
        force: bool,
    },
    Rename {
        title: String,
        target: Option<String>,
    },
    Title {
        target: Option<String>,
    },
    Pin {
        target: Option<String>,
    },
    Unpin {
        target: Option<String>,
    },
    Move {
        destination_space: String,
        target: Option<String>,
        #[arg(long)]
        group: Option<String>,
        #[arg(long, default_value_t = 0)]
        index: usize,
        #[arg(long)]
        pinned: bool,
    },
    Next,
    #[command(alias = "previous")]
    Prev,
    Last,
}

#[derive(Subcommand)]
pub enum PaneCommand {
    Split {
        #[arg(value_enum, default_value = "right")]
        direction: PaneDirection,
        #[arg(long = "in")]
        target: Option<String>,
        #[arg(long)]
        cwd: Option<PathBuf>,
        #[arg(long)]
        script: Option<String>,
        #[arg(last = true)]
        argv: Vec<String>,
    },
    Focus {
        target: Option<String>,
    },
    Close {
        target: Option<String>,
        #[arg(long)]
        force: bool,
    },
    MoveToNewTab {
        target: Option<String>,
        #[arg(long = "in")]
        destination_space: Option<String>,
        #[arg(long, default_value_t = 0)]
        index: usize,
        #[arg(long)]
        pinned: bool,
    },
    MoveToTab {
        destination_tab: String,
        target_pane: String,
        target: Option<String>,
        #[arg(value_enum, long, default_value = "right")]
        direction: PaneDirection,
    },
    Capture {
        target: Option<String>,
        #[arg(long)]
        lines: Option<usize>,
    },
    Health {
        target: Option<String>,
    },
    WaitReady {
        target: Option<String>,
        #[arg(long, default_value_t = 5.0)]
        timeout: f64,
    },
    Resize {
        target: Option<String>,
        #[arg(long, default_value_t = 24)]
        rows: u16,
        #[arg(long, default_value_t = 80)]
        columns: u16,
        #[arg(long, default_value_t = 800)]
        pixel_width: u16,
        #[arg(long, default_value_t = 480)]
        pixel_height: u16,
    },
    Layout {
        #[arg(value_enum)]
        layout: PaneLayout,
        target: Option<String>,
    },
    #[command(alias = "send-text")]
    Send {
        #[arg(long = "to")]
        target: Option<String>,
        #[arg(long)]
        newline: bool,
        #[arg(long)]
        submit: bool,
        text: Option<String>,
    },
    Key {
        #[arg(value_enum)]
        key: PaneKey,
        target: Option<String>,
    },
    Notify {
        target: Option<String>,
        #[arg(long)]
        title: Option<String>,
        #[arg(long)]
        body: Option<String>,
    },
}

#[derive(Subcommand)]
pub enum ConfigCommand {
    List,
    Get { key: String },
    Set { key: String, value: String },
    Reset { key: Option<String> },
    Path,
    Validate,
}

#[derive(Subcommand)]
pub enum SkillsCommand {
    List,
    Get {
        name: String,
        #[arg(long)]
        full: bool,
    },
    Path {
        name: String,
    },
    Install,
}

#[derive(Subcommand)]
pub enum AgentCommand {
    Receive {
        #[arg(long)]
        kind: String,
    },
    Reload,
    Setup {
        kind: String,
    },
    Health {
        kind: String,
    },
    Repair {
        kind: String,
    },
    Remove {
        kind: String,
    },
}

#[derive(Subcommand)]
pub enum LicenseCommand {
    Status,
    Activate,
    Deactivate,
    Refresh,
    Buy,
    Renew,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum PaneDirection {
    Left,
    Right,
    Up,
    Down,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum PaneLayout {
    Tile,
    MainVertical,
}

#[derive(Clone, Copy, ValueEnum)]
pub enum PaneKey {
    Enter,
    Escape,
    Tab,
    Backspace,
    CtrlC,
    CtrlD,
    CtrlL,
    CtrlZ,
}
