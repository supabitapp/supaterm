use bytes::BytesMut;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt};

use super::{Direction, Frame, FrameDecoder, PrefaceDecoder, ProtocolError, encode_preface};

pub struct FrameReader<R> {
    input: R,
    buffer: BytesMut,
    decoder: FrameDecoder,
}

impl<R: AsyncRead + Unpin> FrameReader<R> {
    pub fn new(input: R, direction: Direction) -> Self {
        Self {
            input,
            buffer: BytesMut::with_capacity(8 * 1024),
            decoder: FrameDecoder::new(direction),
        }
    }

    pub async fn read_preface(&mut self) -> Result<(), ProtocolError> {
        let mut decoder = PrefaceDecoder::new();
        loop {
            if decoder.decode(&mut self.buffer)?.is_some() {
                return Ok(());
            }
            if self.input.read_buf(&mut self.buffer).await? == 0 {
                return Err(ProtocolError::UnexpectedEof { phase: "preface" });
            }
        }
    }

    pub async fn read_frame(&mut self) -> Result<Option<Frame>, ProtocolError> {
        loop {
            if let Some(frame) = self.decoder.decode(&mut self.buffer)? {
                return Ok(Some(frame));
            }
            if self.input.read_buf(&mut self.buffer).await? == 0 {
                return if self.buffer.is_empty() {
                    Ok(None)
                } else {
                    Err(ProtocolError::UnexpectedEof { phase: "frame" })
                };
            }
        }
    }
}

pub struct FrameWriter<W> {
    output: W,
}

impl<W: AsyncWrite + Unpin> FrameWriter<W> {
    pub fn new(output: W) -> Self {
        Self { output }
    }

    pub async fn write_preface(&mut self) -> Result<(), ProtocolError> {
        self.output.write_all(&encode_preface()).await?;
        self.output.flush().await?;
        Ok(())
    }

    pub async fn write_frame(&mut self, frame: &Frame) -> Result<(), ProtocolError> {
        self.output.write_all(&frame.encode()).await?;
        self.output.flush().await?;
        Ok(())
    }
}
