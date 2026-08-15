mod child;
mod projection;
mod root;

use std::{
    collections::{BTreeMap, HashMap, HashSet, VecDeque},
    fmt,
    num::NonZeroUsize,
    path::PathBuf,
};

use self::{
    child::apply_child,
    projection::{session_snapshot, visible_progress_rows},
    root::{accepts, apply_root, bind, promote_root_if_needed},
};
use super::{
    AgentActivityPhase, AgentChild, AgentChildIdentity, AgentDelivery, AgentDeliveryApplication,
    AgentDeliveryReceipt, AgentEvent, AgentEventApplication, AgentForegroundKey,
    AgentForegroundSession, AgentKind, AgentPresentation, AgentProgressRow, AgentProgressSource,
    AgentSessionKey, AgentSessionSnapshot, AgentStateSnapshot, AgentTurnLifecycle, NativeSessionId,
};
use crate::TerminalId;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AgentStateSnapshotError {
    DuplicateSession,
    DuplicateChild,
    MismatchedChildSession,
    DuplicateForeground,
    DuplicateDeliveryReceipt,
    MissingForegroundSession,
    InvalidRevision,
}

impl fmt::Display for AgentStateSnapshotError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::DuplicateSession => "agent snapshot contains a duplicate session",
            Self::DuplicateChild => "agent snapshot contains a duplicate child",
            Self::MismatchedChildSession => {
                "agent snapshot child belongs to a different native session"
            }
            Self::DuplicateForeground => "agent snapshot contains a duplicate foreground key",
            Self::DuplicateDeliveryReceipt => {
                "agent snapshot contains a duplicate delivery receipt"
            }
            Self::MissingForegroundSession => {
                "agent snapshot foreground refers to a missing session"
            }
            Self::InvalidRevision => "agent snapshot revision precedes a session revision",
        })
    }
}

impl std::error::Error for AgentStateSnapshotError {}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(super) struct SessionState {
    pub(super) children: BTreeMap<AgentChildIdentity, AgentChild>,
    pub(super) detail: Option<String>,
    pub(super) attention_request_id: Option<String>,
    pub(super) hover_messages: Vec<String>,
    pub(super) has_pending_background_work: bool,
    pub(super) is_actionable: bool,
    pub(super) phase: AgentActivityPhase,
    pub(super) progress_rows_by_source: BTreeMap<AgentProgressSource, Vec<AgentProgressRow>>,
    pub(super) revision: u64,
    pub(super) transcript_path: Option<PathBuf>,
    pub(super) turn_lifecycle: AgentTurnLifecycle,
    pub(super) working_directory: Option<PathBuf>,
}

impl Default for SessionState {
    fn default() -> Self {
        Self {
            children: BTreeMap::new(),
            detail: None,
            attention_request_id: None,
            hover_messages: Vec::new(),
            has_pending_background_work: false,
            is_actionable: false,
            phase: AgentActivityPhase::Idle,
            progress_rows_by_source: BTreeMap::new(),
            revision: 0,
            transcript_path: None,
            turn_lifecycle: AgentTurnLifecycle::Unseen,
            working_directory: None,
        }
    }
}

#[derive(Debug)]
pub struct AgentState {
    sessions: HashMap<AgentSessionKey, SessionState>,
    foreground_sessions: HashMap<AgentForegroundKey, NativeSessionId>,
    delivery_receipts: HashSet<AgentDeliveryReceipt>,
    delivery_receipt_order: VecDeque<AgentDeliveryReceipt>,
    delivery_receipt_capacity: usize,
    revision: u64,
}

impl Default for AgentState {
    fn default() -> Self {
        Self::with_delivery_receipt_capacity_value(Self::DEFAULT_DELIVERY_RECEIPT_CAPACITY)
    }
}

impl AgentState {
    pub const DEFAULT_DELIVERY_RECEIPT_CAPACITY: usize = 16_384;

    pub fn new() -> Self {
        Self::default()
    }

