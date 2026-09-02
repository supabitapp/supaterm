use serde_json::{Value, json};
use supaterm_host::host::actor::{HostActor, HostConfiguration};
use supaterm_host::protocol::connection::ConnectionSession;
use supaterm_host::protocol::control::{
    BuildIdentity, ClientControl, ClientId, ClientRole, CommandId, HostControl, HostId, Limits,
    PROTOCOL_VERSION, ProtocolErrorCode,
};
use uuid::Uuid;

fn build() -> BuildIdentity {
    BuildIdentity {
        version: "26.0.0".into(),
        fingerprint: "build-a".into(),
    }
}

fn hello(protocol_version: u16, build: BuildIdentity) -> ClientControl {
    ClientControl::Hello {
        protocol_version,
        build,
        role: ClientRole::Ui,
        client_id: Some(ClientId(
            Uuid::parse_str("11111111-1111-4111-8111-111111111111").unwrap(),
        )),
        capabilities: vec!["semantic_state".into(), "unsupported".into()],
        limits: Limits::default(),
    }
}

fn session() -> ConnectionSession {
    let actor = HostActor::spawn(HostConfiguration {
        host_id: HostId(Uuid::parse_str("33333333-3333-4333-8333-333333333333").unwrap()),
        epoch: Uuid::parse_str("44444444-4444-4444-8444-444444444444").unwrap(),
        build: build(),
        capabilities: vec!["semantic_state".into()],
        command_cache_capacity: 16,
        terminal_environment: None,
    });
    ConnectionSession::new(actor)
}

fn error_code(control: HostControl) -> ProtocolErrorCode {
    match control {
        HostControl::Error { error, .. } => error.code,
        other => panic!("expected error, got {other:?}"),
    }
}

#[tokio::test]
async fn hello_is_required_before_requests() {
    let command_id = CommandId(Uuid::new_v4());
    let mut session = session();

    let response = session
        .receive(ClientControl::Request {
            command_id,
            method: "state.snapshot".into(),
            params: Value::Null,
        })
        .await;

    assert_eq!(error_code(response), ProtocolErrorCode::HelloRequired);
}

#[tokio::test]
async fn version_or_build_mismatch_is_refused() {
    let mut wrong_version = session();
    assert_eq!(
        error_code(
            wrong_version
                .receive(hello(PROTOCOL_VERSION + 1, build()))
                .await
        ),
        ProtocolErrorCode::ProtocolMismatch
    );

    let mut wrong_build = session();
    let mut other_build = build();
    other_build.fingerprint = "build-b".into();
    assert_eq!(
        error_code(
            wrong_build
                .receive(hello(PROTOCOL_VERSION, other_build))
                .await
        ),
        ProtocolErrorCode::ProtocolMismatch
    );
}

#[tokio::test]
async fn welcome_negotiates_only_supported_capabilities() {
    let mut session = session();

    let response = session.receive(hello(PROTOCOL_VERSION, build())).await;

    match response {
        HostControl::Welcome {
            host_id,
            epoch,
            revision,
            structure_revision,
            capabilities,
            ..
        } => {
            assert_eq!(host_id.to_string(), "33333333-3333-4333-8333-333333333333");
            assert_eq!(epoch.to_string(), "44444444-4444-4444-8444-444444444444");
            assert_eq!(revision, 0);
            assert_eq!(structure_revision, 0);
            assert_eq!(capabilities, ["semantic_state"]);
        }
        other => panic!("expected welcome, got {other:?}"),
    }
}

#[tokio::test]
async fn duplicate_command_returns_the_first_result() {
    let command_id = CommandId(Uuid::new_v4());
    let mut first_connection = session();
    first_connection
        .receive(hello(PROTOCOL_VERSION, build()))
        .await;
    let actor = first_connection.actor().clone();
    let first = first_connection
        .receive(ClientControl::Request {
            command_id,
            method: "state.snapshot".into(),
            params: Value::Null,
        })
        .await;

    let mut retry_connection = ConnectionSession::new(actor);
    retry_connection
        .receive(hello(PROTOCOL_VERSION, build()))
        .await;
    let retry = retry_connection
        .receive(ClientControl::Request {
            command_id,
            method: "missing.method".into(),
            params: json!({"different": true}),
        })
        .await;

    assert_eq!(retry, first);
}
