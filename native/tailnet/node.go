package main

import (
	"context"
	"os"
	"time"

	"tailscale.com/client/local"
	"tailscale.com/ipn"
	"tailscale.com/ipn/ipnstate"
	"tailscale.com/tsnet"
	"tailscale.com/types/logger"
)

const (
	busRetryDelay      = time.Second
	statusPollInterval = 30 * time.Second
	statusTimeout      = 10 * time.Second
	loginURLGrace      = 10 * time.Second
	commandTimeout     = 30 * time.Second
	certTimeout        = 2 * time.Minute
	certRecheck        = 12 * time.Hour
)

var certBackoff = []time.Duration{30 * time.Second, time.Minute, 5 * time.Minute}

// tsnet reads these when the matching Server field is empty.
var tsnetEnv = []string{
	"TS_AUTHKEY", "TS_AUTH_KEY", "TS_CLIENT_SECRET", "TS_CLIENT_ID",
	"TS_ID_TOKEN", "TS_AUDIENCE", "TS_CONTROL_URL", "TSNET_FORCE_LOGIN",
}

func newServer(cfg startConfig, logf logger.Logf) *tsnet.Server {
	for _, name := range tsnetEnv {
		os.Unsetenv(name)
	}
	return &tsnet.Server{
		Dir:           cfg.StateDir,
		Hostname:      cfg.Hostname,
		ControlURL:    cfg.ControlURL,
		AuthKey:       cfg.AuthKey,
		AdvertiseTags: cfg.AdvertiseTags,
		UserLogf:      logger.Discard,
		Logf:          logf,
	}
}

type commandEvent int

const (
	commandStarted commandEvent = iota
	commandSettled
)

type certResult struct {
	domain string
	https  httpsStatus
}

type node struct {
	cfg  startConfig
	srv  *tsnet.Server
	lc   *local.Client
	emit *emitter
	red  redactor

	notes  chan ipn.Notify
	logins chan commandEvent
	certs  chan certResult
}

func newNode(cfg startConfig, srv *tsnet.Server, lc *local.Client, emit *emitter, red redactor) *node {
	return &node{
		cfg:    cfg,
		srv:    srv,
		lc:     lc,
		emit:   emit,
		red:    red,
		notes:  make(chan ipn.Notify),
		logins: make(chan commandEvent),
		certs:  make(chan certResult),
	}
}

func (n *node) watchBus(ctx context.Context) {
	for ctx.Err() == nil {
		n.watchOnce(ctx)
		select {
		case <-ctx.Done():
		case <-time.After(busRetryDelay):
		}
	}
}

func (n *node) watchOnce(ctx context.Context) {
	watcher, err := n.lc.WatchIPNBus(ctx, ipn.NotifyInitialState)
	if err != nil {
		return
	}
	defer watcher.Close()
	for {
		note, err := watcher.Next()
		if err != nil {
			return
		}
		select {
		case n.notes <- note:
		case <-ctx.Done():
			return
		}
	}
}

func (n *node) runCommands(ctx context.Context, cmds <-chan command) {
	for {
		select {
		case <-ctx.Done():
			return
		case cmd := <-cmds:
			n.execute(ctx, cmd)
		}
	}
}

func (n *node) execute(ctx context.Context, cmd command) {
	cctx, cancel := context.WithTimeout(ctx, commandTimeout)
	defer cancel()
	switch cmd.(type) {
	case loginCommand:
		n.signal(ctx, commandStarted)
		if err := n.login(cctx); err != nil {
			n.signal(ctx, commandSettled)
			n.emit.error(errLoginFailed, n.red.err(err))
		}
	case logoutCommand:
		n.signal(ctx, commandStarted)
		err := n.lc.Logout(cctx)
		n.signal(ctx, commandSettled)
		if err != nil {
			n.emit.error(errLogoutFailed, n.red.err(err))
		}
	}
}

func (n *node) login(ctx context.Context) error {
	prefs, err := n.lc.GetPrefs(ctx)
	if err != nil {
		return err
	}
	if !prefs.WantRunning {
		if err := n.lc.Start(ctx, ipn.Options{UpdatePrefs: n.prefs()}); err != nil {
			return err
		}
	}
	return n.lc.StartLoginInteractive(ctx)
}

// Mirrors the prefs tsnet.Server.Start applies; Logout replaces them with defaults.
func (n *node) prefs() *ipn.Prefs {
	p := ipn.NewPrefs()
	p.Hostname = n.cfg.Hostname
	p.WantRunning = true
	p.ControlURL = n.cfg.ControlURL
	p.AdvertiseTags = n.cfg.AdvertiseTags
	return p
}

func (n *node) signal(ctx context.Context, ev commandEvent) {
	select {
	case n.logins <- ev:
	case <-ctx.Done():
	}
}

