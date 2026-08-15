use std::{
    collections::HashMap,
    io::{self, Read, Write},
    sync::{Arc, Mutex, mpsc},
    thread,
    time::Duration,
};

use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySystem};
use tokio::sync::mpsc as tokio_mpsc;
use uuid::Uuid;

use crate::{
    AttachmentId, BootId, CommandSpec, ErrorCode, HostEnvelope, HostMessage, HostRole, ProcessExit,
    RequestId, TerminalData, TerminalId, TerminalInfo, TerminalSize, TerminalStatus,
};

const READ_BUFFER_BYTES: usize = 32 * 1024;
const LIFECYCLE_POLL: Duration = Duration::from_millis(10);

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct LaunchSpec {
    pub command: CommandSpec,
    pub size: TerminalSize,
}

#[derive(Debug)]
pub(crate) struct DomainError {
    pub code: ErrorCode,
    pub message: String,
}

impl DomainError {
    fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

pub(crate) struct HostState {
    boot_id: BootId,
    input_queue_capacity: usize,
    terminals: Mutex<HashMap<TerminalId, Arc<Terminal>>>,
}

impl HostState {
    pub fn new(boot_id: BootId, input_queue_capacity: usize) -> Self {
        Self {
            boot_id,
            input_queue_capacity,
            terminals: Mutex::new(HashMap::new()),
        }
    }

    pub fn create(
        &self,
        terminal_id: TerminalId,
        launch: LaunchSpec,
    ) -> Result<TerminalInfo, DomainError> {
        validate_launch(&launch)?;
        let mut terminals = self.terminals.lock().unwrap();
        if let Some(terminal) = terminals.get(&terminal_id) {
            if terminal.launch == launch {
                return Ok(terminal.info());
            }
            return Err(DomainError::new(
                ErrorCode::Conflict,
                "terminal identity already has a different launch spec",
            ));
        }
        let terminal =
            Terminal::spawn(terminal_id, self.boot_id, launch, self.input_queue_capacity)?;
        let info = terminal.info();
        terminals.insert(terminal_id, terminal);
        Ok(info)
    }

    pub fn list(&self) -> Vec<TerminalInfo> {
        let mut terminals: Vec<_> = self
            .terminals
            .lock()
            .unwrap()
            .values()
            .map(|terminal| terminal.info())
            .collect();
        terminals.sort_by_key(|terminal| terminal.id.to_string());
        terminals
    }

    pub fn get(&self, terminal_id: TerminalId) -> Result<TerminalInfo, DomainError> {
        Ok(self.terminal(terminal_id)?.info())
    }

    pub fn attach(
        &self,
        terminal_id: TerminalId,
        connection_id: Uuid,
        request_id: RequestId,
        sender: tokio_mpsc::Sender<HostEnvelope>,
    ) -> Result<(), DomainError> {
        self.terminal(terminal_id)?
            .attach(connection_id, request_id, sender)
    }

    pub fn input(
        &self,
        terminal_id: TerminalId,
        connection_id: Uuid,
        attachment_id: AttachmentId,
        data: TerminalData,
    ) -> Result<(), DomainError> {
        self.terminal(terminal_id)?
            .input(connection_id, attachment_id, data.into_bytes())
    }

    pub fn resize(
        &self,
        terminal_id: TerminalId,
        connection_id: Uuid,
        attachment_id: AttachmentId,
        size: TerminalSize,
    ) -> Result<(), DomainError> {
        self.terminal(terminal_id)?
            .resize(connection_id, attachment_id, size)
    }

    pub fn detach(
        &self,
        terminal_id: TerminalId,
        connection_id: Uuid,
        attachment_id: AttachmentId,
    ) -> Result<(), DomainError> {
        self.terminal(terminal_id)?
            .detach(connection_id, attachment_id)
    }

    pub fn end(&self, terminal_id: TerminalId) -> Result<(), DomainError> {
        self.terminal(terminal_id)?.end()
    }

    pub fn detach_connection(&self, connection_id: Uuid) {
        for terminal in self.terminals.lock().unwrap().values() {
            terminal.detach_connection(connection_id);
        }
    }

    pub fn end_all(&self) {
        for terminal in self.terminals.lock().unwrap().values() {
            let _ = terminal.end();
        }
    }

