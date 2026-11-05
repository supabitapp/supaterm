# SidePulse

SidePulse Pro sits in a MacBook Pro's SD card slot, and SidePulse Dot plugs into USB-C. In the
Supaterm desktop app on macOS and Linux, their LEDs show what your agents are doing, so you can see
when one needs you without switching windows.

## Turning it on

Open **Settings** > **SidePulse** and turn on **SidePulse**, then insert or plug in the device.
Supaterm finds it once its volume mounts, and the page shows each connected device. Turning
SidePulse off, or quitting Supaterm, turns the LEDs off.

Quit SidePulse's own menu bar app first. Both apps write to the same device, and each overwrites
the other.

## What the lights mean

The LEDs show the most urgent state across your open threads in every connected environment.
Archived and snoozed threads don't count.

| Light          | Meaning                                                    |
| -------------- | ---------------------------------------------------------- |
| Amber pulse    | An agent is waiting for your approval or answer, or failed |
| Cyan roll      | An agent is running                                        |
| Solid green    | An agent finished with a reply you have not seen           |
| Dim teal pulse | Nothing needs you                                          |

A reply or failure counts as seen once you open the thread. The LEDs turn off while no Supaterm
window is open. **Brightness** scales every animation.

**Can't write** means this computer doesn't allow writing to removable storage, which some managed
Macs block.
