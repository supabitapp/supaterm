use crate::agent::enrichment::scan as scan_enrichment;
use crate::agent::machine::{MachineEnvironment, MachineServiceError, MachineServices};
use crate::agent::manifest::DetectionCatalog;
use crate::agent::process::{ProcessScan, is_descendant, scan_process_group};
use crate::protocol::control::{
    BuildIdentity, ClientId, ClientRole, CommandId, HostControl, HostId, ProtocolError,
    ProtocolErrorCode,
};
use crate::protocol::terminal::PaneId;
use crate::terminal::actor::{PaneInfo, TerminalError, TerminalRegistry, TerminalRuntimeEvent};
use crate::terminal::pty::{SpawnSpec, TerminalEnvironment};
use crate::workspace::model::{
    ItemId, Placement, SpaceId, SplitDirection, SplitId, SplitPlacement, TabId, WindowId, Workspace,
};
use crate::workspace::persistence::{DurableDocument, PersistenceWorker};
use crate::workspace::reducer::{Command, ReducerError, closing_pane_ids};
use crate::workspace::replay::{HostModel, ModelError};
use crate::workspace::runtime::{
    AgentAuthority, AgentEnrichment, AgentPhase, NotificationOrigin, ProcessIdentity, ProgressState,
};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::path::PathBuf;
use tokio::sync::{mpsc, oneshot};
use uuid::Uuid;

const ACTOR_QUEUE_CAPACITY: usize = 256;

#[derive(Clone, Debug)]
pub struct HostConfiguration {
    pub host_id: HostId,
    pub epoch: Uuid,
    pub build: BuildIdentity,
    pub capabilities: Vec<String>,
    pub command_cache_capacity: usize,
    pub terminal_environment: Option<TerminalEnvironment>,
    pub machine_environment: Option<MachineEnvironment>,
}

#[derive(Clone, Debug)]
pub struct HostStatus {
    pub host_id: HostId,
    pub epoch: Uuid,
    pub build: BuildIdentity,
    pub revision: u64,
    pub structure_revision: u64,
    pub capabilities: Vec<String>,
}

#[derive(Clone)]
pub struct HostActor {
    sender: mpsc::Sender<ActorMessage>,
    terminals: TerminalRegistry,
    machine_services: Option<MachineServices>,
}

#[derive(Clone, Copy)]
pub(crate) struct RequestContext {
    pub connection_id: Uuid,
    pub client_id: ClientId,
    pub role: ClientRole,
    pub peer_process_id: Option<u32>,
}

impl HostActor {
    pub fn spawn(configuration: HostConfiguration) -> Self {
        let workspace = Workspace::new(
            SpaceId(Uuid::from_u128(1)),
            WindowId(Uuid::from_u128(2)),
            "Space 1".into(),
        );
        let document = DurableDocument::new(configuration.host_id, workspace, Vec::new());
        Self::spawn_with_document(configuration, document, None)
    }

    pub fn spawn_with_document(
        configuration: HostConfiguration,
        document: DurableDocument,
        persistence: Option<PersistenceWorker>,
    ) -> Self {
        let (sender, receiver) = mpsc::channel(ACTOR_QUEUE_CAPACITY);
        let (terminals, mut terminal_events) =
            TerminalRegistry::spawn_with_events(configuration.terminal_environment.clone());
        let event_sender = sender.clone();
        tokio::spawn(async move {
            while let Some(event) = terminal_events.recv().await {
                if event_sender
                    .send(ActorMessage::TerminalEvent(event))
                    .await
                    .is_err()
                {
                    break;
                }
            }
        });
        let model = HostModel::new(document.workspace, document.clients, 2048, 16 * 1024 * 1024)
            .with_epoch(configuration.epoch);
        let machine_services = configuration
            .machine_environment
            .clone()
            .and_then(|environment| MachineServices::new(environment).ok());
        if let Some(services) = machine_services.clone() {
            tokio::spawn(async move {
                services.repair_installed().await;
            });
        }
        tokio::spawn(run(
            configuration,
            terminals.clone(),
            sender.clone(),
            model,
            document.settings,
            persistence,
            receiver,
        ));
        Self {
            sender,
            terminals,
            machine_services,
        }
    }

    pub(crate) fn terminals(&self) -> &TerminalRegistry {
        &self.terminals
    }

    pub async fn status(&self) -> Result<HostStatus, ProtocolError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ActorMessage::Status { reply })
            .await
            .map_err(|_| internal_error())?;
        response.await.map_err(|_| internal_error())
    }

    pub async fn ensure_client(&self, client_id: ClientId) -> Result<(), ProtocolError> {
        let (reply, response) = oneshot::channel();
        self.sender
            .send(ActorMessage::EnsureClient { client_id, reply })
            .await
            .map_err(|_| internal_error())?;
        response.await.map_err(|_| internal_error())
    }

    pub async fn restore_terminal(
        &self,
        pane_id: PaneId,
        spec: SpawnSpec,
    ) -> Result<(), TerminalError> {
        match self.terminals.create_with_id(pane_id, spec).await {
            Ok(info) => self
                .sender
                .send(ActorMessage::SpawnFinished {
                    pane_id,
                    result: Ok(info),
                })
                .await
                .map_err(|_| TerminalError::Stopped),
            Err(error) => {
                let _ = self
                    .sender
                    .send(ActorMessage::SpawnFinished {
                        pane_id,
                        result: Err(error.to_string()),
                    })
                    .await;
                Err(error)
            }
        }
    }

    pub(crate) async fn execute(
        &self,
        context: RequestContext,
        command_id: CommandId,
        method: String,
        params: Value,
    ) -> HostControl {
        if MachineServices::handles(&method) {
            return match &self.machine_services {
                Some(services) => match services.execute(context.role, &method, params).await {
                    Ok(value) => result(command_id, value),
                    Err(error) => machine_error(command_id, error),
                },
                None => error(
                    Some(command_id),
                    ProtocolErrorCode::CapabilityUnavailable,
                    Value::Null,
                ),
            };
        }
        let (reply, response) = oneshot::channel();
        if self
            .sender
            .send(ActorMessage::Execute {
                context,
                command_id,
                method,
                params,
                reply,
            })
            .await
            .is_err()
        {
            return HostControl::Error {
                command_id: Some(command_id),
                error: internal_error(),
            };
        }
        response.await.unwrap_or_else(|_| HostControl::Error {
            command_id: Some(command_id),
            error: internal_error(),
        })
    }

    pub fn disconnect(&self, connection_id: Uuid) {
        let _ = self
            .sender
            .try_send(ActorMessage::Disconnected { connection_id });
    }
}

