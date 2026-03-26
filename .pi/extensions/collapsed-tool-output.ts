import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createFindToolDefinition,
	createGrepToolDefinition,
	createLsToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	keyHint,
} from "@mariozechner/pi-coding-agent";
import { Container, Text } from "@mariozechner/pi-tui";
import { homedir } from "node:os";

const COLLAPSED_RENDERER = Symbol("collapsed-renderer");

const toolCache = new Map<string, ReturnType<typeof createToolDefinitions>>();

function createToolDefinitions(cwd: string) {
	return {
		read: createReadToolDefinition(cwd),
		bash: createBashToolDefinition(cwd),
		edit: createEditToolDefinition(cwd),
		write: createWriteToolDefinition(cwd),
		grep: createGrepToolDefinition(cwd),
		find: createFindToolDefinition(cwd),
		ls: createLsToolDefinition(cwd),
	};
}

function getToolDefinitions(cwd: string) {
	let tools = toolCache.get(cwd);
	if (!tools) {
		tools = createToolDefinitions(cwd);
		toolCache.set(cwd, tools);
	}
	return tools;
}

function markCollapsed<T extends object>(component: T): T {
	(component as Record<PropertyKey, unknown>)[COLLAPSED_RENDERER] = true;
	return component;
}

function isCollapsed(component: unknown) {
	return Boolean(component && typeof component === "object" && (component as Record<PropertyKey, unknown>)[COLLAPSED_RENDERER]);
}

function resetCollapsedComponent<T extends { lastComponent?: unknown }>(context: T): T {
	if (!isCollapsed(context.lastComponent)) {
		return context;
	}
	return {
		...context,
		lastComponent: undefined,
	};
}

function shortenPath(path: string | undefined) {
	if (!path) {
		return path ?? "";
	}
	const home = homedir();
	if (path.startsWith(home)) {
		return `~${path.slice(home.length)}`;
	}
	return path;
}

function emptyResult() {
	return markCollapsed(new Container());
}

function hiddenResult(theme: any, label = "result hidden") {
	return markCollapsed(new Text(theme.fg("dim", `${label} (${keyHint("app.tools.expand", "to expand")})`), 0, 0));
}

function collapsedEditCall(args: any, theme: any) {
	const path = args?.path ? theme.fg("accent", shortenPath(args.path)) : theme.fg("toolOutput", "...");
	return markCollapsed(new Text(`${theme.fg("toolTitle", theme.bold("edit"))} ${path}`, 0, 0));
}

function collapsedWriteCall(args: any, theme: any) {
	const path = args?.path ? theme.fg("accent", shortenPath(args.path)) : theme.fg("toolOutput", "...");
	const lineCount = typeof args?.content === "string" ? args.content.split("\n").length : 0;
	const lineInfo = lineCount > 0 ? theme.fg("muted", ` (${lineCount} lines)`) : "";
	return markCollapsed(new Text(`${theme.fg("toolTitle", theme.bold("write"))} ${path}${lineInfo}`, 0, 0));
}

export default function (pi: ExtensionAPI) {
	const baseTools = getToolDefinitions(process.cwd());

	pi.registerTool({
		...baseTools.read,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).read.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return hiddenResult(theme);
			}
			return getToolDefinitions(context.cwd).read.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.bash,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).bash.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return hiddenResult(theme, options.isPartial ? "running, result hidden" : "result hidden");
			}
			return getToolDefinitions(context.cwd).bash.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.edit,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).edit.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			if (!context.expanded) {
				return collapsedEditCall(args, theme);
			}
			return getToolDefinitions(context.cwd).edit.renderCall!(args, theme, resetCollapsedComponent(context));
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return emptyResult();
			}
			return getToolDefinitions(context.cwd).edit.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.write,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).write.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			if (!context.expanded) {
				return collapsedWriteCall(args, theme);
			}
			return getToolDefinitions(context.cwd).write.renderCall!(args, theme, resetCollapsedComponent(context));
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return emptyResult();
			}
			return getToolDefinitions(context.cwd).write.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.grep,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).grep.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return hiddenResult(theme);
			}
			return getToolDefinitions(context.cwd).grep.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.find,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).find.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return hiddenResult(theme);
			}
			return getToolDefinitions(context.cwd).find.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});

	pi.registerTool({
		...baseTools.ls,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			return getToolDefinitions(ctx.cwd).ls.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderResult(result, options, theme, context) {
			if (!options.expanded && !context.isError) {
				return hiddenResult(theme);
			}
			return getToolDefinitions(context.cwd).ls.renderResult!(
				result,
				options,
				theme,
				resetCollapsedComponent(context),
			);
		},
	});
}