    pub fn with_delivery_receipt_capacity(delivery_receipt_capacity: NonZeroUsize) -> Self {
        Self::with_delivery_receipt_capacity_value(delivery_receipt_capacity.get())
    }

    fn with_delivery_receipt_capacity_value(delivery_receipt_capacity: usize) -> Self {
        Self {
            sessions: HashMap::new(),
            foreground_sessions: HashMap::new(),
            delivery_receipts: HashSet::new(),
            delivery_receipt_order: VecDeque::new(),
            delivery_receipt_capacity,
            revision: 0,
        }
    }

    pub fn revision(&self) -> u64 {
        self.revision
    }

    pub fn apply_delivery(&mut self, delivery: AgentDelivery) -> AgentDeliveryApplication {
        if delivery
            .events
            .iter()
            .any(|event| event.terminal_id != delivery.terminal_id)
        {
            return AgentDeliveryApplication {
                accepted: false,
                changed: false,
                duplicate: false,
            };
        }
        let receipt = AgentDeliveryReceipt {
            terminal_id: delivery.terminal_id,
            delivery_id: delivery.id,
        };
        if self.delivery_receipts.contains(&receipt) {
            return AgentDeliveryApplication {
                accepted: true,
                changed: false,
                duplicate: true,
            };
        }
        let accepts_empty_delivery = delivery.events.is_empty();
        let mut accepted = false;
        let mut changed = false;
        for event in delivery.events {
            let application = self.apply_event(event);
            accepted |= application.accepted;
            changed |= application.changed;
        }
        self.record_delivery_receipt(receipt);
        AgentDeliveryApplication {
            accepted: accepted || accepts_empty_delivery,
            changed,
            duplicate: false,
        }
    }

    pub fn apply_event(&mut self, event: AgentEvent) -> AgentEventApplication {
        let key = AgentSessionKey {
            terminal_id: event.terminal_id,
            agent: event.scope.agent,
            native_session_id: event.scope.native_session_id.clone(),
        };
        let session_exists = self.sessions.contains_key(&key);
        if event.scope.child_id.is_some() && !session_exists {
            return rejected();
        }
        let previous_state = self.sessions.get(&key).cloned();
        let mut state = previous_state.clone().unwrap_or_default();
        if !accepts(&event, &state, session_exists) {
            return rejected();
        }
        let foreground_key = AgentForegroundKey {
            terminal_id: event.terminal_id,
            agent: event.scope.agent,
        };
        let previous_foreground = self.foreground_sessions.get(&foreground_key).cloned();
        if event.scope.child_id.is_none()
            && matches!(event.action, super::AgentAction::SessionStarted { .. })
        {
            if previous_foreground.as_ref() == Some(&event.scope.native_session_id) {
                self.foreground_sessions.remove(&foreground_key);
            }
            state = SessionState::default();
        }
        bind(&event, &mut state);
        if event.scope.child_id.is_some() {
            apply_child(&event, &mut state);
            return self.finish_event(
                key,
                state,
                previous_state.as_ref(),
                foreground_key,
                previous_foreground.as_ref(),
            );
        }
        if matches!(event.action, super::AgentAction::SessionEnded) {
            self.sessions.remove(&key);
            if previous_foreground.as_ref() == Some(&event.scope.native_session_id) {
                self.foreground_sessions.remove(&foreground_key);
            }
            self.revision += 1;
            return AgentEventApplication {
                accepted: true,
                changed: true,
            };
        }
        promote_root_if_needed(
            &event,
            &state,
            !session_exists,
            &foreground_key,
            &mut self.foreground_sessions,
        );
        apply_root(
            &event,
            &mut state,
            &foreground_key,
            &mut self.foreground_sessions,
        );
        self.finish_event(
            key,
            state,
            previous_state.as_ref(),
            foreground_key,
            previous_foreground.as_ref(),
        )
    }

    pub fn has_session(&self, key: &AgentSessionKey) -> bool {
        self.sessions.contains_key(key)
    }

