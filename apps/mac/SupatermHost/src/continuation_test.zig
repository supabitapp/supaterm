const std = @import("std");
const ipc = @import("ipc.zig");
const loop = @import("loop.zig");
const Client = loop.Client;

test "raw output waits for subscription" {
    const alloc = std.testing.allocator;
    var client = Client{
        .alloc = alloc,
        .socket_fd = -1,
        .read_buf = try ipc.SocketBuffer.init(alloc),
        .write_buf = .empty,
    };
    defer {
        client.read_buf.deinit();
        client.write_buf.deinit(alloc);
    }

    try loop.testing.appendOutput(&client, "before");
    try std.testing.expectEqual(@as(usize, 0), client.write_buf.items.len);

    client.receives_pty_output = true;
    try loop.testing.appendOutput(&client, "after");
    try std.testing.expect(client.has_pending_output);

    var messages = try ipc.SocketBuffer.init(alloc);
    defer messages.deinit();
    try messages.buf.appendSlice(alloc, client.write_buf.items);
    const message = messages.next().?;
    try std.testing.expectEqual(ipc.Tag.Output, message.header.tag);
    try std.testing.expectEqualStrings("after", message.payload);
    try std.testing.expect(messages.next() == null);
}
