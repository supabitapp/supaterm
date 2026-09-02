use std::sync::Arc;

use thiserror::Error;
use tokio::io::{AsyncWrite, AsyncWriteExt};
use tokio::sync::{OwnedSemaphorePermit, Semaphore, mpsc, oneshot};

use crate::protocol::{Frame, FrameKind, ProtocolError};

#[derive(Clone, Copy, Debug)]
pub struct OutboundConfig {
    pub control_messages: usize,
    pub control_bytes: usize,
    pub terminal_messages: usize,
    pub terminal_bytes: usize,
}

impl Default for OutboundConfig {
    fn default() -> Self {
        Self {
            control_messages: 64,
            control_bytes: 16 * 1024 * 1024 + 9,
            terminal_messages: 64,
            terminal_bytes: 4 * 1024 * 1024,
        }
    }
}

impl OutboundConfig {
    pub fn validate(self) -> Result<Self, OutboundConfigError> {
        for (name, value) in [
            ("control_messages", self.control_messages),
            ("control_bytes", self.control_bytes),
            ("terminal_messages", self.terminal_messages),
            ("terminal_bytes", self.terminal_bytes),
        ] {
            if value == 0 || value > Semaphore::MAX_PERMITS {
                return Err(OutboundConfigError::InvalidBound {
                    name,
                    value,
                    maximum: Semaphore::MAX_PERMITS,
                });
            }
        }
        Ok(self)
    }
}

#[derive(Clone)]
pub struct OutboundSender {
    control: QueueSender,
    terminal: QueueSender,
}

#[derive(Clone)]
struct QueueSender {
    sender: mpsc::Sender<QueuedFrame>,
    bytes: Arc<Semaphore>,
    maximum_bytes: usize,
}

struct QueuedFrame {
    frame: Frame,
    _permit: OwnedSemaphorePermit,
    written: Option<oneshot::Sender<Result<(), ProtocolError>>>,
}

impl OutboundSender {
    pub async fn send(&self, frame: Frame) -> Result<(), OutboundError> {
        self.queue(frame, None).await
    }

    pub async fn send_and_flush(&self, frame: Frame) -> Result<(), OutboundError> {
        let (written, receive) = oneshot::channel();
        self.queue(frame, Some(written)).await?;
        receive
            .await
            .map_err(|_| OutboundError::Closed)?
            .map_err(OutboundError::Protocol)
    }

    async fn queue(
        &self,
        frame: Frame,
        written: Option<oneshot::Sender<Result<(), ProtocolError>>>,
    ) -> Result<(), OutboundError> {
        let queue = if matches!(
            frame.kind(),
            FrameKind::TerminalOutput | FrameKind::TerminalSnapshot
        ) {
            &self.terminal
        } else {
            &self.control
        };
        let permits = u32::try_from(frame.encoded_len()).map_err(|_| OutboundError::TooLarge)?;
        if frame.encoded_len() > queue.maximum_bytes {
            return Err(OutboundError::TooLarge);
        }
        let permit = queue
            .bytes
            .clone()
            .acquire_many_owned(permits)
            .await
            .map_err(|_| OutboundError::Closed)?;
        queue
            .sender
            .send(QueuedFrame {
                frame,
                _permit: permit,
                written,
            })
            .await
            .map_err(|_| OutboundError::Closed)
    }
}

pub fn spawn_outbound<W>(
    mut output: W,
    config: OutboundConfig,
) -> Result<
    (
        OutboundSender,
        tokio::task::JoinHandle<Result<(), ProtocolError>>,
    ),
    OutboundConfigError,
>
where
    W: AsyncWrite + Unpin + Send + 'static,
{
    let config = config.validate()?;
    let (control_sender, mut control_receiver) = mpsc::channel(config.control_messages);
    let (terminal_sender, mut terminal_receiver) = mpsc::channel(config.terminal_messages);
    let sender = OutboundSender {
        control: QueueSender {
            sender: control_sender,
            bytes: Arc::new(Semaphore::new(config.control_bytes)),
            maximum_bytes: config.control_bytes,
        },
        terminal: QueueSender {
            sender: terminal_sender,
            bytes: Arc::new(Semaphore::new(config.terminal_bytes)),
            maximum_bytes: config.terminal_bytes,
        },
    };
    let task = tokio::spawn(async move {
        let mut prefer_control = true;
        loop {
            let queued = if prefer_control {
                match control_receiver.try_recv() {
                    Ok(frame) => Some(frame),
                    Err(mpsc::error::TryRecvError::Disconnected) => terminal_receiver.recv().await,
                    Err(mpsc::error::TryRecvError::Empty) => match terminal_receiver.try_recv() {
                        Ok(frame) => Some(frame),
                        Err(mpsc::error::TryRecvError::Disconnected) => {
                            control_receiver.recv().await
                        }
                        Err(mpsc::error::TryRecvError::Empty) => {
                            tokio::select! {
                                frame = control_receiver.recv() => frame,
                                frame = terminal_receiver.recv() => frame,
                            }
                        }
                    },
                }
            } else {
                match terminal_receiver.try_recv() {
                    Ok(frame) => Some(frame),
                    Err(mpsc::error::TryRecvError::Disconnected) => control_receiver.recv().await,
                    Err(mpsc::error::TryRecvError::Empty) => match control_receiver.try_recv() {
                        Ok(frame) => Some(frame),
                        Err(mpsc::error::TryRecvError::Disconnected) => {
                            terminal_receiver.recv().await
                        }
                        Err(mpsc::error::TryRecvError::Empty) => {
                            tokio::select! {
                                frame = terminal_receiver.recv() => frame,
                                frame = control_receiver.recv() => frame,
                            }
                        }
                    },
                }
            };
            let Some(queued) = queued else {
                output.shutdown().await?;
                return Ok(());
            };
            prefer_control = !prefer_control;
            let result = async {
                output.write_all(&queued.frame.encode()).await?;
                output.flush().await?;
                Ok(())
            }
            .await;
            if let Some(written) = queued.written {
                let _ = written.send(result.clone());
            }
            result?;
        }
    });
    Ok((sender, task))
}

#[derive(Debug, Error, Eq, PartialEq)]
pub enum OutboundConfigError {
    #[error("outbound queue bound {name}={value} must be between 1 and {maximum}")]
    InvalidBound {
        name: &'static str,
        value: usize,
        maximum: usize,
    },
}

#[derive(Debug, Error)]
pub enum OutboundError {
    #[error("outbound queue is closed")]
    Closed,
    #[error("outbound frame cannot fit the queue budget")]
    TooLarge,
    #[error(transparent)]
    Protocol(#[from] ProtocolError),
}