    fn terminal(&self, terminal_id: TerminalId) -> Result<Arc<Terminal>, DomainError> {
        self.terminals
            .lock()
            .unwrap()
            .get(&terminal_id)
            .cloned()
            .ok_or_else(|| DomainError::new(ErrorCode::NotFound, "terminal not found"))
    }
}

struct Terminal {
    id: TerminalId,
    boot_id: BootId,
    launch: LaunchSpec,
    master: Mutex<Option<Box<dyn MasterPty + Send>>>,
    input: mpsc::SyncSender<WriterCommand>,
    lifecycle: mpsc::SyncSender<LifecycleCommand>,
    state: Mutex<TerminalRuntime>,
}

struct TerminalRuntime {
    size: TerminalSize,
    next_sequence: u64,
    attachment: Option<Attachment>,
    child_exit: Option<ProcessExit>,
    reader_closed: bool,
    completed_exit: Option<ProcessExit>,
    ending: bool,
}

struct Attachment {
    id: AttachmentId,
    connection_id: Uuid,
    sender: tokio_mpsc::Sender<HostEnvelope>,
}

enum WriterCommand {
    Data(Vec<u8>),
    Close,
}

enum LifecycleCommand {
    End,
}

impl Terminal {
    fn spawn(
        id: TerminalId,
        boot_id: BootId,
        launch: LaunchSpec,
        input_queue_capacity: usize,
    ) -> Result<Arc<Self>, DomainError> {
        let pair = NativePtySystem::default()
            .openpty(launch.size.into())
            .map_err(|error| DomainError::new(ErrorCode::InvalidRequest, error.to_string()))?;
        let mut command = CommandBuilder::from_argv(
            launch
                .command
                .argv
                .iter()
                .map(std::ffi::OsString::from)
                .collect(),
        );
        if !launch.command.environment.inherit {
            command.env_clear();
        }
        for (key, value) in &launch.command.environment.set {
            command.env(key, value);
        }
        for key in &launch.command.environment.remove {
            command.env_remove(key);
        }
        command.cwd(&launch.command.cwd);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| DomainError::new(ErrorCode::InvalidRequest, error.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| DomainError::new(ErrorCode::InvalidRequest, error.to_string()))?;
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| DomainError::new(ErrorCode::InvalidRequest, error.to_string()))?;
        drop(pair.slave);
        let (input_sender, input_receiver) = mpsc::sync_channel(input_queue_capacity);
        let (lifecycle_sender, lifecycle_receiver) = mpsc::sync_channel(1);
        let terminal = Arc::new(Self {
            id,
            boot_id,
            launch: launch.clone(),
            master: Mutex::new(Some(pair.master)),
            input: input_sender,
            lifecycle: lifecycle_sender,
            state: Mutex::new(TerminalRuntime {
                size: launch.size,
                next_sequence: 0,
                attachment: None,
                child_exit: None,
                reader_closed: false,
                completed_exit: None,
                ending: false,
            }),
        });

        spawn_reader(Arc::clone(&terminal), reader);
        spawn_writer(writer, input_receiver);
        spawn_lifecycle(Arc::clone(&terminal), child, lifecycle_receiver);

        Ok(terminal)
    }

    fn info(&self) -> TerminalInfo {
        let state = self.state.lock().unwrap();
        TerminalInfo {
            id: self.id,
            boot_id: self.boot_id,
            argv: self.launch.command.argv.clone(),
            cwd: self.launch.command.cwd.clone(),
            size: state.size,
            status: match &state.completed_exit {
                Some(exit) => TerminalStatus::Exited { exit: exit.clone() },
                None => TerminalStatus::Running,
            },
            next_sequence: state.next_sequence,
        }
    }

    fn attach(
        &self,
        connection_id: Uuid,
        request_id: RequestId,
        sender: tokio_mpsc::Sender<HostEnvelope>,
    ) -> Result<(), DomainError> {
        let mut state = self.state.lock().unwrap();
        if state.completed_exit.is_some() {
            return Err(DomainError::new(
                ErrorCode::TerminalExited,
                "terminal has exited",
            ));
        }
        if state.attachment.is_some() {
            return Err(DomainError::new(
                ErrorCode::TerminalInUse,
                "terminal already has a controlling attachment",
            ));
        }
        let attachment_id = AttachmentId::new();
        let terminal = self.info_from_state(&state);
        let response = HostEnvelope {
            epoch: crate::PROTOCOL_EPOCH,
            role: HostRole::Host,
            request_id: Some(request_id),
            body: HostMessage::Attached {
                terminal,
                attachment_id,
            },
        };
        sender
            .try_send(response)
            .map_err(|_| DomainError::new(ErrorCode::Backpressure, "connection queue is full"))?;
        state.attachment = Some(Attachment {
            id: attachment_id,
            connection_id,
            sender,
        });
        Ok(())
    }

