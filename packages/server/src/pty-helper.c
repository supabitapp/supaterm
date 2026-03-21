/*
 * pty-helper: spawn a shell inside a PTY and relay I/O via stdin/stdout.
 *
 * Usage: pty-helper <shell> <cols> <rows>
 *
 * stdin  → written to PTY master (user input)
 * stdout → PTY master output (terminal output, binary)
 * stderr → status messages (JSON)
 *
 * Resize: send "\x1b[8;<rows>;<cols>t" to stdin (DECSCR)
 * Or: send SIGWINCH to this process
 */

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <sys/ioctl.h>
#include <sys/select.h>
#include <sys/wait.h>
#include <signal.h>
#include <errno.h>
#include <fcntl.h>
#include <termios.h>
#ifdef __APPLE__
#include <util.h>
#else
#include <pty.h>
#endif

static int master_fd = -1;
static pid_t child_pid = -1;
static volatile sig_atomic_t got_sigchld = 0;

static void sigchld_handler(int sig) {
    (void)sig;
    got_sigchld = 1;
}

int main(int argc, char *argv[]) {
    if (argc < 4) {
        fprintf(stderr, "{\"error\":\"usage: pty-helper <shell> <cols> <rows>\"}\n");
        return 1;
    }

    const char *shell = argv[1];
    int cols = atoi(argv[2]);
    int rows = atoi(argv[3]);

    struct winsize ws = {
        .ws_row = (unsigned short)rows,
        .ws_col = (unsigned short)cols,
        .ws_xpixel = 0,
        .ws_ypixel = 0,
    };

    /* Set up SIGCHLD handler */
    struct sigaction sa;
    memset(&sa, 0, sizeof(sa));
    sa.sa_handler = sigchld_handler;
    sigaction(SIGCHLD, &sa, NULL);

    child_pid = forkpty(&master_fd, NULL, NULL, &ws);
    if (child_pid < 0) {
        fprintf(stderr, "{\"error\":\"forkpty failed\"}\n");
        return 1;
    }

    if (child_pid == 0) {
        /* Child: exec the shell */
        /* Pass through environment from parent */
        execlp(shell, shell, "-l", NULL);
        _exit(127);
    }

    /* Parent: relay I/O */
    fprintf(stderr, "{\"pid\":%d,\"fd\":%d}\n", child_pid, master_fd);
    fflush(stderr);

    /* Set stdin to non-blocking */
    int flags = fcntl(STDIN_FILENO, F_GETFL, 0);
    fcntl(STDIN_FILENO, F_SETFL, flags | O_NONBLOCK);

    /* Set master_fd to non-blocking */
    flags = fcntl(master_fd, F_GETFL, 0);
    fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);

    char buf[65536];

    for (;;) {
        if (got_sigchld) {
            /* Check if child exited */
            int status;
            pid_t ret = waitpid(child_pid, &status, WNOHANG);
            if (ret > 0) {
                /* Drain remaining output */
                for (;;) {
                    ssize_t n = read(master_fd, buf, sizeof(buf));
                    if (n <= 0) break;
                    write(STDOUT_FILENO, buf, (size_t)n);
                }
                int code = WIFEXITED(status) ? WEXITSTATUS(status) : 1;
                fprintf(stderr, "{\"exit\":%d}\n", code);
                fflush(stderr);
                break;
            }
        }

        fd_set rfds;
        FD_ZERO(&rfds);
        FD_SET(STDIN_FILENO, &rfds);
        FD_SET(master_fd, &rfds);
        int maxfd = master_fd > STDIN_FILENO ? master_fd : STDIN_FILENO;

        struct timeval tv = { .tv_sec = 0, .tv_usec = 50000 }; /* 50ms */
        int ret = select(maxfd + 1, &rfds, NULL, NULL, &tv);
        if (ret < 0) {
            if (errno == EINTR) continue;
            break;
        }

        /* Read from stdin → write to PTY */
        if (FD_ISSET(STDIN_FILENO, &rfds)) {
            ssize_t n = read(STDIN_FILENO, buf, sizeof(buf));
            if (n <= 0) {
                /* stdin closed → kill child */
                kill(child_pid, SIGHUP);
                break;
            }
            /* Check for resize escape: \x1bPTYRESIZE;<rows>;<cols>\x1b\\ */
            if (n > 12 && memcmp(buf, "\x1bPTYRESIZE;", 11) == 0) {
                int r = 0, c = 0;
                sscanf(buf + 11, "%d;%d", &r, &c);
                if (r > 0 && c > 0) {
                    struct winsize nws = { .ws_row = (unsigned short)r, .ws_col = (unsigned short)c };
                    ioctl(master_fd, TIOCSWINSZ, &nws);
                    continue;
                }
            }
            write(master_fd, buf, (size_t)n);
        }

        /* Read from PTY → write to stdout */
        if (FD_ISSET(master_fd, &rfds)) {
            ssize_t n = read(master_fd, buf, sizeof(buf));
            if (n <= 0) {
                if (errno == EIO) break; /* PTY closed */
                if (errno != EAGAIN) break;
            } else {
                write(STDOUT_FILENO, buf, (size_t)n);
            }
        }
    }

    close(master_fd);
    return 0;
}
