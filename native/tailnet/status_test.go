package main

import (
	"encoding/json"
	"net/netip"
	"testing"
	"time"

	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tailcfg"
	"tailscale.com/types/views"
)

func runningSnapshot(edit func(*ipnstate.Status)) *ipnstate.Status {
	expiry := time.Date(2027, 1, 2, 4, 4, 5, 0, time.FixedZone("CET", 3600))
	st := &ipnstate.Status{
		Self: &ipnstate.PeerStatus{
			DNSName:      "supaterm-mbp.tail1234.ts.net.",
			TailscaleIPs: []netip.Addr{netip.MustParseAddr("100.64.0.1"), netip.MustParseAddr("fd7a:115c:a1e0::1")},
			UserID:       7,
			KeyExpiry:    &expiry,
		},
		User:   map[tailcfg.UserID]tailcfg.UserProfile{7: {LoginName: "alice@example.com", DisplayName: "Alice"}},
		Health: []string{"Unable to connect to the Tailscale coordination server"},
	}
	if edit != nil {
		edit(st)
	}
	return st
}

const runningPrefix = `{"state":"running","dnsName":"supaterm-mbp.tail1234.ts.net","addresses":["100.64.0.1","fd7a:115c:a1e0::1"],`

func TestDeriveStatus(t *testing.T) {
	withCertDomains := func(domains ...string) func(*ipnstate.Status) {
		return func(st *ipnstate.Status) { st.CertDomains = domains }
	}
	tests := []struct {
		name string
		obs  observation
		want string
	}{
		{
			name: "no state yet",
			obs:  observation{State: ipn.NoState},
			want: `{"state":"starting"}`,
		},
		{
			name: "backend starting",
			obs:  observation{State: ipn.Starting, Status: runningSnapshot(nil)},
			want: `{"state":"starting"}`,
		},
		{
			name: "needs login with url",
			obs:  observation{State: ipn.NeedsLogin, LoginURL: "https://login.tailscale.com/a/abc", AwaitingLoginURL: true},
			want: `{"state":"needs-login","loginUrl":"https://login.tailscale.com/a/abc"}`,
		},
		{
			name: "needs login while a login url is on its way",
			obs:  observation{State: ipn.NeedsLogin, AwaitingLoginURL: true},
			want: `{"state":"starting"}`,
		},
		{
			name: "needs login with no login in flight",
			obs:  observation{State: ipn.NeedsLogin},
			want: `{"state":"needs-login","loginUrl":null}`,
		},
		{
			name: "backend stopped while the process lives",
			obs:  observation{State: ipn.Stopped, Status: runningSnapshot(nil)},
			want: `{"state":"needs-login","loginUrl":null}`,
		},
		{
			name: "machine needs approval",
			obs:  observation{State: ipn.NeedsMachineAuth},
			want: `{"state":"needs-approval"}`,
		},
		{
			name: "running before self is known",
			obs:  observation{State: ipn.Running, Status: &ipnstate.Status{}},
			want: `{"state":"starting"}`,
		},
		{
			name: "running without addresses",
			obs: observation{State: ipn.Running, Status: runningSnapshot(func(st *ipnstate.Status) {
				st.Self.TailscaleIPs = nil
			})},
			want: `{"state":"starting"}`,
		},
		{
			name: "running user node without https",
			obs:  observation{State: ipn.Running, Status: runningSnapshot(nil)},
			want: runningPrefix + `"owner":{"type":"user","login":"alice@example.com","displayName":"Alice"},"https":"unavailable","keyExpiry":"2027-01-02T03:04:05Z","health":["Unable to connect to the Tailscale coordination server"]}`,
		},
		{
			name: "running tagged node with no key expiry and no health",
			obs: observation{State: ipn.Running, Status: runningSnapshot(func(st *ipnstate.Status) {
				tags := views.SliceOf([]string{"tag:supaterm", "tag:ci"})
				st.Self.Tags = &tags
				st.Self.KeyExpiry = nil
				st.Health = nil
			})},
			want: runningPrefix + `"owner":{"type":"tagged","tags":["tag:supaterm","tag:ci"]},"https":"unavailable","keyExpiry":null,"health":[]}`,
		},
		{
			name: "https provisioning before the first fetch reports",
			obs: observation{
				State:  ipn.Running,
				Status: runningSnapshot(withCertDomains("supaterm-mbp.tail1234.ts.net")),
				Cert:   certState{Domain: "supaterm-mbp.tail1234.ts.net", HTTPS: httpsStatus{Phase: httpsProvisioning}},
			},
			want: runningPrefix + `"owner":{"type":"user","login":"alice@example.com","displayName":"Alice"},"https":"provisioning","keyExpiry":"2027-01-02T03:04:05Z","health":["Unable to connect to the Tailscale coordination server"]}`,
		},
		{
			name: "https ready",
			obs: observation{
				State:  ipn.Running,
				Status: runningSnapshot(withCertDomains("supaterm-mbp.tail1234.ts.net")),
				Cert:   certState{Domain: "supaterm-mbp.tail1234.ts.net", HTTPS: httpsStatus{Phase: httpsReady}},
			},
			want: runningPrefix + `"owner":{"type":"user","login":"alice@example.com","displayName":"Alice"},"https":"ready","keyExpiry":"2027-01-02T03:04:05Z","health":["Unable to connect to the Tailscale coordination server"]}`,
		},
		{
			name: "https failed carries its error",
			obs: observation{
				State:  ipn.Running,
				Status: runningSnapshot(withCertDomains("supaterm-mbp.tail1234.ts.net")),
				Cert:   certState{Domain: "supaterm-mbp.tail1234.ts.net", HTTPS: httpsStatus{Phase: httpsFailed, Error: "rate limited"}},
			},
			want: runningPrefix + `"owner":{"type":"user","login":"alice@example.com","displayName":"Alice"},"https":"failed","httpsError":"rate limited","keyExpiry":"2027-01-02T03:04:05Z","health":["Unable to connect to the Tailscale coordination server"]}`,
		},
		{
			name: "cert state for a previous domain is not reused",
			obs: observation{
				State:  ipn.Running,
				Status: runningSnapshot(withCertDomains("supaterm-mbp.tail1234.ts.net")),
				Cert:   certState{Domain: "old-name.tail1234.ts.net", HTTPS: httpsStatus{Phase: httpsReady}},
			},
			want: runningPrefix + `"owner":{"type":"user","login":"alice@example.com","displayName":"Alice"},"https":"provisioning","keyExpiry":"2027-01-02T03:04:05Z","health":["Unable to connect to the Tailscale coordination server"]}`,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := json.Marshal(deriveStatus(tt.obs))
			if err != nil {
				t.Fatal(err)
			}
			if string(got) != tt.want {
				t.Errorf("got  %s\nwant %s", got, tt.want)
			}
		})
	}
}

