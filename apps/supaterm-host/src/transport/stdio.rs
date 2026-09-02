use std::io::Read;
use std::path::Path;

use tokio::io::{AsyncWriteExt, stdout};
use tokio::net::UnixStream;
use tokio::sync::mpsc;

pub async fn bridge_stdio(socket: &Path) -> Result<(), std::io::Error> {
    let stream = UnixStream::connect(socket).await?;
    let (mut socket_read, mut socket_write) = stream.into_split();
    let mut input = stdin_chunks()?;
    let mut output = stdout();
    let client_to_host = async {
        while let Some(chunk) = input.recv().await {
            if let Err(error) = socket_write.write_all(&chunk?).await {
                if !is_disconnect(&error) {
                    return Err(error);
                }
                break;
            }
        }
        match socket_write.shutdown().await {
            Ok(()) => Ok(()),
            Err(error) if is_disconnect(&error) => Ok(()),
            Err(error) => Err(error),
        }
    };
    let host_to_client = async {
        tokio::io::copy(&mut socket_read, &mut output).await?;
        output.flush().await
    };
    tokio::pin!(client_to_host);
    tokio::pin!(host_to_client);
    tokio::select! {
        result = &mut host_to_client => result?,
        result = &mut client_to_host => {
            result?;
            host_to_client.await?;
        }
    }
    Ok(())
}

fn stdin_chunks() -> Result<mpsc::Receiver<Result<Vec<u8>, std::io::Error>>, std::io::Error> {
    let (sender, receiver) = mpsc::channel(1);
    drop(
        std::thread::Builder::new()
            .name("supaterm-stdin".to_owned())
            .spawn(move || {
                let mut input = std::io::stdin().lock();
                let mut buffer = [0; 8 * 1024];
                loop {
                    match input.read(&mut buffer) {
                        Ok(0) => return,
                        Ok(length) => {
                            if sender.blocking_send(Ok(buffer[..length].to_vec())).is_err() {
                                return;
                            }
                        }
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(error) => {
                            let _ = sender.blocking_send(Err(error));
                            return;
                        }
                    }
                }
            })?,
    );
    Ok(receiver)
}

fn is_disconnect(error: &std::io::Error) -> bool {
    matches!(
        error.kind(),
        std::io::ErrorKind::NotConnected
            | std::io::ErrorKind::BrokenPipe
            | std::io::ErrorKind::ConnectionReset
    )
}
