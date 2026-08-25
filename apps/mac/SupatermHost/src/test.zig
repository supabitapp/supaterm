comptime {
    _ = @import("main.zig");
    _ = @import("util.zig");
    _ = @import("socket.zig");
    _ = @import("ipc.zig");
    _ = @import("label.zig");
    _ = @import("signal.zig");
    _ = @import("loop.zig");
    _ = @import("cfg.zig");
    _ = @import("daemonize.zig");
    _ = @import("continuation_test.zig");
    _ = @import("live_test.zig");
    _ = @import("shutdown_test.zig");
    _ = @import("terminal_replay.zig");
}
