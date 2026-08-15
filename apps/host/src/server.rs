use std::{future::Future, sync::Arc, time::Duration};

use tokio::{net::UnixStream, sync::mpsc, task::JoinSet};
use uuid::Uuid;

use crate::{
    ClientEnvelope, ErrorCode, HostEnvelope, HostError, HostMessage, HostRole, MachineId, Request,
    RequestId,
    terminal::{DomainError, HostState, LaunchSpec},
    transport::{read_frame, write_frame},
};

pub(crate) async fn run_host<F>(
    listener: &tokio::net::UnixListener,
    state: Arc<HostState>,
    machine_id: MachineId,
    boot_id: crate::BootId,
    connection_queue_capacity: usize,
    shutdown: F,
) -> Result<(), HostError>
where
    F: Future<Output = ()>,
{
    tokio::pin!(shutdown);
    let mut connections = JoinSet::new();
    loop {
        tokio::select! {
            accepted = listener.accept() => {
                let (stream, _) = accepted?;
                if stream.peer_cred()?.uid() != unsafe { libc::geteuid() } {
                    continue;
                }
                let state = Arc::clone(&state);
                connections.spawn(async move {
                    let _ = serve_connection(
                        stream,
                        state,
                        machine_id,
                        boot_id,
                        connection_queue_capacity,
                    ).await;
                });
            }
            _ = &mut shutdown => break,
            completed = connections.join_next(), if !connections.is_empty() => {
                let _ = completed;
            }
        }
    }
    state.end_all();
    connections.abort_all();
    while connections.join_next().await.is_some() {}
    Ok(())
}

async fn serve_connection(
    stream: UnixStream,
    state: Arc<HostState>,
    machine_id: MachineId,
    boot_id: crate::BootId,
    connection_queue_capacity: usize,
) -> Result<(), HostError> {
    let connection_id = Uuid::new_v4();
    let guard = ConnectionGuard {
        connection_id,
        state: Arc::clone(&state),
    };
    let (mut reader, mut writer) = stream.into_split();
    let (sender, mut receiver) = mpsc::channel::<HostEnvelope>(connection_queue_capacity);
    let mut writer_task = tokio::spawn(async move {
        while let Some(frame) = receiver.recv().await {
            write_frame(&mut writer, &frame).await?;
        }
        Ok::<(), HostError>(())
    });
    let read_result = async {
        let mut greeted_role = None;
        while let Some(frame) = read_frame::<ClientEnvelope, _>(&mut reader).await? {
            if frame.epoch != crate::PROTOCOL_EPOCH {
                send_error(
                    &sender,
                    frame.request_id,
                    DomainError {
                        code: ErrorCode::Protocol,
                        message: "unsupported protocol epoch".into(),
                    },
                )
                .await?;
                break;
            }
            if greeted_role.is_some_and(|role| role != frame.role) {
                send_error(
                    &sender,
                    frame.request_id,
                    DomainError {
                        code: ErrorCode::Protocol,
                        message: "client role changed after hello".into(),
                    },
                )
                .await?;
                break;
            }

            match (&greeted_role, &frame.body) {
                (None, Request::Hello { .. }) => {
                    greeted_role = Some(frame.role);
                    send_response(
                        &sender,
                        frame.request_id,
                        HostMessage::Hello {
                            machine_id,
                            boot_id,
                        },
                    )
                    .await?;
                }
                (None, _) => {
                    send_error(
                        &sender,
                        frame.request_id,
                        DomainError {
                            code: ErrorCode::Protocol,
                            message: "hello must be the first request".into(),
                        },
                    )
                    .await?;
                    break;
                }
                (Some(_), Request::Hello { .. }) => {
                    send_error(
                        &sender,
                        frame.request_id,
                        DomainError {
                            code: ErrorCode::Protocol,
                            message: "hello was already completed".into(),
                        },
                    )
                    .await?;
                }
                (Some(_), request) => {
                    dispatch(
                        Arc::clone(&state),
                        connection_id,
                        frame.request_id,
                        request.clone(),
                        &sender,
                    )
                    .await?;
                }
            }
        }
        Ok::<(), HostError>(())
    }
    .await;

    drop(guard);
    drop(sender);
    let write_result = match tokio::time::timeout(Duration::from_secs(1), &mut writer_task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(HostError::Task(error.to_string())),
        Err(_) => {
            writer_task.abort();
            let _ = writer_task.await;
            Err(HostError::Task("connection writer did not drain".into()))
        }
    };
    read_result?;
    write_result
}

