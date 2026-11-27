package main

import (
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"

	"tailscale.com/types/logger"
)

var (
	urlPattern     = regexp.MustCompile(`(?i)[a-z][a-z0-9+.-]*://[^\s"'<>]+`)
	authKeyPattern = regexp.MustCompile(`(?i)tskey-[^\s"'<>]*`)
)

type redactor struct {
	secrets []string
}

func newRedactor(cfg startConfig) redactor {
	var r redactor
	for _, s := range []string{cfg.IngressSecret, cfg.AuthKey} {
		if s != "" {
			r.secrets = append(r.secrets, s)
		}
	}
	return r
}

func (r redactor) text(s string) string {
	for _, secret := range r.secrets {
		s = strings.ReplaceAll(s, secret, "[redacted]")
	}
	s = authKeyPattern.ReplaceAllString(s, "[redacted]")
	return urlPattern.ReplaceAllString(s, "[url]")
}

func (r redactor) err(err error) string { return r.text(err.Error()) }

func filteredLogf(w io.Writer, r redactor) logger.Logf {
	var mu sync.Mutex
	return func(format string, args ...any) {
		line := r.text(fmt.Sprintf(format, args...))
		mu.Lock()
		defer mu.Unlock()
		io.WriteString(w, strings.TrimRight(line, "\n")+"\n")
	}
}

type logfWriter logger.Logf

func (f logfWriter) Write(p []byte) (int, error) {
	f("%s", p)
	return len(p), nil
}
