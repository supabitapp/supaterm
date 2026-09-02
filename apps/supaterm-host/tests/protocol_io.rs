use std::io::ErrorKind;
use supaterm_host::protocol::frame::{Direction, PREFACE};
use supaterm_host::protocol::io::FrameReader;
use tokio::io::{AsyncWriteExt, duplex};

#[tokio::test]
async fn eof_between_frame_bytes_is_an_error() {
    let (mut writer, reader) = duplex(64);
    let task = tokio::spawn(async move {
        writer.write_all(&PREFACE[..4]).await.unwrap();
        writer.shutdown().await.unwrap();
    });
    let error = FrameReader::new(reader, Direction::ClientToHost)
        .read()
        .await
        .unwrap_err();

    assert_eq!(error.kind(), ErrorKind::UnexpectedEof);
    task.await.unwrap();
}

#[tokio::test]
async fn clean_eof_before_a_preface_is_a_disconnect() {
    let (mut writer, reader) = duplex(64);
    writer.shutdown().await.unwrap();

    assert!(
        FrameReader::new(reader, Direction::ClientToHost)
            .read()
            .await
            .unwrap()
            .is_none()
    );
}
