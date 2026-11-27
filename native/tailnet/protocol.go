package main

import (
	"encoding/json"
	"errors"
	"io"
	"net/netip"
	"net/url"
	"path/filepath"
	"sync"
)

const protocolVersion = 1

type command interface{ isCommand() }

type startConfig struct {
	StateDir       string
	Hostname       string
	ControlURL     string
	AuthKey        string
	AdvertiseTags  []string
	IngressAddress netip.AddrPort
	IngressSecret  string
	Verbose        bool
}

type loginCommand struct{}

type logoutCommand struct{}

func (startConfig) isCommand()   {}
func (loginCommand) isCommand()  {}
func (logoutCommand) isCommand() {}

type wireCommand struct {
	Version        int      `json:"version"`
	Type           string   `json:"type"`
	StateDir       string   `json:"stateDir"`
	Hostname       string   `json:"hostname"`
	ControlURL     *string  `json:"controlUrl"`
	AuthKey        *string  `json:"authKey"`
	AdvertiseTags  []string `json:"advertiseTags"`
	IngressAddress string   `json:"ingressAddress"`
	IngressSecret  string   `json:"ingressSecret"`
	Verbose        bool     `json:"verbose"`
}

const (
	minSecretBytes = 16
	maxSecretBytes = 512
)

func decodeCommand(line []byte) (command, error) {
	var w wireCommand
	if err := json.Unmarshal(line, &w); err != nil {
		return nil, errors.New("command is not a JSON object")
	}
	if w.Version != protocolVersion {
		return nil, errors.New("unsupported protocol version")
	}
	switch w.Type {
	case "start":
		cfg, err := decodeStart(w)
		if err != nil {
			return nil, err
		}
		return cfg, nil
	case "login":
		return loginCommand{}, nil
	case "logout":
		return logoutCommand{}, nil
	default:
		return nil, errors.New("unknown command type")
	}
}

func decodeStart(w wireCommand) (startConfig, error) {
	if w.StateDir == "" || !filepath.IsAbs(w.StateDir) {
		return startConfig{}, errors.New("stateDir must be an absolute path")
	}
	if w.Hostname == "" {
		return startConfig{}, errors.New("hostname is required")
	}
	controlURL := deref(w.ControlURL)
	if controlURL != "" {
		u, err := url.Parse(controlURL)
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return startConfig{}, errors.New("controlUrl must be an absolute http(s) URL")
		}
	}
	ingress, err := netip.ParseAddrPort(w.IngressAddress)
	if err != nil || !ingress.Addr().IsLoopback() || ingress.Port() == 0 {
		return startConfig{}, errors.New("ingressAddress must be a loopback ip:port")
	}
	if !validSecret(w.IngressSecret) {
		return startConfig{}, errors.New("ingressSecret must be 16-512 characters of [A-Za-z0-9._~+/=-]")
	}
	return startConfig{
		StateDir:       w.StateDir,
		Hostname:       w.Hostname,
		ControlURL:     controlURL,
		AuthKey:        deref(w.AuthKey),
		AdvertiseTags:  append([]string{}, w.AdvertiseTags...),
		IngressAddress: ingress,
		IngressSecret:  w.IngressSecret,
		Verbose:        w.Verbose,
	}, nil
}

func validSecret(s string) bool {
	if len(s) < minSecretBytes || len(s) > maxSecretBytes {
		return false
	}
	for i := range len(s) {
		c := s[i]
		ok := 'a' <= c && c <= 'z' || 'A' <= c && c <= 'Z' || '0' <= c && c <= '9'
		switch c {
		case '.', '_', '~', '+', '/', '=', '-':
			ok = true
		}
		if !ok {
			return false
		}
	}
	return true
}

func deref(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

type errorCode string

const (
	errBadCommand        errorCode = "bad-command"
	errStartFailed       errorCode = "start-failed"
	errLoginFailed       errorCode = "login-failed"
	errLogoutFailed      errorCode = "logout-failed"
	errListenFailed      errorCode = "listen-failed"
	errCertificateFailed errorCode = "certificate-failed"
	errIngressFailed     errorCode = "ingress-failed"
)

type eventHeader struct {
	Version int    `json:"version"`
	Type    string `json:"type"`
}

func header(eventType string) eventHeader {
	return eventHeader{Version: protocolVersion, Type: eventType}
}

type helloEvent struct {
	eventHeader
	TailscaleVersion string `json:"tailscaleVersion"`
}

type statusEvent struct {
	eventHeader
	Status status `json:"status"`
}

type errorEvent struct {
	eventHeader
	Code    errorCode `json:"code"`
	Message string    `json:"message"`
}

type emitter struct {
	mu         sync.Mutex
	w          io.Writer
	finished   bool
	lastStatus []byte
}

func newEmitter(w io.Writer) *emitter { return &emitter{w: w} }

func (e *emitter) hello(tailscaleVersion string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.writeLocked(helloEvent{header("hello"), tailscaleVersion})
}

func (e *emitter) error(code errorCode, message string) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.writeLocked(errorEvent{header("error"), code, message})
}

func (e *emitter) status(s status) {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.statusLocked(s)
}

func (e *emitter) finish() {
	e.mu.Lock()
	defer e.mu.Unlock()
	e.statusLocked(stateOnly("stopped"))
	e.finished = true
}

func (e *emitter) statusLocked(s status) {
	encoded, err := json.Marshal(s)
	if err != nil || string(encoded) == string(e.lastStatus) {
		return
	}
	if e.writeLocked(statusEvent{header("status"), s}) {
		e.lastStatus = encoded
	}
}

func (e *emitter) writeLocked(event any) bool {
	if e.finished {
		return false
	}
	line, err := json.Marshal(event)
	if err != nil {
		return false
	}
	_, err = e.w.Write(append(line, '\n'))
	return err == nil
}