enum ActorMessage {
    Status {
        reply: oneshot::Sender<HostStatus>,
    },
    EnsureClient {
        client_id: ClientId,
        reply: oneshot::Sender<()>,
    },
    Execute {
        context: RequestContext,
        command_id: CommandId,
        method: String,
        params: Value,
        reply: oneshot::Sender<HostControl>,
    },
    Disconnected {
        connection_id: Uuid,
    },
    SpawnFinished {
        pane_id: PaneId,
        result: Result<PaneInfo, String>,
    },
    TerminalEvent(TerminalRuntimeEvent),
    ProcessScanned {
        pane_id: PaneId,
        generation: u64,
        scan: Option<ProcessScan>,
    },
    EnrichmentScanned {
        pane_id: PaneId,
        generation: u64,
        source_process: ProcessIdentity,
        enrichment: Box<AgentEnrichment>,
    },
}

#[derive(Clone, Copy, Debug, Eq, Hash, PartialEq)]
struct CommandKey {
    client_id: ClientId,
    command_id: CommandId,
}

struct ActorState {
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    sender: mpsc::Sender<ActorMessage>,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    command_results: HashMap<CommandKey, HostControl>,
    command_order: VecDeque<CommandKey>,
    close_grants: BTreeMap<PaneId, CloseGrant>,
    detection_catalog: Option<DetectionCatalog>,
    process_scans: BTreeMap<PaneId, ProcessScanState>,
    screen_revisions: BTreeMap<PaneId, u64>,
    notification_sink: Option<NotificationLease>,
    enrichment_subscriptions: BTreeMap<Uuid, EnrichmentSubscription>,
    enrichment_scans: BTreeMap<PaneId, EnrichmentScanState>,
}

async fn run(
    configuration: HostConfiguration,
    terminals: TerminalRegistry,
    sender: mpsc::Sender<ActorMessage>,
    model: HostModel,
    settings: BTreeMap<String, Value>,
    persistence: Option<PersistenceWorker>,
    mut receiver: mpsc::Receiver<ActorMessage>,
) {
    let mut state = ActorState {
        configuration,
        terminals,
        sender,
        model,
        settings,
        persistence,
        command_results: HashMap::new(),
        command_order: VecDeque::new(),
        close_grants: BTreeMap::new(),
        detection_catalog: DetectionCatalog::embedded().ok(),
        process_scans: BTreeMap::new(),
        screen_revisions: BTreeMap::new(),
        notification_sink: None,
        enrichment_subscriptions: BTreeMap::new(),
        enrichment_scans: BTreeMap::new(),
    };
    let mut enrichment_refresh = tokio::time::interval(std::time::Duration::from_secs(10));
    enrichment_refresh.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        let message = tokio::select! {
            message = receiver.recv() => message,
            _ = enrichment_refresh.tick() => {
                state.refresh_enrichments();
                continue;
            }
        };
        let Some(message) = message else { break };
        match message {
            ActorMessage::Status { reply } => {
                let _ = reply.send(state.status());
            }
            ActorMessage::EnsureClient { client_id, reply } => {
                if state.model.ensure_client(client_id) {
                    state.persist().await;
                }
                let _ = reply.send(());
            }
            ActorMessage::Execute {
                context,
                command_id,
                method,
                params,
                reply,
            } => {
                let result = state.execute(context, command_id, method, params).await;
                let _ = reply.send(result);
            }
            ActorMessage::Disconnected { connection_id } => {
                state.disconnected(connection_id);
            }
            ActorMessage::SpawnFinished { pane_id, result } => {
                state.spawn_finished(pane_id, result).await;
            }
            ActorMessage::TerminalEvent(event) => {
                state.terminal_event(event).await;
            }
            ActorMessage::ProcessScanned {
                pane_id,
                generation,
                scan,
            } => {
                state.process_scanned(pane_id, generation, scan).await;
            }
            ActorMessage::EnrichmentScanned {
                pane_id,
                generation,
                source_process,
                enrichment,
            } => state.enrichment_scanned(pane_id, generation, source_process, *enrichment),
        }
    }
}

impl ActorState {
    fn status(&self) -> HostStatus {
        HostStatus {
            host_id: self.configuration.host_id,
            epoch: self.configuration.epoch,
            build: self.configuration.build.clone(),
            revision: self.model.revision(),
            structure_revision: self.model.structure_revision(),
            capabilities: self.configuration.capabilities.clone(),
        }
    }