async fn dispatch(
    state: Arc<HostState>,
    connection_id: Uuid,
    request_id: RequestId,
    request: Request,
    sender: &mpsc::Sender<HostEnvelope>,
) -> Result<(), HostError> {
    let response = match request {
        Request::Create {
            terminal_id,
            command,
            size,
        } => {
            let state = Arc::clone(&state);
            match tokio::task::spawn_blocking(move || {
                state.create(terminal_id, LaunchSpec { command, size })
            })
            .await
            .map_err(|error| HostError::Task(error.to_string()))?
            {
                Ok(terminal) => Some(HostMessage::Created { terminal }),
                Err(error) => {
                    send_error(sender, request_id, error).await?;
                    None
                }
            }
        }
        Request::List => Some(HostMessage::Terminals {
            terminals: state.list(),
        }),
        Request::Get { terminal_id } => match state.get(terminal_id) {
            Ok(terminal) => Some(HostMessage::Terminal { terminal }),
            Err(error) => {
                send_error(sender, request_id, error).await?;
                None
            }
        },
        Request::Attach { terminal_id } => {
            if let Err(error) = state.attach(terminal_id, connection_id, request_id, sender.clone())
            {
                send_error(sender, request_id, error).await?;
            }
            None
        }
        Request::Input {
            terminal_id,
            attachment_id,
            data,
        } => match state.input(terminal_id, connection_id, attachment_id, data) {
            Ok(()) => Some(HostMessage::Ack),
            Err(error) => {
                send_error(sender, request_id, error).await?;
                None
            }
        },
        Request::Resize {
            terminal_id,
            attachment_id,
            size,
        } => match state.resize(terminal_id, connection_id, attachment_id, size) {
            Ok(()) => Some(HostMessage::Ack),
            Err(error) => {
                send_error(sender, request_id, error).await?;
                None
            }
        },
        Request::Detach {
            terminal_id,
            attachment_id,
        } => match state.detach(terminal_id, connection_id, attachment_id) {
            Ok(()) => Some(HostMessage::Ack),
            Err(error) => {
                send_error(sender, request_id, error).await?;
                None
            }
        },
        Request::End { terminal_id } => match state.end(terminal_id) {
            Ok(()) => Some(HostMessage::Ack),
            Err(error) => {
                send_error(sender, request_id, error).await?;
                None
            }
        },
        Request::Hello { .. } => unreachable!(),
    };
    if let Some(response) = response {
        send_response(sender, request_id, response).await?;
    }
    Ok(())
}

async fn send_response(
    sender: &mpsc::Sender<HostEnvelope>,
    request_id: RequestId,
    body: HostMessage,
) -> Result<(), HostError> {
    sender
        .send(HostEnvelope {
            epoch: crate::PROTOCOL_EPOCH,
            role: HostRole::Host,
            request_id: Some(request_id),
            body,
        })
        .await
        .map_err(|_| HostError::ConnectionClosed)
}

async fn send_error(
    sender: &mpsc::Sender<HostEnvelope>,
    request_id: RequestId,
    error: DomainError,
) -> Result<(), HostError> {
    send_response(
        sender,
        request_id,
        HostMessage::Error {
            code: error.code,
            message: error.message,
        },
    )
    .await
}

struct ConnectionGuard {
    connection_id: Uuid,
    state: Arc<HostState>,
}

impl Drop for ConnectionGuard {
    fn drop(&mut self) {
        self.state.detach_connection(self.connection_id);
    }
}