func TestCertDomain(t *testing.T) {
	tests := []struct {
		name    string
		domains []string
		want    string
	}{
		{"no domains", nil, ""},
		{"prefers the node's own name", []string{"svc.tail1234.ts.net", "supaterm-mbp.tail1234.ts.net"}, "supaterm-mbp.tail1234.ts.net"},
		{"falls back to the first domain", []string{"other.tail1234.ts.net"}, "other.tail1234.ts.net"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			st := runningSnapshot(func(st *ipnstate.Status) { st.CertDomains = tt.domains })
			if got := certDomain(st); got != tt.want {
				t.Errorf("certDomain = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestMergeState(t *testing.T) {
	tests := []struct {
		current, next, want ipn.State
	}{
		{ipn.NoState, ipn.NoState, ipn.NoState},
		{ipn.NoState, ipn.NeedsLogin, ipn.NeedsLogin},
		{ipn.Stopped, ipn.NoState, ipn.Stopped},
		{ipn.NeedsLogin, ipn.NoState, ipn.NeedsLogin},
		{ipn.NeedsMachineAuth, ipn.NoState, ipn.NeedsMachineAuth},
		{ipn.Running, ipn.NoState, ipn.NoState},
		{ipn.Starting, ipn.NoState, ipn.NoState},
		{ipn.Stopped, ipn.NeedsLogin, ipn.NeedsLogin},
	}
	for _, tt := range tests {
		if got := mergeState(tt.current, tt.next); got != tt.want {
			t.Errorf("mergeState(%v, %v) = %v, want %v", tt.current, tt.next, got, tt.want)
		}
	}
}