    async fn execute(
        &mut self,
        context: RequestContext,
        command_id: CommandId,
        method: String,
        params: Value,
    ) -> HostControl {
        let RequestContext {
            connection_id,
            client_id,
            role,
            peer_process_id,
        } = context;
        let key = CommandKey {
            client_id,
            command_id,
        };
        if let Some(result) = self.command_results.get(&key) {
            return result.clone();
        }
        let result = if role == ClientRole::Hook && method != "agent.session_start" {
            error(
                Some(command_id),
                ProtocolErrorCode::PermissionDenied,
                json!({"method": method}),
            )
        } else {
            match method.as_str() {
                "agent.session_start" if role == ClientRole::Hook => {
                    match serde_json::from_value::<SessionStartRequest>(params) {
                        Ok(request) => match self.session_start(peer_process_id, request) {
                            Ok(accepted) => result(command_id, json!({"accepted": accepted})),
                            Err(code) => error(Some(command_id), code, Value::Null),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "agent.session_start" => error(
                    Some(command_id),
                    ProtocolErrorCode::PermissionDenied,
                    Value::Null,
                ),
                "agent.fork_session" if matches!(role, ClientRole::Ui | ClientRole::Cli) => {
                    match serde_json::from_value::<ForkAgentRequest>(params) {
                        Ok(request) => match self.fork_agent_session(request).await {
                            Ok(forked) => result(command_id, forked),
                            Err(ApplyWorkspaceError::Model(model_error)) => {
                                workspace_error(command_id, model_error)
                            }
                            Err(ApplyWorkspaceError::SpawnSpecs) => {
                                error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                            }
                            Err(ApplyWorkspaceError::ConfirmationRequired(_)) => {
                                error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                            }
                            Err(ApplyWorkspaceError::Unsupported) => error(
                                Some(command_id),
                                ProtocolErrorCode::CapabilityUnavailable,
                                Value::Null,
                            ),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "state.snapshot" if params.is_null() => {
                    result(command_id, self.model.snapshot(client_id))
                }
                "state.snapshot" => error(
                    Some(command_id),
                    ProtocolErrorCode::InvalidRequest,
                    json!({"method": method}),
                ),
                "state.subscribe" => match serde_json::from_value::<SubscribeRequest>(params) {
                    Ok(request) => result(
                        command_id,
                        self.model.subscribe(client_id, request.after_revision),
                    ),
                    Err(decode_error) => invalid_request(command_id, decode_error),
                },
                "workspace.apply" => match serde_json::from_value::<ApplyRequest>(params) {
                    Ok(request)
                        if request
                            .command
                            .client_id()
                            .is_some_and(|target| target != client_id) =>
                    {
                        error(
                            Some(command_id),
                            ProtocolErrorCode::PermissionDenied,
                            Value::Null,
                        )
                    }
                    Ok(request) => match self.apply_workspace(request).await {
                        Ok(applied) => result(command_id, applied),
                        Err(ApplyWorkspaceError::Model(model_error)) => {
                            workspace_error(command_id, model_error)
                        }
                        Err(ApplyWorkspaceError::SpawnSpecs) => error(
                            Some(command_id),
                            ProtocolErrorCode::InvalidRequest,
                            json!({"reason": "spawn specs do not match created panes"}),
                        ),
                        Err(ApplyWorkspaceError::ConfirmationRequired(pane_ids)) => error(
                            Some(command_id),
                            ProtocolErrorCode::ConfirmationRequired,
                            json!({
                                "pane_ids": pane_ids,
                                "structure_revision": self.model.structure_revision()
                            }),
                        ),
                        Err(ApplyWorkspaceError::Unsupported) => {
                            error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                        }
                    },
                    Err(decode_error) => invalid_request(command_id, decode_error),
                },
                "workspace.prepare_close" => {
                    match serde_json::from_value::<PrepareCloseRequest>(params) {
                        Ok(request) => match self.prepare_close(&request.command) {
                            Ok(confirmation) => result(command_id, confirmation),
                            Err(model_error) => workspace_error(command_id, model_error),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "notification.claim_sink" if role == ClientRole::Ui && params.is_null() => {
                    match self.claim_notification_sink(connection_id, client_id) {
                        Some(lease) => result(command_id, lease),
                        None => error(
                            Some(command_id),
                            ProtocolErrorCode::CapabilityUnavailable,
                            Value::Null,
                        ),
                    }
                }
                "notification.next" if role == ClientRole::Ui => {
                    match serde_json::from_value::<NotificationLeaseRequest>(params) {
                        Ok(request) => {
                            match self.next_notification(connection_id, client_id, request.lease_id)
                            {
                                Ok(notification) => result(command_id, notification),
                                Err(code) => error(Some(command_id), code, Value::Null),
                            }
                        }
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "notification.ack" if role == ClientRole::Ui => {
                    match serde_json::from_value::<NotificationAckRequest>(params) {
                        Ok(request) => {
                            match self.ack_notification(connection_id, client_id, request) {
                                Ok(()) => {
                                    self.persist().await;
                                    result(command_id, json!({"acknowledged": true}))
                                }
                                Err(code) => error(Some(command_id), code, Value::Null),
                            }
                        }
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "notification.release_sink" if role == ClientRole::Ui => {
                    match serde_json::from_value::<NotificationLeaseRequest>(params) {
                        Ok(request) => match self.release_notification_sink(
                            connection_id,
                            client_id,
                            request.lease_id,
                        ) {
                            Ok(()) => result(command_id, json!({"released": true})),
                            Err(code) => error(Some(command_id), code, Value::Null),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "enrichment.subscribe" if role == ClientRole::Ui => {
                    match serde_json::from_value::<EnrichmentSubscribeRequest>(params) {
                        Ok(request) => match self.subscribe_enrichment(
                            connection_id,
                            client_id,
                            request.pane_id,
                        ) {
                            Ok(subscription) => result(command_id, subscription),
                            Err(code) => error(Some(command_id), code, Value::Null),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "enrichment.unsubscribe" if role == ClientRole::Ui => {
                    match serde_json::from_value::<EnrichmentUnsubscribeRequest>(params) {
                        Ok(request) => match self.unsubscribe_enrichment(
                            connection_id,
                            client_id,
                            request.subscription_id,
                        ) {
                            Ok(()) => result(command_id, json!({"unsubscribed": true})),
                            Err(code) => error(Some(command_id), code, Value::Null),
                        },
                        Err(decode_error) => invalid_request(command_id, decode_error),
                    }
                }
                "terminal.list" if params.is_null() => match self.terminals.list().await {
                    Ok(panes) => result(command_id, panes),
                    Err(error) => terminal_error(command_id, error),
                },
                "terminal.close" => match serde_json::from_value::<PaneRequest>(params) {
                    Ok(request) => match self
                        .apply_workspace(ApplyRequest {
                            command: Command::ClosePane {
                                pane_id: request.pane_id,
                            },
                            expected_structure_revision: None,
                            spawn_specs: BTreeMap::new(),
                            confirmation_tokens: request
                                .confirmation_token
                                .map(|token| BTreeMap::from([(request.pane_id, token)]))
                                .unwrap_or_default(),
                        })
                        .await
                    {
                        Ok(applied) => result(command_id, applied),
                        Err(ApplyWorkspaceError::Model(model_error)) => {
                            workspace_error(command_id, model_error)
                        }
                        Err(ApplyWorkspaceError::SpawnSpecs) => {
                            error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                        }
                        Err(ApplyWorkspaceError::ConfirmationRequired(pane_ids)) => error(
                            Some(command_id),
                            ProtocolErrorCode::ConfirmationRequired,
                            json!({
                                "pane_ids": pane_ids,
                                "structure_revision": self.model.structure_revision()
                            }),
                        ),
                        Err(ApplyWorkspaceError::Unsupported) => {
                            error(Some(command_id), ProtocolErrorCode::Internal, Value::Null)
                        }
                    },
                    Err(decode_error) => error(
                        Some(command_id),
                        ProtocolErrorCode::InvalidRequest,
                        json!({"reason": decode_error.to_string()}),
                    ),
                },
                _ => error(
                    Some(command_id),
                    ProtocolErrorCode::MethodNotFound,
                    json!({"method": method}),
                ),
            }
        };
        self.remember(key, result.clone());
        result
    }

    fn remember(&mut self, key: CommandKey, result: HostControl) {
        let capacity = self.configuration.command_cache_capacity.max(1);
        while self.command_order.len() >= capacity {
            if let Some(expired) = self.command_order.pop_front() {
                self.command_results.remove(&expired);
            }
        }
        self.command_order.push_back(key);
        self.command_results.insert(key, result);
    }

    fn session_start(
        &mut self,
        peer_process_id: Option<u32>,
        request: SessionStartRequest,
    ) -> Result<bool, ProtocolErrorCode> {
        let valid_kind = !request.kind.trim().is_empty()
            && request.kind.len() <= 64
            && self
                .detection_catalog
                .as_ref()
                .is_some_and(|catalog| catalog.has_kind(&request.kind));
        let valid_session =
            !request.native_session_id.trim().is_empty() && request.native_session_id.len() <= 1024;
        let valid_arguments = request.command_arguments.as_ref().is_none_or(|arguments| {
            arguments.len() <= 128
                && arguments
                    .iter()
                    .map(String::len)
                    .try_fold(0_usize, usize::checked_add)
                    .is_some_and(|bytes| bytes <= 64 * 1024)
        });
        if !valid_kind || !valid_session || !valid_arguments {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        let facts = self
            .model
            .pane_facts()
            .get(&request.pane_id)
            .ok_or(ProtocolErrorCode::NotFound)?;
        let process = facts
            .foreground_process
            .as_ref()
            .ok_or(ProtocolErrorCode::PermissionDenied)?;
        if !peer_process_id.is_some_and(|process_id| is_descendant(process_id, process)) {
            return Err(ProtocolErrorCode::PermissionDenied);
        }
        if let (Some(reported), Some(observed)) =
            (&request.working_directory, &facts.current_directory)
            && reported != observed
        {
            return Err(ProtocolErrorCode::PermissionDenied);
        }
        Ok(self.model.agent_session_start(
            request.pane_id,
            request.kind,
            request.native_session_id,
            request.working_directory,
            request.command_arguments,
        ))
    }

    async fn fork_agent_session(
        &mut self,
        request: ForkAgentRequest,
    ) -> Result<ForkAgentResult, ApplyWorkspaceError> {
        let fact = self
            .model
            .agent_facts()
            .get(&request.source_pane_id)
            .cloned()
            .ok_or(ApplyWorkspaceError::Unsupported)?;
        let kind = fact.kind.ok_or(ApplyWorkspaceError::Unsupported)?;
        let session_id = fact
            .native_session_id
            .ok_or(ApplyWorkspaceError::Unsupported)?;
        let mut argv = self
            .detection_catalog
            .as_ref()
            .and_then(|catalog| catalog.fork_command(&kind, &session_id))
            .ok_or(ApplyWorkspaceError::Unsupported)?;
        argv[0] = fact
            .process_identity
            .executable
            .to_string_lossy()
            .into_owned();
        let (window_id, space_id, source_tab_id, source_placement) = self
            .pane_location(request.source_pane_id)
            .ok_or(ApplyWorkspaceError::Unsupported)?;
        let pane_id = PaneId(Uuid::new_v4());
        let mut tab_id = None;
        let command = match request.placement {
            ForkPlacement::AdjacentTab => {
                let created_tab_id = TabId(Uuid::new_v4());
                tab_id = Some(created_tab_id);
                let placement = match source_placement {
                    Placement::Root(mut placement) => {
                        placement.index = placement.index.saturating_add(1);
                        Placement::Root(placement)
                    }
                    Placement::Group {
                        group_id,
                        mut index,
                    } => {
                        index = index.saturating_add(1);
                        Placement::Group { group_id, index }
                    }
                };
                Command::CreateTab {
                    window_id,
                    space_id,
                    tab_id: created_tab_id,
                    pane_id,
                    placement,
                    title: None,
                    restart_directory: fact.working_directory.clone(),
                }
            }
            ForkPlacement::SplitRight | ForkPlacement::SplitDown => Command::SplitPane {
                window_id,
                space_id,
                tab_id: source_tab_id,
                target_pane_id: request.source_pane_id,
                pane_id,
                split_id: SplitId(Uuid::new_v4()),
                direction: if request.placement == ForkPlacement::SplitRight {
                    SplitDirection::Horizontal
                } else {
                    SplitDirection::Vertical
                },
                placement: SplitPlacement::After,
                restart_directory: fact.working_directory.clone(),
            },
        };
        let applied = self
            .apply_workspace(ApplyRequest {
                command,
                expected_structure_revision: request.expected_structure_revision,
                spawn_specs: BTreeMap::from([(
                    pane_id,
                    SpawnSpec {
                        argv,
                        cwd: fact.working_directory,
                        environment: Vec::new(),
                        rows: 24,
                        columns: 80,
                        pixel_width: 800,
                        pixel_height: 480,
                    },
                )]),
                confirmation_tokens: BTreeMap::new(),
            })
            .await?;
        Ok(ForkAgentResult {
            pane_id,
            tab_id,
            revision: applied.revision,
            structure_revision: applied.structure_revision,
        })
    }

    fn pane_location(&self, pane_id: PaneId) -> Option<(WindowId, SpaceId, TabId, Placement)> {
        for (window_id, window) in &self.model.workspace().windows {
            for (space_id, content) in &window.spaces {
                for (tab_id, tab) in &content.tabs {
                    if tab.root.contains_pane(pane_id) {
                        return Some((
                            *window_id,
                            *space_id,
                            *tab_id,
                            content.location(ItemId::Tab(*tab_id))?,
                        ));
                    }
                }
            }
        }
        None
    }

    fn claim_notification_sink(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
    ) -> Option<NotificationLeaseGrant> {
        if let Some(lease) = &self.notification_sink {
            return (lease.connection_id == connection_id && lease.client_id == client_id)
                .then(|| lease.grant());
        }
        let floor_attention_revision = self
            .model
            .notifications()
            .back()
            .map_or(0, |notification| notification.attention_revision);
        let lease = NotificationLease {
            id: Uuid::new_v4(),
            connection_id,
            client_id,
            floor_attention_revision,
            cursor: floor_attention_revision,
            offered: None,
        };
        let grant = lease.grant();
        self.notification_sink = Some(lease);
        Some(grant)
    }

    fn next_notification(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
        lease_id: Uuid,
    ) -> Result<Option<crate::workspace::runtime::NotificationRecord>, ProtocolErrorCode> {
        let lease = self
            .notification_sink
            .as_ref()
            .filter(|lease| lease.matches(connection_id, client_id, lease_id))
            .ok_or(ProtocolErrorCode::PermissionDenied)?;
        let offered = lease.offered;
        let cursor = lease.cursor;
        let next = offered
            .and_then(|offered| {
                self.model
                    .notifications()
                    .iter()
                    .find(|notification| notification.id == offered)
                    .cloned()
            })
            .or_else(|| {
                self.model
                    .notifications()
                    .iter()
                    .find(|notification| notification.attention_revision > cursor)
                    .cloned()
            });
        if let Some(lease) = self.notification_sink.as_mut() {
            lease.offered = next.as_ref().map(|notification| notification.id);
        }
        Ok(next)
    }

    fn ack_notification(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
        request: NotificationAckRequest,
    ) -> Result<(), ProtocolErrorCode> {
        let notification = self
            .model
            .notifications()
            .iter()
            .find(|notification| notification.id == request.notification_id)
            .cloned()
            .ok_or(ProtocolErrorCode::NotFound)?;
        let lease = self
            .notification_sink
            .as_mut()
            .filter(|lease| lease.matches(connection_id, client_id, request.lease_id))
            .ok_or(ProtocolErrorCode::PermissionDenied)?;
        if lease.offered != Some(request.notification_id) {
            return Err(ProtocolErrorCode::InvalidRequest);
        }
        lease.cursor = lease.cursor.max(notification.attention_revision);
        lease.offered = None;
        self.model
            .apply(
                Command::MarkNotificationSeen {
                    client_id,
                    pane_id: notification.pane_id,
                    revision: notification.attention_revision,
                },
                None,
            )
            .map_err(|_| ProtocolErrorCode::Internal)?;
        Ok(())
    }

    fn release_notification_sink(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
        lease_id: Uuid,
    ) -> Result<(), ProtocolErrorCode> {
        if !self
            .notification_sink
            .as_ref()
            .is_some_and(|lease| lease.matches(connection_id, client_id, lease_id))
        {
            return Err(ProtocolErrorCode::PermissionDenied);
        }
        self.notification_sink = None;
        Ok(())
    }

    fn subscribe_enrichment(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
        pane_id: PaneId,
    ) -> Result<EnrichmentSubscriptionGrant, ProtocolErrorCode> {
        if !self.model.agent_facts().contains_key(&pane_id) {
            return Err(ProtocolErrorCode::NotFound);
        }
        if let Some(subscription) = self.enrichment_subscriptions.values().find(|subscription| {
            subscription.connection_id == connection_id && subscription.pane_id == pane_id
        }) {
            return Ok(EnrichmentSubscriptionGrant {
                subscription_id: subscription.id,
                enrichment: self.model.enrichments().get(&pane_id).cloned(),
            });
        }
        let id = Uuid::new_v4();
        self.enrichment_subscriptions.insert(
            id,
            EnrichmentSubscription {
                id,
                connection_id,
                client_id,
                pane_id,
            },
        );
        self.start_enrichment_scan(pane_id);
        Ok(EnrichmentSubscriptionGrant {
            subscription_id: id,
            enrichment: self.model.enrichments().get(&pane_id).cloned(),
        })
    }

    fn unsubscribe_enrichment(
        &mut self,
        connection_id: Uuid,
        client_id: ClientId,
        subscription_id: Uuid,
    ) -> Result<(), ProtocolErrorCode> {
        let matches = self
            .enrichment_subscriptions
            .get(&subscription_id)
            .is_some_and(|subscription| {
                subscription.connection_id == connection_id && subscription.client_id == client_id
            });
        if !matches {
            return Err(ProtocolErrorCode::PermissionDenied);
        }
        let pane_id = self
            .enrichment_subscriptions
            .remove(&subscription_id)
            .map(|subscription| subscription.pane_id)
            .ok_or(ProtocolErrorCode::NotFound)?;
        self.stop_enrichment_if_idle(pane_id);
        Ok(())
    }

    fn disconnected(&mut self, connection_id: Uuid) {
        if self
            .notification_sink
            .as_ref()
            .is_some_and(|lease| lease.connection_id == connection_id)
        {
            self.notification_sink = None;
        }
        let pane_ids = self
            .enrichment_subscriptions
            .values()
            .filter(|subscription| subscription.connection_id == connection_id)
            .map(|subscription| subscription.pane_id)
            .collect::<std::collections::BTreeSet<_>>();
        self.enrichment_subscriptions
            .retain(|_, subscription| subscription.connection_id != connection_id);
        for pane_id in pane_ids {
            self.stop_enrichment_if_idle(pane_id);
        }
    }

    fn stop_enrichment_if_idle(&mut self, pane_id: PaneId) {
        if !self
            .enrichment_subscriptions
            .values()
            .any(|subscription| subscription.pane_id == pane_id)
        {
            self.enrichment_scans.remove(&pane_id);
            self.model.clear_enrichment(pane_id);
        }
    }

    fn refresh_enrichments(&mut self) {
        let pane_ids = self
            .enrichment_subscriptions
            .values()
            .map(|subscription| subscription.pane_id)
            .collect::<std::collections::BTreeSet<_>>();
        for pane_id in pane_ids {
            self.start_enrichment_scan(pane_id);
        }
    }

    fn start_enrichment_scan(&mut self, pane_id: PaneId) {
        let Some(facts) = self.model.pane_facts().get(&pane_id) else {
            return;
        };
        let Some(source_process) = facts.foreground_process.clone() else {
            return;
        };
        let working_directory = facts.current_directory.clone();
        let state = self.enrichment_scans.entry(pane_id).or_default();
        if state.running {
            state.pending = true;
            return;
        }
        state.running = true;
        state.pending = false;
        state.generation = state.generation.saturating_add(1);
        let generation = state.generation;
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let enrichment =
                scan_enrichment(pane_id, source_process.clone(), working_directory).await;
            let _ = sender
                .send(ActorMessage::EnrichmentScanned {
                    pane_id,
                    generation,
                    source_process,
                    enrichment: Box::new(enrichment),
                })
                .await;
        });
    }

    fn enrichment_scanned(
        &mut self,
        pane_id: PaneId,
        generation: u64,
        source_process: ProcessIdentity,
        enrichment: AgentEnrichment,
    ) {
        let Some(state) = self.enrichment_scans.get_mut(&pane_id) else {
            return;
        };
        if state.generation != generation {
            return;
        }
        state.running = false;
        let pending = state.pending;
        state.pending = false;
        self.model
            .enrichment_scanned(pane_id, &source_process, enrichment);
        if pending {
            self.start_enrichment_scan(pane_id);
        }
    }

    async fn persist(&self) {
        if let Some(persistence) = &self.persistence {
            let mut document = DurableDocument::new(
                self.configuration.host_id,
                self.model.workspace().clone(),
                self.model.clients().to_vec(),
            );
            document.settings = self.settings.clone();
            let _ = persistence.save(document).await;
        }
    }

    async fn apply_workspace(
        &mut self,
        mut request: ApplyRequest,
    ) -> Result<crate::workspace::replay::ApplyResult, ApplyWorkspaceError> {
        let expected: std::collections::BTreeSet<_> =
            request.command.created_pane_id().into_iter().collect();
        if request
            .spawn_specs
            .keys()
            .copied()
            .collect::<std::collections::BTreeSet<_>>()
            != expected
        {
            return Err(ApplyWorkspaceError::SpawnSpecs);
        }
        let closing =
            closing_pane_ids(self.model.workspace(), &request.command).map_err(ModelError::from)?;
        let required: Vec<_> = closing
            .iter()
            .filter(|pane_id| {
                self.model
                    .pane_facts()
                    .get(pane_id)
                    .and_then(|facts| facts.pid)
                    .is_some()
            })
            .copied()
            .collect();
        let invalid: Vec<_> = required
            .iter()
            .filter(|pane_id| {
                let token = request.confirmation_tokens.get(pane_id);
                let pid = self.model.pane_facts()[pane_id].pid;
                !self.close_grants.get(pane_id).is_some_and(|grant| {
                    Some(&grant.token) == token
                        && grant.structure_revision == self.model.structure_revision()
                        && grant.pid == pid
                })
            })
            .copied()
            .collect();
        if !invalid.is_empty() {
            return Err(ApplyWorkspaceError::ConfirmationRequired(invalid));
        }
        let applied = self
            .model
            .apply(request.command, request.expected_structure_revision)?;
        for pane_id in required {
            self.close_grants.remove(&pane_id);
        }
        let structure_revision = self.model.structure_revision();
        self.close_grants
            .retain(|_, grant| grant.structure_revision == structure_revision);
        for pane_id in &applied.starting_pane_ids {
            let spec = request
                .spawn_specs
                .remove(pane_id)
                .ok_or(ApplyWorkspaceError::SpawnSpecs)?;
            self.schedule_spawn(*pane_id, spec);
        }
        for pane_id in &applied.closing_pane_ids {
            let terminals = self.terminals.clone();
            let pane_id = *pane_id;
            tokio::spawn(async move {
                let _ = terminals.close(pane_id).await;
            });
        }
        self.persist().await;
        Ok(applied)
    }

    fn prepare_close(&mut self, command: &Command) -> Result<CloseConfirmation, ModelError> {
        let pane_ids = closing_pane_ids(self.model.workspace(), command)?;
        let structure_revision = self.model.structure_revision();
        let mut processes = BTreeMap::new();
        let mut tokens = BTreeMap::new();
        for pane_id in pane_ids {
            let Some(pid) = self
                .model
                .pane_facts()
                .get(&pane_id)
                .and_then(|facts| facts.pid)
            else {
                continue;
            };
            let token = Uuid::new_v4();
            self.close_grants.insert(
                pane_id,
                CloseGrant {
                    token,
                    structure_revision,
                    pid: Some(pid),
                },
            );
            processes.insert(pane_id, pid);
            tokens.insert(pane_id, token);
        }
        Ok(CloseConfirmation {
            structure_revision,
            processes,
            tokens,
        })
    }

    fn schedule_spawn(&self, pane_id: PaneId, spec: SpawnSpec) {
        let terminals = self.terminals.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let spawn = terminals
                .create_with_id(pane_id, spec)
                .await
                .map_err(|error| error.to_string());
            let _ = sender
                .send(ActorMessage::SpawnFinished {
                    pane_id,
                    result: spawn,
                })
                .await;
        });
    }

    async fn spawn_finished(&mut self, pane_id: PaneId, spawn: Result<PaneInfo, String>) {
        match spawn {
            Ok(info) if self.model.terminal_running(pane_id, info.pid) => {}
            Ok(_) => {
                let terminals = self.terminals.clone();
                tokio::spawn(async move {
                    let _ = terminals.close(pane_id).await;
                });
            }
            Err(failure) => self.model.terminal_failed(pane_id, failure),
        }
        self.persist().await;
    }

    async fn terminal_event(&mut self, event: TerminalRuntimeEvent) {
        match event {
            TerminalRuntimeEvent::FactsChanged {
                pane_id,
                title,
                current_directory,
                progress,
            } => {
                self.model.terminal_facts(
                    pane_id,
                    title.clone(),
                    current_directory,
                    progress.clone(),
                );
                if let Some(Some(title)) = title
                    && let Some(kind) = self
                        .model
                        .agent_facts()
                        .get(&pane_id)
                        .and_then(|fact| fact.kind.as_deref())
                    && let Some(detection) = self
                        .detection_catalog
                        .as_ref()
                        .and_then(|catalog| catalog.detect_title(kind, &title))
                    && !detection.skip_state_update
                {
                    self.model.detect_agent_phase(
                        pane_id,
                        phase(&detection.phase),
                        AgentAuthority::Osc,
                        detection.rule_id,
                    );
                }
                if let Some(progress) = progress {
                    let progress_source = progress.as_ref().map_or_else(
                        || "4;0;".to_owned(),
                        |progress| {
                            let state = match progress.state {
                                ProgressState::Set => 1,
                                ProgressState::Error => 2,
                                ProgressState::Indeterminate => 3,
                                ProgressState::Paused => 4,
                            };
                            format!(
                                "4;{state};{}",
                                progress
                                    .percent
                                    .map_or_else(String::new, |value| value.to_string())
                            )
                        },
                    );
                    let inferred_phase = match progress {
                        Some(progress)
                            if matches!(
                                progress.state,
                                ProgressState::Set | ProgressState::Indeterminate
                            ) =>
                        {
                            AgentPhase::Working
                        }
                        Some(progress) if progress.state == ProgressState::Error => {
                            AgentPhase::Blocked
                        }
                        Some(_) => AgentPhase::Unknown,
                        None => AgentPhase::Idle,
                    };
                    let detection = self
                        .model
                        .agent_facts()
                        .get(&pane_id)
                        .and_then(|fact| fact.kind.as_deref())
                        .and_then(|kind| {
                            self.detection_catalog
                                .as_ref()
                                .and_then(|catalog| catalog.detect_progress(kind, &progress_source))
                        });
                    if !detection
                        .as_ref()
                        .is_some_and(|value| value.skip_state_update)
                    {
                        self.model.detect_agent_phase(
                            pane_id,
                            detection
                                .as_ref()
                                .map_or(inferred_phase, |value| phase(&value.phase)),
                            AgentAuthority::Osc,
                            detection.map_or_else(|| "osc_progress".into(), |value| value.rule_id),
                        );
                    }
                }
            }
            TerminalRuntimeEvent::ProcessGroupObserved {
                pane_id,
                process_group_id,
            } => self.observe_process_group(pane_id, process_group_id),
            TerminalRuntimeEvent::Bell { pane_id } => self.model.notify(
                pane_id,
                NotificationOrigin::Bell,
                None,
                None,
                timestamp_millis(),
            ),
            TerminalRuntimeEvent::DesktopNotification {
                pane_id,
                title,
                body,
            } => self.model.notify(
                pane_id,
                NotificationOrigin::Desktop,
                title,
                Some(body),
                timestamp_millis(),
            ),
            TerminalRuntimeEvent::ScreenChanged {
                pane_id,
                source_revision,
                text,
            } => {
                let previous = self.screen_revisions.entry(pane_id).or_default();
                if source_revision > *previous {
                    *previous = source_revision;
                    let detection = self
                        .model
                        .agent_facts()
                        .get(&pane_id)
                        .filter(|fact| fact.authority != AgentAuthority::Osc)
                        .and_then(|fact| fact.kind.as_deref())
                        .and_then(|kind| {
                            self.detection_catalog
                                .as_ref()
                                .and_then(|catalog| catalog.detect_screen(kind, &text))
                        });
                    if let Some(detection) = detection
                        && !detection.skip_state_update
                    {
                        self.model.detect_agent_phase(
                            pane_id,
                            phase(&detection.phase),
                            AgentAuthority::Screen,
                            detection.rule_id,
                        );
                    }
                }
            }
            TerminalRuntimeEvent::Exited {
                pane_id,
                code,
                signal,
            } => {
                self.screen_revisions.remove(&pane_id);
                let _ = self.model.terminal_exited(pane_id, code, signal);
            }
        }
        self.persist().await;
    }

    fn observe_process_group(&mut self, pane_id: PaneId, process_group_id: Option<u32>) {
        let Some(process_group_id) = process_group_id else {
            self.model.process_lost(pane_id);
            return;
        };
        let state = self.process_scans.entry(pane_id).or_default();
        state.pending = Some(process_group_id);
        if !state.running {
            self.start_process_scan(pane_id);
        }
    }

    fn start_process_scan(&mut self, pane_id: PaneId) {
        let Some(catalog) = self.detection_catalog.clone() else {
            return;
        };
        let Some(state) = self.process_scans.get_mut(&pane_id) else {
            return;
        };
        let Some(process_group_id) = state.pending.take() else {
            return;
        };
        state.running = true;
        state.generation = state.generation.saturating_add(1);
        let generation = state.generation;
        let sender = self.sender.clone();
        tokio::spawn(async move {
            let scan =
                tokio::task::spawn_blocking(move || scan_process_group(process_group_id, &catalog))
                    .await
                    .ok()
                    .flatten();
            let _ = sender
                .send(ActorMessage::ProcessScanned {
                    pane_id,
                    generation,
                    scan,
                })
                .await;
        });
    }

    async fn process_scanned(
        &mut self,
        pane_id: PaneId,
        generation: u64,
        scan: Option<ProcessScan>,
    ) {
        let pending = {
            let Some(state) = self.process_scans.get_mut(&pane_id) else {
                return;
            };
            if state.generation != generation {
                return;
            }
            state.running = false;
            state.pending.is_some()
        };
        match scan {
            Some(scan) => self.model.process_scanned(pane_id, scan),
            None => self.model.process_lost(pane_id),
        }
        if pending {
            self.start_process_scan(pane_id);
        }
        self.persist().await;
    }
}

#[derive(Default)]
struct ProcessScanState {
    generation: u64,
    running: bool,
    pending: Option<u32>,
}

struct NotificationLease {
    id: Uuid,
    connection_id: Uuid,
    client_id: ClientId,
    floor_attention_revision: u64,
    cursor: u64,
    offered: Option<Uuid>,
}

struct EnrichmentSubscription {
    id: Uuid,
    connection_id: Uuid,
    client_id: ClientId,
    pane_id: PaneId,
}

#[derive(Default)]
struct EnrichmentScanState {
    generation: u64,
    running: bool,
    pending: bool,
}

#[derive(serde::Serialize)]
struct EnrichmentSubscriptionGrant {
    subscription_id: Uuid,
    enrichment: Option<AgentEnrichment>,
}

impl NotificationLease {
    fn matches(&self, connection_id: Uuid, client_id: ClientId, lease_id: Uuid) -> bool {
        self.id == lease_id && self.connection_id == connection_id && self.client_id == client_id
    }

    fn grant(&self) -> NotificationLeaseGrant {
        NotificationLeaseGrant {
            lease_id: self.id,
            after_attention_revision: self.floor_attention_revision,
        }
    }
}

#[derive(Clone, serde::Serialize)]
struct NotificationLeaseGrant {
    lease_id: Uuid,
    after_attention_revision: u64,
}

fn phase(value: &str) -> AgentPhase {
    match value {
        "idle" => AgentPhase::Idle,
        "working" => AgentPhase::Working,
        "blocked" => AgentPhase::Blocked,
        _ => AgentPhase::Unknown,
    }
}

fn timestamp_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64)
}

#[derive(serde::Deserialize)]
struct SubscribeRequest {
    after_revision: Option<u64>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SessionStartRequest {
    pane_id: PaneId,
    kind: String,
    native_session_id: String,
    working_directory: Option<PathBuf>,
    command_arguments: Option<Vec<String>>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationLeaseRequest {
    lease_id: Uuid,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationAckRequest {
    lease_id: Uuid,
    notification_id: Uuid,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct EnrichmentSubscribeRequest {
    pane_id: PaneId,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct EnrichmentUnsubscribeRequest {
    subscription_id: Uuid,
}

#[derive(serde::Deserialize)]
struct ApplyRequest {
    command: Command,
    expected_structure_revision: Option<u64>,
    #[serde(default)]
    spawn_specs: BTreeMap<PaneId, SpawnSpec>,
    #[serde(default)]
    confirmation_tokens: BTreeMap<PaneId, Uuid>,
}

#[derive(serde::Deserialize)]
struct PrepareCloseRequest {
    command: Command,
}

#[derive(serde::Serialize)]
struct CloseConfirmation {
    structure_revision: u64,
    processes: BTreeMap<PaneId, u32>,
    tokens: BTreeMap<PaneId, Uuid>,
}

struct CloseGrant {
    token: Uuid,
    structure_revision: u64,
    pid: Option<u32>,
}

enum ApplyWorkspaceError {
    Model(ModelError),
    SpawnSpecs,
    ConfirmationRequired(Vec<PaneId>),
    Unsupported,
}

impl From<ModelError> for ApplyWorkspaceError {
    fn from(error: ModelError) -> Self {
        Self::Model(error)
    }
}

#[derive(serde::Deserialize)]
struct PaneRequest {
    pane_id: PaneId,
    confirmation_token: Option<Uuid>,
}

#[derive(Clone, Copy, serde::Deserialize, Eq, PartialEq)]
#[serde(rename_all = "snake_case")]
enum ForkPlacement {
    AdjacentTab,
    SplitRight,
    SplitDown,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ForkAgentRequest {
    source_pane_id: PaneId,
    placement: ForkPlacement,
    expected_structure_revision: Option<u64>,
}

#[derive(serde::Serialize)]
struct ForkAgentResult {
    pane_id: PaneId,
    tab_id: Option<TabId>,
    revision: u64,
    structure_revision: u64,
}

fn result<T: serde::Serialize>(command_id: CommandId, value: T) -> HostControl {
    match serde_json::to_value(value) {
        Ok(result) => HostControl::Result { command_id, result },
        Err(serialization_error) => error(
            Some(command_id),
            ProtocolErrorCode::Internal,
            json!({"reason": serialization_error.to_string()}),
        ),
    }
}

fn invalid_request(command_id: CommandId, decode_error: serde_json::Error) -> HostControl {
    error(
        Some(command_id),
        ProtocolErrorCode::InvalidRequest,
        json!({"reason": decode_error.to_string()}),
    )
}

fn workspace_error(command_id: CommandId, model_error: ModelError) -> HostControl {
    match model_error {
        ModelError::StaleStructure { expected, actual } => error(
            Some(command_id),
            ProtocolErrorCode::StaleStructure,
            json!({"expected_structure_revision": expected, "current_structure_revision": actual}),
        ),
        ModelError::Reducer(reducer_error) => {
            let code = match reducer_error {
                ReducerError::NotFound => ProtocolErrorCode::NotFound,
                ReducerError::AlreadyExists
                | ReducerError::InvalidName
                | ReducerError::InvalidPlacement
                | ReducerError::DuplicateItem
                | ReducerError::AncestorAndDescendant
                | ReducerError::LastContainer
                | ReducerError::InvalidRatio
                | ReducerError::InvalidState(_) => ProtocolErrorCode::InvalidRequest,
            };
            error(
                Some(command_id),
                code,
                json!({"reason": reducer_error.to_string()}),
            )
        }
    }
}

fn terminal_error(command_id: CommandId, terminal_error: TerminalError) -> HostControl {
    let code = match terminal_error {
        TerminalError::NotFound => ProtocolErrorCode::NotFound,
        TerminalError::AlreadyExists | TerminalError::NotAttached | TerminalError::StaleWriter => {
            ProtocolErrorCode::InvalidRequest
        }
        TerminalError::Spawn(_)
        | TerminalError::InputTooLarge
        | TerminalError::InputQueueFull
        | TerminalError::Stopped
        | TerminalError::Pty(_)
        | TerminalError::State(_) => ProtocolErrorCode::Internal,
    };
    error(
        Some(command_id),
        code,
        json!({"reason": terminal_error.to_string()}),
    )
}

fn machine_error(command_id: CommandId, machine_error: MachineServiceError) -> HostControl {
    let code = match machine_error {
        MachineServiceError::PermissionDenied => ProtocolErrorCode::PermissionDenied,
        MachineServiceError::InvalidRequest => ProtocolErrorCode::InvalidRequest,
        MachineServiceError::NotFound => ProtocolErrorCode::NotFound,
        MachineServiceError::Internal => ProtocolErrorCode::Internal,
    };
    error(Some(command_id), code, Value::Null)
}

fn error(command_id: Option<CommandId>, code: ProtocolErrorCode, details: Value) -> HostControl {
    HostControl::Error {
        command_id,
        error: ProtocolError {
            code,
            details,
            retryable: false,
        },
    }
}

fn internal_error() -> ProtocolError {
    ProtocolError {
        code: ProtocolErrorCode::Internal,
        details: Value::Null,
        retryable: true,
    }
}
