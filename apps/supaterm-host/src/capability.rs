use crate::protocol::control::{ClientId, HostControl, ProtocolError, ProtocolErrorCode};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

#[derive(Clone)]
pub struct CapabilityBroker {
    inner: Arc<Mutex<State>>,
    timeout: Duration,
}

pub struct CapabilityClient {
    pub connection_id: Uuid,
    pub client_id: ClientId,
    pub capabilities: BTreeSet<String>,
    pub outbound: mpsc::Sender<HostControl>,
}

pub enum CapabilityResponse {
    Result(Value),
    Error(ProtocolError),
}

struct State {
    clients: BTreeMap<Uuid, RegisteredClient>,
    pending: HashMap<Uuid, PendingRequest>,
    next_registration: u64,
}

struct RegisteredClient {
    client_id: ClientId,
    capabilities: BTreeSet<String>,
    outbound: mpsc::Sender<HostControl>,
    registration: u64,
}

struct PendingRequest {
    connection_id: Uuid,
    reply: oneshot::Sender<CapabilityResponse>,
}

impl CapabilityBroker {
    pub fn new(timeout: Duration) -> Self {
        Self {
            inner: Arc::new(Mutex::new(State {
                clients: BTreeMap::new(),
                pending: HashMap::new(),
                next_registration: 0,
            })),
            timeout,
        }
    }

    pub fn register(&self, client: CapabilityClient) {
        let mut state = self.inner.lock().unwrap();
        state.next_registration = state.next_registration.saturating_add(1);
        let registration = state.next_registration;
        state.clients.insert(
            client.connection_id,
            RegisteredClient {
                client_id: client.client_id,
                capabilities: client.capabilities,
                outbound: client.outbound,
                registration,
            },
        );
    }

    pub fn disconnect(&self, connection_id: Uuid) {
        let replies = {
            let mut state = self.inner.lock().unwrap();
            state.clients.remove(&connection_id);
            let request_ids = state
                .pending
                .iter()
                .filter_map(|(request_id, request)| {
                    (request.connection_id == connection_id).then_some(*request_id)
                })
                .collect::<Vec<_>>();
            request_ids
                .into_iter()
                .filter_map(|request_id| state.pending.remove(&request_id))
                .map(|request| request.reply)
                .collect::<Vec<_>>()
        };
        for reply in replies {
            let _ = reply.send(CapabilityResponse::Error(unavailable()));
        }
    }

    pub async fn request(
        &self,
        capability: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, ProtocolError> {
        self.request_for(None, capability, method, params).await
    }

    pub async fn request_for(
        &self,
        client_id: Option<ClientId>,
        capability: &str,
        method: &str,
        params: Value,
    ) -> Result<Value, ProtocolError> {
        let request_id = Uuid::new_v4();
        let (sender, receiver) = oneshot::channel();
        let (connection_id, outbound) = {
            let mut state = self.inner.lock().unwrap();
            let Some((connection_id, client)) = state
                .clients
                .iter()
                .filter(|(_, client)| {
                    client.capabilities.contains(capability)
                        && client_id.is_none_or(|client_id| client.client_id == client_id)
                })
                .max_by_key(|(_, client)| client.registration)
                .map(|(connection_id, client)| (*connection_id, client.outbound.clone()))
            else {
                return Err(unavailable());
            };
            state.pending.insert(
                request_id,
                PendingRequest {
                    connection_id,
                    reply: sender,
                },
            );
            (connection_id, client)
        };
        if outbound
            .send(HostControl::CapabilityRequest {
                request_id,
                capability: capability.to_owned(),
                method: method.to_owned(),
                params,
            })
            .await
            .is_err()
        {
            self.disconnect(connection_id);
            return Err(unavailable());
        }
        let response = match tokio::time::timeout(self.timeout, receiver).await {
            Ok(Ok(response)) => response,
            Ok(Err(_)) | Err(_) => {
                self.inner.lock().unwrap().pending.remove(&request_id);
                return Err(unavailable());
            }
        };
        match response {
            CapabilityResponse::Result(value) => Ok(value),
            CapabilityResponse::Error(error) => Err(error),
        }
    }

    pub fn complete(
        &self,
        connection_id: Uuid,
        request_id: Uuid,
        response: CapabilityResponse,
    ) -> bool {
        let reply = {
            let mut state = self.inner.lock().unwrap();
            let matches = state
                .pending
                .get(&request_id)
                .is_some_and(|request| request.connection_id == connection_id);
            matches
                .then(|| state.pending.remove(&request_id))
                .flatten()
                .map(|request| request.reply)
        };
        reply.is_some_and(|reply| reply.send(response).is_ok())
    }
}

fn unavailable() -> ProtocolError {
    ProtocolError {
        code: ProtocolErrorCode::CapabilityUnavailable,
        details: Value::Null,
        retryable: false,
    }
}