    pub fn has_background_work(&self, key: &AgentSessionKey) -> bool {
        self.sessions
            .get(key)
            .is_some_and(|state| state.has_pending_background_work)
    }

    pub fn foreground_session_id(
        &self,
        terminal_id: TerminalId,
        agent: AgentKind,
    ) -> Option<&NativeSessionId> {
        self.foreground_sessions
            .get(&AgentForegroundKey { terminal_id, agent })
    }

    pub fn presentation(
        &self,
        terminal_id: TerminalId,
        agent: AgentKind,
    ) -> Option<AgentPresentation> {
        let native_session_id = self.foreground_session_id(terminal_id, agent)?;
        let key = AgentSessionKey {
            terminal_id,
            agent,
            native_session_id: native_session_id.clone(),
        };
        let state = self.sessions.get(&key)?;
        let children: Vec<_> = state.children.values().cloned().collect();
        let phase = children
            .iter()
            .fold(state.phase, |phase, child| phase.max(child.phase));
        let detail = if state.phase == phase {
            state.detail.clone()
        } else {
            children
                .iter()
                .find(|child| child.phase == phase)
                .and_then(AgentChild::display_detail)
                .map(str::to_owned)
        };
        Some(AgentPresentation {
            key,
            phase,
            detail,
            hover_messages: state.hover_messages.clone(),
            is_actionable: state.is_actionable,
            progress_rows: visible_progress_rows(state),
            children,
            turn_lifecycle: state.turn_lifecycle.clone(),
            working_directory: state.working_directory.clone(),
        })
    }

    pub fn session(&self, key: &AgentSessionKey) -> Option<AgentSessionSnapshot> {
        self.sessions
            .get(key)
            .map(|state| session_snapshot(key.clone(), state))
    }

    pub fn sessions_for_terminal(&self, terminal_id: TerminalId) -> Vec<AgentSessionSnapshot> {
        let mut sessions: Vec<_> = self
            .sessions
            .iter()
            .filter(|(key, _)| key.terminal_id == terminal_id)
            .map(|(key, state)| session_snapshot(key.clone(), state))
            .collect();
        sessions.sort_by(|left, right| {
            (left.key.agent, &left.key.native_session_id)
                .cmp(&(right.key.agent, &right.key.native_session_id))
        });
        sessions
    }

    pub fn snapshot(&self) -> AgentStateSnapshot {
        let mut sessions: Vec<_> = self
            .sessions
            .iter()
            .map(|(key, state)| session_snapshot(key.clone(), state))
            .collect();
        sessions.sort_by(|left, right| {
            (
                left.key.terminal_id.to_string(),
                left.key.agent,
                &left.key.native_session_id,
            )
                .cmp(&(
                    right.key.terminal_id.to_string(),
                    right.key.agent,
                    &right.key.native_session_id,
                ))
        });
        let mut foreground_sessions: Vec<_> = self
            .foreground_sessions
            .iter()
            .map(|(key, native_session_id)| AgentForegroundSession {
                key: key.clone(),
                native_session_id: native_session_id.clone(),
            })
            .collect();
        foreground_sessions.sort_by(|left, right| {
            (left.key.terminal_id.to_string(), left.key.agent)
                .cmp(&(right.key.terminal_id.to_string(), right.key.agent))
        });
        AgentStateSnapshot {
            revision: self.revision,
            sessions,
            foreground_sessions,
            delivery_receipts: self.delivery_receipt_order.iter().cloned().collect(),
        }
    }

    pub fn from_snapshot(snapshot: AgentStateSnapshot) -> Result<Self, AgentStateSnapshotError> {
        Self::restore(snapshot, Self::DEFAULT_DELIVERY_RECEIPT_CAPACITY)
    }

    pub fn from_snapshot_with_delivery_receipt_capacity(
        snapshot: AgentStateSnapshot,
        delivery_receipt_capacity: NonZeroUsize,
    ) -> Result<Self, AgentStateSnapshotError> {
        Self::restore(snapshot, delivery_receipt_capacity.get())
    }