    fn input(
        &self,
        connection_id: Uuid,
        attachment_id: AttachmentId,
        data: Vec<u8>,
    ) -> Result<(), DomainError> {
        self.require_attachment(connection_id, attachment_id)?;
        if data.len() > crate::MAX_TERMINAL_DATA_BYTES {
            return Err(DomainError::new(
                ErrorCode::InvalidRequest,
                "terminal input exceeds the chunk limit",
            ));
        }
        self.input
            .try_send(WriterCommand::Data(data))
            .map_err(|_| DomainError::new(ErrorCode::Backpressure, "terminal input queue is full"))
    }

    fn resize(
        &self,
        connection_id: Uuid,
        attachment_id: AttachmentId,
        size: TerminalSize,
    ) -> Result<(), DomainError> {
        self.require_attachment(connection_id, attachment_id)?;
        self.master
            .lock()
            .unwrap()
            .as_ref()
            .ok_or_else(|| DomainError::new(ErrorCode::TerminalExited, "terminal has exited"))?
            .resize(size.into())
            .map_err(|error| DomainError::new(ErrorCode::InvalidRequest, error.to_string()))?;
        self.state.lock().unwrap().size = size;
        Ok(())
    }

    fn detach(&self, connection_id: Uuid, attachment_id: AttachmentId) -> Result<(), DomainError> {
        let mut state = self.state.lock().unwrap();
        match &state.attachment {
            Some(attachment)
                if attachment.connection_id == connection_id && attachment.id == attachment_id =>
            {
                state.attachment = None;
                Ok(())
            }
            _ => Err(DomainError::new(
                ErrorCode::NotAttached,
                "attachment does not control this terminal",
            )),
        }
    }

    fn detach_connection(&self, connection_id: Uuid) {
        let mut state = self.state.lock().unwrap();
        if matches!(&state.attachment, Some(attachment) if attachment.connection_id == connection_id)
        {
            state.attachment = None;
        }
    }

    fn end(&self) -> Result<(), DomainError> {
        let mut state = self.state.lock().unwrap();
        if state.completed_exit.is_some() || state.ending {
            return Ok(());
        }
        self.lifecycle
            .try_send(LifecycleCommand::End)
            .map_err(|_| DomainError::new(ErrorCode::Backpressure, "terminal lifecycle is busy"))?;
        state.ending = true;
        Ok(())
    }

    fn require_attachment(
        &self,
        connection_id: Uuid,
        attachment_id: AttachmentId,
    ) -> Result<(), DomainError> {
        let state = self.state.lock().unwrap();
        if matches!(&state.attachment, Some(attachment) if attachment.connection_id == connection_id && attachment.id == attachment_id)
        {
            Ok(())
        } else {
            Err(DomainError::new(
                ErrorCode::NotAttached,
                "attachment does not control this terminal",
            ))
        }
    }

    fn publish_output(&self, bytes: Vec<u8>) {
        let mut state = self.state.lock().unwrap();
        let sequence = state.next_sequence;
        state.next_sequence = state.next_sequence.saturating_add(bytes.len() as u64);
        let failed = state.attachment.as_ref().is_some_and(|attachment| {
            attachment
                .sender
                .try_send(HostEnvelope {
                    epoch: crate::PROTOCOL_EPOCH,
                    role: HostRole::Host,
                    request_id: None,
                    body: HostMessage::Output {
                        terminal_id: self.id,
                        attachment_id: attachment.id,
                        sequence,
                        data: TerminalData::from(bytes),
                    },
                })
                .is_err()
        });
        if failed {
            state.attachment = None;
        }
    }

    fn record_reader_closed(&self) {
        let mut state = self.state.lock().unwrap();
        state.reader_closed = true;
        self.complete_if_ready(&mut state);
    }

    fn record_child_exit(&self, exit: ProcessExit) {
        let mut state = self.state.lock().unwrap();
        state.child_exit = Some(exit);
        self.complete_if_ready(&mut state);
    }

