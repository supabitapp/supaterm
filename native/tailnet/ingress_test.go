package main

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/tailcfg"
)

func TestIdentityFromWhoIs(t *testing.T) {
	node := &tailcfg.Node{Name: "pixel.tail1234.ts.net.", ComputedName: "pixel", StableID: "nXXXX"}
	tests := []struct {
		name string
		who  *apitype.WhoIsResponse
		want *identity
	}{
		{name: "lookup failed", who: nil, want: nil},
		{
			name: "user-owned node",
			who:  &apitype.WhoIsResponse{Node: node, UserProfile: &tailcfg.UserProfile{LoginName: "alice@example.com"}},
			want: &identity{Login: "alice@example.com"},
		},
		{
			name: "tagged node reports the pseudo-user",
			who:  &apitype.WhoIsResponse{Node: node, UserProfile: &tailcfg.UserProfile{LoginName: "tagged-devices"}},
			want: &identity{Login: "tagged-devices"},
		},
		{
			name: "a login too long to send whole is no identity",
			who:  &apitype.WhoIsResponse{Node: node, UserProfile: &tailcfg.UserProfile{LoginName: "alice@example.com" + strings.Repeat("x", maxLoginBytes)}},
			want: nil,
		},
		{
			name: "an invalid UTF-8 login is no identity",
			who:  &apitype.WhoIsResponse{Node: node, UserProfile: &tailcfg.UserProfile{LoginName: "alice\xff@example.com"}},
			want: nil,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := identityFromWhoIs(tt.who); !reflect.DeepEqual(got, tt.want) {
				t.Errorf("got  %#v\nwant %#v", got, tt.want)
			}
		})
	}
}

func TestEncodePreamble(t *testing.T) {
	tests := []struct {
		name string
		p    preamble
		want string
	}{
		{
			name: "tls connection with identity",
			p: preamble{
				Version: 1, Secret: validSecretValue, TLS: true, RemoteAddress: "100.101.102.103", RemotePort: 12345,
				Identity: &identity{Login: "alice@example.com"},
			},
			want: `{"version":1,"secret":"` + validSecretValue + `","tls":true,"remoteAddress":"100.101.102.103","remotePort":12345,"identity":{"login":"alice@example.com"}}` + "\n",
		},
		{
			name: "plain connection whose caller is unknown",
			p:    preamble{Version: 1, Secret: validSecretValue, RemoteAddress: "fd7a:115c:a1e0::1", RemotePort: 80},
			want: `{"version":1,"secret":"` + validSecretValue + `","tls":false,"remoteAddress":"fd7a:115c:a1e0::1","remotePort":80,"identity":null}` + "\n",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := string(encodePreamble(tt.p)); got != tt.want {
				t.Errorf("got  %s\nwant %s", got, tt.want)
			}
		})
	}
}

func TestEncodePreambleFitsWithTheLongestLogin(t *testing.T) {
	login := strings.Repeat("\x01", maxLoginBytes)
	line := encodePreamble(preamble{
		Version: 1, Secret: strings.Repeat("s", maxSecretBytes), TLS: true,
		RemoteAddress: "fd7a:115c:a1e0:ab12:4843:cd96:6258:b240", RemotePort: 65535,
		Identity: &identity{Login: login},
	})
	if len(line) >= maxPreambleBytes {
		t.Fatalf("preamble is %d bytes, want under %d", len(line), maxPreambleBytes)
	}
	var decoded preamble
	if err := json.Unmarshal(line, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Identity.Login != login {
		t.Fatalf("login must arrive whole")
	}
}
