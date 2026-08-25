const std = @import("std");
const ghostty_vt = @import("ghostty-vt");
const ipc = @import("ipc.zig");
const util = @import("util.zig");
const cross = @import("cross.zig");
const socket = @import("socket.zig");
const terminal_replay = @import("terminal_replay.zig");
const lib_posix = @import("posix.zig");
const Cfg = @import("cfg.zig");
const signal = @import("signal.zig");
const assert = std.debug.assert;
const daemonize = @import("daemonize.zig");
const builtin = @import("builtin");

const terminal_continuation_max_bytes = 1024 * 1024;

/// clientLoop sends ipc commands to its corresponding daemon.  It uses poll() as its non-blocking
/// mechanism. It will send stdin to the daemon and receive stdout from the daemon.
pub fn clientLoop(client_sock_fd: i32) !void {
    const gpa: std.mem.Allocator = blk: {
        if (builtin.mode == .Debug) {
            const GPA = std.heap.DebugAllocator(.{});
            const Static = struct {
                var gpa: GPA = .{};
            };
            break :blk Static.gpa.allocator();
        }
        break :blk std.heap.c_allocator;
    };
    defer lib_posix.close(client_sock_fd);

    try signal.openSignalPipe();
    signal.installWakeHandler(@intFromEnum(lib_posix.SIG.WINCH));

    // Make socket non-blocking to avoid blocking on writes
    var sock_flags = try lib_posix.fcntl(client_sock_fd, lib_posix.F.GETFL, 0);
    sock_flags |= lib_posix.O_NONBLOCK;
    _ = try lib_posix.fcntl(client_sock_fd, lib_posix.F.SETFL, sock_flags);

    // Buffer for outgoing socket writes
    var sock_write_buf = try std.ArrayList(u8).initCapacity(gpa, 4096);
    defer sock_write_buf.deinit(gpa);

    // Send init message with terminal size (buffered)
    const size = ipc.getTerminalSize(lib_posix.STDOUT_FILENO);
    try ipc.appendMessage(gpa, &sock_write_buf, .Init, std.mem.asBytes(&size));

    var poll_fds = try std.ArrayList(lib_posix.pollfd).initCapacity(gpa, 4);
    defer poll_fds.deinit(gpa);

    var read_buf = try ipc.SocketBuffer.init(gpa);
    defer read_buf.deinit();

    var stdout_buf = try std.ArrayList(u8).initCapacity(gpa, 4096);
    defer stdout_buf.deinit(gpa);

    const stdin_fd = lib_posix.STDIN_FILENO;

    // Make stdin non-blocking. O_NONBLOCK is set on the open file description,
    // which is shared with the parent shell; restore on exit to avoid
    // corrupting the parent's stdin.
    const stdin_orig_flags = try lib_posix.fcntl(stdin_fd, lib_posix.F.GETFL, 0);
    _ = try lib_posix.fcntl(stdin_fd, lib_posix.F.SETFL, stdin_orig_flags | lib_posix.O_NONBLOCK);
    defer _ = lib_posix.fcntl(stdin_fd, lib_posix.F.SETFL, stdin_orig_flags) catch {};

    const detach_key_disabled = util.isDetachKeyDisabled();

    while (true) {
        poll_fds.clearRetainingCapacity();

        try poll_fds.append(gpa, .{
            .fd = stdin_fd,
            .events = lib_posix.POLL.IN,
            .revents = 0,
        });

        // Poll socket for read, and also for write if we have pending data
        var sock_events: i16 = lib_posix.POLL.IN;
        if (sock_write_buf.items.len > 0) {
            sock_events |= lib_posix.POLL.OUT;
        }
        try poll_fds.append(gpa, .{
            .fd = client_sock_fd,
            .events = sock_events,
            .revents = 0,
        });

        try poll_fds.append(gpa, .{ .fd = signal.sig_pipe[0], .events = lib_posix.POLL.IN, .revents = 0 });

        if (stdout_buf.items.len > 0) {
            try poll_fds.append(gpa, .{
                .fd = lib_posix.STDOUT_FILENO,
                .events = lib_posix.POLL.OUT,
                .revents = 0,
            });
        }

        _ = try lib_posix.poll(poll_fds.items, -1);

        if (poll_fds.items[2].revents & lib_posix.POLL.IN != 0) {
            signal.drainSignalPipe();
            const next_size = ipc.getTerminalSize(lib_posix.STDOUT_FILENO);
            try ipc.appendMessage(gpa, &sock_write_buf, .Resize, std.mem.asBytes(&next_size));
        }

        // Handle stdin -> socket (Input)
        const inp_flags = (lib_posix.POLL.IN | lib_posix.POLL.HUP | lib_posix.POLL.ERR | lib_posix.POLL.NVAL);
        if (poll_fds.items[0].revents & inp_flags != 0) {
            var buf: [4096]u8 = undefined;
            const n_opt: ?usize = lib_posix.read(stdin_fd, &buf) catch |err| blk: {
                if (err == error.WouldBlock) break :blk null;
                return err;
            };

            if (n_opt) |n| {
                if (n > 0) {
                    // Check for detach sequences (ctrl+\ as first byte or Kitty escape sequence)
                    if (!detach_key_disabled and util.isCtrlBackslash(buf[0..n])) {
                        try ipc.appendMessage(gpa, &sock_write_buf, .Detach, "");
                    } else {
                        try ipc.appendMessage(gpa, &sock_write_buf, .Input, buf[0..n]);
                    }
                } else {
                    // EOF on stdin
                    return;
                }
            }
        }

        // Handle socket read (incoming Output messages from daemon)
        if (poll_fds.items[1].revents & lib_posix.POLL.IN != 0) {
            const n = read_buf.read(client_sock_fd) catch |err| {
                if (err == error.WouldBlock) continue;
                if (err == error.ConnectionResetByPeer or err == error.BrokenPipe) {
                    return;
                }
                return err;
            };
            if (n == 0) {
                // Server closed connection
                return;
            }

            while (read_buf.next()) |msg| {
                switch (msg.header.tag) {
                    .Output => {
                        if (msg.payload.len > 0) {
                            try stdout_buf.appendSlice(gpa, msg.payload);
                        }
                    },
                    .Resize => {
                        // daemon is asking for the client's window size usually in response
                        // to this client being set as leader.
                        const next_size = ipc.getTerminalSize(lib_posix.STDOUT_FILENO);
                        try ipc.appendMessage(
                            gpa,
                            &sock_write_buf,
                            .Resize,
                            std.mem.asBytes(&next_size),
                        );
                    },
                    else => {},
                }
            }
        }

        // Handle socket write (flush buffered messages to daemon)
        if (poll_fds.items[1].revents & lib_posix.POLL.OUT != 0) {
            if (sock_write_buf.items.len > 0) {
                const n = lib_posix.write(client_sock_fd, sock_write_buf.items) catch |err| blk: {
                    if (err == error.WouldBlock) break :blk 0;
                    if (err == error.ConnectionResetByPeer or err == error.BrokenPipe) {
                        return;
                    }
                    return err;
                };
                if (n > 0) {
                    try sock_write_buf.replaceRange(gpa, 0, n, &[_]u8{});
                }
            }
        }

        if (stdout_buf.items.len > 0) {
            const n = lib_posix.write(lib_posix.STDOUT_FILENO, stdout_buf.items) catch |err| blk: {
                if (err == error.WouldBlock) break :blk 0;
                return err;
            };
            if (n > 0) {
                try stdout_buf.replaceRange(gpa, 0, n, &[_]u8{});
            }
        }

        if (poll_fds.items[1].revents & (lib_posix.POLL.HUP | lib_posix.POLL.ERR | lib_posix.POLL.NVAL) != 0) {
            return;
        }
    }
}

