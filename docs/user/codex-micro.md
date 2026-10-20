# Codex Micro

Codex Micro is a small macro keyboard from Work Louder. In the Supaterm desktop app its six agent
keys follow your threads and light up with their state, and its other keys, analog stick, and knob
run Supaterm commands. Connect it with USB to get started.

## Turning it on

Open **Settings** > **Codex Micro** and turn on **Enable Codex Micro**, then connect the keyboard.
Supaterm only looks for the keyboard while this is on. The page shows whether the keyboard is
connected and its battery level.

- **macOS** needs Input Monitoring for key presses. If the page shows **Not granted**, choose
  **Open System Settings** and turn Supaterm on under **Privacy & Security** > **Input Monitoring**.
- **Linux** needs read and write access to the keyboard's HID device. Add a udev rule such as
  `/etc/udev/rules.d/70-codex-micro.rules`, then reconnect the keyboard:

  ```
  SUBSYSTEM=="hidraw", ATTRS{idVendor}=="303a", ATTRS{idProduct}=="8360", TAG+="uaccess"
  KERNEL=="hidraw*", KERNELS=="*303A:8360*", TAG+="uaccess"
  ```

**Connected with limited functionality** means key presses work but the keyboard is not accepting
lighting or battery requests. Supaterm keeps retrying.

## Agent keys

The six keys in the top two rows each follow a thread. Choose which threads under **Agent keys**:
the most recently active threads, your pinned threads, threads that need you first, or a thread or
shortcut you pick for each key.

Press a key to open its thread. Press it twice quickly to also bring Supaterm to the front, or turn
on **Focus Supaterm with a single tap** to do that with one press. The light under each key shows
the thread's state:

| Color  | Meaning                                 |
| ------ | --------------------------------------- |
| Blue   | Working                                 |
| Green  | Finished with a reply you have not seen |
| Orange | Waiting for your approval or answer     |
| Red    | Failed                                  |
| White  | Idle                                    |

The key for the focused thread pulses. Lighting turns off after the **Auto-dim** delay and
comes back when you use the keyboard or a thread changes state.

## Keys, stick, and knob

By default the keys toggle Fast mode, approve, decline, fork the thread, and send the message.
Approve, decline, send, and Fast mode act on the focused thread. The analog stick opens the
right panel, moves back and forward, and toggles the sidebar. Turning the knob scrolls the
conversation, and clicking it jumps to the latest message. Choose **Reasoning effort** under
**Knob** to change effort instead, or **Custom** to pick your own actions. In the built-in modes,
pressing and holding the knob opens these settings.

Select a key in the **Layout** picture to change what it does. Choose the keycap you put on it and,
if you like, a different action. Each keycap comes once in the box, so choosing a keycap that is
already on another key swaps the two. **Reset layout** restores the keys, stick, and knob without
changing your agent keys.

The microphone keycaps start unassigned. You can assign them to a supported action like any other key.
