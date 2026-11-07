# SidePulse

SidePulse Pro sits in a MacBook Pro's SD card slot. In the Supaterm desktop app on macOS and Linux,
its LEDs show what your agents are doing, so you can see when one needs you without switching
windows.

## Turning it on

Open **Settings** > **SidePulse** and turn on **SidePulse**, then insert the device.
Supaterm finds it once its volume mounts, and the page shows each connected device. Turning
SidePulse off, or quitting Supaterm, turns the LEDs off. While SidePulse is off, Supaterm doesn't
open any removable volume.

The first time Supaterm opens the device, macOS asks whether it may access files on a removable
volume. Choose **Allow**. If you chose **Don't Allow**, the page shows **No access**; turn on
**Removable Volumes** for Supaterm in **System Settings** > **Privacy & Security** >
**Files & Folders**.

Quit SidePulse's own menu bar app first. Both apps write to the same device, and each overwrites
the other.

## What the lights mean

The LEDs show the most urgent state across your open threads in every connected environment.
Archived and snoozed threads don't count.

| Light     | Default effect | Meaning                                                    |
| --------- | -------------- | ---------------------------------------------------------- |
| Needs you | Amber pulse    | An agent is waiting for your approval or answer, or failed |
| Working   | Cyan roll      | An agent is running                                        |
| Done      | Solid green    | An agent finished with a reply you have not seen           |
| Idle      | Dim teal glow  | Nothing needs you                                          |

A reply or failure counts as seen once you open the thread. The LEDs turn off while no Supaterm
window is open. **Brightness** scales every animation.

To change a light, pick an effect from its menu under **Lights** and a color from the swatch
beside it. The preview next to it plays the result, and a connected SidePulse plays it for a few
seconds before going back to what your agents are doing. **Rainbow** and **Spectrum** bring their
own colors, so give those to one light if you want to tell the others apart at a glance. The reset
button next to a light's name restores its default effect and color.

**Can't write** means this computer doesn't allow writing to removable storage, which some managed
Macs block.
