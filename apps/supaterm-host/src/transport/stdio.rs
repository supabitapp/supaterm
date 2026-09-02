use std::io;
use std::path::Path;
use tokio::io::{AsyncWriteExt, stdin, stdout};
use tokio::net::UnixStream;

pub async fn bridge(socket: &Path) -> io::Result<()> {
    let stream = UnixStream::connect(socket).await?;
    let (mut socket_reader, mut socket_writer) = stream.into_split();
    let mut input = stdin();
    let mut output = stdout();
    let to_host = async {
        tokio::io::copy(&mut input, &mut socket_writer).await?;
        socket_writer.shutdown().await
    };
    let from_host = async {
        tokio::io::copy(&mut socket_reader, &mut output).await?;
        output.flush().await
    };
    tokio::try_join!(to_host, from_host)?;
    Ok(())
}
