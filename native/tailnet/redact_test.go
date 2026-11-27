package main

import "testing"

func testRedactor() redactor {
	return newRedactor(startConfig{
		ControlURL:    "https://HS.example.com:8443",
		AuthKey:       "8f3a9c2e1b7d",
		IngressSecret: validSecretValue,
	})
}

func TestRedactText(t *testing.T) {
	tests := []struct {
		in   string
		want string
	}{
		{"no sensitive content", "no sensitive content"},
		{`acme.GetReg: Get "https://acme-v02.api.letsencrypt.org/directory": dial tcp: refused`, `acme.GetReg: Get "[url]": dial tcp: refused`},
		{"visit https://login.tailscale.com/a/abc to continue", "visit [url] to continue"},
		{"invalid key: tskey-auth-kAbC123-xyz", "invalid key: [redacted]"},
		{"key 8f3a9c2e1b7d rejected", "key [redacted] rejected"},
		{"preamble " + validSecretValue, "preamble [redacted]"},
		{"AuthURL is https://sso.example.org/register/nodekey:abc", "AuthURL is [url]"},
	}
	r := testRedactor()
	for _, tt := range tests {
		if got := r.text(tt.in); got != tt.want {
			t.Errorf("text(%q) = %q, want %q", tt.in, got, tt.want)
		}
	}
}