    fn complete_if_ready(&self, state: &mut TerminalRuntime) {
        if !state.reader_closed || state.completed_exit.is_some() {
            return;
        }
        let Some(exit) = state.child_exit.clone() else {
            return;
        };
        state.completed_exit = Some(exit.clone());
        let Some(attachment) = state.attachment.take() else {
            return;
        };
        let _ = attachment.sender.try_send(HostEnvelope {
            epoch: crate::PROTOCOL_EPOCH,
            role: HostRole::Host,
            request_id: None,
            body: HostMessage::Exited {
                terminal_id: self.id,
                exit,
            },
        });
    }

    fn info_from_state(&self, state: &TerminalRuntime) -> TerminalInfo {
        TerminalInfo {
            id: self.id,
            boot_id: self.boot_id,
            argv: self.launch.command.argv.clone(),
            cwd: self.launch.command.cwd.clone(),
            size: state.size,
            status: match &state.completed_exit {
                Some(exit) => TerminalStatus::Exited { exit: exit.clone() },
                None => TerminalStatus::Running,
            },
            next_sequence: state.next_sequence,
        }
    }
}

fn validate_launch(launch: &LaunchSpec) -> Result<(), DomainError> {
    if launch.command.argv.is_empty() || launch.command.argv[0].is_empty() {
        return Err(DomainError::new(
            ErrorCode::InvalidRequest,
            "argv must contain a program",
        ));
    }
    if !launch.command.cwd.is_absolute() || !launch.command.cwd.is_dir() {
        return Err(DomainError::new(
            ErrorCode::InvalidRequest,
            "cwd must be an absolute existing directory",
        ));
    }
    if launch.size.rows == 0 || launch.size.cols == 0 {
        return Err(DomainError::new(
            ErrorCode::InvalidRequest,
            "terminal rows and columns must be nonzero",
        ));
    }
    Ok(())
}

fn spawn_reader(terminal: Arc<Terminal>, mut reader: Box<dyn Read + Send>) {
    thread::spawn(move || {
        let mut buffer = vec![0_u8; READ_BUFFER_BYTES];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(length) => terminal.publish_output(buffer[..length].to_vec()),
                Err(error) if error.kind() == io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        terminal.record_reader_closed();
    });
}

fn spawn_writer(mut writer: Box<dyn Write + Send>, receiver: mpsc::Receiver<WriterCommand>) {
    thread::spawn(move || {
        while let Ok(command) = receiver.recv() {
            match command {
                WriterCommand::Data(bytes) => {
                    if writer.write_all(&bytes).is_err() || writer.flush().is_err() {
                        break;
                    }
                }
                WriterCommand::Close => break,
            }
        }
    });
}

fn spawn_lifecycle(
    terminal: Arc<Terminal>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
    receiver: mpsc::Receiver<LifecycleCommand>,
) {
    thread::spawn(move || lifecycle_loop(terminal, child, receiver));
}

fn lifecycle_loop(
    terminal: Arc<Terminal>,
    mut child: Box<dyn portable_pty::Child + Send + Sync>,
    receiver: mpsc::Receiver<LifecycleCommand>,
) {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let _ = terminal.input.send(WriterCommand::Close);
                terminal.record_child_exit(process_exit(status));
                break;
            }
            Err(_) => {
                let _ = terminal.input.send(WriterCommand::Close);
                terminal.record_child_exit(ProcessExit::Code(255));
                break;
            }
            Ok(None) => {}
        }
        match receiver.recv_timeout(LIFECYCLE_POLL) {
            Ok(LifecycleCommand::End) => {
                signal_foreground_group(&terminal);
                let _ = child.kill();
                let _ = terminal.input.try_send(WriterCommand::Close);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                signal_foreground_group(&terminal);
                let _ = child.kill();
            }
        }
    }
}

fn signal_foreground_group(terminal: &Terminal) {
    let process_group = terminal
        .master
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|master| master.process_group_leader());
    if let Some(process_group) = process_group {
        unsafe {
            libc::kill(-process_group, libc::SIGHUP);
        }
    }
}

fn process_exit(status: portable_pty::ExitStatus) -> ProcessExit {
    match status.signal() {
        Some(signal) => ProcessExit::Signal(signal.to_owned()),
        None => ProcessExit::Code(status.exit_code()),
    }
}