/// dameonLoop is what the daemon runs to send and receive ipc commands from its corresponding
/// clients.  It uses poll() as its non-blocking mechanism.
fn daemonLoop(daemon: *Daemon, gpa: std.mem.Allocator, io: std.Io, server_sock_fd: lib_posix.socket_t, pty_fd: i32) !void {
    try signal.openSignalPipe();
    signal.installWakeHandler(@intFromEnum(lib_posix.SIG.TERM));
    var poll_fds = try std.ArrayList(lib_posix.pollfd).initCapacity(gpa, 8);
    defer poll_fds.deinit(gpa);

    const init_size = ipc.getTerminalSize(pty_fd);
    var term = try ghostty_vt.Terminal.init(io, gpa, .{
        .cols = init_size.cols,
        .rows = init_size.rows,
        .max_scrollback_lines = 2_000,
    });
    defer term.deinit(gpa);
    var vt_stream = ghostty_vt.TerminalStream.init(.{
        .allocator = gpa,
        .handler = term.vtHandler(),
        .continuation_max_bytes = terminal_continuation_max_bytes,
    });
    defer vt_stream.deinit();

    daemon_loop: while (daemon.running) {
        poll_fds.clearRetainingCapacity();

        try poll_fds.append(gpa, .{
            .fd = server_sock_fd,
            .events = lib_posix.POLL.IN,
            .revents = 0,
        });

        var pty_events: i16 = lib_posix.POLL.IN;
        if (daemon.pty_write_buf.items.len > 0) {
            pty_events |= lib_posix.POLL.OUT;
        }
        try poll_fds.append(gpa, .{
            .fd = pty_fd,
            .events = pty_events,
            .revents = 0,
        });

        try poll_fds.append(gpa, .{ .fd = signal.sig_pipe[0], .events = lib_posix.POLL.IN, .revents = 0 });

        for (daemon.clients.items) |client| {
            var events: i16 = lib_posix.POLL.IN;
            if (client.has_pending_output) {
                events |= lib_posix.POLL.OUT;
            }
            try poll_fds.append(gpa, .{
                .fd = client.socket_fd,
                .events = events,
                .revents = 0,
            });
        }

        _ = try lib_posix.poll(poll_fds.items, -1);

        if (poll_fds.items[2].revents & lib_posix.POLL.IN != 0) {
            signal.drainSignalPipe();
            break :daemon_loop;
        }

        if (poll_fds.items[0].revents & (lib_posix.POLL.ERR | lib_posix.POLL.HUP | lib_posix.POLL.NVAL) != 0) {
            break :daemon_loop;
        } else if (poll_fds.items[0].revents & lib_posix.POLL.IN != 0) {
            const client_fd = try lib_posix.accept(
                server_sock_fd,
                null,
                null,
                lib_posix.SOCK.NONBLOCK | lib_posix.SOCK.CLOEXEC,
            );
            const client = try gpa.create(Client);
            client.* = Client{
                .alloc = gpa,
                .socket_fd = client_fd,
                .read_buf = try ipc.SocketBuffer.init(gpa),
                .write_buf = undefined,
            };
            // 64KB initial capacity lets ~15 broadcast cycles (N_TTY_BUF_SIZE reads
            // * header) accumulate before the first ArrayList growth. The write
            // buffer is userspace-only: it drains via POLLOUT to the client socket,
            // which has no corresponding kernel-imposed per-write limit.
            client.write_buf = try std.ArrayList(u8).initCapacity(client.alloc, 65536);
            try daemon.clients.append(gpa, client);
            continue :daemon_loop;
        }

        var i: usize = daemon.clients.items.len;
        clients_loop: while (i > 0) {
            i -= 1;
            const client = daemon.clients.items[i];
            const revents = poll_fds.items[i + 3].revents;

            if (revents & lib_posix.POLL.IN != 0) {
                const n = client.read_buf.read(client.socket_fd) catch |err| {
                    if (err == error.WouldBlock) continue;
                    const last = daemon.closeClient(gpa, client, i, false);
                    if (last) break :daemon_loop;
                    continue;
                };

                if (n == 0) {
                    // Client closed connection
                    const last = daemon.closeClient(gpa, client, i, false);
                    if (last) break :daemon_loop;
                    continue;
                }

                while (client.read_buf.next()) |msg| {
                    switch (msg.header.tag) {
                        .Input => try daemon.handleInput(gpa, client, msg.payload),
                        .Init => try daemon.handleInit(gpa, client, pty_fd, &term, &vt_stream, msg.payload),
                        .Resize => try daemon.handleResize(gpa, client, pty_fd, &term, msg.payload),
                        .Detach => {
                            daemon.handleDetach(gpa, client, i);
                            break :clients_loop;
                        },
                        .Kill => {
                            break :daemon_loop;
                        },
                        .Info => try daemon.handleInfo(gpa, client),
                        .Output => {},
                        _ => {},
                    }
                }
            }

            if (revents & lib_posix.POLL.OUT != 0) {
                // Flush pending output buffers
                const n = lib_posix.write(client.socket_fd, client.write_buf.items) catch |err| blk: {
                    if (err == error.WouldBlock) break :blk 0;
                    // Error on write, close client
                    const last = daemon.closeClient(gpa, client, i, false);
                    if (last) break :daemon_loop;
                    continue;
                };

                if (n > 0) {
                    client.write_buf.replaceRange(gpa, 0, n, &[_]u8{}) catch unreachable;
                }

                if (client.write_buf.items.len == 0) {
                    client.has_pending_output = false;
                }
            }

            if (revents & (lib_posix.POLL.HUP | lib_posix.POLL.ERR | lib_posix.POLL.NVAL) != 0) {
                const last = daemon.closeClient(gpa, client, i, false);
                if (last) break :daemon_loop;
            }
        }

        const inp_flags = lib_posix.POLL.IN | lib_posix.POLL.HUP | lib_posix.POLL.ERR | lib_posix.POLL.NVAL;
        if (poll_fds.items[1].revents & inp_flags != 0) {
            // Read from PTY. Buffer is sized to N_TTY_BUF_SIZE (4096): the hard
            // kernel limit for the N_TTY line discipline. A larger buffer doesn't
            // help: each read() from a PTY master returns at most 4096 bytes
            // regardless of the userspace buffer size.
            var buf: [4096]u8 = undefined;
            const n_opt: ?usize = lib_posix.read(pty_fd, &buf) catch |err| blk: {
                if (err == error.WouldBlock) break :blk null;
                break :blk 0;
            };

            if (n_opt) |n| {
                if (n == 0) {
                    // EOF: Shell exited
                    // Let the rest of this poll iteration complete so client
                    // write buffers are flushed via the normal POLLOUT path.
                    // On the next iteration, daemon.running will be false.
                    daemon.running = false;
                } else {
                    // Feed PTY output to terminal emulator for state tracking
                    vt_stream.nextSlice(buf[0..n]);
                    daemon.has_pty_output = true;

                    // When no real terminal client has attached yet, respond to
                    // terminal queries (e.g. DA1/DA2) on behalf of the terminal.
                    // This prevents fish from waiting 10s for unanswered queries.
                    if (!daemon.has_terminal_client and
                        daemon.pty_write_buf.items.len < Daemon.PTY_WRITE_BUF_MAX)
                    {
                        util.respondToDeviceAttributes(gpa, &daemon.pty_write_buf, buf[0..n]);
                    }

                    // Broadcast data to all clients.
                    // Rewrite OSC 133;A to include redraw=0 so the outer terminal
                    // does not clear prompt lines on resize (issue #111).
                    const broadcast_data = util.rewritePromptRedraw(gpa, buf[0..n]) orelse buf[0..n];
                    defer if (broadcast_data.ptr != buf[0..n].ptr) gpa.free(broadcast_data);
                    for (daemon.clients.items) |client| {
                        client.appendOutput(broadcast_data) catch continue;
                    }
                }
            }
        }

        if (poll_fds.items[1].revents & lib_posix.POLL.OUT != 0) {
            while (daemon.pty_write_buf.items.len > 0) {
                const n = lib_posix.write(pty_fd, daemon.pty_write_buf.items) catch |err| {
                    if (err != error.WouldBlock) {
                        daemon.pty_write_buf.clearRetainingCapacity();
                    }
                    break;
                };
                if (n == 0) break;
                daemon.pty_write_buf.replaceRange(gpa, 0, n, &[_]u8{}) catch unreachable;
            }
        }
    }
}

