use serde_json::json;
use std::time::Duration;
use supaterm_host::capability::{CapabilityBroker, CapabilityClient, CapabilityResponse};
use supaterm_host::protocol::control::{ClientId, HostControl, ProtocolErrorCode};
use tokio::sync::mpsc;
use uuid::Uuid;

#[tokio::test]
async fn request_routes_to_the_latest_capable_client_and_correlates_the_result() {
    let broker = CapabilityBroker::new(Duration::from_secs(1));
    let first_connection = Uuid::from_u128(1);
    let second_connection = Uuid::from_u128(2);
    let (first_sender, mut first_receiver) = mpsc::channel(1);
    let (second_sender, mut second_receiver) = mpsc::channel(1);
    broker.register(CapabilityClient {
        connection_id: first_connection,
        client_id: ClientId(Uuid::from_u128(3)),
        capabilities: ["native_focus".to_owned()].into(),
        outbound: first_sender,
    });
    broker.register(CapabilityClient {
        connection_id: second_connection,
        client_id: ClientId(Uuid::from_u128(4)),
        capabilities: ["native_focus".to_owned()].into(),
        outbound: second_sender,
    });

    let request = tokio::spawn({
        let broker = broker.clone();
        async move {
            broker
                .request("native_focus", "native.focus", json!({"pane_id": "p"}))
                .await
        }
    });
    assert!(first_receiver.try_recv().is_err());
    let HostControl::CapabilityRequest {
        request_id,
        capability,
        method,
        params,
    } = second_receiver.recv().await.unwrap()
    else {
        panic!("expected a capability request")
    };
    assert_eq!(capability, "native_focus");
    assert_eq!(method, "native.focus");
    assert_eq!(params, json!({"pane_id": "p"}));
    assert!(!broker.complete(
        first_connection,
        request_id,
        CapabilityResponse::Result(json!({"focused": true}))
    ));
    assert!(broker.complete(
        second_connection,
        request_id,
        CapabilityResponse::Result(json!({"focused": true}))
    ));
    assert_eq!(request.await.unwrap().unwrap(), json!({"focused": true}));
}

#[tokio::test]
async fn missing_or_disconnected_capability_is_typed_unavailable() {
    let broker = CapabilityBroker::new(Duration::from_secs(1));
    let error = broker
        .request("native_screenshot", "native.screenshot", json!({}))
        .await
        .unwrap_err();
    assert_eq!(error.code, ProtocolErrorCode::CapabilityUnavailable);

    let connection_id = Uuid::from_u128(5);
    let (sender, mut receiver) = mpsc::channel(1);
    broker.register(CapabilityClient {
        connection_id,
        client_id: ClientId(Uuid::from_u128(6)),
        capabilities: ["native_screenshot".to_owned()].into(),
        outbound: sender,
    });
    let request = tokio::spawn({
        let broker = broker.clone();
        async move {
            broker
                .request("native_screenshot", "native.screenshot", json!({}))
                .await
        }
    });
    assert!(matches!(
        receiver.recv().await,
        Some(HostControl::CapabilityRequest { .. })
    ));
    broker.disconnect(connection_id);
    assert_eq!(
        request.await.unwrap().unwrap_err().code,
        ProtocolErrorCode::CapabilityUnavailable
    );
}
