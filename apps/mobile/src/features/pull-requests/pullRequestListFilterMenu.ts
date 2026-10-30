import type { MenuProps } from "../../components/ui/Menu.types";
import type { PullRequestListControls } from "./pullRequestList";

const STATES = { open: "Open", closed: "Closed", merged: "Merged", all: "All states" } as const;
const INVOLVEMENT = { all: "All PRs", reviewing: "Your review", authored: "By you" } as const;
const DRAFTS = { all: "All drafts", only: "Drafts only", hide: "Hide drafts" } as const;
const REVIEWS = {
  all: "All reviews",
  approved: "Approved",
  "changes-requested": "Changes requested",
  "review-required": "Review required",
  none: "No reviews",
} as const;
const CHECKS = { all: "All checks", passing: "Passing", failing: "Failing" } as const;
const SORTS = {
  updated: "Recently updated",
  created: "Newest created",
  oldest: "Oldest updated",
} as const;
const id = (field: string, value: string) => JSON.stringify([field, value]);
function choices(field: string, options: Readonly<Record<string, string>>, selected: string) {
  return Object.entries(options).map(([value, title]) => ({
    id: id(field, value),
    title,
    state: value === selected ? ("on" as const) : ("off" as const),
  }));
}

export function createPullRequestListFilterMenu(props: {
  readonly environments: readonly { id: string; label: string }[];
  readonly environmentId: string | null;
  readonly onEnvironmentChange: (id: string | null) => void;
  readonly value: PullRequestListControls;
  readonly onChange: (value: PullRequestListControls) => void;
  readonly onReset: () => void;
  readonly authors: readonly string[];
  readonly labels: readonly string[];
  readonly projects: readonly { id: string; title: string; environmentId: string }[];
}) {
  const { value } = props;
  const selectedLabels = value.filters.labels?.flat() ?? [];
  const selectedLabelSet = new Set(selectedLabels);
  const author = value.filters.author;
  const select = (event: string) => {
    let selection: unknown;
    try {
      selection = JSON.parse(event);
    } catch {
      return;
    }
    if (
      !Array.isArray(selection) ||
      selection.length !== 2 ||
      typeof selection[0] !== "string" ||
      typeof selection[1] !== "string"
    )
      return;
    const [field, next] = selection;
    switch (field) {
      case "environment":
        if (next === "") props.onEnvironmentChange(null);
        else if (props.environments.some((environment) => environment.id === next))
          props.onEnvironmentChange(next);
        break;
      case "reset":
        props.onReset();
        break;
      case "state":
        props.onChange({ ...value, state: next as PullRequestListControls["state"] });
        break;
      case "involvement":
        props.onChange({ ...value, involvement: next as PullRequestListControls["involvement"] });
        break;
      case "sort":
        props.onChange({ ...value, sort: next as PullRequestListControls["sort"] });
        break;
      case "project": {
        const project = props.projects.find(
          (project) => JSON.stringify([project.environmentId, project.id]) === next,
        );
        props.onChange({
          ...value,
          projectId: project?.id,
          projectEnvironmentId: project?.environmentId,
        });
        break;
      }
      case "label": {
        const labels = selectedLabels.includes(next)
          ? selectedLabels.filter((label) => label !== next)
          : [...selectedLabels, next].slice(0, 10);
        props.onChange({
          ...value,
          filters: {
            ...value.filters,
            labels: labels.length ? labels.map((label) => [label]) : undefined,
          },
        });
        break;
      }
      case "labels":
        props.onChange({ ...value, filters: { ...value.filters, labels: undefined } });
        break;
      case "author":
        props.onChange({ ...value, filters: { ...value.filters, author: next || undefined } });
        break;
      case "draft":
        props.onChange({
          ...value,
          filters: {
            ...value.filters,
            draft: next === "all" ? undefined : (next as "only" | "hide"),
          },
        });
        break;
      case "review":
        props.onChange({
          ...value,
          filters: {
            ...value.filters,
            review:
              next === "all"
                ? undefined
                : (next as NonNullable<PullRequestListControls["filters"]["review"]>),
          },
        });
        break;
      case "checks":
        props.onChange({
          ...value,
          filters: {
            ...value.filters,
            checks: next === "all" ? undefined : (next as "passing" | "failing"),
          },
        });
        break;
    }
  };
  const count =
    Number(value.state !== "open") +
    Number(value.involvement !== "all") +
    Number(Boolean(author)) +
    selectedLabels.length +
    Number(Boolean(value.filters.draft)) +
    Number(Boolean(value.filters.review)) +
    Number(Boolean(value.filters.checks)) +
    Number(Boolean(value.projectId));
  const more: MenuProps["actions"] = [
    {
      id: "drafts",
      title: value.filters.draft ? DRAFTS[value.filters.draft] : "Drafts",
      subactions: choices("draft", DRAFTS, value.filters.draft ?? "all"),
    },
    {
      id: "reviews",
      title: value.filters.review ? REVIEWS[value.filters.review] : "Reviews",
      subactions: choices("review", REVIEWS, value.filters.review ?? "all"),
    },
    {
      id: "checks",
      title: value.filters.checks ? `${CHECKS[value.filters.checks]} checks` : "Checks",
      subactions: choices("checks", CHECKS, value.filters.checks ?? "all"),
    },
    {
      id: "projects",
      title:
        props.projects.find(
          (project) =>
            project.id === value.projectId && project.environmentId === value.projectEnvironmentId,
        )?.title ?? "Project",
      subactions: choices(
        "project",
        Object.fromEntries([
          ["", "All projects"],
          ...props.projects.map((project) => [
            JSON.stringify([project.environmentId, project.id]),
            project.title,
          ]),
        ]),
        value.projectId ? JSON.stringify([value.projectEnvironmentId, value.projectId]) : "",
      ),
    },
    { id: "sort", title: SORTS[value.sort], subactions: choices("sort", SORTS, value.sort) },
    {
      id: id("reset", ""),
      title: "Reset filters",
      attributes: {
        disabled: count === 0 && value.sort === "updated" && props.environmentId === null,
      },
    },
  ];
  const labels = [...new Set([...selectedLabels, ...props.labels])].slice(0, 60);
  const authors = [
    ...new Set([...(author && author !== "me" ? [author] : []), ...props.authors]),
  ].slice(0, 60);
  const actions: MenuProps["actions"] = [
    {
      id: "environment",
      title: "Environment",
      subactions: choices(
        "environment",
        Object.fromEntries([
          ["", "All environments"],
          ...props.environments.map((environment) => [environment.id, environment.label]),
        ]),
        props.environmentId ?? "",
      ),
    },
    { id: "state", title: "State", subactions: choices("state", STATES, value.state) },
    {
      id: "involvement",
      title: "Involvement",
      subactions: choices("involvement", INVOLVEMENT, value.involvement),
    },
    {
      id: "labels",
      title: "Labels",
      subactions: [
        { id: id("labels", ""), title: "All labels", state: selectedLabels.length ? "off" : "on" },
        ...labels.map((label) => ({
          id: id("label", label),
          title: label,
          state: selectedLabelSet.has(label) ? ("on" as const) : ("off" as const),
        })),
      ],
    },
    {
      id: "author",
      title: "Author",
      subactions: choices(
        "author",
        Object.fromEntries([
          ["", "All authors"],
          ["me", "Me"],
          ...authors.map((login) => [login, login]),
        ]),
        author ?? "",
      ),
    },
    ...more,
  ];
  const customized = count > 0 || props.environmentId !== null || value.sort !== "updated";
  return {
    title: "Pull request filters",
    accessibilityLabel: "Filter pull requests",
    actions,
    onPressAction: ({ nativeEvent }: Parameters<NonNullable<MenuProps["onPressAction"]>>[0]) =>
      select(nativeEvent.event),
    customized,
  };
}