/// Client represents each terminal that has connected to a session.
///
/// Multiple Clients can connect to a single session.
pub const Client = struct {
    alloc: std.mem.Allocator,
    socket_fd: i32,
    has_pending_output: bool = false,
    receives_pty_output: bool = false,
    read_buf: ipc.SocketBuffer,
    write_buf: std.ArrayList(u8),

    pub fn deinit(self: *Client) void {
        lib_posix.close(self.socket_fd);
        self.read_buf.deinit();
        self.write_buf.deinit(self.alloc);
    }

    fn appendOutput(self: *Client, payload: []const u8) !void {
        if (!self.receives_pty_output) return;
        try ipc.appendMessage(self.alloc, &self.write_buf, .Output, payload);
        self.has_pending_output = true;
    }
};

/// Daemon is responsible for managing a supaterm-host session.
///
/// It holds all the state for a running session.  Instead of a single daemon for all sessions, we
/// create a daemon for every session.  This has some benefits. The ipc communication between
/// session clients and the daemon doesn't need to be tagged with the session name.  If a daemon
/// crashes for one session won't crash all the other sessions.
///
/// Conceptually it's also much simpler to reason about.
pub const Daemon = struct {
    cfg: *Cfg,
    session_name: []const u8,
    socket_path: []const u8,
    pty_write_buf: std.ArrayList(u8) = .empty,
    clients: std.ArrayList(*Client) = .empty,
    // This control which client is the leader.  The leader controls terminal state and
    // cols/rows of session.
    leader_client_fd: ?i32 = null,
    running: bool = true,
    pid: i32 = undefined,
    command: ?[]const []const u8 = null,
    has_pty_output: bool = false,
    has_had_client: bool = false,
    has_terminal_client: bool = false,
    shell: []const u8 = "/bin/sh",

    pub fn init(cfg: *Cfg, sesh_name: []const u8, socket_path: []const u8) Daemon {
        return .{
            .cfg = cfg,
            .session_name = sesh_name,
            .socket_path = socket_path,
        };
    }

    pub fn deinit(self: *Daemon, gpa: std.mem.Allocator) void {
        self.clients.deinit(gpa);
        self.pty_write_buf.deinit(gpa);
        gpa.free(self.socket_path);
    }

    pub fn shutdown(self: *Daemon, gpa: std.mem.Allocator) void {
        self.running = false;

        for (self.clients.items) |client| {
            client.deinit();
            gpa.destroy(client);
        }
        self.clients.clearRetainingCapacity();
    }

    pub fn closeClient(self: *Daemon, gpa: std.mem.Allocator, client: *Client, i: usize, shutdown_on_last: bool) bool {
        // leader is disconnected, remove ref and let another client claim leader on input
        if (self.leader_client_fd == client.socket_fd) {
            self.leader_client_fd = null;
        }
        client.deinit();
        gpa.destroy(client);
        _ = self.clients.orderedRemove(i);
        if (shutdown_on_last and self.clients.items.len == 0) {
            self.shutdown(gpa);
            return true;
        }
        return false;
    }

    /// ensureSession will either create or re-use the daemon used for a session.
    /// It will spin up a unix socket, double-fork the process (so it survives
    /// the terminal dying), and automatically attach the client to the ipc unix
    /// socket.
    ///
    /// The return bool value indicates if the current process is the daemon
    /// or the client since they have different behaviors post-fork.
    ///
    /// E.g. If it's the client process then we need to connect to the unix socket
    /// and run the clientLoop.  If it's the daemon then we need to bail since
    /// the daemonLoop is created inside this fn and when it returns that means
    /// the daemon stopped and needs to exit.
    pub fn ensureSession(self: *Daemon, io: std.Io) !bool {
        const sesh_name = self.session_name;
        var dir = try std.Io.Dir.openDirAbsolute(io, self.cfg.socket_dir, .{});
        defer dir.close(io);

        const exists = try socket.sessionExists(io, dir, sesh_name);
        // if daemon is gone then we flip this to true
        var should_create = !exists;

        if (exists) {
            if (ipc.connectSession(self.socket_path)) |fd| {
                lib_posix.close(fd);
            } else |err| switch (err) {
                // Daemon is definitively gone: safe to replace.
                error.ConnectionRefused => {
                    socket.cleanupStaleSocket(io, dir, sesh_name);
                    should_create = true;
                },
                // Connect failed for an unusual reason. The check is only to
                // decide create-vs-attach; the socket file exists, so proceed
                // to attach rather than fail or orphan.
                else => {},
            }
        }

        if (!should_create) {
            return false;
        }

        return self.run(io, dir, sesh_name);
    }

    fn run(self: *Daemon, io: std.Io, dir: std.Io.Dir, sesh_name: []const u8) !bool {
        const server_sock_fd: lib_posix.socket_t = try socket.createSocket(self.socket_path);
        const socket_inode = try socket.socketInode(io, dir, sesh_name);

        var keep_fds_open = [_]i32{ server_sock_fd, dir.handle };
        const cmd = try daemonize.createCmdZ(self.shell, self.command);

        const pty_info = daemonize.daemonize(
            cmd,
            &keep_fds_open,
        ) catch |err| {
            switch (err) {
                error.IsClientProc => {
                    // send a msg to the client that the session was created.
                    var w_buf: [2048]u8 = undefined;
                    var w = std.Io.File.stdout().writer(io, &w_buf);
                    try w.interface.print("session \"{s}\" created\n", .{sesh_name});
                    try w.interface.flush();
                    lib_posix.close(server_sock_fd);
                    return false;
                },
                else => {
                    lib_posix.close(server_sock_fd);
                    dir.deleteFile(io, self.session_name) catch {};
                    return err;
                },
            }
        };
        // =======
        // WARNING: cannot use upstream allocator or io after this point since
        // we forked the process and there's a risk of a mutex (e.g. thread-safe
        // allocator) being locked by a thread prior to fork which can cause a
        // deadlock.
        // =======

        self.pid = pty_info.pid;

        var threaded: std.Io.Threaded = .init_single_threaded;
        defer threaded.deinit();
        const new_io = threaded.io();

        const gpa: std.mem.Allocator = blk: {
            if (builtin.mode == .Debug) {
                const GPA = std.heap.DebugAllocator(.{});
                const Static = struct {
                    var gpa: GPA = .{};
                };
                break :blk Static.gpa.allocator();
            }
            break :blk std.heap.c_allocator;
        };

        defer self.shutdownSession(gpa, new_io, dir, server_sock_fd, pty_info.master_fd, socket_inode);

        try daemonLoop(self, gpa, new_io, server_sock_fd, pty_info.master_fd);
        return true;
    }

    /// Tears the session down in the one order observers can survive.
    ///
    /// The socket file is the only trace of a session anyone can see: `supaterm-host ls`
    /// enumerates the socket directory. So it goes last, after the pty child is
    /// reaped, and a shutdown that stalls stays visible and killable instead of
    /// leaving an orphan nobody can name.
    ///
    fn shutdownSession(
        self: *Daemon,
        gpa: std.mem.Allocator,
        io: std.Io,
        dir: std.Io.Dir,
        server_sock_fd: lib_posix.socket_t,
        master_fd: i32,
        socket_inode: std.Io.File.INode,
    ) void {
        lib_posix.close(server_sock_fd);
        self.handleKill(gpa, io);
        const session_name = self.session_name;
        self.deinit(gpa);
        lib_posix.close(master_fd);
        _ = lib_posix.waitpid(self.pid, 0);
        socket.deleteOwnedSocket(io, dir, session_name, socket_inode);
    }

    fn setLeader(self: *Daemon, gpa: std.mem.Allocator, client: *Client) !void {
        self.leader_client_fd = client.socket_fd;
        // Send a resize message to the client so it can send us back their window size
        // so we can resize the pty and ghostty state.
        try ipc.appendMessage(gpa, &client.write_buf, .Resize, "");
        client.has_pending_output = true;
    }

    const PTY_WRITE_BUF_MAX = 256 * 1024;

    /// Queue bytes for the PTY's stdin. Flushed by daemonLoop on POLLOUT.
    /// Drops the payload if the buffer is over cap -- same failure mode as
    /// the old direct-write ptyWrite (drop on EAGAIN), just at a 64x higher
    /// threshold. Capping avoids OOM when the shell stops reading; dropping
    /// new (not old) bytes avoids tearing a partially-accepted sequence.
    fn queuePtyInput(self: *Daemon, gpa: std.mem.Allocator, data: []const u8) void {
        if (data.len == 0) return;
        if (self.pty_write_buf.items.len + data.len > PTY_WRITE_BUF_MAX) return;

        self.pty_write_buf.appendSlice(gpa, data) catch {};
    }

    pub fn handleInput(self: *Daemon, gpa: std.mem.Allocator, client: *Client, payload: []const u8) !void {
        // client is leader, send entire payload (ansi escape codes + text)
        if (self.leader_client_fd == client.socket_fd) {
            self.queuePtyInput(gpa, payload);
            return;
        }

        // check if leader needs to be updated by detecting any user input
        if (util.isUserInput(payload)) {
            try self.setLeader(gpa, client);
            self.queuePtyInput(gpa, payload);
        }
    }

    pub fn handleInit(
        self: *Daemon,
        gpa: std.mem.Allocator,
        client: *Client,
        pty_fd: i32,
        term: *ghostty_vt.Terminal,
        vt_stream: *ghostty_vt.TerminalStream,
        payload: []const u8,
    ) !void {
        if (payload.len != @sizeOf(ipc.Resize)) return;

        // Serialize terminal state BEFORE resize to capture correct cursor position.
        // Resizing triggers reflow which can move the cursor, and the shell's
        // SIGWINCH-triggered redraw will run after our snapshot is sent.
        if (self.has_pty_output and (self.has_had_client or self.command != null)) {
            const output_len = client.write_buf.items.len;
            terminal_replay.append(client.alloc, &client.write_buf, term, vt_stream);
            client.has_pending_output = client.has_pending_output or client.write_buf.items.len > output_len;
        }

        client.receives_pty_output = true;

        // no leader is set so set one
        if (self.leader_client_fd == null) {
            try self.setLeader(gpa, client);
        }

        // only resize if leader
        if (self.leader_client_fd == client.socket_fd) {
            const resize = std.mem.bytesToValue(ipc.Resize, payload);
            var ws: cross.c.struct_winsize = .{
                .ws_row = resize.rows,
                .ws_col = resize.cols,
                .ws_xpixel = resize.xpixel,
                .ws_ypixel = resize.ypixel,
            };
            _ = cross.c.ioctl(pty_fd, cross.c.TIOCSWINSZ, &ws);
            // Disable prompt_redraw before resize. The daemon's internal terminal
            // would otherwise clear prompt lines expecting the shell to redraw them,
            // but the shell's redraw goes to the PTY (forwarded to clients), not to
            // this daemon terminal. The clearing corrupts the daemon's snapshot state.
            const saved_prompt_redraw = term.flags.shell_redraws_prompt;
            term.flags.shell_redraws_prompt = .false;
            defer term.flags.shell_redraws_prompt = saved_prompt_redraw;
            const opts = ghostty_vt.Terminal.Resize{
                .cols = resize.cols,
                .rows = resize.rows,
            };
            try term.resize(gpa, opts);

            // Mark that we've had a client init, so subsequent clients get terminal state
            self.has_had_client = true;
            self.has_terminal_client = true;
        }
    }

    pub fn handleResize(
        self: *Daemon,
        gpa: std.mem.Allocator,
        client: *Client,
        pty_fd: i32,
        term: *ghostty_vt.Terminal,
        payload: []const u8,
    ) !void {
        if (payload.len != @sizeOf(ipc.Resize)) return;
        if (self.leader_client_fd == null) {
            try self.setLeader(gpa, client);
        }
        // only leader can resize
        if (self.leader_client_fd != client.socket_fd) return;

        const resize = std.mem.bytesToValue(ipc.Resize, payload);
        var ws: cross.c.struct_winsize = .{
            .ws_row = resize.rows,
            .ws_col = resize.cols,
            .ws_xpixel = resize.xpixel,
            .ws_ypixel = resize.ypixel,
        };
        _ = cross.c.ioctl(pty_fd, cross.c.TIOCSWINSZ, &ws);
        // Disable prompt_redraw before resize (same rationale as handleInit).
        const saved_prompt_redraw = term.flags.shell_redraws_prompt;
        term.flags.shell_redraws_prompt = .false;
        defer term.flags.shell_redraws_prompt = saved_prompt_redraw;
        const opts = ghostty_vt.Terminal.Resize{
            .cols = resize.cols,
            .rows = resize.rows,
        };
        try term.resize(gpa, opts);
    }

    pub fn handleDetach(self: *Daemon, gpa: std.mem.Allocator, client: *Client, i: usize) void {
        _ = self.closeClient(gpa, client, i, false);
    }

    pub fn handleKill(self: *Daemon, gpa: std.mem.Allocator, io: std.Io) void {
        self.shutdown(gpa);
        // gracefully shutdown shell processes, shells tend to ignore SIGTERM so we send SIGHUP
        // instead
        //   https://www.gnu.org/software/bash/manual/html_node/Signals.html
        // negative pid means kill process and children
        lib_posix.kill(-self.pid, lib_posix.SIG.HUP) catch {};
        std.Io.sleep(io, std.Io.Duration.fromMilliseconds(500), .real) catch unreachable;
        lib_posix.kill(-self.pid, lib_posix.SIG.KILL) catch {};
    }

    pub fn handleInfo(self: *Daemon, gpa: std.mem.Allocator, client: *Client) !void {
        const info = ipc.Info{ .pid = self.pid };
        try ipc.appendMessage(gpa, &client.write_buf, .Info, std.mem.asBytes(&info));
        client.has_pending_output = true;
    }
};

