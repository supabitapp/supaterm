# Working with threads

Use a new thread for a separate task. Choose **New worktree** when its code changes
need a separate branch and working directory.

## Start a thread

On web and desktop, a new thread keeps the current project and carries your model
and mode selections, unless the destination project has its own model default.
Its branch and workspace mode come from your configured defaults. To continue in
an existing worktree, use **New thread in this worktree** from the branch toolbar.
On mobile, a new task opens in the project you last chose, or your first project
when that one is gone; tap the project in the draft to pick another.

When you change a new thread's project, its branch, workspace mode, and machine
choice reset to that project's defaults; the prompt and a model you picked stay.
Supaterm stays in the current environment if that project exists there, unless Auto
balance chooses another. Otherwise it selects an environment that has it.

### Start without a project

A thread does not need a project. To start one without a project, pick **No
project** from the project menu above a new thread's prompt or from **New thread
in...** in the command palette, or press `mod+alt+n`. On mobile, pick **No
project** from the project list. It starts on your current machine; before
sending, pick another machine from the machine menu to move it there. To move a
draft into a project, pick the project in that menu.

Each thread without a project works in its own folder under `~/.supaterm/scratch` (the
`scratch` folder of your Supaterm data directory), named after its date, the first words
of its first message, and a short id, like
`2026-09-25-convert-these-pngs-to-webp-a1b2c3d4`. Deleting a thread keeps its
folder, so the files the agent wrote stay until you delete them. Branch, worktree, and diff controls stay hidden because
these folders are not Git repositories. This is unavailable when the data
directory itself sits inside a Git checkout.

### Send feedback

Choose **Help > Send feedback** at the bottom of the sidebar, or **Send feedback** in
the command palette. On mobile, open **Settings > About Supaterm**, or use the command
palette with a hardware keyboard. Supaterm opens a new thread under **No project**
with the triage playbook linked in the message. Choose any provider, describe what
happened after the link, and send. Supaterm gets the source for the server's version
while you write.

The agent reads that machine's logs and state, checks the source, looks for known
issues, and can help you write a GitHub issue. It asks before it applies a fix or
posts anything. It runs inside that Supaterm server, so it gives you any restart
steps and does not do them itself.

Feedback goes to the machine of the thread or draft you have open. With nothing
open, it uses your primary machine if that supports it, or else the first connected
machine that does. On mobile, Settings asks which machine when more than one can.

If the app cannot open, run `supaterm triage` in a terminal on the affected machine
instead.

### Start in the background

In a desktop browser or the desktop app, press `Cmd+Enter` on macOS or `Ctrl+Enter`
on Windows and Linux to start a new thread and immediately open another draft. The
next draft keeps the workspace mode and base branch you selected. With **New
worktree**, each background submission creates its own worktree.

To send the same prompt to several models on web or desktop, **Shift-click** models
in a new thread's model picker to add or remove them. A regular click returns to a
single model. Choose a base branch and send. Each selection starts a separate thread
and worktree while you stay in the new thread composer. This requires a Git project.

## Pin and reorder threads

Pin a thread from its menu to keep it above your active work. On web and desktop, the
command palette also offers the thread menu's actions for the thread you are viewing, such
as **Rename thread**, **Pin thread**, and **Snooze thread**.

