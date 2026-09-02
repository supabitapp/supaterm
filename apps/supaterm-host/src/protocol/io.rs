use crate::protocol::frame::{Direction, Frame, FrameDecoder, PREFACE};
use bytes::BytesMut;
use std::io;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

pub struct FrameReader<R> {
    input: R,
    decoder: FrameDecoder,
    buffer: BytesMut,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    pub fn new(input: R, direction: Direction) -> Self {
        Self {
            input,
            decoder: FrameDecoder::new(direction),
            buffer: BytesMut::with_capacity(16 * 1024),
        }
    }

    pub async fn read(&mut self) -> io::Result<Option<Frame>> {
        loop {
            match self.decoder.decode(&mut self.buffer) {
                Ok(Some(frame)) => return Ok(Some(frame)),
                Ok(None) => {}
                Err(error) => return Err(io::Error::new(io::ErrorKind::InvalidData, error)),
            }
            let count = self.input.read_buf(&mut self.buffer).await?;
            if count == 0 {
                if self.buffer.is_empty() {
                    return Ok(None);
                }
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "connection ended during a frame",
                ));
            }
        }
    }
}

pub struct FrameWriter<W> {
    output: W,
    sent_preface: bool,
    buffer: BytesMut,
}

impl<W: AsyncWrite + Unpin> FrameWriter<W> {
    pub fn new(output: W) -> Self {
        Self {
            output,
            sent_preface: false,
            buffer: BytesMut::new(),
        }
    }

    pub async fn write(&mut self, frame: &Frame) -> io::Result<()> {
        self.buffer.clear();
        frame
            .encode(&mut self.buffer)
            .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
        if !self.sent_preface {
            self.output.write_all(&PREFACE).await?;
            self.sent_preface = true;
        }
        self.output.write_all(&self.buffer).await?;
        self.output.flush().await
    }
}
