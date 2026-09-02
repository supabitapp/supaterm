use crate::host::actor::HostActor;
use crate::protocol::control::{
    ClientControl, ClientId, ClientRole, HostControl, Limits, PROTOCOL_VERSION, ProtocolError,
    ProtocolErrorCode,
};
use serde_json::{Value, json};
use uuid::Uuid;

#[derive(Clone, Copy)]
struct ClientIdentity {
    id: ClientId,
    role: ClientRole,
}

pub struct ConnectionSession {
    actor: HostActor,
    client: Option<ClientIdentity>,
    closed: bool,
}

impl ConnectionSession {
    pub fn new(actor: HostActor) -> Self {
        Self {
            actor,
            client: None,
            closed: false,
        }
    }

    pub fn actor(&self) -> &HostActor {
        &self.actor
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn client_id(&self) -> Option<ClientId> {
        self.client.map(|client| client.id)
    }

    pub async fn receive(&mut self, control: ClientControl) -> HostControl {
        if self.closed {
            return protocol_error(None, ProtocolErrorCode::InvalidRequest, Value::Null);
        }
        match (self.client, control) {
            (
                None,
                ClientControl::Hello {
                    protocol_version,
                    build,
                    role,
                    client_id,
                    capabilities,
                    limits,
                },
            ) => {
                let status = match self.actor.status().await {
                    Ok(status) => status,
                    Err(error) => {
                        self.closed = true;
                        return HostControl::Error {
                            command_id: None,
                            error,
                        };
                    }
                };
                if protocol_version != PROTOCOL_VERSION || build != status.build {
                    self.closed = true;
                    return protocol_error(
                        None,
                        ProtocolErrorCode::ProtocolMismatch,
                        json!({
                            "host_protocol_version": PROTOCOL_VERSION,
                            "host_build": status.build
                        }),
                    );
                }
                let negotiated_capabilities = status
                    .capabilities
                    .iter()
                    .filter(|capability| capabilities.contains(capability))
                    .cloned()
                    .collect();
                let negotiated_limits = Limits {
                    maximum_snapshot_bytes: limits
                        .maximum_snapshot_bytes
                        .min(Limits::default().maximum_snapshot_bytes),
                    maximum_continuation_bytes: limits
                        .maximum_continuation_bytes
                        .min(Limits::default().maximum_continuation_bytes),
                };
                self.client = Some(ClientIdentity {
                    id: client_id.unwrap_or_else(|| ClientId(Uuid::new_v4())),
                    role,
                });
                HostControl::Welcome {
                    protocol_version: PROTOCOL_VERSION,
                    build: status.build,
                    host_id: status.host_id,
                    epoch: status.epoch,
                    revision: status.revision,
                    structure_revision: status.structure_revision,
                    capabilities: negotiated_capabilities,
                    limits: negotiated_limits,
                }
            }
            (None, ClientControl::Request { command_id, .. }) => protocol_error(
                Some(command_id),
                ProtocolErrorCode::HelloRequired,
                Value::Null,
            ),
            (Some(_), ClientControl::Hello { .. }) => {
                self.closed = true;
                protocol_error(None, ProtocolErrorCode::UnexpectedHello, Value::Null)
            }
            (
                Some(client),
                ClientControl::Request {
                    command_id,
                    method,
                    params,
                },
            ) => {
                self.actor
                    .execute(client.id, client.role, command_id, method, params)
                    .await
            }
        }
    }
}

fn protocol_error(
    command_id: Option<crate::protocol::control::CommandId>,
    code: ProtocolErrorCode,
    details: Value,
) -> HostControl {
    HostControl::Error {
        command_id,
        error: ProtocolError {
            code,
            details,
            retryable: false,
        },
    }
}