On web and desktop, unpinning, marking as Done, snoozing, and archiving a thread each show
a notification with **Undo** for five seconds. Undo restores the thread's previous
state, including its pinned position, and reopens an archived thread you were
viewing. Discarding an unsent draft from the sidebar works the same way: Undo brings
back its text and attachments. `mod+z` triggers the most recent Undo, even from the composer; see
[Keybindings](./keybindings.md#commands-with-special-behavior).

On web and desktop, you can also drag files from your computer onto any thread row:
the thread opens and the files are attached in its composer, ready for
your next message. The same per-message file limits apply as when attaching
files directly; see [Attach files](./composer.md#attach-files).

On web and desktop, pinning or unpinning a thread keeps the sidebar at your current
scroll position instead of following the thread to its new place in the list.

Pinned threads are never marked Done automatically, even after their pull request merges. Unpinning a thread
returns it to the usual completion rules, and marking a pinned thread as Done removes its pin.

On web and desktop, drag a thread between sections to change its state. Drag a thread up into
the pinned section to pin it at the spot you drop it; drag a pinned thread down into the active
list to unpin it. Dragging a thread onto the **Done** header marks it as Done, and dragging a Done
thread into the active list reopens it. A snoozed thread can be dragged out of the snoozed
shelf, which wakes it, but threads cannot be dragged into the shelf because snoozing needs a wake
time. Dragging a pinned thread out of the pinned section does not ask for unpin confirmation.
Pinned and active boundary labels appear only while dragging, without moving the rows. The
other rows slide aside to show where the thread will land. When you cross into another section,
the dragged thread shows the action the drop performs, with its icon: **Pin**, **Unpin**,
**Mark as Done**, **Reopen**, or **Wake**. Its status and hover actions hide during the drag. A pinned
thread keeps its pin only while it stays in the pinned section; once it leaves, the badge takes
over. Reordering within the same section shows no badge. When there are no pins, drag to the top
edge to pin a thread. Section labels stay readable for the whole drag, and the section the
thread is over takes the accent color. Section labels also
identify empty sections and a collapsed Done shelf.

Drag within the pinned section to change its order. Other rows slide aside to show the spot where
the thread will land. On mobile, open a thread's menu and choose **Arrange threads**. Drag a
handle within **Pinned** to reorder, or between **Pinned** and **Active** to pin or unpin. Drop
onto the **Done** divider to mark a thread as Done. The dragged card shows the action before you
release it. Expand **Snoozed** or **Done** to drag a parked thread back into either live
section. Each drop saves; close the sheet to return to the thread list. The server saves the pinned order,
so it survives a refresh and appears on your other connected devices.

On web and desktop, the list also animates section changes made with thread actions such as
**Pin**, **Mark as Done**, and **Snooze**. These transitions respect your system's reduced-motion
preference. While dragging, rows follow the insertion gap without replaying a second transition
after the drop.

In Default grouping, the active list is ordered by when each thread last came back to you.
You cannot manually reorder threads in the active list. The Done shelf lists the most recently
finished threads first, and **Show more** reveals older history below them.

If dragging is unavailable for one environment, update the Supaterm server running in that
environment. Pinned reordering requires server support. Threads from older servers keep their
default order until the server is updated.

To generate a fresh title from the conversation, open a thread's menu and choose
**Regenerate title**. The action is unavailable while title generation is in progress
or when the connected environment needs a server update.

Agents connected through Supaterm can use the same server-owned metadata workflow to
rename a thread, regenerate its title, or link and unlink a pull request. These changes
appear on web, desktop, and mobile without requiring the originating browser to remain
open.

### Group the inbox

Use **Thread list options → Grouping**, or the **Group:** menu on iPhone, to choose
**Default** or **Project**. On web and desktop, **Thread list options → Project** shows a single
project's threads; right-click a project there to open its settings.
Project groups active and working threads by project, most recent activity first. Activity means
sending a message, a run being requested or completing, or reopening a thread; streamed output
does not reorder it.
Pinned, Snoozed, and Done remain shared shelves in every mode. Select a group's header to collapse
it; the thread you have open stays visible. On web and desktop, drag a project's header to reorder
projects; this sets **Settings → General → Project order** to **Manual**, which the project pickers
also follow. The grouping, collapsed groups, and project order are saved on this device.
You can also change it in Settings → General on web and desktop, or Settings → Organization on mobile.

### Working threads

In Default grouping, threads that are working or monitoring fold into a collapsed **Working**
section. A thread returns to the top of the active list when it finishes, fails, or needs an approval or answer.
The Working section lists the thread you last sent work to first. Pinned threads stay in the
pinned section.

## Mark finished work as Done

Choose **Mark thread as Done** from its menu to move finished work out of the active list
without deleting the conversation. **Reopen thread** restores it to active work
and prevents automatic completion until new activity resumes the usual rules.
On web and desktop, `Cmd/Ctrl+Shift+D` marks the open thread as Done or reopens it
when it is already Done. The shortcut skips terminals and can be changed in Settings → Keybindings.
Manually marking an idle thread as Done dismisses unanswered async questions without
sending an answer or restarting the agent. Marking it as Done also closes the thread's
terminals that wait at an idle prompt, and keeps their output. A terminal that
runs a command, such as a dev server, stays open.

To reclaim disk space from Done work, turn on **Run in the thread's worktree when the
thread is marked Done** for one of the project's actions, or set `"runOnDone": true` on a
`supaterm.json` script, for example `cargo clean`. It runs each time a thread in its own
worktree is marked Done, manually or automatically, even if a terminal there still runs a
command such as a dev server. Threads in the project's main checkout skip it. Its terminal
closes when the command succeeds and stays open when it fails.

On web and desktop, press a thread's **Done** button and drag up or down to
mark every thread in that section between it and the one you release on as Done.
The **Reopen** and **Wake** buttons work the same way in their sections.
Press `Escape` while dragging to cancel.

By default, environments mark inactive threads as Done after three days. Merged pull requests
mark their linked threads as Done when **Automatically mark merged threads as Done** is enabled. A closed pull request
can also mark an idle thread as Done. An empty thread's inactivity counts from when it was created.
Pins, work in progress, pending questions or approvals, and live background work
prevent automatic completion. An open pull request does not prevent inactivity
completion unless you turn on **Keep threads with an open PR**, but an old closed or merged pull request does not mark work as Done if you
resumed it after it closed. Only your own messages count as resuming. A turn that
finished background work or a pull request watch starts on its own does not.

To keep one thread out of the Done shelf no matter how long it sits idle, open its menu,
choose **Automatic completion**, and pick **Disabled**. The current option is checked. Pick
**Enabled** to return to the usual rules. The **Mark as Done**, **Snooze**, and **Archive** actions still work while it
is disabled.

Change these rules in **Settings → General** on web and desktop, or **Settings → Thread behavior** on mobile.
They continue to run when your apps are closed. On web and desktop, choose an environment at the
top to change only its rules, or **All environments** to update connected environments together.
Mixed values show where the selected environments disagree. Mobile applies these
rules to connected environments that support shared settings. Offline environments
and older servers keep their previous values. Changing a rule does not reopen
already Done threads.

## Link a pull request

The server finds the PR for each open thread's saved branch, even when your
apps are closed. Done threads keep their saved links. Update the server if
automatic branch links do not appear.

On web and desktop, right-click a pull request link in a thread and choose
**Link to thread** to select a different PR. Use **Unlink from thread** on the
same link to return to the branch PR, if one exists.
The linked pull request participates in automatic completion.

## Find and reference work

On web and desktop, open the command palette with `Cmd/Ctrl+K`, or select
**Search** at the top of the sidebar, to search threads across connected
environments. Message search starts after two characters and includes your
messages and final agent responses.

Use **Settings → Keybindings** to find or customize shortcuts for searching files
and copying a thread reference. A copied reference uses the thread's pull request
link when available, otherwise its thread ID. See [keybindings](./keybindings.md)
for custom configuration.

## Inspect agent work

**Limited** means the provider stopped on a usage or rate limit. The conversation
keeps the provider's explanation. Retry after the limit resets, or switch to
another provider instance.
On web and desktop, press **Resume** in an empty composer to continue a limited
or interrupted turn manually.
Queued messages stay saved while the limit blocks the thread. They run after
the continuation finishes. If the queue was held by a restart, resume it then.

When the provider reports a reset time, choose **Resume at reset** to schedule a
continuation. You can cancel it from the thread. Enable **Auto-resume limited
threads** in **Settings → General** on web and desktop, or **Settings → Thread
behavior** on mobile, to schedule limit stops by default.
The environment must be running when the reset arrives; it resumes overdue
continuations after a restart. Stopping the thread, sending a new message,
archiving, or marking it as Done prevents a pending continuation from starting.

Choose **Snooze until reset** to hide the thread until its allowance returns.
Snooze and auto-resume are independent: snooze alone wakes the thread without
sending a message; enabling both wakes and continues it. **Wake now** cancels
the snooze. Enable **Snooze limited threads** in thread behavior settings to
snooze limit stops by default. Providers without a reset time offer manual
retry and the normal snooze choices.

On web and desktop, use **Agents** to follow work delegated to subagents.
Stop on a thread also stops the subagents it delegated to.

Subagent threads started by the agent can't take messages; message the parent
thread instead. When such a subagent needs an approval or an answer, the parent
thread asks for it.

Expand a tool call in the conversation to see its full command and output.
Summaries shorten shell wrappers and can still describe the latest call after it
finishes; the call's own result shows its status.

## Open threads side by side

On web and desktop, show up to four threads at once. Drag a thread from the
sidebar onto an edge of the chat to open it beside that thread, or onto the middle
to open it there. You can also right-click a thread and choose **Open to the side**,
choose **Open a thread on the right** or **Open a thread below** in the command
palette, or press `Alt+Enter` on a thread in the palette.

The pane you last clicked is the focused one. Its thread is the one in the address
bar, and keyboard shortcuts, paste, and the thread actions in the palette act on it.
Each thread opens in one pane at a time; opening a thread that is already on screen
focuses its pane.

Drag a pane by the grip in its header onto another pane's edge to move it there,
or onto the middle to swap the two. Drag the lines between panes to resize them.
Close a pane with **×** in its header, and reopen it with `mod+shift+t`. When the
window is too small for every pane, it shows the focused one with arrows to switch
between them, and restores the split when there is room again. Each browser tab
remembers its own arrangement; a new tab or a restarted desktop app starts from the
most recent one.

## Snooze until later

Choose **Snooze → Custom…** from a thread's menu to pick a date and time in your
local time zone, or a duration in minutes, hours, or days. Durations start when
you confirm; one day means 24 hours. On web and desktop, you can also snooze
several selected threads together. Choose **Wake thread** to bring a thread back early, or
**Mark as Done** to move it straight to the Done shelf. On mobile, both appear when you swipe a
snoozed thread or open its menu.
A snoozed thread keeps working and stays hidden until its wake time, even while
its agent wakes itself for background work. It comes back early only when it needs
an approval or answer from you, when a run fails, or when you send it a message.
