package main

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/netip"
	"sync"
	"time"
	"unicode/utf8"

	"tailscale.com/client/local"
	"tailscale.com/client/tailscale/apitype"
	"tailscale.com/tsnet"
)

const (
	maxPreambleBytes  = 4096
	maxLoginBytes     = 512
	whoIsTimeout      = 5 * time.Second
	dialTimeout       = 5 * time.Second
	handshakeTimeout  = 10 * time.Second
	ingressErrorEvery = 10 * time.Second
)

type identity struct {
	Login string `json:"login"`
}

type preamble struct {
	Version       int       `json:"version"`
	Secret        string    `json:"secret"`
	TLS           bool      `json:"tls"`
	RemoteAddress string    `json:"remoteAddress"`
	RemotePort    uint16    `json:"remotePort"`
	Identity      *identity `json:"identity"`
}

// Admission compares the whole login, so a login that cannot be sent whole is sent as no identity.
func identityFromWhoIs(who *apitype.WhoIsResponse) *identity {
	if who == nil || who.Node == nil || who.UserProfile == nil {
		return nil
	}
	login := who.UserProfile.LoginName
	if login == "" || len(login) > maxLoginBytes || !utf8.ValidString(login) {
		return nil
	}
	return &identity{Login: login}
}

func encodePreamble(p preamble) []byte {
	line, _ := json.Marshal(p)
	return append(line, '\n')
}

type listenWant struct {
	plain bool
	tls   bool
}

type liveListener struct {
	net.Listener
	done chan struct{}
}

func (l *liveListener) alive() bool {
	select {
	case <-l.done:
		return false
	default:
		return true
	}
}

type ingress struct {
	ctx    context.Context
	srv    *tsnet.Server
	lc     *local.Client
	target netip.AddrPort
	secret string
	emit   *emitter
	red    redactor
	failed throttle

	plain *liveListener
	tls   *liveListener
}

func (g *ingress) sync(w listenWant) {
	g.plain = g.toggle(g.plain, w.plain, ":80", false)
	g.tls = g.toggle(g.tls, w.tls, ":443", true)
}

func (g *ingress) toggle(ln *liveListener, want bool, addr string, isTLS bool) *liveListener {
	if ln != nil && (!want || !ln.alive()) {
		ln.Close()
		ln = nil
	}
	if !want || ln != nil {
		return ln
	}
	opened, err := g.srv.Listen("tcp", addr)
	if err != nil {
		g.fail(errListenFailed, err)
		return nil
	}
	if isTLS {
		opened = tls.NewListener(opened, &tls.Config{GetCertificate: g.lc.GetCertificate})
	}
	live := &liveListener{Listener: opened, done: make(chan struct{})}
	go g.serve(live)
	return live
}

func (g *ingress) serve(ln *liveListener) {
	defer close(ln.done)
	for {
		conn, err := ln.Accept()
		if err != nil {
			if !errors.Is(err, net.ErrClosed) {
				g.fail(errListenFailed, err)
			}
			return
		}
		go g.handle(conn)
	}
}

func (g *ingress) handle(conn net.Conn) {
	tc, isTLS := conn.(*tls.Conn)
	if isTLS {
		ctx, cancel := context.WithTimeout(g.ctx, handshakeTimeout)
		err := tc.HandshakeContext(ctx)
		cancel()
		if err != nil {
			conn.Close()
			return
		}
	}
	p := preamble{Version: protocolVersion, Secret: g.secret, TLS: isTLS}
	if tcp, ok := conn.RemoteAddr().(*net.TCPAddr); ok {
		remote := tcp.AddrPort()
		p.RemoteAddress = remote.Addr().Unmap().String()
		p.RemotePort = remote.Port()
	}
	ctx, cancel := context.WithTimeout(g.ctx, whoIsTimeout)
	if who, err := g.lc.WhoIs(ctx, conn.RemoteAddr().String()); err == nil {
		p.Identity = identityFromWhoIs(who)
	}
	cancel()

	dialer := net.Dialer{Timeout: dialTimeout}
	upstream, err := dialer.DialContext(g.ctx, "tcp", g.target.String())
	if err != nil {
		conn.Close()
		g.fail(errIngressFailed, err)
		return
	}
	if _, err := upstream.Write(encodePreamble(p)); err != nil {
		conn.Close()
		upstream.Close()
		g.fail(errIngressFailed, err)
		return
	}
	splice(conn, upstream)
}

func (g *ingress) fail(code errorCode, err error) {
	if g.failed.allow(time.Now()) {
		g.emit.error(code, g.red.err(err))
	}
}

func splice(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Go(func() { pipe(b, a) })
	wg.Go(func() { pipe(a, b) })
	wg.Wait()
	a.Close()
	b.Close()
}

func pipe(dst, src net.Conn) {
	if _, err := io.Copy(dst, src); err != nil {
		src.Close()
		dst.Close()
		return
	}
	if cw, ok := dst.(interface{ CloseWrite() error }); ok && cw.CloseWrite() == nil {
		return
	}
	dst.Close()
}

type throttle struct {
	mu    sync.Mutex
	every time.Duration
	last  time.Time
}

func (t *throttle) allow(now time.Time) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if !t.last.IsZero() && now.Sub(t.last) < t.every {
		return false
	}
	t.last = now
	return true
}
