const std = @import("std");
const builtin = @import("builtin");
const cross = @import("cross.zig");
const ipc = @import("ipc.zig");
const lib_posix = @import("posix.zig");
const loop = @import("loop.zig");
const socket = @import("socket.zig");
const Cfg = @import("cfg.zig");

const live_test_timeout_ms = 5_000;

const testOpenPty = if (builtin.os.tag == .macos)
    struct {
        extern "c" fn openpty(
            master_fd: *c_int,
            slave_fd: *c_int,
            name: ?[*:0]u8,
            term: ?*const cross.c.struct_termios,
            size: ?*const cross.c.struct_winsize,
        ) c_int;
    }.openpty
else
    cross.c.openpty;

fn liveDaemonMain(server_sock_fd: i32, pty_fd: i32) u8 {
    var cfg = Cfg{
        .socket_dir = "",
    };
    var daemon = loop.Daemon{
        .cfg = &cfg,
        .session_name = "continuation-live",
        .socket_path = "",
    };
    const alloc = std.heap.c_allocator;
    defer {
        daemon.shutdown(alloc);
        daemon.clients.deinit(alloc);
        daemon.pty_write_buf.deinit(alloc);
    }
    var threaded: std.Io.Threaded = .init_single_threaded;
    defer threaded.deinit();
    loop.testing.runDaemonLoop(
        &daemon,
        alloc,
        threaded.io(),
        server_sock_fd,
        pty_fd,
    ) catch return 1;
    return 0;
}

fn runLiveDaemon(server_sock_fd: i32, pty_fd: i32, notify_fd: i32, start_fd: i32) noreturn {
    var start: [1]u8 = undefined;
    const started = lib_posix.read(start_fd, &start) catch 0;
    lib_posix.close(start_fd);
    if (started != 1) std.c._exit(1);
    const status = liveDaemonMain(server_sock_fd, pty_fd);
    _ = lib_posix.write(notify_fd, &.{status}) catch 0;
    std.c._exit(status);
}

const LiveDaemon = struct {
    alloc: std.mem.Allocator,
    socket_path: []u8,
    slave_fd: i32,
    notify_fd: i32,
    start_fd: i32,
    pid: i32,
    reaped: bool = false,

    fn init(alloc: std.mem.Allocator) !LiveDaemon {
        const socket_path = try std.fmt.allocPrint(
            alloc,
            "/tmp/supaterm-host-continuation-{d}",
            .{std.c.getpid()},
        );
        errdefer alloc.free(socket_path);
        std.Io.Dir.deleteFileAbsolute(std.testing.io, socket_path) catch {};
        errdefer std.Io.Dir.deleteFileAbsolute(std.testing.io, socket_path) catch {};

        var master_fd: c_int = undefined;
        var slave_fd: c_int = undefined;
        const size = cross.c.struct_winsize{
            .ws_row = 10,
            .ws_col = 40,
            .ws_xpixel = 0,
            .ws_ypixel = 0,
        };
        if (testOpenPty(&master_fd, &slave_fd, null, null, &size) != 0) return error.OpenPtyFailed;
        errdefer lib_posix.close(master_fd);
        errdefer lib_posix.close(slave_fd);

        const server_sock_fd = try socket.createSocket(socket_path);
        errdefer lib_posix.close(server_sock_fd);
        const notify_fds = try lib_posix.pipe2(.{ .CLOEXEC = true });
        errdefer lib_posix.close(notify_fds[0]);
        errdefer lib_posix.close(notify_fds[1]);
        const start_fds = try lib_posix.pipe2(.{ .CLOEXEC = true });
        errdefer lib_posix.close(start_fds[0]);
        errdefer lib_posix.close(start_fds[1]);

        const pid = try lib_posix.fork();
        if (pid == 0) {
            lib_posix.close(slave_fd);
            lib_posix.close(notify_fds[0]);
            lib_posix.close(start_fds[1]);
            runLiveDaemon(server_sock_fd, master_fd, notify_fds[1], start_fds[0]);
        }

        lib_posix.close(master_fd);
        lib_posix.close(server_sock_fd);
        lib_posix.close(notify_fds[1]);
        lib_posix.close(start_fds[0]);
        return .{
            .alloc = alloc,
            .socket_path = socket_path,
            .slave_fd = slave_fd,
            .notify_fd = notify_fds[0],
            .start_fd = start_fds[1],
            .pid = pid,
        };
    }

    fn deinit(self: *LiveDaemon) void {
        if (!self.reaped) {
            lib_posix.kill(self.pid, lib_posix.SIG.KILL) catch {};
            _ = lib_posix.waitpid(self.pid, 0);
        }
        lib_posix.close(self.slave_fd);
        lib_posix.close(self.notify_fd);
        lib_posix.close(self.start_fd);
        std.Io.Dir.deleteFileAbsolute(std.testing.io, self.socket_path) catch {};
        self.alloc.free(self.socket_path);
    }

    fn connect(self: *LiveDaemon) !i32 {
        return socket.sessionConnect(self.socket_path);
    }

    fn write(self: *LiveDaemon, bytes: []const u8) !void {
        var offset: usize = 0;
        while (offset < bytes.len) {
            offset += try lib_posix.write(self.slave_fd, bytes[offset..]);
        }
    }

    fn start(self: *LiveDaemon) !void {
        try std.testing.expectEqual(@as(usize, 1), try lib_posix.write(self.start_fd, &.{1}));
    }

    fn stop(self: *LiveDaemon, client_fd: i32) !void {
        try ipc.send(client_fd, .Kill, "");
        var poll_fds = [_]lib_posix.pollfd{.{
            .fd = self.notify_fd,
            .events = lib_posix.POLL.IN,
            .revents = 0,
        }};
        try std.testing.expectEqual(
            @as(usize, 1),
            try lib_posix.poll(&poll_fds, live_test_timeout_ms),
        );
        var status: [1]u8 = undefined;
        try std.testing.expectEqual(@as(usize, 1), try lib_posix.read(self.notify_fd, &status));
        try std.testing.expectEqual(@as(u8, 0), status[0]);
        try std.testing.expectEqual(self.pid, lib_posix.waitpid(self.pid, 0).pid);
        self.reaped = true;
    }
};

