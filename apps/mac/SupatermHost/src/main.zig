const std = @import("std");
const ipc = @import("ipc.zig");
const cross = @import("cross.zig");
const socket = @import("socket.zig");
const lib_posix = @import("posix.zig");
const signal = @import("signal.zig");
const Cfg = @import("cfg.zig");
const loop = @import("loop.zig");
const Daemon = loop.Daemon;

pub fn main(init: std.process.Init) !void {
    const gpa = init.gpa;
    const io = init.io;

    signal.ignoreSigpipe();

    var args = init.minimal.args.iterate();
    defer args.deinit();
    _ = args.next();

    var cfg = try Cfg.init(gpa, io);
    defer cfg.deinit(gpa);

    const command = args.next() orelse return error.CommandRequired;
    if (std.mem.eql(u8, command, "ls")) return list(gpa, io, &cfg);
    if (std.mem.eql(u8, command, "kill")) {
        const session_name = args.next() orelse return error.SessionNameRequired;
        return kill(gpa, io, &cfg, session_name);
    }
    if (std.mem.eql(u8, command, "attach")) {
        var session_name = args.next() orelse return error.SessionNameRequired;
        const existing_only = std.mem.eql(u8, session_name, "--existing");
        if (existing_only) session_name = args.next() orelse return error.SessionNameRequired;

        var command_args: std.ArrayList([]const u8) = .empty;
        defer command_args.deinit(gpa);
        while (args.next()) |arg| try command_args.append(gpa, arg);

        try socket.validateSessionName(session_name);
        const socket_path = socket.getSocketPath(gpa, cfg.socket_dir, session_name) catch |err| switch (err) {
            error.NameTooLong => return socket.printSessionNameTooLong(io, session_name, cfg.socket_dir),
            error.OutOfMemory => return err,
        };

        var daemon = Daemon.init(&cfg, session_name, socket_path);
        daemon.command = if (command_args.items.len > 0) command_args.items else null;
        daemon.shell = init.environ_map.get("SHELL") orelse "/bin/sh";
        return attach(io, &daemon, existing_only);
    }
    return error.InvalidCommand;
}

const Session = struct {
    name: []const u8,
    pid: i32,

    fn lessThan(_: void, left: Session, right: Session) bool {
        return std.mem.order(u8, left.name, right.name) == .lt;
    }
};

fn list(gpa: std.mem.Allocator, io: std.Io, cfg: *Cfg) !void {
    var dir = try std.Io.Dir.openDirAbsolute(io, cfg.socket_dir, .{ .iterate = true });
    defer dir.close(io);
    var iterator = dir.iterate();
    var sessions: std.ArrayList(Session) = .empty;
    defer {
        for (sessions.items) |session| gpa.free(session.name);
        sessions.deinit(gpa);
    }

    while (try iterator.next(io)) |entry| {
        if (!(socket.sessionExists(io, dir, entry.name) catch false)) continue;
        const socket_path = socket.getSocketPath(gpa, cfg.socket_dir, entry.name) catch continue;
        defer gpa.free(socket_path);
        const probe = ipc.probeSession(gpa, socket_path) catch |err| {
            if (err == error.ConnectionRefused) socket.cleanupStaleSocket(io, dir, entry.name);
            continue;
        };
        defer probe.deinit();
        if (probe.info.pid <= 0) continue;
        try sessions.append(gpa, .{
            .name = try gpa.dupe(u8, entry.name),
            .pid = probe.info.pid,
        });
    }

    std.mem.sort(Session, sessions.items, {}, Session.lessThan);
    var buffer: [4096]u8 = undefined;
    var stdout = std.Io.File.stdout().writer(io, &buffer);
    for (sessions.items) |session| {
        try stdout.interface.print("name={s}\tpid={d}\n", .{ session.name, session.pid });
    }
    try stdout.interface.flush();
}

