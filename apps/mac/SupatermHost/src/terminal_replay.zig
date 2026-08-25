const std = @import("std");
const ghostty_vt = @import("ghostty-vt");
const ipc = @import("ipc.zig");
const util = @import("util.zig");

pub fn append(
    alloc: std.mem.Allocator,
    output: *std.ArrayList(u8),
    terminal: *ghostty_vt.Terminal,
    stream: *ghostty_vt.TerminalStream,
) void {
    const snapshot = util.serializeTerminalState(alloc, terminal) orelse return;
    defer alloc.free(snapshot);
    const restore = util.rewritePromptRedraw(alloc, snapshot) orelse snapshot;
    defer if (restore.ptr != snapshot.ptr) alloc.free(restore);
    ipc.appendMessage(alloc, output, .Output, restore) catch return;

    var continuation: std.Io.Writer.Allocating = .init(alloc);
    defer continuation.deinit();
    stream.writeContinuation(&continuation.writer) catch return;
    if (continuation.writer.buffered().len == 0) return;
    ipc.appendMessage(alloc, output, .Output, continuation.writer.buffered()) catch {};
}

test "snapshot precedes continuation" {
    const alloc = std.testing.allocator;
    const continuation = "\x1b[31";
    var terminal = try ghostty_vt.Terminal.init(std.testing.io, alloc, .{
        .cols = 40,
        .rows = 10,
    });
    defer terminal.deinit(alloc);
    var stream = ghostty_vt.TerminalStream.init(.{
        .allocator = alloc,
        .handler = terminal.vtHandler(),
        .continuation_max_bytes = 1024,
    });
    defer stream.deinit();
    stream.nextSlice(continuation);

    var output: std.ArrayList(u8) = .empty;
    defer output.deinit(alloc);
    append(alloc, &output, &terminal, &stream);

    var messages = try ipc.SocketBuffer.init(alloc);
    defer messages.deinit();
    try messages.buf.appendSlice(alloc, output.items);
    const snapshot = messages.next().?;
    try std.testing.expectEqual(ipc.Tag.Output, snapshot.header.tag);
    try std.testing.expect(snapshot.payload.len > 0);
    const pending = messages.next().?;
    try std.testing.expectEqual(ipc.Tag.Output, pending.header.tag);
    try std.testing.expectEqualStrings(continuation, pending.payload);
    try std.testing.expect(messages.next() == null);
}
