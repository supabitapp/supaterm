use bytes::BytesMut;
use supaterm_host::protocol::{
    ClientMessage, ClientRole, Command, CommandResult, Direction, EmptySnapshot, EmptyWorkspace,
    ErrorCode, Frame, FrameDecoder, FrameKind, FrameReader, Hello, HostMessage, PROTOCOL_VERSION,
    PrefaceDecoder, ProtocolError, ProtocolFailure, Welcome, encode_preface,
};
use tokio::io::AsyncWriteExt;

#[test]
fn fragmented_and_coalesced_frames_decode() {
    let first = Frame::new(FrameKind::ClientControl, 0, br#"{"one":1}"#.to_vec()).unwrap();
    let second = Frame::new(FrameKind::TerminalInput, 7, b"abc".to_vec()).unwrap();
    let mut wire = first.encode();
    wire.extend_from_slice(&second.encode());
    let mut decoder = FrameDecoder::new(Direction::ClientToHost);
    let mut input = BytesMut::new();

    for byte in &wire[..wire.len() - 2] {
        input.extend_from_slice(&[*byte]);
        if input.len() < first.encoded_len() {
            assert!(decoder.decode(&mut input).unwrap().is_none());
        }
    }

    assert_eq!(decoder.decode(&mut input).unwrap(), Some(first));
    assert!(decoder.decode(&mut input).unwrap().is_none());
    input.extend_from_slice(&wire[wire.len() - 2..]);
    assert_eq!(decoder.decode(&mut input).unwrap(), Some(second));
    assert!(decoder.decode(&mut input).unwrap().is_none());
}

#[test]
fn frame_bounds_are_kind_specific() {
    for (kind, stream_id) in [
        (FrameKind::ClientControl, 0),
        (FrameKind::HostControl, 0),
        (FrameKind::TerminalInput, 1),
        (FrameKind::TerminalOutput, 1),
        (FrameKind::TerminalSnapshot, 1),
    ] {
        let maximum = kind.maximum_payload_length();
        let length = maximum + 1;
        assert_eq!(
            Frame::new(kind, stream_id, vec![0; length]).unwrap_err(),
            ProtocolError::FrameTooLarge {
                kind,
                length,
                maximum,
            }
        );
    }
}

#[test]
fn frame_accessors_preserve_validated_values() {
    let frame = Frame::new(FrameKind::TerminalInput, 7, b"abc".to_vec()).unwrap();

    assert_eq!(frame.kind(), FrameKind::TerminalInput);
    assert_eq!(frame.stream_id(), 7);
    assert_eq!(frame.payload(), b"abc");
    assert_eq!(
        frame.encode(),
        [16, 0, 0, 0, 7, 0, 0, 0, 3, b'a', b'b', b'c']
    );
}

#[test]
fn direction_stream_and_json_errors_are_typed() {
    let frame = Frame::new(FrameKind::HostControl, 0, b"{}".to_vec()).unwrap();
    let mut bytes = BytesMut::from(frame.encode().as_slice());
    let error = FrameDecoder::new(Direction::ClientToHost)
        .decode(&mut bytes)
        .unwrap_err();
    assert_eq!(
        error,
        ProtocolError::WrongDirection {
            kind: FrameKind::HostControl,
            expected: Direction::ClientToHost,
            received: Direction::HostToClient,
        }
    );

    let error = Frame::new(FrameKind::TerminalInput, 0, Vec::new()).unwrap_err();
    assert!(matches!(error, ProtocolError::InvalidStream { .. }));

    let frame = Frame::new(FrameKind::ClientControl, 0, vec![0xff]).unwrap();
    let error = frame.decode_json::<serde_json::Value>().unwrap_err();
    assert!(matches!(error, ProtocolError::InvalidJson { .. }));
}

#[test]
fn preface_is_fixed_and_rejects_other_versions() {
    assert_eq!(encode_preface(), *b"SUPATERM\0\0\0\x01");
    let mut decoder = PrefaceDecoder::new();
    let mut bytes = BytesMut::from(&b"SUPATERM\0\0\0\x02"[..]);
    let error = decoder.decode(&mut bytes).unwrap_err();
    assert_eq!(
        error,
        ProtocolError::VersionMismatch {
            expected: PROTOCOL_VERSION,
            received: 2,
        }
    );
}

#[test]
fn malicious_headers_fail_before_payload_allocation() {
    let mut unknown = BytesMut::from(&[0xff, 0, 0, 0, 0, 0, 0, 0, 0][..]);
    let error = FrameDecoder::new(Direction::ClientToHost)
        .decode(&mut unknown)
        .unwrap_err();
    assert_eq!(error, ProtocolError::UnknownFrameKind { kind: 0xff });

    let mut oversized = BytesMut::from(&[1, 0, 0, 0, 0, 1, 0, 0, 1][..]);
    let error = FrameDecoder::new(Direction::ClientToHost)
        .decode(&mut oversized)
        .unwrap_err();
    assert!(matches!(
        error,
        ProtocolError::FrameTooLarge {
            length: 16_777_217,
            maximum: 16_777_216,
            ..
        }
    ));
}

#[tokio::test]
async fn partial_frame_eof_is_typed() {
    let (mut writer, reader) = tokio::io::duplex(64);
    writer.write_all(&encode_preface()).await.unwrap();
    writer.write_all(&[1, 0, 0, 0]).await.unwrap();
    writer.shutdown().await.unwrap();
    let mut reader = FrameReader::new(reader, Direction::ClientToHost);
    reader.read_preface().await.unwrap();
    let error = reader.read_frame().await.unwrap_err();
    assert_eq!(error, ProtocolError::UnexpectedEof { phase: "frame" });
}

#[tokio::test]
async fn partial_payload_eof_is_typed() {
    let (mut writer, reader) = tokio::io::duplex(64);
    writer.write_all(&encode_preface()).await.unwrap();
    writer
        .write_all(&[1, 0, 0, 0, 0, 0, 0, 0, 3, b'a'])
        .await
        .unwrap();
    writer.shutdown().await.unwrap();
    let mut reader = FrameReader::new(reader, Direction::ClientToHost);
    reader.read_preface().await.unwrap();
    let error = reader.read_frame().await.unwrap_err();
    assert_eq!(error, ProtocolError::UnexpectedEof { phase: "frame" });
}

#[test]
fn client_messages_match_checked_in_golden_fixtures() {
    let messages = [
        (
            ClientMessage::Hello(Hello {
                protocol_version: 1,
                build_identity: "fixture-build".to_owned(),
                role: ClientRole::Ui,
                client_id: "fixture-client".to_owned(),
                capabilities: vec!["terminal".to_owned()],
                limits: Default::default(),
            }),
            include_str!("fixtures/hello.json"),
            include_str!("fixtures/hello-frame.hex"),
        ),
        (
            ClientMessage::Command {
                request_id: "request-snapshot".to_owned(),
                command_id: "command-snapshot".to_owned(),
                command: Command::Snapshot,
            },
            include_str!("fixtures/command-snapshot.json"),
            include_str!("fixtures/command-snapshot-frame.hex"),
        ),
        (
            ClientMessage::Command {
                request_id: "request-ping".to_owned(),
                command_id: "command-ping".to_owned(),
                command: Command::Ping,
            },
            include_str!("fixtures/command-ping.json"),
            include_str!("fixtures/command-ping-frame.hex"),
        ),
        (
            ClientMessage::Command {
                request_id: "request-shutdown".to_owned(),
                command_id: "command-shutdown".to_owned(),
                command: Command::Shutdown,
            },
            include_str!("fixtures/command-shutdown.json"),
            include_str!("fixtures/command-shutdown-frame.hex"),
        ),
    ];

    for (message, json, frame) in messages {
        assert_control_fixture(FrameKind::ClientControl, &message, json, frame);
    }
}

#[test]
fn host_messages_match_checked_in_golden_fixtures() {
    let messages = [
        (
            HostMessage::Welcome(Welcome {
                protocol_version: 1,
                build_identity: "fixture-build".to_owned(),
                host_id: "fixture-host".to_owned(),
                epoch: "fixture-epoch".to_owned(),
                revision: 7,
                structure_revision: 3,
                capabilities: vec!["terminal".to_owned(), "host.shutdown".to_owned()],
                limits: Default::default(),
            }),
            include_str!("fixtures/welcome.json"),
            include_str!("fixtures/welcome-frame.hex"),
        ),
        (
            HostMessage::Result {
                request_id: "request-snapshot".to_owned(),
                command_id: "command-snapshot".to_owned(),
                result: CommandResult::Snapshot {
                    snapshot: EmptySnapshot {
                        epoch: "fixture-epoch".to_owned(),
                        revision: 8,
                        structure_revision: 4,
                        workspace: EmptyWorkspace::default(),
                    },
                },
            },
            include_str!("fixtures/result-snapshot.json"),
            include_str!("fixtures/result-snapshot-frame.hex"),
        ),
        (
            HostMessage::Result {
                request_id: "request-ping".to_owned(),
                command_id: "command-ping".to_owned(),
                result: CommandResult::Pong {
                    accepted_commands: 12,
                },
            },
            include_str!("fixtures/result-pong.json"),
            include_str!("fixtures/result-pong-frame.hex"),
        ),
        (
            HostMessage::Result {
                request_id: "request-shutdown".to_owned(),
                command_id: "command-shutdown".to_owned(),
                result: CommandResult::ShuttingDown,
            },
            include_str!("fixtures/result-shutting-down.json"),
            include_str!("fixtures/result-shutting-down-frame.hex"),
        ),
        (
            HostMessage::Error {
                request_id: Some("request-ping".to_owned()),
                command_id: Some("command-ping".to_owned()),
                error: ProtocolFailure::new(
                    ErrorCode::InvalidIdentifier,
                    "identifier is invalid",
                    false,
                ),
            },
            include_str!("fixtures/error-command.json"),
            include_str!("fixtures/error-command-frame.hex"),
        ),
        (
            HostMessage::Error {
                request_id: None,
                command_id: None,
                error: ProtocolFailure::new(ErrorCode::HandshakeRequired, "hello required", false),
            },
            include_str!("fixtures/error-handshake.json"),
            include_str!("fixtures/error-handshake-frame.hex"),
        ),
    ];

    for (message, json, frame) in messages {
        assert_control_fixture(FrameKind::HostControl, &message, json, frame);
    }
}

#[test]
fn every_frame_kind_matches_checked_in_golden_headers() {
    let frames = [
        Frame::new(FrameKind::ClientControl, 0, b"client-control".to_vec()).unwrap(),
        Frame::new(FrameKind::HostControl, 0, b"host-control".to_vec()).unwrap(),
        Frame::new(FrameKind::TerminalInput, 0x0102_0304, vec![0, 1, 2, 3]).unwrap(),
        Frame::new(FrameKind::TerminalOutput, 0x1122_3344, b"output".to_vec()).unwrap(),
        Frame::new(
            FrameKind::TerminalSnapshot,
            0xa1b2_c3d4,
            vec![0xde, 0xad, 0xbe, 0xef],
        )
        .unwrap(),
    ];
    let fixtures = include_str!("fixtures/frame-kinds.hex")
        .lines()
        .collect::<Vec<_>>();

    assert_eq!(fixtures.len(), frames.len());
    for (frame, fixture) in frames.iter().zip(fixtures) {
        assert_frame_fixture(frame, fixture);
    }
}

fn assert_control_fixture<T>(kind: FrameKind, message: &T, json: &str, frame: &str)
where
    T: serde::Serialize + serde::de::DeserializeOwned + std::fmt::Debug + PartialEq,
{
    let json = json.trim_end();
    assert_eq!(serde_json::to_string(message).unwrap(), json);
    assert_eq!(&serde_json::from_str::<T>(json).unwrap(), message);

    let expected = Frame::from_json(kind, message).unwrap();
    let decoded = assert_frame_fixture(&expected, frame);
    assert_eq!(&decoded.decode_json::<T>().unwrap(), message);
}

fn assert_frame_fixture(frame: &Frame, fixture: &str) -> Frame {
    let expected = decode_hex(fixture);
    assert_eq!(frame.encode(), expected);

    let mut wire = BytesMut::from(expected.as_slice());
    let decoded = FrameDecoder::new(frame.kind().direction())
        .decode(&mut wire)
        .unwrap()
        .unwrap();
    assert!(wire.is_empty());
    assert_eq!(&decoded, frame);
    decoded
}

fn decode_hex(fixture: &str) -> Vec<u8> {
    let fixture = fixture.trim();
    assert_eq!(fixture.len() % 2, 0);
    fixture
        .as_bytes()
        .chunks_exact(2)
        .map(|digits| u8::from_str_radix(std::str::from_utf8(digits).unwrap(), 16).unwrap())
        .collect()
}