    fn restore(
        snapshot: AgentStateSnapshot,
        delivery_receipt_capacity: usize,
    ) -> Result<Self, AgentStateSnapshotError> {
        let AgentStateSnapshot {
            revision,
            sessions: session_snapshots,
            foreground_sessions: foreground_snapshots,
            delivery_receipts: receipt_snapshots,
        } = snapshot;
        if receipt_snapshots.iter().collect::<HashSet<_>>().len() != receipt_snapshots.len() {
            return Err(AgentStateSnapshotError::DuplicateDeliveryReceipt);
        }
        let first_receipt = receipt_snapshots
            .len()
            .saturating_sub(delivery_receipt_capacity);
        let delivery_receipt_order: VecDeque<_> =
            receipt_snapshots.into_iter().skip(first_receipt).collect();
        let delivery_receipts = delivery_receipt_order.iter().cloned().collect();
        let mut sessions = HashMap::new();
        for session in session_snapshots {
            if session.revision > revision {
                return Err(AgentStateSnapshotError::InvalidRevision);
            }
            let mut children = BTreeMap::new();
            for child in session.children {
                if child.id.native_session_id != session.key.native_session_id {
                    return Err(AgentStateSnapshotError::MismatchedChildSession);
                }
                if children.insert(child.id.clone(), child).is_some() {
                    return Err(AgentStateSnapshotError::DuplicateChild);
                }
            }
            let state = SessionState {
                children,
                detail: session.detail,
                attention_request_id: session.attention_request_id,
                hover_messages: session.hover_messages,
                has_pending_background_work: session.has_pending_background_work,
                is_actionable: session.is_actionable,
                phase: session.phase,
                progress_rows_by_source: session.progress_rows_by_source,
                revision: session.revision,
                transcript_path: session.transcript_path,
                turn_lifecycle: session.turn_lifecycle,
                working_directory: session.working_directory,
            };
            if sessions.insert(session.key, state).is_some() {
                return Err(AgentStateSnapshotError::DuplicateSession);
            }
        }
        let mut foreground_sessions = HashMap::new();
        for foreground in foreground_snapshots {
            let session_key = AgentSessionKey {
                terminal_id: foreground.key.terminal_id,
                agent: foreground.key.agent,
                native_session_id: foreground.native_session_id.clone(),
            };
            if !sessions.contains_key(&session_key) {
                return Err(AgentStateSnapshotError::MissingForegroundSession);
            }
            if foreground_sessions
                .insert(foreground.key, foreground.native_session_id)
                .is_some()
            {
                return Err(AgentStateSnapshotError::DuplicateForeground);
            }
        }
        Ok(Self {
            sessions,
            foreground_sessions,
            delivery_receipts,
            delivery_receipt_order,
            delivery_receipt_capacity,
            revision,
        })
    }

    fn record_delivery_receipt(&mut self, receipt: AgentDeliveryReceipt) {
        if self.delivery_receipt_order.len() == self.delivery_receipt_capacity
            && let Some(expired) = self.delivery_receipt_order.pop_front()
        {
            self.delivery_receipts.remove(&expired);
        }
        self.delivery_receipts.insert(receipt.clone());
        self.delivery_receipt_order.push_back(receipt);
    }

    fn finish_event(
        &mut self,
        key: AgentSessionKey,
        mut state: SessionState,
        previous_state: Option<&SessionState>,
        foreground_key: AgentForegroundKey,
        previous_foreground: Option<&NativeSessionId>,
    ) -> AgentEventApplication {
        let state_changed = previous_state != Some(&state);
        let foreground_changed =
            previous_foreground != self.foreground_sessions.get(&foreground_key);
        let changed = state_changed || foreground_changed;
        if changed {
            self.revision += 1;
            if state_changed {
                state.revision = self.revision;
                self.sessions.insert(key, state);
            }
        }
        AgentEventApplication {
            accepted: true,
            changed,
        }
    }
}

fn rejected() -> AgentEventApplication {
    AgentEventApplication {
        accepted: false,
        changed: false,
    }
}
