use std::time::Duration;

use serde_json::json;
use supaterm_host::{
    ClientEnvelope, ClientId, ClientRole, HostConfig, HostEnvelope, HostMessage, HostRole,
    PROTOCOL_EPOCH, ProcessExit, Request, RequestId, TerminalData, TerminalId,
};
use tempfile::tempdir;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::UnixStream,
    sync::oneshot,
};

#[test]
fn output_event_has_the_cross_language_json_shape() {
    let terminal_id: TerminalId = "123e4567-e89b-12d3-a456-426614174000".parse().unwrap();
    let frame = HostEnvelope {
        epoch: PROTOCOL_EPOCH,
        role: HostRole::Host,
        request_id: None,
        body: HostMessage::Output {
            terminal_id,
            attachment_id: "123e4567-e89b-12d3-a456-426614174001".parse().unwrap(),
            sequence: 19,
            data: TerminalData::from(&b"a\0b"[..]),
        },
    };

    assert_eq!(
        serde_json::to_value(frame).unwrap(),
        json!({
            "epoch": 1,
            "role": "host",
            "requestId": null,
            "body": {
                "type": "output",
                "terminalId": "123e4567-e89b-12d3-a456-426614174000",
                "attachmentId": "123e4567-e89b-12d3-a456-426614174001",
                "sequence": 19,
                "data": "YQBi"
            }
        })
    );
    assert_eq!(
        serde_json::to_value(ProcessExit::Code(23)).unwrap(),
        json!({"kind": "code", "value": 23})
    );
    assert_eq!(
        serde_json::to_value(ProcessExit::Signal("HUP".into())).unwrap(),
        json!({"kind": "signal", "value": "HUP"})
    );
}

#[tokio::test]
async fn raw_length_prefixed_client_can_complete_hello() {
    let directory = tempdir().unwrap();
    let server = supaterm_host::HostServer::bind(HostConfig::for_test(directory.path()))
        .await
        .unwrap();
    let machine_id = server.machine_id();
    let boot_id = server.boot_id();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let mut stream = UnixStream::connect(directory.path().join("host.sock"))
        .await
        .unwrap();
    let request_id = RequestId::new();
    let payload = serde_json::to_vec(&ClientEnvelope {
        epoch: PROTOCOL_EPOCH,
        role: ClientRole::Test,
        request_id,
        body: Request::Hello {
            client_id: ClientId::new(),
        },
    })
    .unwrap();
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await
        .unwrap();
    stream.write_all(&payload).await.unwrap();

    let response: HostEnvelope = tokio::time::timeout(Duration::from_secs(2), async {
        let length = stream.read_u32().await.unwrap() as usize;
        let mut payload = vec![0_u8; length];
        stream.read_exact(&mut payload).await.unwrap();
        serde_json::from_slice(&payload).unwrap()
    })
    .await
    .unwrap();
    assert_eq!(response.request_id, Some(request_id));
    assert_eq!(
        response.body,
        HostMessage::Hello {
            machine_id,
            boot_id
        }
    );

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}

#[tokio::test]
async fn half_closed_client_receives_its_last_response() {
    let directory = tempdir().unwrap();
    let server = supaterm_host::HostServer::bind(HostConfig::for_test(directory.path()))
        .await
        .unwrap();
    let (shutdown_sender, shutdown_receiver) = oneshot::channel();
    let server_task = tokio::spawn(server.run_until(async {
        let _ = shutdown_receiver.await;
    }));
    let mut stream = UnixStream::connect(directory.path().join("host.sock"))
        .await
        .unwrap();
    let request_id = RequestId::new();
    let payload = serde_json::to_vec(&ClientEnvelope {
        epoch: PROTOCOL_EPOCH,
        role: ClientRole::Test,
        request_id,
        body: Request::Hello {
            client_id: ClientId::new(),
        },
    })
    .unwrap();
    stream
        .write_all(&(payload.len() as u32).to_be_bytes())
        .await
        .unwrap();
    stream.write_all(&payload).await.unwrap();
    stream.shutdown().await.unwrap();

    let length = tokio::time::timeout(Duration::from_secs(2), stream.read_u32())
        .await
        .unwrap()
        .unwrap() as usize;
    let mut payload = vec![0_u8; length];
    stream.read_exact(&mut payload).await.unwrap();
    let response: HostEnvelope = serde_json::from_slice(&payload).unwrap();
    assert_eq!(response.request_id, Some(request_id));
    assert!(matches!(response.body, HostMessage::Hello { .. }));

    shutdown_sender.send(()).unwrap();
    server_task.await.unwrap().unwrap();
}
