use std::{collections::HashMap, path::Path};

use tokio::{
    net::{UnixStream, unix::OwnedReadHalf, unix::OwnedWriteHalf},
    sync::{mpsc, oneshot},
};

use crate::{
    AttachmentId, BootId, ClientEnvelope, ClientId, ClientRole, CommandSpec, ErrorCode,
    HostEnvelope, HostError, HostMessage, HostRole, MachineId, Request, RequestId, TerminalData,
    TerminalId, TerminalInfo, TerminalSize,
    transport::{read_frame, write_frame},
};

const CLIENT_QUEUE_CAPACITY: usize = 128;

pub struct HostClient {
    requests: HostRequestHandle,
    events: mpsc::Receiver<HostMessage>,
    machine_id: MachineId,
    boot_id: BootId,
}

#[derive(Clone)]
pub struct HostRequestHandle {
    sender: mpsc::Sender<ClientCommand>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AttachmentInfo {
    pub terminal: TerminalInfo,
    pub attachment_id: AttachmentId,
}

struct ClientCommand {
    request_id: RequestId,
    body: Request,
    response: oneshot::Sender<Result<HostMessage, HostError>>,
}

impl HostClient {
    pub async fn connect(path: &Path, role: ClientRole) -> Result<Self, HostError> {
        let stream = UnixStream::connect(path).await?;
        let (command_sender, command_receiver) = mpsc::channel(CLIENT_QUEUE_CAPACITY);
        let (event_sender, event_receiver) = mpsc::channel(CLIENT_QUEUE_CAPACITY);
        let requests = HostRequestHandle {
            sender: command_sender,
        };
        tokio::spawn(connection_loop(
            stream,
            role,
            command_receiver,
            event_sender,
        ));
        match requests
            .request(Request::Hello {
                client_id: ClientId::new(),
            })
            .await?
        {
            HostMessage::Hello {
                machine_id,
                boot_id,
            } => Ok(Self {
                requests,
                events: event_receiver,
                machine_id,
                boot_id,
            }),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }

    pub fn machine_id(&self) -> MachineId {
        self.machine_id
    }

    pub fn boot_id(&self) -> BootId {
        self.boot_id
    }

    pub fn request_handle(&self) -> HostRequestHandle {
        self.requests.clone()
    }

    pub async fn create(
        &self,
        terminal_id: TerminalId,
        command: CommandSpec,
        size: TerminalSize,
    ) -> Result<TerminalInfo, HostError> {
        self.requests.create(terminal_id, command, size).await
    }

    pub async fn list(&self) -> Result<Vec<TerminalInfo>, HostError> {
        match self.requests.request(Request::List).await? {
            HostMessage::Terminals { terminals } => Ok(terminals),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }

    pub async fn get(&self, terminal_id: TerminalId) -> Result<TerminalInfo, HostError> {
        self.requests.get(terminal_id).await
    }

    pub async fn attach(&self, terminal_id: TerminalId) -> Result<AttachmentInfo, HostError> {
        match self
            .requests
            .request(Request::Attach { terminal_id })
            .await?
        {
            HostMessage::Attached {
                terminal,
                attachment_id,
            } => Ok(AttachmentInfo {
                terminal,
                attachment_id,
            }),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }

    pub async fn input(
        &self,
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        data: TerminalData,
    ) -> Result<(), HostError> {
        self.requests.input(terminal_id, attachment_id, data).await
    }

    pub async fn resize(
        &self,
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        size: TerminalSize,
    ) -> Result<(), HostError> {
        self.requests.resize(terminal_id, attachment_id, size).await
    }

    pub async fn detach(
        &self,
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
    ) -> Result<(), HostError> {
        self.requests
            .expect_ack(Request::Detach {
                terminal_id,
                attachment_id,
            })
            .await
    }

    pub async fn end(&self, terminal_id: TerminalId) -> Result<(), HostError> {
        self.requests.end(terminal_id).await
    }

    pub async fn request(&self, body: Request) -> Result<HostMessage, HostError> {
        self.requests.request(body).await
    }

    pub async fn next_event(&mut self) -> Result<HostMessage, HostError> {
        self.events.recv().await.ok_or(HostError::ConnectionClosed)
    }
}

impl HostRequestHandle {
    pub async fn create(
        &self,
        terminal_id: TerminalId,
        command: CommandSpec,
        size: TerminalSize,
    ) -> Result<TerminalInfo, HostError> {
        match self
            .request(Request::Create {
                terminal_id,
                command,
                size,
            })
            .await?
        {
            HostMessage::Created { terminal } => Ok(terminal),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }

    pub async fn get(&self, terminal_id: TerminalId) -> Result<TerminalInfo, HostError> {
        match self.request(Request::Get { terminal_id }).await? {
            HostMessage::Terminal { terminal } => Ok(terminal),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }

    pub async fn input(
        &self,
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        data: TerminalData,
    ) -> Result<(), HostError> {
        self.expect_ack(Request::Input {
            terminal_id,
            attachment_id,
            data,
        })
        .await
    }

    pub async fn resize(
        &self,
        terminal_id: TerminalId,
        attachment_id: AttachmentId,
        size: TerminalSize,
    ) -> Result<(), HostError> {
        self.expect_ack(Request::Resize {
            terminal_id,
            attachment_id,
            size,
        })
        .await
    }

    pub async fn end(&self, terminal_id: TerminalId) -> Result<(), HostError> {
        self.expect_ack(Request::End { terminal_id }).await
    }

    pub async fn request(&self, body: Request) -> Result<HostMessage, HostError> {
        let request_id = RequestId::new();
        let (response_sender, response_receiver) = oneshot::channel();
        self.sender
            .send(ClientCommand {
                request_id,
                body,
                response: response_sender,
            })
            .await
            .map_err(|_| HostError::ConnectionClosed)?;
        response_receiver
            .await
            .map_err(|_| HostError::ConnectionClosed)?
    }

    async fn expect_ack(&self, request: Request) -> Result<(), HostError> {
        match self.request(request).await? {
            HostMessage::Ack => Ok(()),
            message => Err(HostError::UnexpectedResponse(format!("{message:?}"))),
        }
    }
}

async fn connection_loop(
    stream: UnixStream,
    role: ClientRole,
    commands: mpsc::Receiver<ClientCommand>,
    events: mpsc::Sender<HostMessage>,
) {
    let (reader, writer) = stream.into_split();
    let _ = connection_loop_inner(reader, writer, role, commands, events).await;
}

async fn connection_loop_inner(
    mut reader: OwnedReadHalf,
    mut writer: OwnedWriteHalf,
    role: ClientRole,
    mut commands: mpsc::Receiver<ClientCommand>,
    events: mpsc::Sender<HostMessage>,
) -> Result<(), HostError> {
    let mut pending = HashMap::<RequestId, oneshot::Sender<Result<HostMessage, HostError>>>::new();
    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else {
                    break;
                };
                let request_id = command.request_id;
                pending.insert(request_id, command.response);
                if let Err(error) = write_frame(
                    &mut writer,
                    &ClientEnvelope {
                        epoch: crate::PROTOCOL_EPOCH,
                        role,
                        request_id,
                        body: command.body,
                    },
                ).await {
                    if let Some(response) = pending.remove(&request_id) {
                        let _ = response.send(Err(error));
                    }
                    break;
                }
            }
            frame = read_frame::<HostEnvelope, _>(&mut reader) => {
                let Some(frame) = frame? else {
                    break;
                };
                if frame.epoch != crate::PROTOCOL_EPOCH || frame.role != HostRole::Host {
                    return Err(HostError::Protocol("invalid host envelope".into()));
                }
                match frame.request_id {
                    Some(request_id) => {
                        let response = pending.remove(&request_id).ok_or_else(|| {
                            HostError::Protocol("response has no matching request".into())
                        })?;
                        let _ = response.send(response_message(frame.body));
                    }
                    None if frame.body.is_event() => {
                        events.try_send(frame.body).map_err(|_| HostError::ConnectionClosed)?;
                    }
                    None => return Err(HostError::Protocol("host sent an uncorrelated response".into())),
                }
            }
        }
    }
    for (_, response) in pending {
        let _ = response.send(Err(HostError::ConnectionClosed));
    }
    Ok(())
}

fn response_message(message: HostMessage) -> Result<HostMessage, HostError> {
    match message {
        HostMessage::Error { code, message } => Err(HostError::Remote { code, message }),
        message => Ok(message),
    }
}

impl HostError {
    pub fn remote_code(&self) -> Option<ErrorCode> {
        match self {
            Self::Remote { code, .. } => Some(*code),
            _ => None,
        }
    }
}