type monitor struct {
	*node
	ingress *ingress

	ipnState    ipn.State
	loginURL    string
	awaitingURL bool
	awaitTimer  <-chan time.Time
	status      *ipnstate.Status
	cert        certState
	certCancel  context.CancelFunc
}

func (n *node) monitor(ctx context.Context) {
	m := &monitor{
		node: n,
		ingress: &ingress{
			ctx:    ctx,
			srv:    n.srv,
			lc:     n.lc,
			target: n.cfg.IngressAddress,
			secret: n.cfg.IngressSecret,
			emit:   n.emit,
			red:    n.red,
			failed: throttle{every: ingressErrorEvery},
		},
	}
	m.awaitLoginURL()
	defer m.shutdown()
	poll := time.NewTicker(statusPollInterval)
	defer poll.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case note := <-n.notes:
			m.apply(note)
			m.refresh(ctx)
		case <-poll.C:
			m.refresh(ctx)
		case ev := <-n.logins:
			m.onLogin(ev)
		case <-m.awaitTimer:
			m.awaitingURL, m.awaitTimer = false, nil
		case r := <-n.certs:
			m.onCert(r)
		}
		m.reconcile(ctx)
	}
}

func (m *monitor) apply(note ipn.Notify) {
	if note.State != nil {
		m.ipnState = mergeState(m.ipnState, *note.State)
		if m.ipnState != ipn.NeedsLogin {
			m.loginURL = ""
		}
	}
	if note.BrowseToURL != nil && *note.BrowseToURL != "" {
		m.loginURL = *note.BrowseToURL
		m.awaitingURL, m.awaitTimer = false, nil
	}
	if note.ErrMessage != nil {
		m.emit.error(errStartFailed, m.red.text(*note.ErrMessage))
	}
}

func (m *monitor) refresh(ctx context.Context) {
	ctx, cancel := context.WithTimeout(ctx, statusTimeout)
	defer cancel()
	if st, err := m.lc.StatusWithoutPeers(ctx); err == nil {
		m.status = st
	}
}

func (m *monitor) onLogin(ev commandEvent) {
	switch ev {
	case commandStarted:
		m.loginURL = ""
		m.awaitLoginURL()
	case commandSettled:
		m.awaitingURL, m.awaitTimer = false, nil
	}
}

func (m *monitor) awaitLoginURL() {
	m.awaitingURL, m.awaitTimer = true, time.After(loginURLGrace)
}

func (m *monitor) onCert(r certResult) {
	if r.domain != m.cert.Domain {
		return
	}
	previous := m.cert.HTTPS
	m.cert.HTTPS = r.https
	if r.https.Phase == httpsFailed && r.https != previous {
		m.emit.error(errCertificateFailed, r.https.Error)
	}
}

func (m *monitor) reconcile(ctx context.Context) {
	running := m.ipnState == ipn.Running && selfReady(m.status)
	domain := ""
	if running {
		domain = certDomain(m.status)
	}
	m.syncCert(ctx, domain)
	m.ingress.sync(listenWant{plain: running, tls: domain != ""})
	m.emit.status(deriveStatus(observation{
		State:            m.ipnState,
		LoginURL:         m.loginURL,
		AwaitingLoginURL: m.awaitingURL,
		Status:           m.status,
		Cert:             m.cert,
	}))
}

func (m *monitor) syncCert(ctx context.Context, domain string) {
	if domain == m.cert.Domain {
		return
	}
	if m.certCancel != nil {
		m.certCancel()
		m.certCancel = nil
	}
	m.cert = certState{Domain: domain, HTTPS: httpsStatus{Phase: httpsProvisioning}}
	if domain == "" {
		return
	}
	ctx, m.certCancel = context.WithCancel(ctx)
	go fetchCerts(ctx, m.lc, domain, m.red, m.certs)
}

func (m *monitor) shutdown() {
	m.syncCert(context.Background(), "")
	m.ingress.sync(listenWant{})
}

func fetchCerts(ctx context.Context, lc *local.Client, domain string, red redactor, out chan<- certResult) {
	attempt := 0
	for {
		fctx, cancel := context.WithTimeout(ctx, certTimeout)
		_, _, err := lc.CertPair(fctx, domain)
		cancel()
		if ctx.Err() != nil {
			return
		}
		result := certResult{domain: domain, https: httpsStatus{Phase: httpsReady}}
		wait := certRecheck
		if err != nil {
			result.https = httpsStatus{Phase: httpsFailed, Error: red.err(err)}
			wait = certRetryDelay(attempt, err)
			attempt++
		} else {
			attempt = 0
		}
		select {
		case out <- result:
		case <-ctx.Done():
			return
		}
		select {
		case <-time.After(wait):
		case <-ctx.Done():
			return
		}
	}
}

func certRetryDelay(attempt int, err error) time.Duration {
	delay := certBackoff[min(attempt, len(certBackoff)-1)]
	if retryAfter, ok := local.RateLimitRetryAfter(err); ok && retryAfter > delay {
		return retryAfter
	}
	return delay
}
