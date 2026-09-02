use crate::terminal::vt::{HostTerminal, TerminalEffect, TerminalStateError, TerminalViewport};
use bytes::Bytes;
use tokio::sync::{mpsc, oneshot};

const VT_QUEUE_CAPACITY: usize = 256;

#[derive(Clone)]
pub struct VtHandle {
    sender: mpsc::Sender<VtCommand>,
}

impl VtHandle {
    pub fn spawn(viewport: TerminalViewport) -> Result<Self, TerminalStateError> {
        let terminal = HostTerminal::new(viewport)?;
        let (sender, receiver) = mpsc::channel(VT_QUEUE_CAPACITY);
        tokio::spawn(run(terminal, receiver));
        Ok(Self { sender })
    }

    pub async fn write(&self, bytes: Bytes) -> Result<VtWrite, TerminalStateError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(VtCommand::Write { bytes, reply })
            .await
            .map_err(|_| TerminalStateError::Stopped)?;
        response.await.map_err(|_| TerminalStateError::Stopped)
    }

    pub async fn resize(
        &self,
        viewport: TerminalViewport,
    ) -> Result<Vec<Bytes>, TerminalStateError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(VtCommand::Resize { viewport, reply })
            .await
            .map_err(|_| TerminalStateError::Stopped)?;
        response.await.map_err(|_| TerminalStateError::Stopped)?
    }

    pub async fn snapshot(&self) -> Result<Vec<u8>, TerminalStateError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(VtCommand::Snapshot { reply })
            .await
            .map_err(|_| TerminalStateError::Stopped)?;
        response.await.map_err(|_| TerminalStateError::Stopped)?
    }

    pub async fn plain_text(&self) -> Result<String, TerminalStateError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(VtCommand::PlainText { reply })
            .await
            .map_err(|_| TerminalStateError::Stopped)?;
        response.await.map_err(|_| TerminalStateError::Stopped)?
    }
}

pub struct VtWrite {
    pub replies: Vec<Bytes>,
    pub effects: Vec<TerminalEffect>,
}

enum VtCommand {
    Write {
        bytes: Bytes,
        reply: oneshot::Sender<VtWrite>,
    },
    Resize {
        viewport: TerminalViewport,
        reply: oneshot::Sender<Result<Vec<Bytes>, TerminalStateError>>,
    },
    Snapshot {
        reply: oneshot::Sender<Result<Vec<u8>, TerminalStateError>>,
    },
    PlainText {
        reply: oneshot::Sender<Result<String, TerminalStateError>>,
    },
}

async fn run(mut terminal: HostTerminal, mut receiver: mpsc::Receiver<VtCommand>) {
    while let Some(command) = receiver.recv().await {
        match command {
            VtCommand::Write { bytes, reply } => {
                let write = terminal.write_with_effects(&bytes);
                let replies = write.replies.into_iter().map(Bytes::from).collect();
                let _ = reply.send(VtWrite {
                    replies,
                    effects: write.effects,
                });
            }
            VtCommand::Resize { viewport, reply } => {
                let result = terminal
                    .resize(viewport)
                    .map(|replies| replies.into_iter().map(Bytes::from).collect());
                let _ = reply.send(result);
            }
            VtCommand::Snapshot { reply } => {
                let _ = reply.send(terminal.snapshot());
            }
            VtCommand::PlainText { reply } => {
                let _ = reply.send(terminal.plain_text());
            }
        }
    }
}
