use bytes::BytesMut;
use serde_json::json;
use supaterm_host::protocol::control::{
    BuildIdentity, ClientControl, ClientId, ClientRole, CommandId, ControlDecodeError, HostControl,
    HostId, Limits, PROTOCOL_VERSION, ProtocolError, ProtocolErrorCode, decode_client_control,
    encode_control,
};
use supaterm_host::protocol::frame::{Frame, FrameKind, PREFACE};
use supaterm_host::workspace::replay::{MutationEvent, Subscription};
use uuid::Uuid;

fn client_id() -> ClientId {
    ClientId(Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap())
}

#[test]
fn hello_has_one_canonical_json_encoding() {
    let hello = ClientControl::Hello {
        protocol_version: PROTOCOL_VERSION,
        build: BuildIdentity {
            version: "26.0.0".into(),
            fingerprint: "abc123".into(),
        },
        role: ClientRole::Ui,
        client_id: Some(client_id()),
        capabilities: vec!["semantic_state".into(), "terminal_snapshot".into()],
        limits: Limits::default(),
    };

    assert_eq!(
        String::from_utf8(encode_control(&hello).unwrap()).unwrap(),
        "{\"type\":\"hello\",\"protocol_version\":1,\"build\":{\"version\":\"26.0.0\",\"fingerprint\":\"abc123\"},\"role\":\"ui\",\"client_id\":\"11111111-1111-4111-8111-111111111111\",\"capabilities\":[\"semantic_state\",\"terminal_snapshot\"],\"limits\":{\"maximum_snapshot_bytes\":67108864,\"maximum_continuation_bytes\":16777216}}"
    );
}

#[test]
fn malformed_and_non_utf8_control_payloads_fail() {
    assert!(matches!(
        decode_client_control(b"{"),
        Err(ControlDecodeError::MalformedJson(_))
    ));
    assert_eq!(
        decode_client_control(&[0xff]),
        Err(ControlDecodeError::InvalidUtf8)
    );
}

#[test]
fn responses_keep_the_command_id() {
    let command_id = CommandId(Uuid::parse_str("22222222-2222-4222-8222-222222222222").unwrap());
    let response = HostControl::Result {
        command_id,
        result: json!({"revision": 7}),
    };
    let error = HostControl::Error {
        command_id: Some(command_id),
        error: ProtocolError {
            code: ProtocolErrorCode::StaleStructure,
            details: json!({"current_structure_revision": 8}),
            retryable: false,
        },
    };

    assert_eq!(
        serde_json::to_value(response).unwrap()["command_id"],
        command_id.to_string()
    );
    assert_eq!(
        serde_json::to_value(error).unwrap()["command_id"],
        command_id.to_string()
    );
}

#[test]
fn welcome_carries_host_epoch_and_revision() {
    let host_id = HostId(Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap());
    let welcome = HostControl::Welcome {
        protocol_version: PROTOCOL_VERSION,
        build: BuildIdentity {
            version: "26.0.0".into(),
            fingerprint: "abc123".into(),
        },
        host_id,
        epoch: Uuid::parse_str("44444444-4444-4444-8444-444444444444").unwrap(),
        revision: 19,
        structure_revision: 5,
        capabilities: vec!["semantic_state".into()],
        limits: Limits::default(),
    };

    let value = serde_json::to_value(welcome).unwrap();
    assert_eq!(value["host_id"], host_id.to_string());
    assert_eq!(value["revision"], 19);
    assert_eq!(value["structure_revision"], 5);
}

#[test]
fn checked_in_hello_fixture_matches_the_wire() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/protocol-v1-hello.json")).unwrap();
    let hello = ClientControl::Hello {
        protocol_version: PROTOCOL_VERSION,
        build: BuildIdentity {
            version: "26.0.0".into(),
            fingerprint: "abc123".into(),
        },
        role: ClientRole::Ui,
        client_id: Some(client_id()),
        capabilities: vec!["semantic_state".into(), "terminal_snapshot".into()],
        limits: Limits::default(),
    };
    let mut actual = BytesMut::from(PREFACE.as_slice());
    Frame {
        kind: FrameKind::ClientControl,
        stream_id: 0,
        payload: encode_control(&hello).unwrap().into(),
    }
    .encode(&mut actual)
    .unwrap();

    assert_eq!(hex(&actual), fixture["wire_hex"]);
}

#[test]
fn checked_in_state_fixture_matches_the_wire_dtos() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/protocol-v1-state.json")).unwrap();
    let subscription: Subscription =
        serde_json::from_value(fixture["subscription"].clone()).unwrap();
    let mutation: MutationEvent = serde_json::from_value(fixture["mutation"].clone()).unwrap();

    assert_eq!(
        serde_json::to_value(subscription).unwrap(),
        fixture["subscription"]
    );
    assert_eq!(serde_json::to_value(mutation).unwrap(), fixture["mutation"]);
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}
