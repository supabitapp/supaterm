import { describe, expect, it } from "vite-plus/test";
import {
  appendPullRequestAgentPrompt,
  pullRequestAgentPrompt,
  pullRequestAgentThread,
  pullRequestAgentThreadActions,
} from "./pullRequestAgentTasks";
import { IsoDateTime, ProjectId, ThreadId } from "@supaterm/contracts";
import { sourceControlClients } from "@supaterm/client-runtime/source-control-clients";

const GITHUB = sourceControlClients.get("github").changeRequest;

describe("PR agent tasks", () => {
  it("continues a single linked thread, but keeps an explicit new-thread choice separate", () => {
    const thread = {
      id: ThreadId.make("thread-one"),
      projectId: ProjectId.make("project-one"),
      title: "Existing work",
      archivedAt: null,
    };
    expect(pullRequestAgentThread([thread])).toBe(thread);
    expect(pullRequestAgentThread([thread], "new")).toBeUndefined();
    expect(pullRequestAgentThread([thread], "missing")).toBeUndefined();
    expect(pullRequestAgentThread([])).toBeUndefined();
    const archived = {
      ...thread,
      id: ThreadId.make("thread-two"),
      archivedAt: IsoDateTime.make("2026-10-09T10:00:00.000Z"),
    };
    expect(pullRequestAgentThread([thread, archived])).toBeUndefined();
    expect(pullRequestAgentThread([archived])).toBeUndefined();
    const done = { ...thread, done: true };
    expect(pullRequestAgentThread([done])).toBeUndefined();
    expect(pullRequestAgentThread([done], done.id)).toBe(done);
    expect(pullRequestAgentThread([thread, { ...done, id: archived.id }])).toBeUndefined();
    expect(pullRequestAgentThread([thread, archived], archived.id)).toBe(archived);
    const actions = pullRequestAgentThreadActions([done, archived], "ask", true);
    expect(actions.map((action) => action.title)).toEqual([
      "Start a new thread",
      "Existing work",
      "Done threads",
    ]);
    expect(actions[2]?.subactions).toMatchObject([
      { id: `ask:${done.id}`, subtitle: "Done thread" },
    ]);
    expect(pullRequestAgentThreadActions([thread], "ask", false)).toMatchObject([
      { id: `ask:${thread.id}`, subtitle: "Continue thread" },
    ]);
    expect(pullRequestAgentThreadActions([done], "feedback", false)[0]?.subactions).toMatchObject([
      { id: `feedback:${done.id}`, attributes: { disabled: false } },
    ]);
    expect(pullRequestAgentThreadActions([archived], "feedback", true)[1]).toMatchObject({
      attributes: { disabled: true },
    });
  });
  it("replaces the helper's own text when switching tasks, keeping user edits", () => {
    const first = appendPullRequestAgentPrompt("My question", "explain", GITHUB);
    const next = appendPullRequestAgentPrompt(
      first,
      "feedback",
      GITHUB,
      pullRequestAgentPrompt("explain", GITHUB),
    );
    expect(next).toBe(`My question\n\n${pullRequestAgentPrompt("feedback", GITHUB)}`);
    expect(
      appendPullRequestAgentPrompt(next, "ask", GITHUB, pullRequestAgentPrompt("feedback", GITHUB)),
    ).toBe("My question");
    const edited = `${first} with my own edit`;
    expect(
      appendPullRequestAgentPrompt(
        edited,
        "ask",
        GITHUB,
        pullRequestAgentPrompt("explain", GITHUB),
      ),
    ).toBe(edited);
  });
  it("names the change request with its host's term", () => {
    expect(pullRequestAgentPrompt("conflicts", GITHUB)).toContain(
      "Resolve this pull request's conflicts with its base branch. First confirm this thread is on the PR's branch; if it isn't, prepare the PR in its own worktree.",
    );
    expect(
      pullRequestAgentPrompt("conflicts", sourceControlClients.get("gitlab").changeRequest),
    ).toContain(
      "Resolve this merge request's conflicts with its base branch. First confirm this thread is on the MR's branch; if it isn't, prepare the MR in its own worktree.",
    );
  });
});
