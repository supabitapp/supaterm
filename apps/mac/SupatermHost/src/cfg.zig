/// Cfg is supaterm-host's configuration container.
///
/// The purpose of this container is to hold anything that can be modified by the user.
pub const Cfg = @This();

const std = @import("std");
const lib_posix = @import("posix.zig");
const cross = @import("cross.zig");

socket_dir: []const u8,
log_dir: []const u8,
max_scrollback_lines: usize = 2_000,
dir_mode: u32 = 0o700,
log_mode: u32 = 0o600,

pub fn init(alloc: std.mem.Allocator, io: std.Io) !Cfg {
    const socket_dir = try socketDir(alloc);
    errdefer alloc.free(socket_dir);
    const log_dir = try logDir(alloc);
    errdefer alloc.free(log_dir);

    const dir_mode = if (lib_posix.getenv("SUPATERM_HOST_DIR_MODE")) |m|
        std.fmt.parseInt(u32, m, 8) catch 0o700
    else
        0o700;

    const log_mode = if (lib_posix.getenv("SUPATERM_HOST_LOG_MODE")) |m|
        std.fmt.parseInt(u32, m, 8) catch 0o600
    else
        0o600;

    var cfg = Cfg{
        .socket_dir = socket_dir,
        .log_dir = log_dir,
        .dir_mode = dir_mode,
        .log_mode = log_mode,
    };

    try cfg.mkdir(io);

    return cfg;
}

fn socketDir(alloc: std.mem.Allocator) ![]const u8 {
    const tmpdir = std.mem.trimEnd(u8, lib_posix.getenv("TMPDIR") orelse "/tmp", "/");
    const uid = lib_posix.getuid();

    const socket_dir: []const u8 = if (lib_posix.getenv("SUPATERM_HOST_DIR")) |host_dir|
        try alloc.dupe(u8, host_dir)
    else if (lib_posix.getenv("XDG_RUNTIME_DIR")) |xdg_runtime|
        try std.fmt.allocPrint(alloc, "{s}/supaterm-host", .{xdg_runtime})
    else
        try std.fmt.allocPrint(alloc, "{s}/supaterm-host-{d}", .{ tmpdir, uid });

    return socket_dir;
}

fn logDir(alloc: std.mem.Allocator) ![]const u8 {
    const log_dir = if (lib_posix.getenv("SUPATERM_HOST_DIR")) |host_dir|
        try std.fmt.allocPrint(alloc, "{s}/logs", .{host_dir})
    else if (lib_posix.getenv("XDG_STATE_HOME")) |xdg_state_home|
        try std.fmt.allocPrint(alloc, "{s}/supaterm-host/logs", .{xdg_state_home})
    else if (lib_posix.getenv("HOME")) |home_dir|
        try std.fmt.allocPrint(alloc, "{s}/.local/state/supaterm-host/logs", .{home_dir})
    else fallback: {
        // This is the last resort: falling back to /tmp/$UID if HOME is unset.
        const tmpdir = std.mem.trimEnd(u8, lib_posix.getenv("TMPDIR") orelse "/tmp", "/");
        const uid = lib_posix.getuid();
        break :fallback try std.fmt.allocPrint(alloc, "{s}/supaterm-host-{d}", .{ tmpdir, uid });
    };

    return log_dir;
}

pub fn deinit(self: *Cfg, alloc: std.mem.Allocator) void {
    if (self.socket_dir.len > 0) alloc.free(self.socket_dir);
    if (self.log_dir.len > 0) alloc.free(self.log_dir);
}

pub fn mkdir(self: *Cfg, io: std.Io) !void {
    const sock_perms = std.Io.Dir.Permissions.fromMode(@intCast(self.dir_mode));
    try mkdirAll(io, self.socket_dir, sock_perms);
    try setDirPermissions(io, self.socket_dir, sock_perms);
    const log_perms = std.Io.Dir.Permissions.fromMode(@intCast(self.dir_mode));
    try mkdirAll(io, self.log_dir, log_perms);
    try setDirPermissions(io, self.log_dir, log_perms);
}

fn setDirPermissions(io: std.Io, path: []const u8, permissions: std.Io.Dir.Permissions) !void {
    var dir = try std.Io.Dir.openDirAbsolute(io, path, .{ .iterate = true });
    defer dir.close(io);
    try dir.setPermissions(io, permissions);
}

fn mkdirAll(io: std.Io, sub_dir_path: []const u8, permissions: std.Io.Dir.Permissions) !void {
    var it = std.fs.path.componentIterator(sub_dir_path);
    var component = it.last() orelse return error.BadPathName;
    while (true) {
        std.Io.Dir.createDirAbsolute(io, component.path, permissions) catch |err| switch (err) {
            error.PathAlreadyExists => {},
            error.FileNotFound => |e| {
                component = it.previous() orelse return e;
                continue;
            },
            else => |e| return e,
        };
        component = it.next() orelse return;
    }
}

test "Cfg.init uses default modes when env vars are not set" {
    const alloc = std.testing.allocator;

    // Ensure they are not set
    _ = cross.c.unsetenv("SUPATERM_HOST_DIR_MODE");
    _ = cross.c.unsetenv("SUPATERM_HOST_LOG_MODE");

    var cfg = try Cfg.init(alloc, std.testing.io);
    defer cfg.deinit(alloc);

    try std.testing.expectEqual(@as(u32, 0o700), cfg.dir_mode);
    try std.testing.expectEqual(@as(u32, 0o600), cfg.log_mode);
}

test "Cfg.init uses custom modes from env vars" {
    const alloc = std.testing.allocator;

    // Set custom octal values
    _ = cross.c.setenv("SUPATERM_HOST_DIR_MODE", "770", 1);
    _ = cross.c.setenv("SUPATERM_HOST_LOG_MODE", "660", 1);
    defer {
        _ = cross.c.unsetenv("SUPATERM_HOST_DIR_MODE");
        _ = cross.c.unsetenv("SUPATERM_HOST_LOG_MODE");
    }

    var cfg = try Cfg.init(alloc, std.testing.io);
    defer cfg.deinit(alloc);

    try std.testing.expectEqual(@as(u32, 0o770), cfg.dir_mode);
    try std.testing.expectEqual(@as(u32, 0o660), cfg.log_mode);
}