pub const testing = if (builtin.is_test) struct {
    pub fn appendOutput(client: *Client, payload: []const u8) !void {
        try client.appendOutput(payload);
    }

    pub fn runDaemonLoop(
        daemon: *Daemon,
        gpa: std.mem.Allocator,
        io: std.Io,
        server_sock_fd: lib_posix.socket_t,
        pty_fd: i32,
    ) !void {
        try daemonLoop(daemon, gpa, io, server_sock_fd, pty_fd);
    }

    pub fn shutdownSession(
        daemon: *Daemon,
        gpa: std.mem.Allocator,
        io: std.Io,
        dir: std.Io.Dir,
        server_sock_fd: lib_posix.socket_t,
        master_fd: i32,
        socket_inode: std.Io.File.INode,
    ) void {
        daemon.shutdownSession(gpa, io, dir, server_sock_fd, master_fd, socket_inode);
    }
} else struct {};

test "first attach replays explicit command output" {
    const alloc = std.testing.allocator;
    const command = [_][]const u8{"/bin/zsh"};
    var daemon = Daemon{
        .cfg = undefined,
        .session_name = "test",
        .socket_path = "",
        .command = &command,
        .has_pty_output = true,
    };
    var client = Client{
        .alloc = alloc,
        .socket_fd = -1,
        .read_buf = try ipc.SocketBuffer.init(alloc),
        .write_buf = .empty,
    };
    defer client.read_buf.deinit();
    defer client.write_buf.deinit(alloc);

    var term = try ghostty_vt.Terminal.init(std.testing.io, alloc, .{
        .cols = 80,
        .rows = 24,
    });
    defer term.deinit(alloc);
    var stream = ghostty_vt.TerminalStream.init(.{
        .allocator = alloc,
        .handler = term.vtHandler(),
        .continuation_max_bytes = 1024,
    });
    defer stream.deinit();
    stream.nextSlice("first-attach-output");

    const resize = ipc.Resize{ .rows = 24, .cols = 80 };
    try daemon.handleInit(alloc, &client, -1, &term, &stream, std.mem.asBytes(&resize));

    try std.testing.expect(std.mem.indexOf(u8, client.write_buf.items, "first-attach-output") != null);
}
