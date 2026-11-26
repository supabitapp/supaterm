import { msg } from "gt-react-native";

import type { MenuProps } from "../../components/ui/Menu.types";
import { m, type MessageResolver } from "../../i18n/messages";
import type { PullRequestListControls } from "./pullRequestList";

const STATES = {
  open: msg("Open", { $context: "pull request state filter" }),
  closed: msg("Closed", { $context: "pull request state filter" }),
  merged: msg("Merged", { $context: "pull request state filter" }),
  all: msg("All states"),
};
const INVOLVEMENT = {
  all: msg("All PRs"),
  reviewing: msg("Your review"),
  authored: msg("By you"),
};
const DRAFTS = { all: msg("All drafts"), only: msg("Drafts only"), hide: msg("Hide drafts") };
const REVIEWS = {
  all: msg("All reviews"),
  approved: msg("Approved", { $context: "review status filter" }),
  "changes-requested": msg("Changes requested"),
  "review-required": msg("Review required"),
  none: msg("No reviews"),
};
const CHECKS = {
  all: msg("All checks"),
  passing: msg("Passing", { $context: "CI checks filter" }),
  failing: msg("Failing", { $context: "CI checks filter" }),
};
const CHECKS_TITLES = { passing: msg("Passing checks"), failing: msg("Failing checks") };
const SORTS = {
  updated: msg("Recently updated"),
  created: msg("Newest created"),
  oldest: msg("Oldest updated"),
};
const resolveOptions = <Key extends string>(
  options: Readonly<Record<Key, string>>,
  resolve: MessageResolver,
) =>
  Object.fromEntries(Object.entries<string>(options).map(([key, title]) => [key, resolve(title)]));
const id = (field: string, value: string) => JSON.stringify([field, value]);
function choices(field: string, options: Readonly<Record<string, string>>, selected: string) {
  return Object.entries(options).map(([value, title]) => ({
    id: id(field, value),
    title,
    state: value === selected ? ("on" as const) : ("off" as const),
  }));
}

export function createPullRequestListFilterMenu(
  props: {
    readonly environments: readonly { id: string; label: string }[];
    readonly environmentId: string | null;
    readonly onEnvironmentChange: (id: string | null) => void;
    readonly value: PullRequestListControls;
    readonly onChange: (value: PullRequestListControls) => void;
    readonly onReset: () => void;
    readonly authors: readonly string[];
    readonly labels: readonly string[];
    /** Dot colors by lowercased label name, for the labels that have one. */
    readonly labelColors: Readonly<Record<string, string>>;
    readonly projects: readonly { id: string; title: string; environmentId: string }[];
    /** Opens a picker that searches the host, for a label or author no loaded row carries. */
    readonly onSearch: (kind: "labels" | "authors") => void;
  },
  resolve: MessageResolver = m,
) {
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
      case "search":
        if (next === "labels" || next === "authors") props.onSearch(next);
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
      title: value.filters.draft
        ? resolve(DRAFTS[value.filters.draft])
        : resolve(msg("Drafts", { $context: "filter menu" })),
      subactions: choices("draft", resolveOptions(DRAFTS, resolve), value.filters.draft ?? "all"),
    },
    {
      id: "reviews",
      title: value.filters.review
        ? resolve(REVIEWS[value.filters.review])
        : resolve(msg("Reviews", { $context: "filter menu" })),
      subactions: choices(
        "review",
        resolveOptions(REVIEWS, resolve),
        value.filters.review ?? "all",
      ),
    },
    {
      id: "checks",
      title: value.filters.checks
        ? resolve(CHECKS_TITLES[value.filters.checks])
        : resolve(msg("Checks", { $context: "filter menu" })),
      subactions: choices("checks", resolveOptions(CHECKS, resolve), value.filters.checks ?? "all"),
    },
    {
      id: "projects",
      title:
        props.projects.find(
          (project) =>
            project.id === value.projectId && project.environmentId === value.projectEnvironmentId,
        )?.title ?? resolve(msg("Project", { $context: "filter menu" })),
      subactions: choices(
        "project",
        Object.fromEntries([
          ["", resolve(msg("All projects"))],
          ...props.projects.map((project) => [
            JSON.stringify([project.environmentId, project.id]),
            project.title,
          ]),
        ]),
        value.projectId ? JSON.stringify([value.projectEnvironmentId, value.projectId]) : "",
      ),
    },
    {
      id: "sort",
      title: resolve(SORTS[value.sort]),
      subactions: choices("sort", resolveOptions(SORTS, resolve), value.sort),
    },
    {
      id: id("reset", ""),
      title: resolve(msg("Reset filters")),
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
      title: resolve(msg("Environment", { $context: "filter menu" })),
      subactions: choices(
        "environment",
        Object.fromEntries([
          ["", resolve(msg("All environments"))],
          ...props.environments.map((environment) => [environment.id, environment.label]),
        ]),
        props.environmentId ?? "",
      ),
    },
    {
      id: "state",
      title: resolve(msg("State", { $context: "filter menu" })),
      subactions: choices("state", resolveOptions(STATES, resolve), value.state),
    },
    {
      id: "involvement",
      title: resolve(msg("Involvement", { $context: "filter menu" })),
      subactions: choices("involvement", resolveOptions(INVOLVEMENT, resolve), value.involvement),
    },
    {
      id: "labels",
      title: resolve(msg("Labels", { $context: "filter menu" })),
      subactions: [
        {
          id: id("search", "labels"),
          title: resolve(msg("Search labels…")),
          image: "magnifyingglass",
        },
        {
          id: id("labels", ""),
          title: resolve(msg("All labels")),
          state: selectedLabels.length ? "off" : "on",
        },
        ...labels.map((label) => {
          const color = props.labelColors[label.toLowerCase()];
          return {
            id: id("label", label),
            title: label,
            state: selectedLabelSet.has(label) ? ("on" as const) : ("off" as const),
            ...(color ? { image: "circle.fill", imageColor: color } : {}),
          };
        }),
      ],
    },
    {
      id: "author",
      title: resolve(msg("Author", { $context: "filter menu" })),
      subactions: [
        {
          id: id("search", "authors"),
          title: resolve(msg("Search authors…")),
          image: "magnifyingglass",
        },
        ...choices(
          "author",
          Object.fromEntries([
            ["", resolve(msg("All authors"))],
            ["me", resolve(msg("Me", { $context: "author filter, the current user" }))],
            ...authors.map((login) => [login, login]),
          ]),
          author ?? "",
        ),
      ],
    },
    ...more,
  ];
  const customized = count > 0 || props.environmentId !== null || value.sort !== "updated";
  return {
    title: resolve(msg("Pull request filters")),
    accessibilityLabel: resolve(msg("Filter pull requests")),
    actions,
    onPressAction: ({ nativeEvent }: Parameters<NonNullable<MenuProps["onPressAction"]>>[0]) =>
      select(nativeEvent.event),
    customized,
  };
}
