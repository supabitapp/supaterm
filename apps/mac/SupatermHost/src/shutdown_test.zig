const std = @import("std");
const lib_posix = @import("posix.zig");
const loop = @import("loop.zig");
const socket = @import("socket.zig");
const Cfg = @import("cfg.zig");

const shutdown_timeout_ms = 10_000;

/// Stands in for the pty child. It leads its own process group so handleKill's
/// `kill(-pid, ...)` reaches nothing but this child, drops the listen socket so
/// closing it in the parent really stops the listener, and blocks on a pipe the
/// parent never writes to. It reports over `ready_fd` once it owns the group,
/// because signalling a group id that is not yet the child's would hit whatever
/// unrelated processes happen to hold it.
fn spawnPtyChild(
    server_sock_fd: lib_posix.socket_t,
    block_fd: lib_posix.fd_t,
    ready_fd: lib_posix.fd_t,
) !i32 {
    const pid = try lib_posix.fork();
    if (pid != 0) return pid;
    const session_id = lib_posix.setsid() catch -1;
    // Outlive the SIGHUP so the whole grace sleep runs against a live child,
    // the way a shell that refuses to hang up does.
    lib_posix.sigaction(lib_posix.SIG.HUP, &.{
        .handler = .{ .handler = lib_posix.SIG.IGN },
        .mask = lib_posix.sigemptyset(),
        .flags = 0,
    }, null);
    lib_posix.close(server_sock_fd);
    _ = lib_posix.write(ready_fd, &[_]u8{if (session_id > 0) 1 else 0}) catch {};
    lib_posix.close(ready_fd);
    var buf: [1]u8 = undefined;
    _ = lib_posix.read(block_fd, &buf) catch {};
    std.c._exit(0);
}

const Shutdown = struct {
    daemon: *loop.Daemon,
    dir: std.Io.Dir,
    server_sock_fd: lib_posix.socket_t,
    master_fd: i32,
    inode: std.Io.File.INode,
    done: std.atomic.Value(bool) = .init(false),

    fn run(self: *Shutdown) void {
        var threaded: std.Io.Threaded = .init_single_threaded;
        defer threaded.deinit();
        loop.testing.shutdownSession(
            self.daemon,
            std.testing.allocator,
            threaded.io(),
            self.dir,
            self.server_sock_fd,
            self.master_fd,
            self.inode,
        );
        self.done.store(true, .release);
    }
};

fn isReaped(pid: i32) bool {
    lib_posix.kill(pid, @enumFromInt(0)) catch |err| return err == error.ProcessNotFound;
    return false;
}

test "shutdown keeps the session visible and connectable until the pty child is reaped" {
    const alloc = std.testing.allocator;
    const io = std.testing.io;

    const session_name = try std.fmt.allocPrint(alloc, "supaterm-host-shutdown-{d}", .{std.c.getpid()});
    defer alloc.free(session_name);
    const socket_path = try std.fmt.allocPrint(alloc, "/tmp/{s}", .{session_name});
    defer alloc.free(socket_path);
    const daemon_socket_path = try alloc.dupe(u8, socket_path);

    var dir = try std.Io.Dir.openDirAbsolute(io, "/tmp", .{});
    defer dir.close(io);
    dir.deleteFile(io, session_name) catch {};

    const server_sock_fd = try socket.createSocket(socket_path);
    const inode = try socket.socketInode(io, dir, session_name);
    errdefer dir.deleteFile(io, session_name) catch {};

    const block = try lib_posix.pipe2(.{});
    defer lib_posix.close(block[1]);
    const ready = try lib_posix.pipe2(.{});
    defer lib_posix.close(ready[0]);
    const child_pid = try spawnPtyChild(server_sock_fd, block[0], ready[1]);
    lib_posix.close(block[0]);
    lib_posix.close(ready[1]);

    var ready_byte: [1]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 1), try lib_posix.read(ready[0], &ready_byte));
    try std.testing.expectEqual(@as(u8, 1), ready_byte[0]);

    // The pty master only has to be a closable fd; nothing reads it.
    const master = try lib_posix.pipe2(.{});
    lib_posix.close(master[0]);

    var cfg = Cfg{
        .socket_dir = "/tmp",
        .log_dir = "",
        .max_scrollback_lines = 100,
    };
    var daemon = loop.Daemon{
        .cfg = &cfg,
        .session_name = session_name,
        .socket_path = daemon_socket_path,
        .created_at = 0,
        .pid = child_pid,
    };

    var shutdown = Shutdown{
        .daemon = &daemon,
        .dir = dir,
        .server_sock_fd = server_sock_fd,
        .master_fd = master[1],
        .inode = inode,
    };
    const thread = try std.Thread.spawn(.{}, Shutdown.run, .{&shutdown});
    defer thread.join();

    var refused_while_listed = false;
    const deadline = std.Io.Timestamp.now(io, .awake).addDuration(
        std.Io.Duration.fromMilliseconds(shutdown_timeout_ms),
    );
    while (!shutdown.done.load(.acquire)) {
        // Order matters: a missing socket file proves the unlink already ran,
        // and the unlink runs after waitpid, so the later reap check must
        // agree. Reading it the other way round would race.
        const listed = socket.sessionExists(io, dir, session_name) catch false;
        if (!listed and !isReaped(child_pid)) return error.SessionInvisibleWhileAlive;

        if (listed) {
            if (socket.sessionConnect(socket_path)) |client_fd| {
                lib_posix.close(client_fd);
            } else |err| switch (err) {
                // What `supaterm-host run <name>` sees mid-shutdown: refused at once,
                // which ensureSession turns into a fresh session.
                error.ConnectionRefused => refused_while_listed = true,
                // The unlink landed between the stat above and this connect.
                error.FileNotFound => {},
                else => return err,
            }
        }

        if (std.Io.Timestamp.now(io, .awake).durationTo(deadline).toMilliseconds() <= 0) {
            return error.ShutdownTimedOut;
        }
        std.Io.sleep(io, std.Io.Duration.fromMilliseconds(1), .real) catch {};
    }

    try std.testing.expect(refused_while_listed);
    try std.testing.expect(!try socket.sessionExists(io, dir, session_name));
}

test "shutdown leaves a socket file another daemon has taken over" {
    const alloc = std.testing.allocator;
    const io = std.testing.io;

    const session_name = try std.fmt.allocPrint(alloc, "supaterm-host-replaced-{d}", .{std.c.getpid()});
    defer alloc.free(session_name);
    const socket_path = try std.fmt.allocPrint(alloc, "/tmp/{s}", .{session_name});

    var dir = try std.Io.Dir.openDirAbsolute(io, "/tmp", .{});
    defer dir.close(io);
    dir.deleteFile(io, session_name) catch {};

    const server_sock_fd = try socket.createSocket(socket_path);
    const inode = try socket.socketInode(io, dir, session_name);

    // A replacement daemon reclaims the name while the first one shuts down.
    dir.deleteFile(io, session_name) catch {};
    const replacement_fd = try socket.createSocket(socket_path);
    defer lib_posix.close(replacement_fd);
    defer dir.deleteFile(io, session_name) catch {};

    lib_posix.close(server_sock_fd);
    socket.deleteOwnedSocket(io, dir, session_name, inode);

    try std.testing.expect(try socket.sessionExists(io, dir, session_name));
    const client_fd = try socket.sessionConnect(socket_path);
    lib_posix.close(client_fd);
    alloc.free(socket_path);
}
