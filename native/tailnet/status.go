package main

import (
	"encoding/json"
	"slices"
	"strings"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
)

type status interface{ isStatus() }

type stateOnly string

type needsLoginStatus struct {
	LoginURL *string `json:"loginUrl"`
}

type runningStatus struct {
	DNSName    string   `json:"dnsName"`
	Addresses  []string `json:"addresses"`
	Owner      owner    `json:"owner"`
	HTTPS      string   `json:"https"`
	HTTPSError string   `json:"httpsError,omitempty"`
	KeyExpiry  *string  `json:"keyExpiry"`
	Health     []string `json:"health"`
}

func (stateOnly) isStatus()        {}
func (needsLoginStatus) isStatus() {}
func (runningStatus) isStatus()    {}

func (s stateOnly) MarshalJSON() ([]byte, error) {
	return json.Marshal(struct {
		State string `json:"state"`
	}{string(s)})
}

func (s needsLoginStatus) MarshalJSON() ([]byte, error) {
	type fields needsLoginStatus
	return json.Marshal(struct {
		State string `json:"state"`
		fields
	}{"needs-login", fields(s)})
}

func (s runningStatus) MarshalJSON() ([]byte, error) {
	type fields runningStatus
	return json.Marshal(struct {
		State string `json:"state"`
		fields
	}{"running", fields(s)})
}

type owner interface{ isOwner() }

type userOwner struct {
	Login       string `json:"login"`
	DisplayName string `json:"displayName"`
}

type taggedOwner struct {
	Tags []string `json:"tags"`
}

func (userOwner) isOwner()   {}
func (taggedOwner) isOwner() {}

func (o userOwner) MarshalJSON() ([]byte, error) {
	type fields userOwner
	return json.Marshal(struct {
		Type string `json:"type"`
		fields
	}{"user", fields(o)})
}

func (o taggedOwner) MarshalJSON() ([]byte, error) {
	type fields taggedOwner
	return json.Marshal(struct {
		Type string `json:"type"`
		fields
	}{"tagged", fields(o)})
}

type httpsPhase string

const (
	httpsProvisioning httpsPhase = "provisioning"
	httpsReady        httpsPhase = "ready"
	httpsFailed       httpsPhase = "failed"
	httpsUnavailable  httpsPhase = "unavailable"
)

type httpsStatus struct {
	Phase httpsPhase
	Error string
}

type certState struct {
	Domain string
	HTTPS  httpsStatus
}

type observation struct {
	State            ipn.State
	LoginURL         string
	AwaitingLoginURL bool
	Status           *ipnstate.Status
	Cert             certState
}

func deriveStatus(o observation) status {
	switch o.State {
	case ipn.NeedsLogin, ipn.Stopped:
		if o.LoginURL != "" {
			return needsLoginStatus{LoginURL: &o.LoginURL}
		}
		if o.AwaitingLoginURL {
			return stateOnly("starting")
		}
		return needsLoginStatus{}
	case ipn.NeedsMachineAuth:
		return stateOnly("needs-approval")
	case ipn.Running:
		if !selfReady(o.Status) {
			return stateOnly("starting")
		}
		return deriveRunning(o.Status, o.Cert)
	default:
		return stateOnly("starting")
	}
}

func mergeState(current, next ipn.State) ipn.State {
	if next != ipn.NoState {
		return next
	}
	switch current {
	case ipn.NeedsLogin, ipn.NeedsMachineAuth, ipn.Stopped:
		return current
	default:
		return next
	}
}

func selfReady(st *ipnstate.Status) bool {
	return st != nil && st.Self != nil && len(st.Self.TailscaleIPs) > 0
}

func deriveRunning(st *ipnstate.Status, cert certState) runningStatus {
	self := st.Self
	addresses := make([]string, 0, len(self.TailscaleIPs))
	for _, ip := range self.TailscaleIPs {
		addresses = append(addresses, ip.String())
	}
	https := httpsFor(certDomain(st), cert)
	running := runningStatus{
		DNSName:   strings.TrimSuffix(self.DNSName, "."),
		Addresses: addresses,
		Owner:     deriveOwner(st),
		HTTPS:     string(https.Phase),
		Health:    append([]string{}, st.Health...),
	}
	if https.Phase == httpsFailed {
		running.HTTPSError = https.Error
	}
	if self.KeyExpiry != nil && !self.KeyExpiry.IsZero() {
		expiry := self.KeyExpiry.UTC().Format(time.RFC3339)
		running.KeyExpiry = &expiry
	}
	return running
}

func httpsFor(domain string, cert certState) httpsStatus {
	switch {
	case domain == "":
		return httpsStatus{Phase: httpsUnavailable}
	case cert.Domain != domain:
		return httpsStatus{Phase: httpsProvisioning}
	default:
		return cert.HTTPS
	}
}

func deriveOwner(st *ipnstate.Status) owner {
	if tags := st.Self.Tags; tags != nil && tags.Len() > 0 {
		return taggedOwner{Tags: tags.AsSlice()}
	}
	profile := st.User[st.Self.UserID]
	return userOwner{Login: profile.LoginName, DisplayName: profile.DisplayName}
}

func certDomain(st *ipnstate.Status) string {
	if !selfReady(st) || len(st.CertDomains) == 0 {
		return ""
	}
	if self := strings.TrimSuffix(st.Self.DNSName, "."); slices.Contains(st.CertDomains, self) {
		return self
	}
	return st.CertDomains[0]
}