fn kill(gpa: std.mem.Allocator, io: std.Io, cfg: *Cfg, session_name: []const u8) !void {
    try socket.validateSessionName(session_name);
    const socket_path = socket.getSocketPath(gpa, cfg.socket_dir, session_name) catch |err| switch (err) {
        error.NameTooLong => return socket.printSessionNameTooLong(io, session_name, cfg.socket_dir),
        error.OutOfMemory => return err,
    };
    defer gpa.free(socket_path);

    var dir = try std.Io.Dir.openDirAbsolute(io, cfg.socket_dir, .{});
    defer dir.close(io);
    if (!try socket.sessionExists(io, dir, session_name)) return error.SessionNotFound;

    const fd = ipc.connectSession(socket_path) catch |err| {
        if (err == error.ConnectionRefused) socket.cleanupStaleSocket(io, dir, session_name);
        return err;
    };
    defer lib_posix.close(fd);
    ipc.send(fd, .Kill, "") catch |err| switch (err) {
        error.BrokenPipe, error.ConnectionResetByPeer => return,
        else => return err,
    };

    var drain: [256]u8 = undefined;
    while (true) {
        const count = lib_posix.read(fd, &drain) catch break;
        if (count == 0) break;
    }
}

fn connectExistingSession(socket_path: []const u8) !lib_posix.socket_t {
    return socket.sessionConnect(socket_path) catch |err| switch (err) {
        error.FileNotFound, error.ConnectionRefused => error.SessionNotFound,
        else => err,
    };
}

fn attach(io: std.Io, daemon: *Daemon, existing_only: bool) !void {
    const client_socket = if (existing_only)
        try connectExistingSession(daemon.socket_path)
    else session: {
        if (try daemon.ensureSession(io)) return;
        break :session try socket.sessionConnect(daemon.socket_path);
    };

    var original_termios: cross.c.termios = undefined;
    const stdin_is_tty = cross.c.tcgetattr(lib_posix.STDIN_FILENO, &original_termios) == 0;
    defer {
        if (stdin_is_tty) _ = cross.c.tcsetattr(lib_posix.STDIN_FILENO, cross.c.TCSAFLUSH, &original_termios);
        _ = lib_posix.write(lib_posix.STDOUT_FILENO, "\x1bc") catch {};
    }

    if (stdin_is_tty) {
        var raw_termios = original_termios;
        cross.c.cfmakeraw(&raw_termios);
        raw_termios.c_cc[cross.c.VLNEXT] = cross.c._POSIX_VDISABLE;
        raw_termios.c_cc[cross.c.VQUIT] = cross.c._POSIX_VDISABLE;
        raw_termios.c_cc[cross.c.VMIN] = 1;
        raw_termios.c_cc[cross.c.VTIME] = 0;
        _ = cross.c.tcsetattr(lib_posix.STDIN_FILENO, cross.c.TCSANOW, &raw_termios);
    }

    _ = try lib_posix.write(lib_posix.STDOUT_FILENO, "\x1b[2J\x1b[H");
    try loop.clientLoop(client_socket);
}

test "existing-only connection never creates a session" {
    const gpa = std.testing.allocator;
    const io = std.testing.io;
    const session_name = try std.fmt.allocPrint(gpa, "supaterm-host-existing-{d}", .{std.c.getpid()});
    defer gpa.free(session_name);
    const socket_path = try std.fmt.allocPrint(gpa, "/tmp/{s}", .{session_name});
    defer gpa.free(socket_path);
    var dir = try std.Io.Dir.openDirAbsolute(io, "/tmp", .{});
    defer dir.close(io);
    dir.deleteFile(io, session_name) catch {};

    try std.testing.expectError(error.SessionNotFound, connectExistingSession(socket_path));
    try std.testing.expect(!try socket.sessionExists(io, dir, session_name));

    const server_fd = try socket.createSocket(socket_path);
    defer lib_posix.close(server_fd);
    defer dir.deleteFile(io, session_name) catch {};
    const client_fd = try connectExistingSession(socket_path);
    lib_posix.close(client_fd);
}
