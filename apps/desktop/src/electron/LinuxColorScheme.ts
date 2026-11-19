import { Message, MessageType, Variant, sessionBus, type MessageBus } from "@particle/dbus-next";

const PORTAL = "org.freedesktop.portal.Desktop";
const PATH = "/org/freedesktop/portal/desktop";
const SETTINGS = "org.freedesktop.portal.Settings";
const DBUS = "org.freedesktop.DBus";
const NAMESPACE = "org.freedesktop.appearance";
const KEY = "color-scheme";

export type LinuxColorScheme = "dark" | "light" | null;

function decodeColorScheme(value: unknown) {
  let scheme = value;
  while (scheme instanceof Variant) scheme = scheme.value;
  return scheme === 1 ? "dark" : scheme === 0 || scheme === 2 ? "light" : null;
}

const settingsCall = (member: "ReadOne" | "Read") =>
  new Message({
    destination: PORTAL,
    path: PATH,
    interface: SETTINGS,
    member,
    signature: "ss",
    body: [NAMESPACE, KEY],
  });

/**
 * Follows the desktop color scheme through the XDG settings portal. Without a session bus or
 * portal it reports nothing, so Chromium's own resolution stays in charge.
 */
export function watchLinuxColorScheme(
  onChange: (scheme: LinuxColorScheme) => void,
  bus: MessageBus = sessionBus(),
) {
  let closed = false;
  let changed = false;
  const report = (value: unknown) => {
    if (!closed) onChange(decodeColorScheme(value));
  };
  const onMessage = (message: Message) => {
    if (
      message.type !== MessageType.SIGNAL ||
      message.path !== PATH ||
      message.interface !== SETTINGS ||
      message.member !== "SettingChanged"
    )
      return;
    const [namespace, key, value] = message.body;
    if (namespace !== NAMESPACE || key !== KEY) return;
    changed = true;
    report(value);
  };
  const ignore = () => undefined;

  bus.on("error", ignore);
  bus.on("message", onMessage);
  const ready = (async () => {
    await bus.call(
      new Message({
        destination: DBUS,
        path: "/org/freedesktop/DBus",
        interface: DBUS,
        member: "AddMatch",
        signature: "s",
        body: [
          `type='signal',interface='${SETTINGS}',member='SettingChanged',path='${PATH}',arg0='${NAMESPACE}',arg1='${KEY}'`,
        ],
      }),
    );
    const reply = await bus
      .call(settingsCall("ReadOne"))
      .catch(() => bus.call(settingsCall("Read")));
    if (reply && !changed) report(reply.body[0]);
  })().catch(ignore);

  return {
    ready,
    stop: () => {
      closed = true;
      bus.removeListener("message", onMessage);
      bus.disconnect();
    },
  };
}
