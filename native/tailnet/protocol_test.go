package main

import (
	"bytes"
	"net/netip"
	"reflect"
	"strings"
	"testing"
)

const validSecretValue = "c2VjcmV0LXNlY3JldC1zZWNyZXQ_-.~+/="

func startLine(fields string) string {
	base := `"version":1,"type":"start","stateDir":"/var/supaterm/tailnet","hostname":"supaterm-mbp","ingressAddress":"127.0.0.1:54321","ingressSecret":"` + validSecretValue + `"`
	if fields != "" {
		base += "," + fields
	}
	return "{" + base + "}"
}

func TestDecodeCommand(t *testing.T) {
	base := startConfig{
		StateDir:       "/var/supaterm/tailnet",
		Hostname:       "supaterm-mbp",
		AdvertiseTags:  []string{},
		IngressAddress: netip.MustParseAddrPort("127.0.0.1:54321"),
		IngressSecret:  validSecretValue,
	}
	tests := []struct {
		name    string
		line    string
		want    command
		wantErr string
	}{
		{
			name: "start with nulls",
			line: startLine(`"controlUrl":null,"authKey":null,"advertiseTags":[],"verbose":false`),
			want: base,
		},
		{
			name: "start with every field",
			line: startLine(`"controlUrl":"https://hs.example.com:8443","authKey":"tskey-auth-abc","advertiseTags":["tag:a","tag:b"],"verbose":true,"futureField":1`),
			want: func() startConfig {
				c := base
				c.ControlURL = "https://hs.example.com:8443"
				c.AuthKey = "tskey-auth-abc"
				c.AdvertiseTags = []string{"tag:a", "tag:b"}
				c.Verbose = true
				return c
			}(),
		},
		{
			name: "ipv6 loopback ingress",
			line: strings.Replace(startLine(""), `127.0.0.1:54321`, `[::1]:54321`, 1),
			want: func() startConfig {
				c := base
				c.IngressAddress = netip.MustParseAddrPort("[::1]:54321")
				return c
			}(),
		},
		{name: "login", line: `{"version":1,"type":"login"}`, want: loginCommand{}},
		{name: "logout", line: `{"version":1,"type":"logout"}`, want: logoutCommand{}},
		{name: "not json", line: `login`, wantErr: "not a JSON object"},
		{name: "json array", line: `[]`, wantErr: "not a JSON object"},
		{name: "missing version", line: `{"type":"login"}`, wantErr: "unsupported protocol version"},
		{name: "future version", line: `{"version":2,"type":"login"}`, wantErr: "unsupported protocol version"},
		{name: "unknown type", line: `{"version":1,"type":"reboot"}`, wantErr: "unknown command type"},
		{name: "relative state dir", line: strings.Replace(startLine(""), `/var/supaterm/tailnet`, `var/tailnet`, 1), wantErr: "stateDir"},
		{name: "missing hostname", line: strings.Replace(startLine(""), `"supaterm-mbp"`, `""`, 1), wantErr: "hostname"},
		{name: "control url without scheme", line: startLine(`"controlUrl":"hs.example.com"`), wantErr: "controlUrl"},
		{name: "control url with other scheme", line: startLine(`"controlUrl":"ftp://hs.example.com"`), wantErr: "controlUrl"},
		{name: "ingress on a routable address", line: strings.Replace(startLine(""), `127.0.0.1:54321`, `192.168.1.2:54321`, 1), wantErr: "ingressAddress"},
		{name: "ingress without port", line: strings.Replace(startLine(""), `127.0.0.1:54321`, `127.0.0.1:0`, 1), wantErr: "ingressAddress"},
		{name: "ingress hostname", line: strings.Replace(startLine(""), `127.0.0.1:54321`, `localhost:54321`, 1), wantErr: "ingressAddress"},
		{name: "short secret", line: strings.Replace(startLine(""), validSecretValue, `short`, 1), wantErr: "ingressSecret"},
		{name: "secret with a quote", line: strings.Replace(startLine(""), validSecretValue, `0123456789abcdef\"`, 1), wantErr: "ingressSecret"},
		{name: "oversized secret", line: strings.Replace(startLine(""), validSecretValue, strings.Repeat("a", maxSecretBytes+1), 1), wantErr: "ingressSecret"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := decodeCommand([]byte(tt.line))
			if tt.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("err = %v, want it to mention %q", err, tt.wantErr)
				}
				if got != nil {
					t.Fatalf("command = %#v, want nil on error", got)
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestEmitterDedupesStatusesAndStopsAfterFinish(t *testing.T) {
	var out bytes.Buffer
	e := newEmitter(&out)
	e.hello("1.106.0")
	e.status(stateOnly("starting"))
	e.status(stateOnly("starting"))
	e.status(needsLoginStatus{})
	e.error(errBadCommand, "unknown command type")
	e.status(needsLoginStatus{})
	e.finish()
	e.status(stateOnly("starting"))
	e.error(errLoginFailed, "late")

	want := `{"version":1,"type":"hello","tailscaleVersion":"1.106.0"}
{"version":1,"type":"status","status":{"state":"starting"}}
{"version":1,"type":"status","status":{"state":"needs-login","loginUrl":null}}
{"version":1,"type":"error","code":"bad-command","message":"unknown command type"}
{"version":1,"type":"status","status":{"state":"stopped"}}
`
	if out.String() != want {
		t.Errorf("got\n%s\nwant\n%s", out.String(), want)
	}
}
