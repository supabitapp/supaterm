package main

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"
	"time"

	tailscaleroot "tailscale.com"
	"tailscale.com/envknob"
	"tailscale.com/logtail"
	"tailscale.com/types/logger"
)

const (
	maxCommandBytes = 64 << 10
	commandQueue    = 16
	shutdownTimeout = 5 * time.Second
)

func main() {
	stdout := os.Stdout
	if devnull, err := os.OpenFile(os.DevNull, os.O_WRONLY, 0); err == nil {
		os.Stdout = devnull
	}
	log.SetOutput(io.Discard)
	os.Exit(run(os.Args[1:], os.Stdin, stdout, os.Stderr))
}

func tailscaleVersion() string {
	return strings.TrimSpace(tailscaleroot.VersionDotTxt)
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	switch {
	case len(args) == 1 && args[0] == "--version":
		fmt.Fprintf(stdout, "supaterm-tailnet %s\n", tailscaleVersion())
		return 0
	case len(args) > 0:
		fmt.Fprintln(stderr, "usage: supaterm-tailnet [--version]")
		return 2
	}

	signal.Ignore(syscall.SIGPIPE)
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	emit := newEmitter(stdout)
	defer emit.finish()
	emit.hello(tailscaleVersion())

	starts := make(chan startConfig, 1)
	cmds := make(chan command, commandQueue)
	go func() {
		defer cancel()
		readCommands(stdin, emit, starts, cmds)
	}()

	select {
	case <-ctx.Done():
		return 0
	case cfg := <-starts:
		return serve(ctx, cfg, emit, cmds, stderr)
	}
}

func serve(ctx context.Context, cfg startConfig, emit *emitter, cmds <-chan command, stderr io.Writer) int {
	red := newRedactor(cfg)
	var logf logger.Logf
	if cfg.Verbose {
		logf = filteredLogf(stderr, red)
		log.SetOutput(logfWriter(logf))
	}
	envknob.SetNoLogsNoSupport()
	logtail.Disable()
	srv := newServer(cfg, logf)

	started := make(chan error, 1)
	go func() { started <- srv.Start() }()
	select {
	case <-ctx.Done():
		return 0
	case err := <-started:
		if err != nil {
			emit.error(errStartFailed, red.err(err))
			return 1
		}
	}
	lc, err := srv.LocalClient()
	if err != nil {
		emit.error(errStartFailed, red.err(err))
		return 1
	}

	n := newNode(cfg, srv, lc, emit, red)
	var wg sync.WaitGroup
	wg.Go(func() { n.watchBus(ctx) })
	wg.Go(func() { n.monitor(ctx) })
	wg.Go(func() { n.runCommands(ctx, cmds) })
	<-ctx.Done()

	closed := make(chan struct{})
	go func() {
		wg.Wait()
		srv.Close()
		close(closed)
	}()
	select {
	case <-closed:
	case <-time.After(shutdownTimeout):
	}
	return 0
}

func readCommands(r io.Reader, emit *emitter, starts chan<- startConfig, cmds chan<- command) {
	started := false
	scanLines(r, func(line []byte, tooLong bool) {
		if tooLong {
			emit.error(errBadCommand, "command line too long")
			return
		}
		cmd, err := decodeCommand(line)
		if err != nil {
			emit.error(errBadCommand, err.Error())
			return
		}
		switch cmd := cmd.(type) {
		case startConfig:
			if started {
				emit.error(errBadCommand, "node already started")
				return
			}
			started = true
			starts <- cmd
		default:
			if !started {
				emit.error(errBadCommand, "the first command must be start")
				return
			}
			select {
			case cmds <- cmd:
			default:
				emit.error(errBadCommand, "too many pending commands")
			}
		}
	})
}

func scanLines(r io.Reader, each func(line []byte, tooLong bool)) {
	br := bufio.NewReaderSize(r, maxCommandBytes)
	for {
		line, err := br.ReadSlice('\n')
		if errors.Is(err, bufio.ErrBufferFull) {
			for errors.Is(err, bufio.ErrBufferFull) {
				_, err = br.ReadSlice('\n')
			}
			each(nil, true)
		} else if line = bytes.TrimSpace(line); len(line) > 0 {
			each(line, false)
		}
		if err != nil {
			return
		}
	}
}