fn readMessage(buffer: *ipc.SocketBuffer, socket_fd: i32) !ipc.SocketMsg {
    const io = std.testing.io;
    const deadline = std.Io.Timestamp.now(io, .awake).addDuration(
        std.Io.Duration.fromMilliseconds(live_test_timeout_ms),
    );
    while (true) {
        if (buffer.next()) |message| return message;
        const remaining = std.Io.Timestamp.now(io, .awake).durationTo(deadline).toMilliseconds();
        if (remaining <= 0) return error.Timeout;
        var poll_fds = [_]lib_posix.pollfd{.{
            .fd = socket_fd,
            .events = lib_posix.POLL.IN,
            .revents = 0,
        }};
        if (try lib_posix.poll(&poll_fds, @intCast(remaining)) == 0) return error.Timeout;
        if (poll_fds[0].revents & (lib_posix.POLL.HUP | lib_posix.POLL.ERR | lib_posix.POLL.NVAL) != 0) {
            return error.ConnectionClosed;
        }
        if (try buffer.read(socket_fd) == 0) return error.ConnectionClosed;
    }
}

fn readTag(buffer: *ipc.SocketBuffer, socket_fd: i32, tag: ipc.Tag) ![]const u8 {
    while (true) {
        const message = try readMessage(buffer, socket_fd);
        if (message.header.tag == tag) return message.payload;
    }
}

test "live attach preserves split sequence across PTY and socket boundaries" {
    const alloc = std.testing.allocator;
    const prefix = "\x1b[31";
    const suffix = "mX\x1b[0m";
    var daemon = try LiveDaemon.init(alloc);
    defer daemon.deinit();

    const first_fd = try daemon.connect();
    defer lib_posix.close(first_fd);
    var first = try ipc.SocketBuffer.init(alloc);
    defer first.deinit();
    const resize = ipc.Resize{ .rows = 10, .cols = 40 };
    try ipc.send(first_fd, .Init, std.mem.asBytes(&resize));
    try daemon.write("first");
    try daemon.start();
    _ = try readTag(&first, first_fd, .Resize);
    try std.testing.expectEqualStrings("first", try readTag(&first, first_fd, .Output));

    try daemon.write(prefix);
    try std.testing.expectEqualStrings(prefix, try readTag(&first, first_fd, .Output));

    const second_fd = try daemon.connect();
    defer lib_posix.close(second_fd);
    var second = try ipc.SocketBuffer.init(alloc);
    defer second.deinit();
    try ipc.send(second_fd, .Init, std.mem.asBytes(&resize));
    try std.testing.expect((try readTag(&second, second_fd, .Output)).len > 0);
    try std.testing.expectEqualStrings(prefix, try readTag(&second, second_fd, .Output));

    try daemon.write(suffix);
    try std.testing.expectEqualStrings(suffix, try readTag(&first, first_fd, .Output));
    try std.testing.expectEqualStrings(suffix, try readTag(&second, second_fd, .Output));
    try daemon.stop(second_fd);
}
