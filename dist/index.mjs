import { dirname, join, relative, resolve } from "node:path";
import process$1 from "node:process";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
// \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod, mod.exports), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
		key = keys[i];
		if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
			get: ((k) => from[k]).bind(null, key),
			enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
		});
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
const DEFAULT_CONFIG = {
	lang: void 0,
	message: void 0,
	abortEarly: void 0,
	abortPipeEarly: void 0
};
/**
* Returns the global configuration.
*
* @param config The config to merge.
*
* @returns The configuration.
*/
/* @__NO_SIDE_EFFECTS__ */
function getGlobalConfig(config$1) {
	if (!config$1 && true) return DEFAULT_CONFIG;
	return {
		lang: config$1?.lang ?? void 0,
		message: config$1?.message,
		abortEarly: config$1?.abortEarly ?? void 0,
		abortPipeEarly: config$1?.abortPipeEarly ?? void 0
	};
}
/**
* Stringifies an unknown input to a literal or type string.
*
* @param input The unknown input.
*
* @returns A literal or type string.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _stringify(input) {
	const type = typeof input;
	if (type === "string") return `"${input}"`;
	if (type === "number" || type === "bigint" || type === "boolean") return `${input}`;
	if (type === "object" || type === "function") return (input && Object.getPrototypeOf(input)?.constructor?.name) ?? "null";
	return type;
}
/**
* Adds an issue to the dataset.
*
* @param context The issue context.
* @param label The issue label.
* @param dataset The input dataset.
* @param config The configuration.
* @param other The optional props.
*
* @internal
*/
function _addIssue(context, label, dataset, config$1, other) {
	const input = other && "input" in other ? other.input : dataset.value;
	const expected = other?.expected ?? context.expects ?? null;
	const received = other?.received ?? /* @__PURE__ */ _stringify(input);
	const issue = {
		kind: context.kind,
		type: context.type,
		input,
		expected,
		received,
		message: `Invalid ${label}: ${expected ? `Expected ${expected} but r` : "R"}eceived ${received}`,
		requirement: context.requirement,
		path: other?.path,
		issues: other?.issues,
		lang: config$1.lang,
		abortEarly: config$1.abortEarly,
		abortPipeEarly: config$1.abortPipeEarly
	};
	const isSchema = context.kind === "schema";
	const message$1 = other?.message ?? context.message ?? (context.reference, issue.lang, void 0) ?? (isSchema ? (issue.lang, void 0) : null) ?? config$1.message ?? (issue.lang, void 0);
	if (message$1 !== void 0) issue.message = typeof message$1 === "function" ? message$1(issue) : message$1;
	if (isSchema) dataset.typed = false;
	if (dataset.issues) dataset.issues.push(issue);
	else dataset.issues = [issue];
}
/**
* Compares two values using the SameValueZero algorithm, which treats `NaN`
* as equal to itself unlike `===`.
*
* @param value1 The first value.
* @param value2 The second value.
*
* @returns Whether the values are equal.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _isSameValueZero(value1, value2) {
	return value1 === value2 || Number.isNaN(value1) && Number.isNaN(value2);
}
/**
* Joins multiple `expects` values with the given separator.
*
* @param values The `expects` values.
* @param separator The separator.
*
* @returns The joined `expects` property.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _joinExpects(values$1, separator) {
	const list = [...new Set(values$1)];
	if (list.length > 1) return `(${list.join(` ${separator} `)})`;
	return list[0] ?? "never";
}
/**
* Eagerly creates and attaches the Standard Schema properties of a schema.
*
* Hint: The contextual `this` type includes the standard properties that are
* attached before the schema is returned.
*
* @param schema The schema to attach standard properties to.
*
* @returns The schema with standard properties attached.
*
* @internal
*/
function _standardSchema(schema) {
	schema["~standard"] = {
		version: 1,
		vendor: "valibot",
		validate: (value$1) => schema["~run"]({ value: value$1 }, /* @__PURE__ */ getGlobalConfig())
	};
	return schema;
}
/**
* A Valibot error with useful information.
*/
var ValiError = class extends Error {
	/**
	* Creates a Valibot error with useful information.
	*
	* @param issues The error issues.
	*/
	constructor(issues) {
		super(issues[0].message);
		this.name = "ValiError";
		this.issues = issues;
	}
};
/* @__NO_SIDE_EFFECTS__ */
function parseJson(config$1, message$1) {
	return {
		kind: "transformation",
		type: "parse_json",
		reference: parseJson,
		config: config$1,
		message: message$1,
		async: false,
		"~run"(dataset, config$2) {
			try {
				dataset.value = JSON.parse(dataset.value, this.config?.reviver);
			} catch (error) {
				if (error instanceof Error) {
					_addIssue(this, "JSON", dataset, config$2, { received: `"${error.message}"` });
					dataset.typed = false;
				} else throw error;
			}
			return dataset;
		}
	};
}
/**
* Creates a custom transformation action.
*
* @param operation The transformation operation.
*
* @returns A transform action.
*/
/* @__NO_SIDE_EFFECTS__ */
function transform(operation) {
	return {
		kind: "transformation",
		type: "transform",
		reference: transform,
		async: false,
		operation,
		"~run"(dataset) {
			dataset.value = this.operation(dataset.value);
			return dataset;
		}
	};
}
const ABORT_EARLY_CONFIG = { abortEarly: true };
/**
* Returns the fallback value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The output dataset if available.
* @param config The config if available.
*
* @returns The fallback value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getFallback(schema, dataset, config$1) {
	return typeof schema.fallback === "function" ? schema.fallback(dataset, config$1) : schema.fallback;
}
/**
* Returns a fallback value as output if the input does not match the schema.
*
* @param schema The schema to catch.
* @param fallback The fallback value.
*
* @returns The passed schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function fallback(schema, fallback$1) {
	return _standardSchema({
		...schema,
		fallback: fallback$1,
		"~run"(dataset, config$1) {
			const outputDataset = schema["~run"](dataset, config$1);
			return outputDataset.issues ? {
				typed: true,
				value: /* @__PURE__ */ getFallback(this, outputDataset, config$1)
			} : outputDataset;
		}
	});
}
/**
* Returns the default value of the schema.
*
* @param schema The schema to get it from.
* @param dataset The input dataset if available.
* @param config The config if available.
*
* @returns The default value.
*/
/* @__NO_SIDE_EFFECTS__ */
function getDefault(schema, dataset, config$1) {
	return typeof schema.default === "function" ? schema.default(dataset, config$1) : schema.default;
}
/**
* Checks if the input matches the schema. By using a type predicate, this
* function can be used as a type guard.
*
* @param schema The schema to be used.
* @param input The input to be tested.
*
* @returns Whether the input matches the schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function is(schema, input) {
	return !schema["~run"]({ value: input }, ABORT_EARLY_CONFIG).issues;
}
/* @__NO_SIDE_EFFECTS__ */
function array(item, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "array",
		reference: array,
		expects: "Array",
		async: false,
		item,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (Array.isArray(input)) {
				dataset.typed = true;
				dataset.value = [];
				for (let key = 0; key < input.length; key++) {
					const value$1 = input[key];
					const itemDataset = this.item["~run"]({ value: value$1 }, config$1);
					if (itemDataset.issues) {
						const pathItem = {
							type: "array",
							origin: "value",
							input,
							key,
							value: value$1
						};
						for (const issue of itemDataset.issues) {
							if (issue.path) issue.path.unshift(pathItem);
							else issue.path = [pathItem];
							dataset.issues?.push(issue);
						}
						if (!dataset.issues) dataset.issues = itemDataset.issues;
						if (config$1.abortEarly) {
							dataset.typed = false;
							break;
						}
					}
					if (!itemDataset.typed) dataset.typed = false;
					dataset.value.push(itemDataset.value);
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function literal(literal_, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "literal",
		reference: literal,
		expects: /* @__PURE__ */ _stringify(literal_),
		async: false,
		literal: literal_,
		message: message$1,
		"~run"(dataset, config$1) {
			if (/* @__PURE__ */ _isSameValueZero(dataset.value, this.literal)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function nullable(wrapped, default_) {
	return _standardSchema({
		kind: "schema",
		type: "nullable",
		reference: nullable,
		expects: `(${wrapped.expects} | null)`,
		async: false,
		wrapped,
		default: default_,
		"~run"(dataset, config$1) {
			if (dataset.value === null) {
				if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
				if (dataset.value === null) {
					dataset.typed = true;
					return dataset;
				}
			}
			return this.wrapped["~run"](dataset, config$1);
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function object(entries$1, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "object",
		reference: object,
		expects: "Object",
		async: false,
		entries: entries$1,
		message: message$1,
		"~run"(dataset, config$1) {
			const input = dataset.value;
			if (input && typeof input === "object") {
				dataset.typed = true;
				dataset.value = {};
				for (const key in this.entries) {
					const valueSchema = this.entries[key];
					if (key in input || (valueSchema.type === "exact_optional" || valueSchema.type === "optional" || valueSchema.type === "nullish") && valueSchema.default !== void 0) {
						const value$1 = key in input ? input[key] : /* @__PURE__ */ getDefault(valueSchema);
						const valueDataset = valueSchema["~run"]({ value: value$1 }, config$1);
						if (valueDataset.issues) {
							const pathItem = {
								type: "object",
								origin: "value",
								input,
								key,
								value: value$1
							};
							for (const issue of valueDataset.issues) {
								if (issue.path) issue.path.unshift(pathItem);
								else issue.path = [pathItem];
								dataset.issues?.push(issue);
							}
							if (!dataset.issues) dataset.issues = valueDataset.issues;
							if (config$1.abortEarly) {
								dataset.typed = false;
								break;
							}
						}
						if (!valueDataset.typed) dataset.typed = false;
						dataset.value[key] = valueDataset.value;
					} else if (valueSchema.fallback !== void 0) dataset.value[key] = /* @__PURE__ */ getFallback(valueSchema);
					else if (valueSchema.type !== "exact_optional" && valueSchema.type !== "optional" && valueSchema.type !== "nullish") {
						_addIssue(this, "key", dataset, config$1, {
							input: void 0,
							expected: `"${key}"`,
							path: [{
								type: "object",
								origin: "key",
								input,
								key,
								value: input[key]
							}]
						});
						if (config$1.abortEarly) break;
					}
				}
			} else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function optional(wrapped, default_) {
	return _standardSchema({
		kind: "schema",
		type: "optional",
		reference: optional,
		expects: `(${wrapped.expects} | undefined)`,
		async: false,
		wrapped,
		default: default_,
		"~run"(dataset, config$1) {
			if (dataset.value === void 0) {
				if (this.default !== void 0) dataset.value = /* @__PURE__ */ getDefault(this, dataset, config$1);
				if (dataset.value === void 0) {
					dataset.typed = true;
					return dataset;
				}
			}
			return this.wrapped["~run"](dataset, config$1);
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function picklist(options, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "picklist",
		reference: picklist,
		expects: /* @__PURE__ */ _joinExpects(options.map(_stringify), "|"),
		async: false,
		options,
		message: message$1,
		"~run"(dataset, config$1) {
			if (this.options.includes(dataset.value)) dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/* @__NO_SIDE_EFFECTS__ */
function string(message$1) {
	return _standardSchema({
		kind: "schema",
		type: "string",
		reference: string,
		expects: "string",
		async: false,
		message: message$1,
		"~run"(dataset, config$1) {
			if (typeof dataset.value === "string") dataset.typed = true;
			else _addIssue(this, "type", dataset, config$1);
			return dataset;
		}
	});
}
/**
* Returns the sub issues of the provided datasets for the union issue.
*
* @param datasets The datasets.
*
* @returns The sub issues.
*
* @internal
*/
/* @__NO_SIDE_EFFECTS__ */
function _subIssues(datasets) {
	let issues;
	if (datasets) for (const dataset of datasets) if (issues) for (const issue of dataset.issues) issues.push(issue);
	else issues = dataset.issues;
	return issues;
}
/* @__NO_SIDE_EFFECTS__ */
function union(options, message$1) {
	return _standardSchema({
		kind: "schema",
		type: "union",
		reference: union,
		expects: /* @__PURE__ */ _joinExpects(options.map((option) => option.expects), "|"),
		async: false,
		options,
		message: message$1,
		"~run"(dataset, config$1) {
			let validDataset;
			let typedDatasets;
			let untypedDatasets;
			for (const schema of this.options) {
				const optionDataset = schema["~run"]({ value: dataset.value }, config$1);
				if (optionDataset.typed) if (optionDataset.issues) if (typedDatasets) typedDatasets.push(optionDataset);
				else typedDatasets = [optionDataset];
				else {
					validDataset = optionDataset;
					break;
				}
				else if (untypedDatasets) untypedDatasets.push(optionDataset);
				else untypedDatasets = [optionDataset];
			}
			if (validDataset) return validDataset;
			if (typedDatasets) {
				if (typedDatasets.length === 1) return typedDatasets[0];
				_addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(typedDatasets) });
				dataset.typed = true;
			} else if (untypedDatasets?.length === 1) return untypedDatasets[0];
			else _addIssue(this, "type", dataset, config$1, { issues: /* @__PURE__ */ _subIssues(untypedDatasets) });
			return dataset;
		}
	});
}
/**
* Creates a unknown schema.
*
* @returns A unknown schema.
*/
/* @__NO_SIDE_EFFECTS__ */
function unknown() {
	return _standardSchema({
		kind: "schema",
		type: "unknown",
		reference: unknown,
		expects: "unknown",
		async: false,
		"~run"(dataset) {
			dataset.typed = true;
			return dataset;
		}
	});
}
/**
* Parses an unknown input based on a schema.
*
* @param schema The schema to be used.
* @param input The input to be parsed.
* @param config The parse configuration.
*
* @returns The parsed input.
*/
function parse(schema, input, config$1) {
	const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
	if (dataset.issues) throw new ValiError(dataset.issues);
	return dataset.value;
}
/* @__NO_SIDE_EFFECTS__ */
function pipe(...pipe$1) {
	return _standardSchema({
		...pipe$1[0],
		pipe: pipe$1,
		"~run"(dataset, config$1) {
			for (const item of pipe$1) if (item.kind !== "metadata") {
				if (dataset.issues && (item.kind === "schema" || item.kind === "transformation")) {
					dataset.typed = false;
					break;
				}
				if (!dataset.issues || !config$1.abortEarly && !config$1.abortPipeEarly) dataset = item["~run"](dataset, config$1);
			}
			return dataset;
		}
	});
}
/**
* Parses an unknown input based on a schema.
*
* @param schema The schema to be used.
* @param input The input to be parsed.
* @param config The parse configuration.
*
* @returns The parse result.
*/
/* @__NO_SIDE_EFFECTS__ */
function safeParse(schema, input, config$1) {
	const dataset = schema["~run"]({ value: input }, /* @__PURE__ */ getGlobalConfig(config$1));
	return {
		typed: dataset.typed,
		success: !dataset.issues,
		output: dataset.value,
		issues: dataset.issues
	};
}
// src/text.ts
/** `text` on one line, with every run of whitespace turned into a single space */
function collapseWhitespace(text) {
	return text.replace(/\s+/g, " ").trim();
}
/** The number of ASCII digits at the start of `text` */
function countLeadingDigits(text) {
	let count = 0;
	while (text.charAt(count) >= "0" && text.charAt(count) <= "9") count++;
	return count;
}
/** Todo phases persisted outside this process: session entries, omp's `todo` tool, the peer database */
const todoPhasesSchema = /* @__PURE__ */ array(/* @__PURE__ */ object({
	name: /* @__PURE__ */ string(),
	tasks: /* @__PURE__ */ array(/* @__PURE__ */ object({
		content: /* @__PURE__ */ string(),
		status: /* @__PURE__ */ picklist([
			"pending",
			"in_progress",
			"completed",
			"abandoned",
			"blocked"
		]),
		blocker: /* @__PURE__ */ optional(/* @__PURE__ */ string())
	}))
}));
/**
* Enforces the Single-Active-Task Invariant (matching omp's `normalizeInProgressTask`):
* - At most one task across all phases is `in_progress`.
* - If none is `in_progress`, the first `pending` task is promoted to `in_progress`.
* - Assigns stable `#1`, `#2`, ... IDs to every item.
*/
function normalizePhases(phases) {
	let nextId = 1;
	let hasActiveTask = false;
	const normalized = phases.map((phase) => ({
		name: phase.name.trim() || "Tasks",
		tasks: phase.tasks.flatMap((task) => {
			const content = task.content.trim();
			if (!content) return [];
			let status = task.status;
			if (status === "in_progress") {
				if (hasActiveTask) status = "pending";
				hasActiveTask = true;
			}
			const blocker = task.blocker ?? "";
			return [{
				id: `#${nextId++}`,
				content,
				status,
				...blocker ? { blocker } : {}
			}];
		})
	})).filter((phase) => phase.tasks.length > 0);
	if (!hasActiveTask) {
		const firstPending = allTasks(normalized).find((task) => task.status === "pending");
		if (firstPending) firstPending.status = "in_progress";
	}
	return normalized;
}
function allTasks(phases) {
	return phases.flatMap((phase) => phase.tasks);
}
/** Tasks the stop gate waits for */
function isIncomplete(task) {
	return task.status === "pending" || task.status === "in_progress";
}
/** Tasks the sidecar may still complete or drop */
function isOpen(task) {
	return task.status !== "completed" && task.status !== "abandoned";
}
/**
* Matches a task identifier (`"#1"`, `"1"`, or task content) against a todo item.
*/
function matchesTodo(task, token) {
	const clean = token.trim();
	if (!clean) return false;
	if (clean === task.id || `#${clean}` === task.id) return true;
	const taskText = collapseWhitespace(task.content).toLowerCase();
	const tokenText = collapseWhitespace(withoutTaskId(clean)).toLowerCase();
	if (!tokenText) return false;
	return taskText === tokenText || tokenText.length >= 6 && taskText.includes(tokenText);
}
/** Drops a leading task ID such as `#3:` so the rest of the token can match a task's content */
function withoutTaskId(token) {
	const digitCount = countLeadingDigits(token.slice(1));
	if (!token.startsWith("#") || digitCount === 0) return token;
	const rest = token.slice(1 + digitCount).trimStart();
	return ([
		":",
		".",
		"-"
	].includes(rest.charAt(0)) ? rest.slice(1) : rest).trimStart();
}
// src/omp/branch.ts
const stateEntryType = "omp-sidecar-todo-watcher.state";
const phasesEntrySchema = /* @__PURE__ */ union([/* @__PURE__ */ pipe(/* @__PURE__ */ object({
	type: /* @__PURE__ */ literal("custom"),
	customType: /* @__PURE__ */ picklist([stateEntryType, "user_todo_edit"]),
	data: /* @__PURE__ */ object({ phases: todoPhasesSchema })
}), /* @__PURE__ */ transform((entry) => entry.data.phases)), /* @__PURE__ */ pipe(/* @__PURE__ */ object({
	type: /* @__PURE__ */ literal("message"),
	message: /* @__PURE__ */ object({
		role: /* @__PURE__ */ literal("toolResult"),
		toolName: /* @__PURE__ */ literal("todo"),
		isError: /* @__PURE__ */ optional(/* @__PURE__ */ literal(false)),
		details: /* @__PURE__ */ object({ phases: todoPhasesSchema })
	})
}), /* @__PURE__ */ transform((entry) => entry.message.details.phases))]);
function appendStateEntry(pi, watcher) {
	pi.appendEntry(stateEntryType, structuredClone({
		phases: watcher.phases,
		telemetry: watcher.telemetry
	}));
}
/** The newest todo phases on a session branch: this plugin's state, user todo edits, or omp's own `todo` tool */
function findLatestTodoPhases(branch) {
	for (const entry of branch.toReversed()) {
		const result = /* @__PURE__ */ safeParse(phasesEntrySchema, entry);
		if (result.success) return result.output;
	}
	return [];
}
// src/omp/hud.ts
const plainTheme = {
	fg: (_color, text) => text,
	strikethrough: (text) => text
};
const maxVisibleTasks = 5;
function refreshUi(ctx, { broker, watcher }) {
	if (!ctx.hasUI) return;
	const lines = renderHudLines(watcher, broker.listOtherPeers(watcher.peerId), ctx.ui.theme);
	ctx.ui.setWidget("sidecar-todo-watcher", lines.length > 0 ? lines : void 0, { placement: "aboveEditor" });
	ctx.ui.setStatus("sidecar-todo", renderStatusText(watcher));
}
/**
* Renders a multi-line TUI widget showing managed Todos (with checkboxes & theme colors) + Peer Team activity.
*/
function renderHudLines(watcher, peers, theme = plainTheme) {
	const tasks = allTasks(watcher.phases);
	const lines = [];
	if (tasks.length > 0) {
		const done = tasks.filter((task) => task.status === "completed").length;
		const active = watcher.activeTask;
		const pauseBadge = watcher.paused ? theme.fg("warning", " [PAUSED]") : "";
		const { telemetry } = watcher;
		const telemetryBadge = telemetry.calls > 0 ? theme.fg("dim", ` · Watcher(${telemetry.lastModelId ?? telemetry.mode}): ${telemetry.calls} calls, ${telemetry.totalTokens} tok, ${(telemetry.cacheHitRate * 100).toFixed(1)}% cache ($${telemetry.totalCostUsd.toFixed(4)})`) : "";
		lines.push(`${theme.fg("accent", "[Sidecar Todo]")} ${done}/${tasks.length} done${pauseBadge}${active ? ` · Active (${active.id}): ${active.content}` : ` · ${theme.fg("success", "All complete ✓")}`}${telemetryBadge}`);
		for (const task of tasks.slice(0, maxVisibleTasks)) lines.push(`  ${renderTask(task, theme)}`);
		if (tasks.length > maxVisibleTasks) lines.push(`  ${theme.fg("dim", `… +${tasks.length - maxVisibleTasks} more todo(s)`)}`);
	}
	if (peers.length > 0) {
		const peerSummary = peers.map((peer) => `@${peer.peerId}(${peer.completedCount}/${peer.totalCount}${peer.activeTask === null ? "" : `: ${peer.activeTask}`})`).join(" | ");
		lines.push(`${theme.fg("accent", "[Peers]")} ${peerSummary}`);
	}
	return lines;
}
function renderStatusText(watcher) {
	const tasks = allTasks(watcher.phases);
	if (tasks.length === 0) return void 0;
	const done = tasks.filter((task) => task.status === "completed").length;
	const active = watcher.activeTask;
	return `Todo ${done}/${tasks.length}${watcher.paused ? " (paused)" : active ? ` (${active.id})` : " ✓"}`;
}
function renderTask(task, theme) {
	switch (task.status) {
		case "completed": return theme.fg("success", `[x] ${task.id} ${theme.strikethrough(task.content)}`);
		case "in_progress": return theme.fg("accent", `[>] ${task.id} ${task.content}`);
		case "abandoned": return theme.fg("dim", `[-] ${task.id} ${theme.strikethrough(task.content)}`);
		case "blocked": return theme.fg("warning", `[!] ${task.id} ${task.content} (blocked)`);
		case "pending": return theme.fg("muted", `[ ] ${task.id} ${task.content}`);
	}
}
// src/watcher/prompts.ts
/** Every fixed rule lives in the system prompt, so all sidecar calls share it as the start of their cached prefix */
const sidecarInstructions = [
	"You are a fast, deterministic JSON-only code-progress judge for a coding agent's todo list. Each user message reports the agent's activity since the previous one. Do not think or explain; output ONLY a raw JSON object starting with '{' and ending with '}'.",
	"",
	"[WHEN THERE IS NO TODO LIST YET]",
	"Extract 2 to 6 concrete, verifiable engineering todo items in execution order (`initTasks` array).",
	"If any step is ALREADY fully implemented/verified by the reported tool actions, list its 1-based ID (e.g. \"#1\") in `completedTasks`.",
	"Reply format: {\"initTasks\": [\"step 1\", \"step 2\"], \"completedTasks\": [\"#1\"], \"milestoneSummary\": null, \"exportedSymbolsChanged\": []}",
	"",
	"[EVALUATION RULES FOR AN EXISTING TODO LIST]",
	"1. Mark an open item in `completedTasks` (by ID like \"#1\") ONLY if every function/requirement named in that item is implemented and verified in the reported code/actions.",
	"2. For investigation/analysis/audit items (e.g. 'Analyze X', 'Locate root cause'), mark completed ONLY if the target files were read AND the 'Main Agent Notes & Analytical Findings' contain the concrete analytical conclusion/findings (or the agent has already moved on to implementing the fix).",
	"3. Never mark a test/verification item completed if the test command has not run yet or failed.",
	"4. If the user added new requirements, list in `appendTasks`; if an item is obsolete, list in `dropTasks`.",
	"5. If shared exports/signatures changed or a key investigation finding affects peers, write a 1-sentence `milestoneSummary` and list `exportedSymbolsChanged`.",
	"Reply format: {\"completedTasks\": [\"#1\"], \"appendTasks\": [], \"dropTasks\": [], \"milestoneSummary\": null, \"exportedSymbolsChanged\": []}"
].join("\n");
/** The first message of a transcript, carrying the task context the sidecar has not seen yet */
function buildOpeningPrompt(context) {
	const lines = [
		"[TASK CONTEXT]",
		`User Goal: ${context.userGoal || "(infer from the activity below)"}`,
		...todoListLines(context.phases)
	];
	if (context.phases.length > 0) lines.push(`Investigated/Read files so far: ${[...context.cumulativeReadFiles].join(", ") || "(none)"}`, `Modified files so far: ${[...context.cumulativeTouchedFiles].join(", ") || "(none)"}`);
	return [
		...lines,
		"",
		...activityLines(context.burst, context.diff)
	].join("\n");
}
/** A later message of a transcript: what changed since the sidecar's previous reply */
function buildFollowUpPrompt(context) {
	const { burst } = context;
	return [
		...burst.userPrompted ? [`New user message: ${context.userPrompt}`] : [],
		...openTodoLines(context.phases),
		"",
		...activityLines(burst, context.diff)
	].join("\n");
}
function todoListLines(phases) {
	const tasks = allTasks(phases);
	if (tasks.length === 0) return ["Todo List: (none yet)"];
	return ["Todo List:", ...tasks.map(taskLine)];
}
/** The finished items already sit earlier in the transcript */
function openTodoLines(phases) {
	const tasks = allTasks(phases);
	if (tasks.length === 0) return ["Todo List: (none yet)"];
	const openTasks = tasks.filter(isOpen);
	return openTasks.length > 0 ? ["Open Todo Items:", ...openTasks.map(taskLine)] : ["Open Todo Items: (none)"];
}
function taskLine(task) {
	return `${task.id} [${task.status}]: ${task.content}`;
}
function activityLines(burst, diff) {
	const lines = [];
	if (burst.assistantNotes.length > 0) lines.push("Main Agent Notes & Analytical Findings:", ...burst.assistantNotes);
	if (burst.readEvidence.length > 0) lines.push("Files & symbols inspected:", ...bullets(burst.readEvidence));
	if (burst.toolActions.length > 0) lines.push("Executed tool actions:", ...bullets(burst.toolActions));
	if (burst.touchedFiles.size > 0) lines.push(`Modified files: ${[...burst.touchedFiles].join(", ")}`);
	if (diff.trim()) lines.push("On-disk git diff snippet:", "```diff", diff.trim().slice(0, 3e3), "```");
	return ["[AGENT ACTIVITY]", ...lines.length > 0 ? lines : ["(none)"]];
}
function bullets(items) {
	return items.map((item) => `- ${item}`);
}
// src/omp/runner.ts
const watcherModeSchema = /* @__PURE__ */ picklist([
	"auto",
	"detached",
	"ephemeral"
]);
const detachedModelSpecs = [
	"@smol",
	"@tiny",
	"@commit",
	"gemini-3.8-flash",
	"deepseek-v4.1-flash",
	"deepseek-flash",
	"claude-haiku-4-5"
];
const zeroUsage = {
	input: 0,
	output: 0,
	cacheRead: 0,
	cacheWrite: 0,
	totalTokens: 0,
	cost: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		total: 0
	}
};
function isWatcherMode(value) {
	return /* @__PURE__ */ is(watcherModeSchema, value);
}
/** The cheap model for the Detached Micro-Judge, or undefined when the watcher must use the session model */
function resolveDetachedModel(ctx, settings) {
	if (settings.mode === "ephemeral") return void 0;
	const specs = settings.modelSpec === void 0 ? detachedModelSpecs : [settings.modelSpec, ...detachedModelSpecs];
	for (const spec of specs) {
		const model = ctx.models.resolve(spec);
		if (model) return model;
	}
}
/** Prefers a Detached Micro-Judge on a cheap/fast model (@smol / @tiny / deepseek-flash) and, outside `detached` mode, falls back to a Shared-Cache Ephemeral Turn on the active session model */
function createSidecarRunner(ctx, settings) {
	return async (request, signal) => {
		const model = resolveDetachedModel(ctx, settings);
		if (model) {
			const reply = await askDetached(ctx, model, request, signal).catch((error) => {
				if (settings.mode === "detached") throw error;
			});
			if (reply) return reply;
		}
		if (settings.mode === "detached") throw new Error("No detached sidecar model replied");
		if (!ctx.runEphemeralTurn) throw new Error("No sidecar watcher runner available");
		const { replyText, assistantMessage } = await ctx.runEphemeralTurn({
			promptText: `${sidecarInstructions}\n\n${request.prompt}`,
			minimizeEffort: true,
			signal
		});
		return {
			replyText,
			mode: "ephemeral-shared-cache",
			modelId: `${assistantMessage.provider}/${assistantMessage.model}`,
			usage: assistantMessage.usage
		};
	};
}
async function askDetached(ctx, model, request, signal) {
	const complete = await loadCompleteSimple();
	const apiKey = await ctx.modelRegistry.getApiKey(model);
	if (!complete || apiKey === void 0 || apiKey === "") return void 0;
	const headers = await ctx.modelRegistry.resolveModelHeaders(model, signal);
	const cacheKey = `${ctx.sessionManager.getSessionId()}:detached-watcher`;
	const message = await complete(model, {
		systemPrompt: sidecarInstructions,
		messages: [...request.transcript.flatMap((exchange) => [userMessage(exchange.prompt), assistantMessage(model, exchange.replyText)]), userMessage(request.prompt)]
	}, {
		apiKey,
		headers,
		sessionId: cacheKey,
		promptCacheKey: cacheKey,
		temperature: 0,
		disableReasoning: true,
		forceReasoningOff: true,
		signal
	});
	signal?.throwIfAborted();
	const replyText = message.content.filter((block) => block.type === "text").map((block) => block.text ?? "").join("\n");
	if (!replyText.trim()) return void 0;
	return {
		replyText,
		mode: "detached-smol",
		modelId: `${message.provider}/${message.model}`,
		usage: message.usage
	};
}
function userMessage(text) {
	return {
		role: "user",
		content: [{
			type: "text",
			text
		}],
		timestamp: Date.now()
	};
}
/** An earlier reply in the form pi-ai returns one from `model` */
function assistantMessage(model, text) {
	return {
		role: "assistant",
		content: [{
			type: "text",
			text
		}],
		api: model.api,
		provider: model.provider,
		model: model.id,
		usage: zeroUsage,
		stopReason: "stop",
		timestamp: Date.now()
	};
}
let completeSimplePromise;
async function loadCompleteSimple() {
	completeSimplePromise ??= import("@oh-my-pi/pi-ai").then((piAi) => piAi.completeSimple, () => void 0);
	return completeSimplePromise;
}
// src/omp/command.ts
const peerTodosDescription = "Manage Sidecar Watcher todos & peer sync: /peer-todos [status|model <spec>|mode <auto|detached|ephemeral>|add <task>|done <#id>|reset|pause|resume|broadcast <msg>]";
function runPeerTodosCommand(rawArgs, session, ctx) {
	const { broker, watcher, settings } = session;
	const trimmed = rawArgs.trim();
	const spaceIndex = trimmed.indexOf(" ");
	const subcommand = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
	const rest = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
	switch (subcommand) {
		case "model": {
			if (rest) settings.modelSpec = rest;
			const model = resolveDetachedModel(ctx, settings);
			const modelName = model === void 0 ? void 0 : `${model.provider}/${model.id}`;
			if (!rest) return {
				message: `Current Watcher model: ${modelName ?? (settings.mode === "detached" ? "none" : "session model (ephemeral)")}`,
				level: "info"
			};
			return modelName === void 0 ? {
				message: `Could not resolve "${rest}", will fallback to default chain`,
				level: "warning"
			} : {
				message: `Watcher model set to ${modelName}`,
				level: "info"
			};
		}
		case "mode":
			if (!isWatcherMode(rest)) return {
				message: "Usage: /peer-todos mode <auto|detached|ephemeral>",
				level: "warning"
			};
			settings.mode = rest;
			return {
				message: `Watcher mode set to ${rest}`,
				level: "info"
			};
		case "add": {
			const added = watcher.addManualTask(rest);
			return added ? {
				message: `Added ${added.id}: ${added.content}`,
				level: "info",
				changed: "todos"
			} : {
				message: "Usage: /peer-todos add <task description>",
				level: "warning"
			};
		}
		case "done": {
			const completed = watcher.markTaskCompleted(rest);
			return completed ? {
				message: `Completed ${completed.id}: ${completed.content}`,
				level: "info",
				changed: "todos"
			} : {
				message: `No open todo matching "${rest}"`,
				level: "warning"
			};
		}
		case "reset":
			watcher.resetTodos();
			return {
				message: "Sidecar todos archived and reset.",
				level: "info",
				changed: "todos"
			};
		case "pause":
		case "resume":
			watcher.paused = subcommand === "pause";
			return {
				message: `Sidecar Todo Watcher ${watcher.paused ? "paused" : "resumed"}.`,
				level: "info",
				changed: "hud"
			};
		case "broadcast":
			if (!rest) return {
				message: "Usage: /peer-todos broadcast <technical message>",
				level: "warning"
			};
			return {
				message: `Broadcast queued for ${broker.broadcastPeerNote(watcher.peerId, rest)} active peer(s).`,
				level: "info"
			};
		default: {
			const lines = renderHudLines(watcher, broker.listOtherPeers(watcher.peerId));
			return {
				message: lines.length > 0 ? lines.join("\n") : "No active todos or peers.",
				level: "info"
			};
		}
	}
}
// src/omp/environment.ts
const optionalSetting = /* @__PURE__ */ pipe(/* @__PURE__ */ optional(/* @__PURE__ */ string()), /* @__PURE__ */ transform((value) => value === "" ? void 0 : value));
const environmentSchema = /* @__PURE__ */ object({
	OMP_PEER_ID: optionalSetting,
	OMP_PEER_BROKER_DB: optionalSetting,
	OMP_WATCHER_MODEL: optionalSetting,
	OMP_WATCHER_MODE: /* @__PURE__ */ fallback(watcherModeSchema, "auto")
});
/** The plugin's environment variables, with empty values treated as unset */
function readEnvironment(env) {
	return parse(environmentSchema, env);
}
// src/peer-sync/broker.ts
const stalePeerTtlMs = 9e5;
const storedPhasesSchema = /* @__PURE__ */ fallback(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ parseJson(), todoPhasesSchema), []);
const storedStringsSchema = /* @__PURE__ */ fallback(/* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ parseJson(), /* @__PURE__ */ array(/* @__PURE__ */ string())), []);
const schemaSql = `
  CREATE TABLE IF NOT EXISTS peers (
    peer_id TEXT PRIMARY KEY,
    pid INTEGER NOT NULL DEFAULT 0,
    cwd TEXT NOT NULL,
    todos_json TEXT NOT NULL DEFAULT '[]',
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS peer_file_access (
    peer_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    access_kind TEXT NOT NULL CHECK (access_kind IN ('read', 'write')),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (peer_id, file_path, access_kind)
  );

  CREATE TABLE IF NOT EXISTS peer_inbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_peer_id TEXT NOT NULL,
    to_peer_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('milestone_sync', 'write_conflict', 'direct_broadcast')),
    completed_task TEXT,
    summary TEXT NOT NULL,
    touched_files_json TEXT NOT NULL,
    exported_symbols_json TEXT NOT NULL,
    dedupe_hash TEXT NOT NULL,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS idx_peer_inbox_dedupe
    ON peer_inbox (to_peer_id, dedupe_hash);
`;
/**
* SQLite WAL-backed cross-process broker that coordinates peer sessions:
* 1. Tracks each peer's PID, heartbeat, ReadSet, WriteSet, and managed TodoPhases;
* 2. Automatically prunes dead/crashed peer processes (via `process.kill(pid, 0)` + TTL);
* 3. Detects Read-Set intersections & Write-Write conflicts when a peer completes a milestone;
* 4. Queues deduplicated, Zero-ACK `<peer-sync>` advisories for injection at the target peer's next tool boundary.
*/
var PeerSyncBroker = class {
	cwd;
	#db;
	#sql;
	constructor(dbPath, cwd) {
		this.cwd = cwd;
		mkdirSync(dirname(dbPath), {
			recursive: true,
			mode: 448
		});
		this.#db = new DatabaseSync(dbPath);
		this.#db.exec("PRAGMA journal_mode = WAL;");
		this.#db.exec("PRAGMA busy_timeout = 3000;");
		for (const suffix of [
			"",
			"-wal",
			"-shm"
		]) try {
			chmodSync(`${dbPath}${suffix}`, 384);
		} catch {}
		this.#db.exec(schemaSql);
		this.#sql = this.#db.createTagStore();
	}
	registerPeer(peerId) {
		this.#sql.run`
      INSERT INTO peers (peer_id, pid, cwd, todos_json, updated_at)
      VALUES (${peerId}, ${process$1.pid}, ${this.cwd}, '[]', ${Date.now()})
      ON CONFLICT(peer_id) DO UPDATE SET
        pid = excluded.pid,
        cwd = excluded.cwd,
        updated_at = excluded.updated_at`;
	}
	unregisterPeer(peerId) {
		this.#transaction(() => this.#deletePeer(peerId));
	}
	/** Records repo-relative file paths in the peer's ReadSet or WriteSet, warning both sides of a Write-Write overlap */
	recordFileAccess(peerId, filePaths, kind) {
		if (filePaths.length === 0) return;
		this.#pruneStalePeers();
		const now = Date.now();
		this.#transaction(() => {
			this.registerPeer(peerId);
			for (const filePath of filePaths) this.#sql.run`
          INSERT INTO peer_file_access (peer_id, file_path, access_kind, updated_at)
          VALUES (${peerId}, ${filePath}, ${kind}, ${now})
          ON CONFLICT(peer_id, file_path, access_kind) DO UPDATE SET updated_at = excluded.updated_at`;
			if (kind === "write") this.#warnConcurrentWriters(peerId, filePaths);
		});
	}
	updatePeerTodos(peerId, phases) {
		this.#sql.run`
      INSERT INTO peers (peer_id, pid, cwd, todos_json, updated_at)
      VALUES (${peerId}, ${process$1.pid}, ${this.cwd}, ${JSON.stringify(phases)}, ${Date.now()})
      ON CONFLICT(peer_id) DO UPDATE SET
        pid = excluded.pid,
        cwd = excluded.cwd,
        todos_json = excluded.todos_json,
        updated_at = excluded.updated_at`;
	}
	/** Queues a technical note for every other active peer and returns how many accepted it */
	broadcastPeerNote(fromPeerId, note) {
		this.#pruneStalePeers();
		const message = {
			fromPeerId,
			kind: "direct_broadcast",
			summary: note,
			touchedFiles: [],
			exportedSymbols: []
		};
		let queued = 0;
		this.#transaction(() => {
			this.registerPeer(fromPeerId);
			for (const toPeerId of this.#otherPeerIds(fromPeerId)) if (this.#enqueue(toPeerId, message)) queued++;
		});
		return queued;
	}
	/**
	* Called when the Sidecar Watcher marks one or more Todo items completed (or a significant write-burst settles).
	* Routes a `<peer-sync>` notice to every peer whose ReadSet/WriteSet intersects `touchedFiles`,
	* or to all active peers when `exportedSymbols` is non-empty (contract change).
	*/
	publishMilestoneSync(milestone) {
		const { fromPeerId, completedTasks, touchedFiles, exportedSymbols } = milestone;
		const summaryText = milestone.summary?.trim() ?? "";
		if (!summaryText && completedTasks.length === 0) return;
		const summary = summaryText || `Completed milestone: ${completedTasks.join("; ")}${touchedFiles.length > 0 ? ` (files: ${touchedFiles.join(", ")})` : ""}`;
		this.#pruneStalePeers();
		this.#transaction(() => {
			this.registerPeer(fromPeerId);
			const accessRows = this.#sql.all`
        SELECT DISTINCT peer_id, file_path FROM peer_file_access WHERE peer_id != ${fromPeerId}`;
			const filesByPeer = Map.groupBy(accessRows, (row) => row.peer_id);
			for (const toPeerId of this.#otherPeerIds(fromPeerId)) {
				const relevantFiles = filesRelevantToPeer((filesByPeer.get(toPeerId) ?? []).map((row) => row.file_path), touchedFiles, exportedSymbols);
				if (!relevantFiles) continue;
				this.#enqueue(toPeerId, {
					fromPeerId,
					kind: "milestone_sync",
					completedTask: completedTasks[0],
					summary,
					touchedFiles: relevantFiles,
					exportedSymbols
				});
			}
		});
	}
	/**
	* Atomically drains all pending `<peer-sync>` messages for `peerId`.
	* Called at `tool_result` boundary so injection never interrupts an in-flight streaming call.
	*/
	drainInbox(peerId) {
		return this.#sql.all`
      UPDATE peer_inbox SET delivered = 1
      WHERE to_peer_id = ${peerId} AND delivered = 0
      RETURNING id, from_peer_id, kind, completed_task, summary, touched_files_json, exported_symbols_json`.sort((a, b) => a.id - b.id).map((row) => ({
			fromPeerId: row.from_peer_id,
			kind: row.kind,
			completedTask: row.completed_task ?? void 0,
			summary: row.summary,
			touchedFiles: parse(storedStringsSchema, row.touched_files_json),
			exportedSymbols: parse(storedStringsSchema, row.exported_symbols_json)
		}));
	}
	listOtherPeers(peerId) {
		this.#pruneStalePeers();
		return this.#sql.all`
      SELECT peer_id, todos_json FROM peers WHERE peer_id != ${peerId} ORDER BY updated_at DESC`.map((row) => {
			const tasks = parse(storedPhasesSchema, row.todos_json).flatMap((phase) => phase.tasks);
			return {
				peerId: row.peer_id,
				activeTask: tasks.find((task) => task.status === "in_progress")?.content ?? null,
				completedCount: tasks.filter((task) => task.status === "completed").length,
				totalCount: tasks.length
			};
		});
	}
	close() {
		this.#db.close();
	}
	#pruneStalePeers() {
		const now = Date.now();
		const stalePeerIds = this.#sql.all`SELECT peer_id, pid, updated_at FROM peers`.filter((row) => now - row.updated_at > stalePeerTtlMs || row.pid > 0 && !isProcessAlive(row.pid)).map((row) => row.peer_id);
		if (stalePeerIds.length === 0) return;
		this.#transaction(() => {
			for (const peerId of stalePeerIds) this.#deletePeer(peerId);
		});
	}
	#deletePeer(peerId) {
		this.#sql.run`DELETE FROM peers WHERE peer_id = ${peerId}`;
		this.#sql.run`DELETE FROM peer_file_access WHERE peer_id = ${peerId}`;
		this.#sql.run`DELETE FROM peer_inbox WHERE to_peer_id = ${peerId} AND delivered = 0`;
	}
	#otherPeerIds(peerId) {
		return this.#sql.all`SELECT peer_id FROM peers WHERE peer_id != ${peerId}`.map((row) => row.peer_id);
	}
	#warnConcurrentWriters(peerId, filePaths) {
		const rows = this.#sql.all`
      SELECT DISTINCT peer_id, file_path FROM peer_file_access
      WHERE peer_id != ${peerId} AND access_kind = 'write'
        AND file_path IN (SELECT value FROM json_each(${JSON.stringify(filePaths)}))`;
		for (const [otherPeerId, otherRows] of Map.groupBy(rows, (row) => row.peer_id)) {
			const overlappingFiles = otherRows.map((row) => row.file_path);
			const fileList = overlappingFiles.join(", ");
			this.#enqueue(otherPeerId, {
				fromPeerId: peerId,
				kind: "write_conflict",
				summary: `Concurrent write detected on [${fileList}] with peer @${peerId}. Coordinate or re-read before further edits to avoid lost updates.`,
				touchedFiles: overlappingFiles,
				exportedSymbols: []
			});
			this.#enqueue(peerId, {
				fromPeerId: otherPeerId,
				kind: "write_conflict",
				summary: `You modified [${fileList}] which peer @${otherPeerId} is also actively editing. Re-read the file or partition responsibilities.`,
				touchedFiles: overlappingFiles,
				exportedSymbols: []
			});
		}
	}
	/** Returns false when the recipient already received the same notice */
	#enqueue(toPeerId, message) {
		const { fromPeerId, kind, summary } = message;
		const normalizedSummary = collapseWhitespace(summary).toLowerCase();
		const dedupeHash = createHash("sha256").update(`${fromPeerId}|${toPeerId}|${kind}|${normalizedSummary}`).digest("hex").slice(0, 32);
		const { changes } = this.#sql.run`
      INSERT INTO peer_inbox (
        from_peer_id, to_peer_id, kind, completed_task, summary,
        touched_files_json, exported_symbols_json, dedupe_hash, delivered, created_at
      ) VALUES (
        ${fromPeerId}, ${toPeerId}, ${kind}, ${message.completedTask ?? null}, ${summary},
        ${JSON.stringify(message.touchedFiles)}, ${JSON.stringify(message.exportedSymbols)}, ${dedupeHash}, 0, ${Date.now()}
      )
      ON CONFLICT (to_peer_id, dedupe_hash) DO NOTHING`;
		return Number(changes) > 0;
	}
	/** Takes the write lock up front so concurrent peers wait on `busy_timeout` instead of failing to upgrade */
	#transaction(run) {
		this.#db.exec("BEGIN IMMEDIATE");
		try {
			run();
			this.#db.exec("COMMIT");
		} catch (error) {
			this.#db.exec("ROLLBACK");
			throw error;
		}
	}
};
/** Files a milestone should report to a peer, or undefined when the peer is unaffected */
function filesRelevantToPeer(peerFiles, touchedFiles, exportedSymbols) {
	if (exportedSymbols.length > 0) return touchedFiles;
	const sharedFiles = touchedFiles.filter((file) => peerFiles.includes(file));
	if (sharedFiles.length > 0) return sharedFiles;
	const touchedDirs = touchedFiles.map((file) => dirname(file)).filter((dir) => dir !== ".");
	return peerFiles.some((file) => touchedDirs.some((dir) => file === dir || file.startsWith(`${dir}/`))) ? touchedFiles : void 0;
}
function isProcessAlive(pid) {
	try {
		process$1.kill(pid, 0);
		return true;
	} catch (error) {
		return error.code === "EPERM";
	}
}
// node_modules/picomatch/lib/constants.js
var require_constants = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const WIN_SLASH = "\\\\/";
	const WIN_NO_SLASH = `[^${WIN_SLASH}]`;
	const DEFAULT_MAX_EXTGLOB_RECURSION = 0;
	/**
	* Posix glob regex
	*/
	const DOT_LITERAL = "\\.";
	const PLUS_LITERAL = "\\+";
	const QMARK_LITERAL = "\\?";
	const SLASH_LITERAL = "\\/";
	const ONE_CHAR = "(?=.)";
	const QMARK = "[^/]";
	const END_ANCHOR = `(?:${SLASH_LITERAL}|$)`;
	const START_ANCHOR = `(?:^|${SLASH_LITERAL})`;
	const DOTS_SLASH = `${DOT_LITERAL}{1,2}${END_ANCHOR}`;
	const POSIX_CHARS = {
		DOT_LITERAL,
		PLUS_LITERAL,
		QMARK_LITERAL,
		SLASH_LITERAL,
		ONE_CHAR,
		QMARK,
		END_ANCHOR,
		DOTS_SLASH,
		NO_DOT: `(?!${DOT_LITERAL})`,
		NO_DOTS: `(?!${START_ANCHOR}${DOTS_SLASH})`,
		NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}${END_ANCHOR})`,
		NO_DOTS_SLASH: `(?!${DOTS_SLASH})`,
		QMARK_NO_DOT: `[^.${SLASH_LITERAL}]`,
		STAR: `${QMARK}*?`,
		START_ANCHOR,
		SEP: "/"
	};
	/**
	* Windows glob regex
	*/
	const WINDOWS_CHARS = {
		...POSIX_CHARS,
		SLASH_LITERAL: `[${WIN_SLASH}]`,
		QMARK: WIN_NO_SLASH,
		STAR: `${WIN_NO_SLASH}*?`,
		DOTS_SLASH: `${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$)`,
		NO_DOT: `(?!${DOT_LITERAL})`,
		NO_DOTS: `(?!(?:^|[${WIN_SLASH}])${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
		NO_DOT_SLASH: `(?!${DOT_LITERAL}{0,1}(?:[${WIN_SLASH}]|$))`,
		NO_DOTS_SLASH: `(?!${DOT_LITERAL}{1,2}(?:[${WIN_SLASH}]|$))`,
		QMARK_NO_DOT: `[^.${WIN_SLASH}]`,
		START_ANCHOR: `(?:^|[${WIN_SLASH}])`,
		END_ANCHOR: `(?:[${WIN_SLASH}]|$)`,
		SEP: "\\"
	};
	module.exports = {
		DEFAULT_MAX_EXTGLOB_RECURSION,
		MAX_LENGTH: 65536,
		POSIX_REGEX_SOURCE: {
			__proto__: null,
			alnum: "a-zA-Z0-9",
			alpha: "a-zA-Z",
			ascii: "\\x00-\\x7F",
			blank: " \\t",
			cntrl: "\\x00-\\x1F\\x7F",
			digit: "0-9",
			graph: "\\x21-\\x7E",
			lower: "a-z",
			print: "\\x20-\\x7E ",
			punct: "\\-!\"#$%&'()\\*+,./:;<=>?@[\\]^_`{|}~",
			space: " \\t\\r\\n\\v\\f",
			upper: "A-Z",
			word: "A-Za-z0-9_",
			xdigit: "A-Fa-f0-9"
		},
		REGEX_BACKSLASH: /\\(?![*+?^${}(|)[\]])/g,
		REGEX_NON_SPECIAL_CHARS: /^[^@![\].,$*+?^{}()|\\/]+/,
		REGEX_SPECIAL_CHARS: /[-*+?.^${}(|)[\]]/,
		REGEX_SPECIAL_CHARS_BACKREF: /(\\?)((\W)(\3*))/g,
		REGEX_SPECIAL_CHARS_GLOBAL: /([-*+?.^${}(|)[\]])/g,
		REGEX_REMOVE_BACKSLASH: /(?:\[.*?[^\\]\]|\\(?=.))/g,
		REPLACEMENTS: {
			__proto__: null,
			"***": "*",
			"**/**": "**",
			"**/**/**": "**"
		},
		CHAR_0: 48,
		CHAR_9: 57,
		CHAR_UPPERCASE_A: 65,
		CHAR_LOWERCASE_A: 97,
		CHAR_UPPERCASE_Z: 90,
		CHAR_LOWERCASE_Z: 122,
		CHAR_LEFT_PARENTHESES: 40,
		CHAR_RIGHT_PARENTHESES: 41,
		CHAR_ASTERISK: 42,
		CHAR_AMPERSAND: 38,
		CHAR_AT: 64,
		CHAR_BACKWARD_SLASH: 92,
		CHAR_CARRIAGE_RETURN: 13,
		CHAR_CIRCUMFLEX_ACCENT: 94,
		CHAR_COLON: 58,
		CHAR_COMMA: 44,
		CHAR_DOT: 46,
		CHAR_DOUBLE_QUOTE: 34,
		CHAR_EQUAL: 61,
		CHAR_EXCLAMATION_MARK: 33,
		CHAR_FORM_FEED: 12,
		CHAR_FORWARD_SLASH: 47,
		CHAR_GRAVE_ACCENT: 96,
		CHAR_HASH: 35,
		CHAR_HYPHEN_MINUS: 45,
		CHAR_LEFT_ANGLE_BRACKET: 60,
		CHAR_LEFT_CURLY_BRACE: 123,
		CHAR_LEFT_SQUARE_BRACKET: 91,
		CHAR_LINE_FEED: 10,
		CHAR_NO_BREAK_SPACE: 160,
		CHAR_PERCENT: 37,
		CHAR_PLUS: 43,
		CHAR_QUESTION_MARK: 63,
		CHAR_RIGHT_ANGLE_BRACKET: 62,
		CHAR_RIGHT_CURLY_BRACE: 125,
		CHAR_RIGHT_SQUARE_BRACKET: 93,
		CHAR_SEMICOLON: 59,
		CHAR_SINGLE_QUOTE: 39,
		CHAR_SPACE: 32,
		CHAR_TAB: 9,
		CHAR_UNDERSCORE: 95,
		CHAR_VERTICAL_LINE: 124,
		CHAR_ZERO_WIDTH_NOBREAK_SPACE: 65279,
		/**
		* Create EXTGLOB_CHARS
		*/
		extglobChars(chars) {
			return {
				"!": {
					type: "negate",
					open: "(?:(?!(?:",
					close: `))${chars.STAR})`
				},
				"?": {
					type: "qmark",
					open: "(?:",
					close: ")?"
				},
				"+": {
					type: "plus",
					open: "(?:",
					close: ")+"
				},
				"*": {
					type: "star",
					open: "(?:",
					close: ")*"
				},
				"@": {
					type: "at",
					open: "(?:",
					close: ")"
				}
			};
		},
		/**
		* Create GLOB_CHARS
		*/
		globChars(win32) {
			return win32 === true ? WINDOWS_CHARS : POSIX_CHARS;
		}
	};
}));
// node_modules/picomatch/lib/utils.js
var require_utils = /* @__PURE__ */ __commonJSMin(((exports) => {
	const { REGEX_BACKSLASH, REGEX_REMOVE_BACKSLASH, REGEX_SPECIAL_CHARS, REGEX_SPECIAL_CHARS_GLOBAL } = require_constants();
	exports.isObject = (val) => val !== null && typeof val === "object" && !Array.isArray(val);
	exports.hasRegexChars = (str) => REGEX_SPECIAL_CHARS.test(str);
	exports.isRegexChar = (str) => str.length === 1 && exports.hasRegexChars(str);
	exports.escapeRegex = (str) => str.replace(REGEX_SPECIAL_CHARS_GLOBAL, "\\$1");
	exports.toPosixSlashes = (str) => str.replace(REGEX_BACKSLASH, "/");
	exports.isWindows = () => {
		if (typeof navigator !== "undefined" && navigator.platform) {
			const platform = navigator.platform.toLowerCase();
			return platform === "win32" || platform === "windows";
		}
		if (typeof process !== "undefined" && process.platform) return process.platform === "win32";
		return false;
	};
	exports.removeBackslashes = (str) => {
		return str.replace(REGEX_REMOVE_BACKSLASH, (match) => {
			return match === "\\" ? "" : match;
		});
	};
	exports.escapeLast = (input, char, lastIdx) => {
		const idx = input.lastIndexOf(char, lastIdx);
		if (idx === -1) return input;
		if (input[idx - 1] === "\\") return exports.escapeLast(input, char, idx - 1);
		return `${input.slice(0, idx)}\\${input.slice(idx)}`;
	};
	exports.removePrefix = (input, state = {}) => {
		let output = input;
		if (output.startsWith("./")) {
			output = output.slice(2);
			state.prefix = "./";
		}
		return output;
	};
	exports.wrapOutput = (input, state = {}, options = {}) => {
		let output = `${options.contains ? "" : "^"}(?:${input})${options.contains ? "" : "$"}`;
		if (state.negated === true) output = `(?:^(?!${output}).*$)`;
		return output;
	};
	exports.basename = (path, { windows } = {}) => {
		const segs = path.split(windows ? /[\\/]/ : "/");
		const last = segs[segs.length - 1];
		if (last === "") return segs[segs.length - 2];
		return last;
	};
}));
// node_modules/picomatch/lib/scan.js
var require_scan = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const utils = require_utils();
	const { CHAR_ASTERISK, CHAR_AT, CHAR_BACKWARD_SLASH, CHAR_COMMA, CHAR_DOT, CHAR_EXCLAMATION_MARK, CHAR_FORWARD_SLASH, CHAR_LEFT_CURLY_BRACE, CHAR_LEFT_PARENTHESES, CHAR_LEFT_SQUARE_BRACKET, CHAR_PLUS, CHAR_QUESTION_MARK, CHAR_RIGHT_CURLY_BRACE, CHAR_RIGHT_PARENTHESES, CHAR_RIGHT_SQUARE_BRACKET } = require_constants();
	const isPathSeparator = (code) => {
		return code === CHAR_FORWARD_SLASH || code === CHAR_BACKWARD_SLASH;
	};
	const depth = (token) => {
		if (token.isPrefix !== true) token.depth = token.isGlobstar ? Infinity : 1;
	};
	/**
	* Quickly scans a glob pattern and returns an object with a handful of
	* useful properties, like `isGlob`, `path` (the leading non-glob, if it exists),
	* `glob` (the actual pattern), `negated` (true if the path starts with `!` but not
	* with `!(`) and `negatedExtglob` (true if the path starts with `!(`).
	*
	* ```js
	* const pm = require('picomatch');
	* console.log(pm.scan('foo/bar/*.js'));
	* { isGlob: true, input: 'foo/bar/*.js', base: 'foo/bar', glob: '*.js' }
	* ```
	* @param {String} `str`
	* @param {Object} `options`
	* @return {Object} Returns an object with tokens and regex source string.
	* @api public
	*/
	const scan = (input, options) => {
		const opts = options || {};
		const length = input.length - 1;
		const scanToEnd = opts.parts === true || opts.tokens === true || opts.scanToEnd === true;
		const slashes = [];
		const tokens = [];
		const parts = [];
		let str = input;
		let index = -1;
		let start = 0;
		let lastIndex = 0;
		let isBrace = false;
		let isBracket = false;
		let isGlob = false;
		let isExtglob = false;
		let isGlobstar = false;
		let braceEscaped = false;
		let backslashes = false;
		let negated = false;
		let negatedExtglob = false;
		let finished = false;
		let braces = 0;
		let prev;
		let code;
		let token = {
			value: "",
			depth: 0,
			isGlob: false
		};
		const eos = () => index >= length;
		const peek = () => str.charCodeAt(index + 1);
		const advance = () => {
			prev = code;
			return str.charCodeAt(++index);
		};
		while (index < length) {
			code = advance();
			let next;
			if (code === CHAR_BACKWARD_SLASH) {
				backslashes = token.backslashes = true;
				code = advance();
				if (code === CHAR_LEFT_CURLY_BRACE) braceEscaped = true;
				continue;
			}
			if (braceEscaped === true || code === CHAR_LEFT_CURLY_BRACE) {
				braces++;
				while (eos() !== true && (code = advance())) {
					if (code === CHAR_BACKWARD_SLASH) {
						backslashes = token.backslashes = true;
						advance();
						continue;
					}
					if (code === CHAR_LEFT_CURLY_BRACE) {
						braces++;
						continue;
					}
					if (braceEscaped !== true && code === CHAR_DOT && (code = advance()) === CHAR_DOT) {
						isBrace = token.isBrace = true;
						isGlob = token.isGlob = true;
						finished = true;
						if (scanToEnd === true) continue;
						break;
					}
					if (braceEscaped !== true && code === CHAR_COMMA) {
						isBrace = token.isBrace = true;
						isGlob = token.isGlob = true;
						finished = true;
						if (scanToEnd === true) continue;
						break;
					}
					if (code === CHAR_RIGHT_CURLY_BRACE) {
						braces--;
						if (braces === 0) {
							braceEscaped = false;
							isBrace = token.isBrace = true;
							finished = true;
							break;
						}
					}
				}
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_FORWARD_SLASH) {
				slashes.push(index);
				tokens.push(token);
				token = {
					value: "",
					depth: 0,
					isGlob: false
				};
				if (finished === true) continue;
				if (prev === CHAR_DOT && index === start + 1) {
					start += 2;
					continue;
				}
				lastIndex = index + 1;
				continue;
			}
			if (opts.noext !== true) {
				if ((code === CHAR_PLUS || code === CHAR_AT || code === CHAR_ASTERISK || code === CHAR_QUESTION_MARK || code === CHAR_EXCLAMATION_MARK) === true && peek() === CHAR_LEFT_PARENTHESES) {
					isGlob = token.isGlob = true;
					isExtglob = token.isExtglob = true;
					finished = true;
					if (code === CHAR_EXCLAMATION_MARK && index === start) negatedExtglob = true;
					if (scanToEnd === true) {
						let parens = 0;
						while (eos() !== true && (code = advance())) {
							if (code === CHAR_BACKWARD_SLASH) {
								backslashes = token.backslashes = true;
								advance();
								continue;
							}
							if (code === CHAR_LEFT_PARENTHESES) {
								parens++;
								continue;
							}
							if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
								finished = true;
								break;
							}
						}
						continue;
					}
					break;
				}
			}
			if (code === CHAR_ASTERISK) {
				if (prev === CHAR_ASTERISK) isGlobstar = token.isGlobstar = true;
				isGlob = token.isGlob = true;
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_QUESTION_MARK) {
				isGlob = token.isGlob = true;
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
			if (code === CHAR_LEFT_SQUARE_BRACKET) {
				while (eos() !== true && (next = advance())) {
					if (next === CHAR_BACKWARD_SLASH) {
						backslashes = token.backslashes = true;
						advance();
						continue;
					}
					if (next === CHAR_RIGHT_SQUARE_BRACKET) {
						isBracket = token.isBracket = true;
						isGlob = token.isGlob = true;
						finished = true;
						break;
					}
				}
				if (scanToEnd === true) continue;
				break;
			}
			if (opts.nonegate !== true && code === CHAR_EXCLAMATION_MARK && index === start) {
				negated = token.negated = true;
				start++;
				continue;
			}
			if (opts.noparen !== true && code === CHAR_LEFT_PARENTHESES) {
				isGlob = token.isGlob = true;
				if (scanToEnd === true) {
					let parens = 1;
					while (eos() !== true && (code = advance())) {
						if (code === CHAR_BACKWARD_SLASH) {
							backslashes = token.backslashes = true;
							advance();
							continue;
						}
						if (code === CHAR_LEFT_PARENTHESES) {
							parens++;
							continue;
						}
						if (code === CHAR_RIGHT_PARENTHESES && --parens === 0) {
							finished = true;
							break;
						}
					}
					continue;
				}
				break;
			}
			if (isGlob === true) {
				finished = true;
				if (scanToEnd === true) continue;
				break;
			}
		}
		if (opts.noext === true) {
			isExtglob = false;
			isGlob = false;
		}
		let base = str;
		let prefix = "";
		let glob = "";
		if (start > 0) {
			prefix = str.slice(0, start);
			str = str.slice(start);
			lastIndex -= start;
		}
		if (base && isGlob === true && lastIndex > 0) {
			base = str.slice(0, lastIndex);
			glob = str.slice(lastIndex);
		} else if (isGlob === true) {
			base = "";
			glob = str;
		} else base = str;
		if (base && base !== "" && base !== "/" && base !== str) {
			if (isPathSeparator(base.charCodeAt(base.length - 1))) base = base.slice(0, -1);
		}
		if (opts.unescape === true) {
			if (glob) glob = utils.removeBackslashes(glob);
			if (base && backslashes === true) base = utils.removeBackslashes(base);
		}
		const state = {
			prefix,
			input,
			start,
			base,
			glob,
			isBrace,
			isBracket,
			isGlob,
			isExtglob,
			isGlobstar,
			negated,
			negatedExtglob
		};
		if (opts.tokens === true) {
			state.maxDepth = 0;
			if (!isPathSeparator(code)) tokens.push(token);
			state.tokens = tokens;
		}
		if (opts.parts === true || opts.tokens === true) {
			let prevIndex;
			for (let idx = 0; idx < slashes.length; idx++) {
				const n = prevIndex !== void 0 ? prevIndex + 1 : start;
				const i = slashes[idx];
				const value = input.slice(n, i);
				if (opts.tokens) {
					if (idx === 0 && start !== 0) {
						tokens[idx].isPrefix = true;
						tokens[idx].value = prefix;
					} else tokens[idx].value = value;
					depth(tokens[idx]);
					state.maxDepth += tokens[idx].depth;
				}
				if (i >= start) {
					parts.push(value);
					prevIndex = i;
				}
			}
			const n = prevIndex !== void 0 ? prevIndex + 1 : start;
			const value = input.slice(n);
			parts.push(value);
			if (opts.tokens && prevIndex && prevIndex + 1 < input.length) {
				tokens[tokens.length - 1].value = value;
				depth(tokens[tokens.length - 1]);
				state.maxDepth += tokens[tokens.length - 1].depth;
			}
			state.slashes = slashes;
			state.parts = parts;
		}
		return state;
	};
	module.exports = scan;
}));
// node_modules/picomatch/lib/parse.js
var require_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const constants = require_constants();
	const utils = require_utils();
	/**
	* Constants
	*/
	const { MAX_LENGTH, POSIX_REGEX_SOURCE, REGEX_NON_SPECIAL_CHARS, REGEX_SPECIAL_CHARS_BACKREF, REPLACEMENTS } = constants;
	/**
	* Helpers
	*/
	const expandRange = (args, options) => {
		if (typeof options.expandRange === "function") return options.expandRange(...args, options);
		args.sort();
		const value = `[${args.join("-")}]`;
		try {
			new RegExp(value);
		} catch (ex) {
			return args.map((v) => utils.escapeRegex(v)).join("..");
		}
		return value;
	};
	/**
	* Create the message for a syntax error
	*/
	const syntaxError = (type, char) => {
		return `Missing ${type}: "${char}" - use "\\\\${char}" to match literal characters`;
	};
	const splitTopLevel = (input) => {
		const parts = [];
		let bracket = 0;
		let paren = 0;
		let quote = 0;
		let value = "";
		let escaped = false;
		for (const ch of input) {
			if (escaped === true) {
				value += ch;
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				value += ch;
				escaped = true;
				continue;
			}
			if (ch === "\"") {
				quote = quote === 1 ? 0 : 1;
				value += ch;
				continue;
			}
			if (quote === 0) {
				if (ch === "[") bracket++;
				else if (ch === "]" && bracket > 0) bracket--;
				else if (bracket === 0) {
					if (ch === "(") paren++;
					else if (ch === ")" && paren > 0) paren--;
					else if (ch === "|" && paren === 0) {
						parts.push(value);
						value = "";
						continue;
					}
				}
			}
			value += ch;
		}
		parts.push(value);
		return parts;
	};
	const isPlainBranch = (branch) => {
		let escaped = false;
		for (const ch of branch) {
			if (escaped === true) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (/[?*+@!()[\]{}]/.test(ch)) return false;
		}
		return true;
	};
	const normalizeSimpleBranch = (branch) => {
		let value = branch.trim();
		let changed = true;
		while (changed === true) {
			changed = false;
			if (/^@\([^\\()[\]{}|]+\)$/.test(value)) {
				value = value.slice(2, -1);
				changed = true;
			}
		}
		if (!isPlainBranch(value)) return;
		return value.replace(/\\(.)/g, "$1");
	};
	const hasRepeatedCharPrefixOverlap = (branches) => {
		const values = branches.map(normalizeSimpleBranch).filter(Boolean);
		for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) {
			const a = values[i];
			const b = values[j];
			const char = a[0];
			if (!char || a !== char.repeat(a.length) || b !== char.repeat(b.length)) continue;
			if (a === b || a.startsWith(b) || b.startsWith(a)) return true;
		}
		return false;
	};
	const parseRepeatedExtglob = (pattern, requireEnd = true) => {
		if (pattern[0] !== "+" && pattern[0] !== "*" || pattern[1] !== "(") return;
		let bracket = 0;
		let paren = 0;
		let quote = 0;
		let escaped = false;
		for (let i = 1; i < pattern.length; i++) {
			const ch = pattern[i];
			if (escaped === true) {
				escaped = false;
				continue;
			}
			if (ch === "\\") {
				escaped = true;
				continue;
			}
			if (ch === "\"") {
				quote = quote === 1 ? 0 : 1;
				continue;
			}
			if (quote === 1) continue;
			if (ch === "[") {
				bracket++;
				continue;
			}
			if (ch === "]" && bracket > 0) {
				bracket--;
				continue;
			}
			if (bracket > 0) continue;
			if (ch === "(") {
				paren++;
				continue;
			}
			if (ch === ")") {
				paren--;
				if (paren === 0) {
					if (requireEnd === true && i !== pattern.length - 1) return;
					return {
						type: pattern[0],
						body: pattern.slice(2, i),
						end: i
					};
				}
			}
		}
	};
	const buildCharClassStar = (chars) => {
		return `${chars.length === 1 ? utils.escapeRegex(chars[0]) : `[${chars.map((ch) => utils.escapeRegex(ch)).join("")}]`}*`;
	};
	const getStarExtglobSequenceChars = (pattern) => {
		let index = 0;
		const chars = [];
		while (index < pattern.length) {
			const match = parseRepeatedExtglob(pattern.slice(index), false);
			if (!match || match.type !== "*") return;
			const branches = splitTopLevel(match.body).map((branch) => branch.trim());
			if (branches.length !== 1) return;
			const branch = normalizeSimpleBranch(branches[0]);
			if (!branch || branch.length !== 1) return;
			chars.push(branch);
			index += match.end + 1;
		}
		if (chars.length < 1) return;
		return chars;
	};
	const repeatedExtglobRecursion = (pattern) => {
		let depth = 0;
		let value = pattern.trim();
		let match = parseRepeatedExtglob(value);
		while (match) {
			depth++;
			value = match.body.trim();
			match = parseRepeatedExtglob(value);
		}
		return depth;
	};
	const analyzeRepeatedExtglob = (body, options) => {
		if (options.maxExtglobRecursion === false) return { risky: false };
		const max = typeof options.maxExtglobRecursion === "number" ? options.maxExtglobRecursion : constants.DEFAULT_MAX_EXTGLOB_RECURSION;
		const branches = splitTopLevel(body).map((branch) => branch.trim());
		if (branches.length > 1) {
			if (branches.some((branch) => branch === "") || branches.some((branch) => /^[*?]+$/.test(branch)) || hasRepeatedCharPrefixOverlap(branches)) return { risky: true };
		}
		const safeChars = [];
		let sawStarSequence = false;
		let combinable = true;
		for (const branch of branches) {
			const chars = getStarExtglobSequenceChars(branch);
			if (chars) {
				sawStarSequence = true;
				safeChars.push(...chars);
				continue;
			}
			const literal = normalizeSimpleBranch(branch);
			if (literal && literal.length === 1) {
				safeChars.push(literal);
				continue;
			}
			combinable = false;
			if (repeatedExtglobRecursion(branch) > max) return { risky: true };
		}
		if (sawStarSequence) return combinable ? {
			risky: true,
			safeOutput: buildCharClassStar([...new Set(safeChars)])
		} : { risky: true };
		return { risky: false };
	};
	/**
	* Parse the given input string.
	* @param {String} input
	* @param {Object} options
	* @return {Object}
	*/
	const parse = (input, options) => {
		if (typeof input !== "string") throw new TypeError("Expected a string");
		input = REPLACEMENTS[input] || input;
		const opts = { ...options };
		const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
		let len = input.length;
		if (len > max) throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
		const bos = {
			type: "bos",
			value: "",
			output: opts.prepend || ""
		};
		const tokens = [bos];
		const capture = opts.capture ? "" : "?:";
		const PLATFORM_CHARS = constants.globChars(opts.windows);
		const EXTGLOB_CHARS = constants.extglobChars(PLATFORM_CHARS);
		const { DOT_LITERAL, PLUS_LITERAL, SLASH_LITERAL, ONE_CHAR, DOTS_SLASH, NO_DOT, NO_DOT_SLASH, NO_DOTS_SLASH, QMARK, QMARK_NO_DOT, STAR, START_ANCHOR } = PLATFORM_CHARS;
		const globstar = (opts) => {
			return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
		};
		const nodot = opts.dot ? "" : NO_DOT;
		const qmarkNoDot = opts.dot ? QMARK : QMARK_NO_DOT;
		let star = opts.bash === true ? globstar(opts) : STAR;
		if (opts.capture) star = `(${star})`;
		if (typeof opts.noext === "boolean") opts.noextglob = opts.noext;
		const state = {
			input,
			index: -1,
			start: 0,
			dot: opts.dot === true,
			consumed: "",
			output: "",
			prefix: "",
			backtrack: false,
			negated: false,
			brackets: 0,
			braces: 0,
			parens: 0,
			quotes: 0,
			globstar: false,
			tokens
		};
		input = utils.removePrefix(input, state);
		len = input.length;
		const extglobs = [];
		const braces = [];
		const stack = [];
		let prev = bos;
		let value;
		/**
		* Tokenizing helpers
		*/
		const eos = () => state.index === len - 1;
		const peek = state.peek = (n = 1) => input[state.index + n];
		const advance = state.advance = () => input[++state.index] || "";
		const remaining = () => input.slice(state.index + 1);
		const consume = (value = "", num = 0) => {
			state.consumed += value;
			state.index += num;
		};
		const append = (token) => {
			state.output += token.output != null ? token.output : token.value;
			consume(token.value);
		};
		const negate = () => {
			let count = 1;
			while (peek() === "!" && (peek(2) !== "(" || peek(3) === "?")) {
				advance();
				state.start++;
				count++;
			}
			if (count % 2 === 0) return false;
			state.negated = true;
			state.start++;
			return true;
		};
		const increment = (type) => {
			state[type]++;
			stack.push(type);
		};
		const decrement = (type) => {
			state[type]--;
			stack.pop();
		};
		/**
		* Push tokens onto the tokens array. This helper speeds up
		* tokenizing by 1) helping us avoid backtracking as much as possible,
		* and 2) helping us avoid creating extra tokens when consecutive
		* characters are plain text. This improves performance and simplifies
		* lookbehinds.
		*/
		const push = (tok) => {
			if (prev.type === "globstar") {
				const isBrace = state.braces > 0 && (tok.type === "comma" || tok.type === "brace");
				const isExtglob = tok.extglob === true || extglobs.length && (tok.type === "pipe" || tok.type === "paren");
				if (tok.type !== "slash" && tok.type !== "paren" && !isBrace && !isExtglob) {
					state.output = state.output.slice(0, -prev.output.length);
					prev.type = "star";
					prev.value = "*";
					prev.output = star;
					state.output += prev.output;
				}
			}
			if (extglobs.length && tok.type !== "paren") extglobs[extglobs.length - 1].inner += tok.value;
			if (tok.value || tok.output) append(tok);
			if (prev && prev.type === "text" && tok.type === "text") {
				prev.output = (prev.output || prev.value) + tok.value;
				prev.value += tok.value;
				return;
			}
			tok.prev = prev;
			tokens.push(tok);
			prev = tok;
		};
		const extglobOpen = (type, value) => {
			const token = {
				...EXTGLOB_CHARS[value],
				conditions: 1,
				inner: ""
			};
			token.prev = prev;
			token.parens = state.parens;
			token.output = state.output;
			token.startIndex = state.index;
			token.tokensIndex = tokens.length;
			const output = (opts.capture ? "(" : "") + token.open;
			increment("parens");
			push({
				type,
				value,
				output: state.output ? "" : ONE_CHAR
			});
			push({
				type: "paren",
				extglob: true,
				value: advance(),
				output
			});
			extglobs.push(token);
		};
		const extglobClose = (token) => {
			const literal = input.slice(token.startIndex, state.index + 1);
			const body = input.slice(token.startIndex + 2, state.index);
			const analysis = analyzeRepeatedExtglob(body, opts);
			if ((token.type === "plus" || token.type === "star") && analysis.risky) {
				const safeOutput = analysis.safeOutput ? (token.output ? "" : ONE_CHAR) + (opts.capture ? `(${analysis.safeOutput})` : analysis.safeOutput) : void 0;
				const open = tokens[token.tokensIndex];
				open.type = "text";
				open.value = literal;
				open.output = safeOutput || utils.escapeRegex(literal);
				for (let i = token.tokensIndex + 1; i < tokens.length; i++) {
					tokens[i].value = "";
					tokens[i].output = "";
					delete tokens[i].suffix;
				}
				state.output = token.output + open.output;
				state.backtrack = true;
				push({
					type: "paren",
					extglob: true,
					value,
					output: ""
				});
				decrement("parens");
				return;
			}
			let output = token.close + (opts.capture ? ")" : "");
			let rest;
			if (token.type === "negate") {
				let extglobStar = star;
				if (token.inner && token.inner.length > 1 && token.inner.includes("/")) extglobStar = globstar(opts);
				if (extglobStar !== star || eos() || /^\)+$/.test(remaining())) output = token.close = `)$))${extglobStar}`;
				if (token.inner.includes("*") && (rest = remaining()) && /^\.[^\\/.]+$/.test(rest)) output = token.close = `)${parse(rest, {
					...options,
					fastpaths: false
				}).output})${extglobStar})`;
				if (token.prev.type === "bos") state.negatedExtglob = true;
			}
			push({
				type: "paren",
				extglob: true,
				value,
				output
			});
			decrement("parens");
		};
		/**
		* Fast paths
		*/
		if (opts.fastpaths !== false && !/(^[*!]|[/()[\]{}"])/.test(input)) {
			let backslashes = false;
			let output = input.replace(REGEX_SPECIAL_CHARS_BACKREF, (m, esc, chars, first, rest, index) => {
				if (first === "\\") {
					backslashes = true;
					return m;
				}
				if (first === "?") {
					if (esc) return esc + first + (rest ? QMARK.repeat(rest.length) : "");
					if (index === 0) return qmarkNoDot + (rest ? QMARK.repeat(rest.length) : "");
					return QMARK.repeat(chars.length);
				}
				if (first === ".") return DOT_LITERAL.repeat(chars.length);
				if (first === "*") {
					if (esc) return esc + first + (rest ? star : "");
					return star;
				}
				return esc ? m : `\\${m}`;
			});
			if (backslashes === true) {
				if (opts.unescape === true) output = output.replace(/\\/g, "");
				else output = output.replace(/\\+/g, (m) => {
					return m.length % 2 === 0 ? "\\\\" : m ? "\\" : "";
				});
			}
			if (output === input && opts.contains === true) {
				state.output = input;
				return state;
			}
			state.output = utils.wrapOutput(output, state, options);
			return state;
		}
		/**
		* Tokenize input until we reach end-of-string
		*/
		while (!eos()) {
			value = advance();
			if (value === "\0") continue;
			/**
			* Escaped characters
			*/
			if (value === "\\") {
				const next = peek();
				if (next === "/" && opts.bash !== true) continue;
				if (next === "." || next === ";") continue;
				if (!next) {
					value += "\\";
					push({
						type: "text",
						value
					});
					continue;
				}
				const match = /^\\+/.exec(remaining());
				let slashes = 0;
				if (match && match[0].length > 2) {
					slashes = match[0].length;
					state.index += slashes;
					if (slashes % 2 !== 0) value += "\\";
				}
				if (opts.unescape === true) value = advance();
				else value += advance();
				if (state.brackets === 0) {
					push({
						type: "text",
						value
					});
					continue;
				}
			}
			/**
			* If we're inside a regex character class, continue
			* until we reach the closing bracket.
			*/
			if (state.brackets > 0 && (value !== "]" || prev.value === "[" || prev.value === "[^")) {
				if (opts.posix !== false && value === ":") {
					const inner = prev.value.slice(1);
					if (inner.includes("[")) {
						prev.posix = true;
						if (inner.includes(":")) {
							const idx = prev.value.lastIndexOf("[");
							const pre = prev.value.slice(0, idx);
							const rest = prev.value.slice(idx + 2);
							const posix = POSIX_REGEX_SOURCE[rest];
							if (posix) {
								prev.value = pre + posix;
								state.backtrack = true;
								advance();
								if (!bos.output && tokens.indexOf(prev) === 1) bos.output = ONE_CHAR;
								continue;
							}
						}
					}
				}
				if (value === "[" && peek() !== ":" || value === "-" && peek() === "]") value = `\\${value}`;
				if (value === "]" && (prev.value === "[" || prev.value === "[^")) value = `\\${value}`;
				if (opts.posix === true && value === "!" && prev.value === "[") value = "^";
				prev.value += value;
				append({ value });
				continue;
			}
			/**
			* If we're inside a quoted string, continue
			* until we reach the closing double quote.
			*/
			if (state.quotes === 1 && value !== "\"") {
				value = utils.escapeRegex(value);
				prev.value += value;
				append({ value });
				continue;
			}
			/**
			* Double quotes
			*/
			if (value === "\"") {
				state.quotes = state.quotes === 1 ? 0 : 1;
				if (opts.keepQuotes === true) push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Parentheses
			*/
			if (value === "(") {
				increment("parens");
				push({
					type: "paren",
					value
				});
				continue;
			}
			if (value === ")") {
				if (state.parens === 0 && opts.strictBrackets === true) throw new SyntaxError(syntaxError("opening", "("));
				const extglob = extglobs[extglobs.length - 1];
				if (extglob && state.parens === extglob.parens + 1) {
					extglobClose(extglobs.pop());
					continue;
				}
				push({
					type: "paren",
					value,
					output: state.parens ? ")" : "\\)"
				});
				decrement("parens");
				continue;
			}
			/**
			* Square brackets
			*/
			if (value === "[") {
				if (opts.nobracket === true || !remaining().includes("]")) {
					if (opts.nobracket !== true && opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
					value = `\\${value}`;
				} else increment("brackets");
				push({
					type: "bracket",
					value
				});
				continue;
			}
			if (value === "]") {
				if (opts.nobracket === true || prev && prev.type === "bracket" && prev.value.length === 1) {
					push({
						type: "text",
						value,
						output: `\\${value}`
					});
					continue;
				}
				if (state.brackets === 0) {
					if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("opening", "["));
					push({
						type: "text",
						value,
						output: `\\${value}`
					});
					continue;
				}
				decrement("brackets");
				const prevValue = prev.value.slice(1);
				if (prev.posix !== true && prevValue[0] === "^" && !prevValue.includes("/")) value = `/${value}`;
				prev.value += value;
				append({ value });
				if (opts.literalBrackets === false || utils.hasRegexChars(prevValue)) continue;
				const escaped = utils.escapeRegex(prev.value);
				state.output = state.output.slice(0, -prev.value.length);
				if (opts.literalBrackets === true) {
					state.output += escaped;
					prev.value = escaped;
					continue;
				}
				prev.value = `(${capture}${escaped}|${prev.value})`;
				state.output += prev.value;
				continue;
			}
			/**
			* Braces
			*/
			if (value === "{" && opts.nobrace !== true) {
				increment("braces");
				const open = {
					type: "brace",
					value,
					output: "(",
					outputIndex: state.output.length,
					tokensIndex: state.tokens.length
				};
				braces.push(open);
				push(open);
				continue;
			}
			if (value === "}") {
				const brace = braces[braces.length - 1];
				if (opts.nobrace === true || !brace) {
					push({
						type: "text",
						value,
						output: value
					});
					continue;
				}
				let output = ")";
				if (brace.dots === true) {
					const arr = tokens.slice();
					const range = [];
					for (let i = arr.length - 1; i >= 0; i--) {
						tokens.pop();
						if (arr[i].type === "brace") break;
						if (arr[i].type !== "dots") range.unshift(arr[i].value);
					}
					output = expandRange(range, opts);
					state.backtrack = true;
				}
				if (brace.comma !== true && brace.dots !== true) {
					const out = state.output.slice(0, brace.outputIndex);
					const toks = state.tokens.slice(brace.tokensIndex);
					brace.value = brace.output = "\\{";
					value = output = "\\}";
					state.output = out;
					for (const t of toks) state.output += t.output || t.value;
				}
				push({
					type: "brace",
					value,
					output
				});
				decrement("braces");
				braces.pop();
				continue;
			}
			/**
			* Pipes
			*/
			if (value === "|") {
				if (extglobs.length > 0) extglobs[extglobs.length - 1].conditions++;
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Commas
			*/
			if (value === ",") {
				let output = value;
				const brace = braces[braces.length - 1];
				if (brace && stack[stack.length - 1] === "braces") {
					brace.comma = true;
					output = "|";
				}
				push({
					type: "comma",
					value,
					output
				});
				continue;
			}
			/**
			* Slashes
			*/
			if (value === "/") {
				if (prev.type === "dot" && state.index === state.start + 1) {
					state.start = state.index + 1;
					state.consumed = "";
					state.output = "";
					tokens.pop();
					prev = bos;
					continue;
				}
				push({
					type: "slash",
					value,
					output: SLASH_LITERAL
				});
				continue;
			}
			/**
			* Dots
			*/
			if (value === ".") {
				if (state.braces > 0 && prev.type === "dot") {
					if (prev.value === ".") prev.output = DOT_LITERAL;
					const brace = braces[braces.length - 1];
					prev.type = "dots";
					prev.output += value;
					prev.value += value;
					brace.dots = true;
					continue;
				}
				if (state.braces + state.parens === 0 && prev.type !== "bos" && prev.type !== "slash") {
					push({
						type: "text",
						value,
						output: DOT_LITERAL
					});
					continue;
				}
				push({
					type: "dot",
					value,
					output: DOT_LITERAL
				});
				continue;
			}
			/**
			* Question marks
			*/
			if (value === "?") {
				if (!(prev && prev.value === "(") && opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					extglobOpen("qmark", value);
					continue;
				}
				if (prev && prev.type === "paren") {
					const next = peek();
					let output = value;
					if (prev.value === "(" && !/[!=<:]/.test(next) || next === "<" && !/<([!=]|\w+>)/.test(remaining())) output = `\\${value}`;
					push({
						type: "text",
						value,
						output
					});
					continue;
				}
				if (opts.dot !== true && (prev.type === "slash" || prev.type === "bos")) {
					push({
						type: "qmark",
						value,
						output: QMARK_NO_DOT
					});
					continue;
				}
				push({
					type: "qmark",
					value,
					output: QMARK
				});
				continue;
			}
			/**
			* Exclamation
			*/
			if (value === "!") {
				if (opts.noextglob !== true && peek() === "(") {
					if (peek(2) !== "?" || !/[!=<:]/.test(peek(3))) {
						extglobOpen("negate", value);
						continue;
					}
				}
				if (opts.nonegate !== true && state.index === 0) {
					negate();
					continue;
				}
			}
			/**
			* Plus
			*/
			if (value === "+") {
				if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					extglobOpen("plus", value);
					continue;
				}
				if (prev && prev.value === "(" || opts.regex === false) {
					push({
						type: "plus",
						value,
						output: PLUS_LITERAL
					});
					continue;
				}
				if (prev && (prev.type === "bracket" || prev.type === "paren" || prev.type === "brace") || state.parens > 0) {
					push({
						type: "plus",
						value
					});
					continue;
				}
				push({
					type: "plus",
					value: PLUS_LITERAL
				});
				continue;
			}
			/**
			* Plain text
			*/
			if (value === "@") {
				if (opts.noextglob !== true && peek() === "(" && peek(2) !== "?") {
					push({
						type: "at",
						extglob: true,
						value,
						output: ""
					});
					continue;
				}
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Plain text
			*/
			if (value !== "*") {
				if (value === "$" || value === "^") value = `\\${value}`;
				const match = REGEX_NON_SPECIAL_CHARS.exec(remaining());
				if (match) {
					value += match[0];
					state.index += match[0].length;
				}
				push({
					type: "text",
					value
				});
				continue;
			}
			/**
			* Stars
			*/
			if (prev && (prev.type === "globstar" || prev.star === true)) {
				prev.type = "star";
				prev.star = true;
				prev.value += value;
				prev.output = star;
				state.backtrack = true;
				state.globstar = true;
				consume(value);
				continue;
			}
			let rest = remaining();
			if (opts.noextglob !== true && /^\([^?]/.test(rest)) {
				extglobOpen("star", value);
				continue;
			}
			if (prev.type === "star") {
				if (opts.noglobstar === true) {
					consume(value);
					continue;
				}
				const prior = prev.prev;
				const before = prior.prev;
				const isStart = prior.type === "slash" || prior.type === "bos";
				const afterStar = before && (before.type === "star" || before.type === "globstar");
				if (opts.bash === true && (!isStart || rest[0] && rest[0] !== "/")) {
					push({
						type: "star",
						value,
						output: ""
					});
					continue;
				}
				const isBrace = state.braces > 0 && (prior.type === "comma" || prior.type === "brace");
				const isExtglob = extglobs.length && (prior.type === "pipe" || prior.type === "paren");
				if (!isStart && prior.type !== "paren" && !isBrace && !isExtglob) {
					push({
						type: "star",
						value,
						output: ""
					});
					continue;
				}
				while (rest.slice(0, 3) === "/**") {
					const after = input[state.index + 4];
					if (after && after !== "/") break;
					rest = rest.slice(3);
					consume("/**", 3);
				}
				const isEnd = eos() || state.parens > 0 && rest === ")".repeat(state.parens) && !extglobs.some((extglob) => extglob.type === "negate");
				if (prior.type === "bos" && eos()) {
					prev.type = "globstar";
					prev.value += value;
					prev.output = globstar(opts);
					state.output = prev.output;
					state.globstar = true;
					consume(value);
					continue;
				}
				if (prior.type === "slash" && prior.prev.type !== "bos" && !afterStar && isEnd) {
					state.output = state.output.slice(0, -(prior.output + prev.output).length);
					prior.output = `(?:${prior.output}`;
					prev.type = "globstar";
					prev.output = globstar(opts) + (opts.strictSlashes ? ")" : "|$)");
					prev.value += value;
					state.globstar = true;
					state.output += prior.output + prev.output;
					consume(value);
					continue;
				}
				if (prior.type === "slash" && prior.prev.type !== "bos" && rest[0] === "/") {
					const end = rest[1] !== void 0 ? "|$" : "";
					state.output = state.output.slice(0, -(prior.output + prev.output).length);
					prior.output = `(?:${prior.output}`;
					prev.type = "globstar";
					prev.output = `${globstar(opts)}${SLASH_LITERAL}|${SLASH_LITERAL}${end})`;
					prev.value += value;
					state.output += prior.output + prev.output;
					state.globstar = true;
					consume(value + advance());
					push({
						type: "slash",
						value: "/",
						output: ""
					});
					continue;
				}
				if (prior.type === "bos" && rest[0] === "/") {
					prev.type = "globstar";
					prev.value += value;
					prev.output = `(?:^|${SLASH_LITERAL}|${globstar(opts)}${SLASH_LITERAL})`;
					state.output = prev.output;
					state.globstar = true;
					consume(value + advance());
					push({
						type: "slash",
						value: "/",
						output: ""
					});
					continue;
				}
				state.output = state.output.slice(0, -prev.output.length);
				prev.type = "globstar";
				prev.output = globstar(opts);
				prev.value += value;
				state.output += prev.output;
				state.globstar = true;
				consume(value);
				continue;
			}
			const token = {
				type: "star",
				value,
				output: star
			};
			if (opts.bash === true) {
				token.output = ".*?";
				if (prev.type === "bos" || prev.type === "slash") token.output = nodot + token.output;
				push(token);
				continue;
			}
			if (prev && (prev.type === "bracket" || prev.type === "paren") && opts.regex === true) {
				token.output = value;
				push(token);
				continue;
			}
			if (state.index === state.start || prev.type === "slash" || prev.type === "dot") {
				if (prev.type === "dot") {
					state.output += NO_DOT_SLASH;
					prev.output += NO_DOT_SLASH;
				} else if (opts.dot === true) {
					state.output += NO_DOTS_SLASH;
					prev.output += NO_DOTS_SLASH;
				} else {
					state.output += nodot;
					prev.output += nodot;
				}
				if (peek() !== "*") {
					state.output += ONE_CHAR;
					prev.output += ONE_CHAR;
				}
			}
			push(token);
		}
		while (state.brackets > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "]"));
			state.output = utils.escapeLast(state.output, "[");
			decrement("brackets");
		}
		while (state.parens > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", ")"));
			state.output = utils.escapeLast(state.output, "(");
			decrement("parens");
		}
		while (state.braces > 0) {
			if (opts.strictBrackets === true) throw new SyntaxError(syntaxError("closing", "}"));
			state.output = utils.escapeLast(state.output, "{");
			decrement("braces");
		}
		if (opts.strictSlashes !== true && (prev.type === "star" || prev.type === "bracket")) push({
			type: "maybe_slash",
			value: "",
			output: `${SLASH_LITERAL}?`
		});
		if (state.backtrack === true) {
			state.output = "";
			for (const token of state.tokens) {
				state.output += token.output != null ? token.output : token.value;
				if (token.suffix) state.output += token.suffix;
			}
		}
		return state;
	};
	/**
	* Fast paths for creating regular expressions for common glob patterns.
	* This can significantly speed up processing and has very little downside
	* impact when none of the fast paths match.
	*/
	parse.fastpaths = (input, options) => {
		const opts = { ...options };
		const max = typeof opts.maxLength === "number" ? Math.min(MAX_LENGTH, opts.maxLength) : MAX_LENGTH;
		const len = input.length;
		if (len > max) throw new SyntaxError(`Input length: ${len}, exceeds maximum allowed length: ${max}`);
		input = REPLACEMENTS[input] || input;
		const { DOT_LITERAL, SLASH_LITERAL, ONE_CHAR, DOTS_SLASH, NO_DOT, NO_DOTS, NO_DOTS_SLASH, STAR, START_ANCHOR } = constants.globChars(opts.windows);
		const nodot = opts.dot ? NO_DOTS : NO_DOT;
		const slashDot = opts.dot ? NO_DOTS_SLASH : NO_DOT;
		const capture = opts.capture ? "" : "?:";
		const state = {
			negated: false,
			prefix: ""
		};
		let star = opts.bash === true ? ".*?" : STAR;
		if (opts.capture) star = `(${star})`;
		const globstar = (opts) => {
			if (opts.noglobstar === true) return star;
			return `(${capture}(?:(?!${START_ANCHOR}${opts.dot ? DOTS_SLASH : DOT_LITERAL}).)*?)`;
		};
		const create = (str) => {
			switch (str) {
				case "*": return `${nodot}${ONE_CHAR}${star}`;
				case ".*": return `${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "*.*": return `${nodot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "*/*": return `${nodot}${star}${SLASH_LITERAL}${ONE_CHAR}${slashDot}${star}`;
				case "**": return nodot + globstar(opts);
				case "**/*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${ONE_CHAR}${star}`;
				case "**/*.*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${slashDot}${star}${DOT_LITERAL}${ONE_CHAR}${star}`;
				case "**/.*": return `(?:${nodot}${globstar(opts)}${SLASH_LITERAL})?${DOT_LITERAL}${ONE_CHAR}${star}`;
				default: {
					const match = /^(.*?)\.(\w+)$/.exec(str);
					if (!match) return;
					const source = create(match[1]);
					if (!source) return;
					return source + DOT_LITERAL + match[2];
				}
			}
		};
		let source = create(utils.removePrefix(input, state));
		if (source && opts.strictSlashes !== true) source += `${SLASH_LITERAL}?`;
		return source;
	};
	module.exports = parse;
}));
// node_modules/picomatch/lib/picomatch.js
var require_picomatch$1 = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const scan = require_scan();
	const parse = require_parse();
	const utils = require_utils();
	const constants = require_constants();
	const isObject = (val) => val && typeof val === "object" && !Array.isArray(val);
	/**
	* Creates a matcher function from one or more glob patterns. The
	* returned function takes a string to match as its first argument,
	* and returns true if the string is a match. The returned matcher
	* function also takes a boolean as the second argument that, when true,
	* returns an object with additional information.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch(glob[, options]);
	*
	* const isMatch = picomatch('*.!(*a)');
	* console.log(isMatch('a.a')); //=> false
	* console.log(isMatch('a.b')); //=> true
	*
	* // For environments without `node.js`, `picomatch/posix` provides you a dependency-free matcher, without automatic OS detection.
	* const picomatch = require('picomatch/posix');
	* // the same API, defaulting to posix paths
	* const isMatch = picomatch('a/*');
	* console.log(isMatch('a\\b')); //=> false
	* console.log(isMatch('a/b')); //=> true
	*
	* // you can still configure the matcher function to accept windows paths
	* const isMatch = picomatch('a/*', { options: windows });
	* console.log(isMatch('a\\b')); //=> true
	* console.log(isMatch('a/b')); //=> true
	* ```
	* @name picomatch
	* @param {String|Array} `globs` One or more glob patterns.
	* @param {Object=} `options`
	* @return {Function=} Returns a matcher function.
	* @api public
	*/
	const picomatch = (glob, options, returnState = false) => {
		if (Array.isArray(glob)) {
			const fns = glob.map((input) => picomatch(input, options, returnState));
			const arrayMatcher = (str) => {
				for (const isMatch of fns) {
					const state = isMatch(str);
					if (state) return state;
				}
				return false;
			};
			return arrayMatcher;
		}
		const isState = isObject(glob) && glob.tokens && glob.input;
		if (glob === "" || typeof glob !== "string" && !isState) throw new TypeError("Expected pattern to be a non-empty string");
		const opts = options || {};
		const posix = opts.windows;
		const regex = isState ? picomatch.compileRe(glob, options) : picomatch.makeRe(glob, options, false, true);
		const state = regex.state;
		delete regex.state;
		let isIgnored = () => false;
		if (opts.ignore) {
			const ignoreOpts = {
				...options,
				ignore: null,
				onMatch: null,
				onResult: null
			};
			isIgnored = picomatch(opts.ignore, ignoreOpts, returnState);
		}
		const matcher = (input, returnObject = false) => {
			const { isMatch, match, output } = picomatch.test(input, regex, options, {
				glob,
				posix
			});
			const result = {
				glob,
				state,
				regex,
				posix,
				input,
				output,
				match,
				isMatch
			};
			if (typeof opts.onResult === "function") opts.onResult(result);
			if (isMatch === false) {
				result.isMatch = false;
				return returnObject ? result : false;
			}
			if (isIgnored(input)) {
				if (typeof opts.onIgnore === "function") opts.onIgnore(result);
				result.isMatch = false;
				return returnObject ? result : false;
			}
			if (typeof opts.onMatch === "function") opts.onMatch(result);
			return returnObject ? result : true;
		};
		if (returnState) matcher.state = state;
		return matcher;
	};
	/**
	* Test `input` with the given `regex`. This is used by the main
	* `picomatch()` function to test the input string.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.test(input, regex[, options]);
	*
	* console.log(picomatch.test('foo/bar', /^(?:([^/]*?)\/([^/]*?))$/));
	* // { isMatch: true, match: [ 'foo/', 'foo', 'bar' ], output: 'foo/bar' }
	* ```
	* @param {String} `input` String to test.
	* @param {RegExp} `regex`
	* @return {Object} Returns an object with matching info.
	* @api public
	*/
	picomatch.test = (input, regex, options, { glob, posix } = {}) => {
		if (typeof input !== "string") throw new TypeError("Expected input to be a string");
		if (input === "") return {
			isMatch: false,
			output: ""
		};
		const opts = options || {};
		const format = opts.format || (posix ? utils.toPosixSlashes : null);
		let match = input === glob;
		let output = match && format ? format(input) : input;
		if (match === false) {
			output = format ? format(input) : input;
			match = output === glob;
		}
		if (match === false || opts.capture === true) {
			if (opts.matchBase === true || opts.basename === true) match = picomatch.matchBase(input, regex, options, posix);
			else match = regex.exec(output);
		}
		return {
			isMatch: Boolean(match),
			match,
			output
		};
	};
	/**
	* Match the basename of a filepath.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.matchBase(input, glob[, options]);
	* console.log(picomatch.matchBase('foo/bar.js', '*.js'); // true
	* ```
	* @param {String} `input` String to test.
	* @param {RegExp|String} `glob` Glob pattern or regex created by [.makeRe](#makeRe).
	* @return {Boolean}
	* @api public
	*/
	picomatch.matchBase = (input, glob, options, posix = options && options.windows) => {
		return (glob instanceof RegExp ? glob : picomatch.makeRe(glob, options)).test(utils.basename(input, { windows: posix }));
	};
	/**
	* Returns true if **any** of the given glob `patterns` match the specified `string`.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.isMatch(string, patterns[, options]);
	*
	* console.log(picomatch.isMatch('a.a', ['b.*', '*.a'])); //=> true
	* console.log(picomatch.isMatch('a.a', 'b.*')); //=> false
	* ```
	* @param {String|Array} str The string to test.
	* @param {String|Array} patterns One or more glob patterns to use for matching.
	* @param {Object} [options] See available [options](#options).
	* @return {Boolean} Returns true if any patterns match `str`
	* @api public
	*/
	picomatch.isMatch = (str, patterns, options) => picomatch(patterns, options)(str);
	/**
	* Parse a glob pattern to create the source string for a regular
	* expression.
	*
	* ```js
	* const picomatch = require('picomatch');
	* const result = picomatch.parse(pattern[, options]);
	* ```
	* @param {String} `pattern`
	* @param {Object} `options`
	* @return {Object} Returns an object with useful properties and output to be used as a regex source string.
	* @api public
	*/
	picomatch.parse = (pattern, options) => {
		if (Array.isArray(pattern)) return pattern.map((p) => picomatch.parse(p, options));
		return parse(pattern, {
			...options,
			fastpaths: false
		});
	};
	/**
	* Scan a glob pattern to separate the pattern into segments.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.scan(input[, options]);
	*
	* const result = picomatch.scan('!./foo/*.js');
	* console.log(result);
	* { prefix: '!./',
	*   input: '!./foo/*.js',
	*   start: 3,
	*   base: 'foo',
	*   glob: '*.js',
	*   isBrace: false,
	*   isBracket: false,
	*   isGlob: true,
	*   isExtglob: false,
	*   isGlobstar: false,
	*   negated: true }
	* ```
	* @param {String} `input` Glob pattern to scan.
	* @param {Object} `options`
	* @return {Object} Returns an object with
	* @api public
	*/
	picomatch.scan = (input, options) => scan(input, options);
	/**
	* Compile a regular expression from the `state` object returned by the
	* [parse()](#parse) method.
	*
	* ```js
	* const picomatch = require('picomatch');
	* const state = picomatch.parse('*.js');
	* // picomatch.compileRe(state[, options]);
	*
	* console.log(picomatch.compileRe(state));
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {Object} `state`
	* @param {Object} `options`
	* @param {Boolean} `returnOutput` Intended for implementors, this argument allows you to return the raw output from the parser.
	* @param {Boolean} `returnState` Adds the state to a `state` property on the returned regex. Useful for implementors and debugging.
	* @return {RegExp}
	* @api public
	*/
	picomatch.compileRe = (state, options, returnOutput = false, returnState = false) => {
		if (returnOutput === true) return state.output;
		const opts = options || {};
		const prepend = opts.contains ? "" : "^";
		const append = opts.contains ? "" : "$";
		let source = `${prepend}(?:${state.output})${append}`;
		if (state && state.negated === true) source = `^(?!${source}).*$`;
		const regex = picomatch.toRegex(source, options);
		if (returnState === true) regex.state = state;
		return regex;
	};
	/**
	* Create a regular expression from a parsed glob pattern.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.makeRe(state[, options]);
	*
	* const result = picomatch.makeRe('*.js');
	* console.log(result);
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {String} `state` The object returned from the `.parse` method.
	* @param {Object} `options`
	* @param {Boolean} `returnOutput` Implementors may use this argument to return the compiled output, instead of a regular expression. This is not exposed on the options to prevent end-users from mutating the result.
	* @param {Boolean} `returnState` Implementors may use this argument to return the state from the parsed glob with the returned regular expression.
	* @return {RegExp} Returns a regex created from the given pattern.
	* @api public
	*/
	picomatch.makeRe = (input, options = {}, returnOutput = false, returnState = false) => {
		if (!input || typeof input !== "string") throw new TypeError("Expected a non-empty string");
		let parsed = {
			negated: false,
			fastpaths: true
		};
		if (options.fastpaths !== false && (input[0] === "." || input[0] === "*")) parsed.output = parse.fastpaths(input, options);
		if (!parsed.output) parsed = parse(input, options);
		return picomatch.compileRe(parsed, options, returnOutput, returnState);
	};
	/**
	* Create a regular expression from the given regex source string.
	*
	* ```js
	* const picomatch = require('picomatch');
	* // picomatch.toRegex(source[, options]);
	*
	* const { output } = picomatch.parse('*.js');
	* console.log(picomatch.toRegex(output));
	* //=> /^(?:(?!\.)(?=.)[^/]*?\.js)$/
	* ```
	* @param {String} `source` Regular expression source string.
	* @param {Object} `options`
	* @return {RegExp}
	* @api public
	*/
	picomatch.toRegex = (source, options) => {
		try {
			const opts = options || {};
			return new RegExp(source, opts.flags || (opts.nocase ? "i" : ""));
		} catch (err) {
			if (options && options.debug === true) throw err;
			return /$^/;
		}
	};
	/**
	* Picomatch constants.
	* @return {Object}
	*/
	picomatch.constants = constants;
	/**
	* Expose "picomatch"
	*/
	module.exports = picomatch;
}));
const matchesSensitiveFile = (0, (/* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
	const pico = require_picomatch$1();
	const utils = require_utils();
	function picomatch(glob, options, returnState = false) {
		if (options && (options.windows === null || options.windows === void 0)) options = {
			...options,
			windows: utils.isWindows()
		};
		return pico(glob, options, returnState);
	}
	Object.assign(picomatch, pico);
	module.exports = picomatch;
})))(), 1)).default)([
	"**/.env",
	"**/.env.*",
	"**/.env.*/**",
	"**/.npmrc",
	"**/.pypirc",
	"**/.netrc",
	"**/.git-credentials",
	"**/id_{rsa,ed25519,ecdsa,dsa}{,.*}",
	"**/*.{pem,key,p12,pfx,keystore,jks}",
	"**/*{secret,credential,token,passwd,password}{,s}.{json,yaml,yml,toml,ini,conf}",
	"**/.ssh/**",
	"**/.aws/**",
	"**/.gnupg/**"
], {
	dot: true,
	nocase: true
});
const secretPatterns = [
	[/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PRIVATE_KEY]"],
	[/\b(Bearer\s+)[\w.~+/=-]{16,}\b/gi, "$1[REDACTED_TOKEN]"],
	[/\b(?:sk-[\w-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{16,}|AIza[\w-]{30,}|eyJ[\w-]{10,}\.eyJ[\w-]{10,}\.[\w-]{10,})\b/g, "[REDACTED_SECRET]"],
	[/\b(\w*(?:api[_-]?key|secret|password|passwd|access[_-]?token|auth[_-]?token|client[_-]?secret|private[_-]?key)\w*\s*[:=]\s*)(['"]?)[^\s'"`,;]{8,}\2/gi, "$1$2[REDACTED]$2"]
];
/**
* Checks whether a file path points to a credential/secret/key file whose contents
* must NEVER be extracted into sidecar prompts or git diff snippets.
*/
function isSensitiveFilePath(filePath) {
	const normalized = filePath.trim().replaceAll("\\", "/");
	return normalized !== "" && matchesSensitiveFile(normalized);
}
/**
* Redacts API keys, Bearer tokens, PEM private keys, JWTs, and secret assignments
* before any text is sent to an external Sidecar LLM or persisted to SQLite.
*/
function redactSecrets(text) {
	return secretPatterns.reduce((redacted, [pattern, replacement]) => redacted.replace(pattern, replacement), text);
}
// src/watcher/tool-evidence.ts
const readToolNames = /* @__PURE__ */ new Set([
	"read",
	"grep",
	"glob",
	"lsp",
	"web_search"
]);
const writeToolNames = /* @__PURE__ */ new Set([
	"edit",
	"write",
	"ast_edit",
	"apply_patch"
]);
const verifyToolNames = /* @__PURE__ */ new Set([
	"bash",
	"eval",
	"lsp"
]);
const declarationLinePattern = /^\s*(?:export\s+(?:default\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|enum)\s+\w+|(?:async\s+)?function\s+\w+|class\s+\w+|def\s+\w+|pub\s+(?:async\s+)?(?:fn|struct|enum|trait)\s+\w+|func\s+\w+|describe\s*\(|test\s*\(|it\s*\()/;
const patchFileHeaders = [
	"*** Update File:",
	"*** Add File:",
	"*** Delete File:"
];
const optionalText = /* @__PURE__ */ fallback(/* @__PURE__ */ optional(/* @__PURE__ */ string()), void 0);
const toolInputSchema = /* @__PURE__ */ object({
	path: optionalText,
	file: optionalText,
	filePath: optionalText,
	targetFile: optionalText,
	input: optionalText,
	content: optionalText,
	command: optionalText,
	pattern: optionalText,
	query: optionalText
});
function parseToolInput(input) {
	return parse(toolInputSchema, input);
}
/** Extracts the repo-relative file paths referenced in tool arguments (`read`, `edit`, `write`, `apply_patch`, `grep`) so ReadSet / WriteSet comparisons across peers are deterministic */
function extractFilePaths(cwd, input) {
	const rawPaths = [
		input.path,
		input.file,
		input.filePath,
		input.targetFile
	].filter((path) => path !== void 0 && path.trim() !== "" && !path.includes("://"));
	for (const line of input.input?.split("\n") ?? []) {
		const header = patchFileHeaders.find((prefix) => line.startsWith(prefix));
		if (header !== void 0) rawPaths.push(line.slice(header.length));
	}
	return [...new Set(rawPaths.map((path) => toRepoPath(cwd, path)).filter(Boolean))];
}
function toRepoPath(cwd, rawPath) {
	let cleaned = rawPath.trim();
	if (cleaned.startsWith("\"") || cleaned.startsWith("'")) cleaned = cleaned.slice(1);
	if (cleaned.endsWith("\"") || cleaned.endsWith("'")) cleaned = cleaned.slice(0, -1);
	cleaned = cleaned.split(":")[0];
	if (!cleaned) return "";
	const absolutePath = resolve(cwd, cleaned);
	const repoPath = relative(cwd, absolutePath);
	return repoPath && !repoPath.startsWith("..") ? repoPath : absolutePath;
}
/**
* Extracts all top-level/exported symbol declarations + a compact head/tail preview
* from written or patched code so the detached small model sees 100% of implemented
* functions even in files >1000 chars without blowing up token count.
*/
function summarizeCodeChange(label, toolName, rawContent) {
	if (isSensitiveFilePath(label)) return `--- ${label} (${toolName}) ---\n[REDACTED_SENSITIVE_FILE]`;
	const sanitized = redactSecrets(rawContent);
	const declarations = sanitized.split("\n").map((line) => (line.startsWith("+") || line.startsWith("-") ? line.slice(1) : line).trim()).filter((line) => declarationLinePattern.test(line)).map((line) => line.slice(0, 120));
	const declarationHeader = declarations.length > 0 ? `Declarations (${declarations.length}): ${declarations.slice(0, 20).join(" ; ")}\n` : "";
	const code = sanitized.trim();
	return `--- ${label} (${toolName}) ---\n${declarationHeader}${code.length <= 700 ? code : `${code.slice(0, 400)}\n... [${code.length - 650} chars elided] ...\n${code.slice(-250)}`}`;
}
/**
* Extracts a compact (<180 chars) evidence fingerprint from read/grep/glob/lsp/web_search tool output
* so `detached-smol` can objectively verify whether the main agent actually inspected the target files/symbols
* without sending thousands of tokens of raw file contents.
*/
function summarizeReadEvidence(toolName, filePaths, input, rawOutput) {
	const target = filePaths.join(", ") || (input.pattern !== void 0 ? `pattern:${input.pattern}` : "") || (input.query !== void 0 ? `query:${input.query}` : "") || toolName;
	if (filePaths.some(isSensitiveFilePath)) return `${toolName}(${target}) -> [REDACTED_SENSITIVE_FILE]`;
	if (rawOutput === void 0 || rawOutput.trim() === "") return `${toolName}(${target}) -> read ok`;
	const sanitized = redactSecrets(rawOutput);
	const symbols = sanitized.split("\n").map((line) => withoutLineNumber(line).trim()).filter((line) => declarationLinePattern.test(line)).map((line) => line.slice(0, 80));
	if (symbols.length > 0) return `${toolName}(${target}) -> symbols=[${symbols.slice(0, 6).join(" ; ")}]`;
	return `${toolName}(${target}) -> snippet="${collapseWhitespace(sanitized).slice(0, 140)}"`;
}
/** Drops the `12:` or `12|` line-number prefix that read and grep output put before each line */
function withoutLineNumber(line) {
	const trimmed = line.trimStart();
	const digitCount = countLeadingDigits(trimmed);
	const separator = trimmed.charAt(digitCount);
	return digitCount > 0 && (separator === ":" || separator === "|") ? trimmed.slice(digitCount + 1) : line;
}
function summarizeVerification(toolName, input, filePaths, rawOutput, failed) {
	const command = input.command === void 0 ? filePaths.join(", ") || toolName : redactSecrets(input.command).slice(0, 80);
	const outputTail = rawOutput !== void 0 && rawOutput !== "" ? ` | ${failed ? "error" : "output"}: ${collapseWhitespace(redactSecrets(rawOutput)).slice(-160)}` : "";
	return `${toolName}(${JSON.stringify(command)}) -> ${failed ? "FAILED" : "ok (exit 0)"}${outputTail}`;
}
// src/peer-sync/notices.ts
/**
* Formats drained `PeerSyncMessage[]` as an XML-wrapped, Zero-ACK advisory block
* suitable for `tool_result.additionalContext`.
*/
function formatPeerSyncNotices(messages) {
	return messages.map((message) => {
		return `<peer-sync ${[
			`from="@${message.fromPeerId}"`,
			`kind="${message.kind}"`,
			message.completedTask === void 0 ? "" : `milestone=${JSON.stringify(message.completedTask)}`,
			message.touchedFiles.length > 0 ? `files=${JSON.stringify(message.touchedFiles.join(","))}` : "",
			message.exportedSymbols.length > 0 ? `symbols=${JSON.stringify(message.exportedSymbols.join(","))}` : "",
			`policy="zero-ack: adapt your code directly if affected; NEVER send thank-you or acknowledgment messages"`
		].filter(Boolean).join(" ")}>\n${message.summary}\n</peer-sync>`;
	}).join("\n");
}
// src/watcher/burst.ts
/** Tool activity and assistant notes accumulated since the last sidecar check */
var Burst = class {
	writes = 0;
	verifications = 0;
	reads = 0;
	substantiveTextLength = 0;
	verificationFailed = false;
	userPrompted = false;
	touchedFiles = /* @__PURE__ */ new Set();
	toolActions = [];
	readEvidence = [];
	codeSnippets = [];
	assistantNotes = [];
	get hasPendingActivity() {
		const hasReadSynthesis = this.reads > 0 && this.substantiveTextLength >= 80;
		return this.writes > 0 || this.verifications > 0 || hasReadSynthesis || this.userPrompted;
	}
	get hasToolActivity() {
		return this.writes > 0 || this.verifications > 0 || this.reads > 0;
	}
	addReadEvidence(evidence) {
		pushRecent(this.readEvidence, evidence, 8);
	}
	addCodeSnippet(snippet) {
		pushRecent(this.codeSnippets, snippet, 4);
	}
	addAssistantNote(note) {
		pushRecent(this.assistantNotes, note, 4);
	}
};
function pushRecent(items, item, limit) {
	items.push(item);
	if (items.length > limit) items.shift();
}
// src/watcher/telemetry.ts
function createUsageTelemetry() {
	return {
		calls: 0,
		mode: "ephemeral-shared-cache",
		inputTokens: 0,
		outputTokens: 0,
		cacheReadTokens: 0,
		cacheWriteTokens: 0,
		totalTokens: 0,
		totalCostUsd: 0,
		cacheHitRate: 0,
		perCallLog: []
	};
}
function recordSidecarCall(telemetry, call) {
	const { input, output, cacheRead, cacheWrite } = call.usage;
	const totalTokens = call.usage.totalTokens || input + output + cacheRead + cacheWrite;
	const costUsd = call.usage.cost.total;
	telemetry.calls++;
	telemetry.lastModelId = call.modelId;
	telemetry.mode = telemetry.calls === 1 || telemetry.mode === call.mode ? call.mode : "mixed";
	telemetry.inputTokens += input;
	telemetry.outputTokens += output;
	telemetry.cacheReadTokens += cacheRead;
	telemetry.cacheWriteTokens += cacheWrite;
	telemetry.totalTokens += totalTokens;
	telemetry.totalCostUsd += costUsd;
	telemetry.cacheHitRate = cacheHitRate(telemetry.cacheReadTokens, telemetry.inputTokens + telemetry.cacheReadTokens + telemetry.cacheWriteTokens);
	telemetry.perCallLog.push({
		callIndex: telemetry.calls,
		kind: call.kind,
		mode: call.mode,
		modelId: call.modelId,
		input,
		output,
		cacheRead,
		cacheWrite,
		totalTokens,
		cacheHitRate: cacheHitRate(cacheRead, input + cacheRead + cacheWrite),
		costUsd,
		durationMs: Math.round(call.durationMs)
	});
}
function cacheHitRate(cacheReadTokens, promptTokens) {
	return promptTokens > 0 ? cacheReadTokens / promptTokens : 0;
}
// src/watcher/verdict.ts
const nonBlankStrings = /* @__PURE__ */ fallback(/* @__PURE__ */ optional(/* @__PURE__ */ pipe(/* @__PURE__ */ array(/* @__PURE__ */ unknown()), /* @__PURE__ */ transform((items) => items.filter((item) => typeof item === "string" && item.trim() !== "")))), void 0);
const verdictSchema = /* @__PURE__ */ pipe(/* @__PURE__ */ string(), /* @__PURE__ */ parseJson(), /* @__PURE__ */ object({
	/** Initial tasks extracted on Turn 1 when no todo list exists yet */
	initTasks: nonBlankStrings,
	/** Task IDs (#1, #2) or task contents completed in this write-burst */
	completedTasks: nonBlankStrings,
	/** Newly discovered or user-added tasks to append to the active phase */
	appendTasks: nonBlankStrings,
	/** Obsolete tasks (by ID or content) to mark as abandoned */
	dropTasks: nonBlankStrings,
	/** Concise 1-line technical summary of interface/behavior changes for peer agents (null if internal-only) */
	milestoneSummary: /* @__PURE__ */ fallback(/* @__PURE__ */ optional(/* @__PURE__ */ nullable(/* @__PURE__ */ string())), void 0),
	/** Exported function/type/class symbols added or modified in this write-burst */
	exportedSymbolsChanged: nonBlankStrings
}));
/** Parses the JSON object in the sidecar's reply, tolerating surrounding prose or markdown code fences */
function parseSidecarVerdict(replyText) {
	const json = replyText.slice(replyText.indexOf("{"), replyText.lastIndexOf("}") + 1);
	const result = /* @__PURE__ */ safeParse(verdictSchema, json);
	return result.success ? result.output : void 0;
}
// src/watcher/watcher.ts
const maxStopBlocks = 3;
/** Long enough for a prefix cache to serve most of a long list, short enough to bound what one cache miss re-bills */
const maxTranscriptTextLength = 96e3;
const verificationTaskPattern = /\b(?:bun\s+test|npm\s+test|pnpm\s+test|vitest|jest|pytest|cargo\s+test|go\s+test|tsc|typecheck|lint)\b|运行.*测试|跑通.*测试|验证通过/i;
const investigationTaskPattern = /\b(?:investigate|analyze|audit|inspect|research|locate|find|diagnose|review|check|understand)\b|调研|分析|排查|审计|定位|检查|阅读|梳理|诊断/i;
/**
* Core state machine for a single Peer Session's Sidecar Todo Watcher.
*/
var SidecarTodoWatcher = class {
	peerId;
	telemetry = createUsageTelemetry();
	paused = false;
	#broker;
	#phases = [];
	#archivedBatches = [];
	#burst = new Burst();
	#cumulativeReadFiles = /* @__PURE__ */ new Set();
	#cumulativeTouchedFiles = /* @__PURE__ */ new Set();
	#transcript = [];
	#userGoal = "";
	#pendingTailNotices = [];
	#stopBlockCount = 0;
	constructor(peerId, broker) {
		this.peerId = peerId;
		this.#broker = broker;
		broker.registerPeer(peerId);
	}
	get phases() {
		return this.#phases;
	}
	/** Earlier lists, oldest first, kept when a new prompt replaces a finished list or `resetTodos` clears one */
	get archivedBatches() {
		return this.#archivedBatches;
	}
	/** Whether `runPass` without `force` would consult the sidecar */
	get isPassDue() {
		return !this.paused && (this.#phases.length === 0 || this.#burst.hasPendingActivity);
	}
	get pendingTouchedFiles() {
		return [...this.#burst.touchedFiles];
	}
	get activeTask() {
		return allTasks(this.#phases).find((task) => task.status === "in_progress");
	}
	get incompleteTasks() {
		return allTasks(this.#phases).filter(isIncomplete);
	}
	/**
	* Restores state from branch entries on `/resume`, `/branch`, `/tree`, or `session_switch`.
	*/
	restore(phases) {
		this.#startList(normalizePhases(phases));
	}
	resetTodos() {
		if (this.#phases.length > 0) this.#archivedBatches.push(this.#phases);
		this.#startList([]);
	}
	/**
	* Handles a new user prompt (`input` event):
	* - If all existing todos were already completed/abandoned, archives and clears the list so Turn 1 of the new prompt extracts a fresh Todo list (solving #41359)
	* - Otherwise flags the prompt so mid-task scope additions can be extracted
	*/
	onUserInput(text) {
		const prompt = text.trim();
		if (!prompt || prompt.startsWith("/")) return { clearedFinishedList: false };
		const clearedFinishedList = this.#phases.length > 0 && this.incompleteTasks.length === 0;
		if (clearedFinishedList) this.resetTodos();
		this.#stopBlockCount = 0;
		this.#burst.userPrompted = true;
		this.#userGoal = redactSecrets(prompt).slice(0, 1200);
		return { clearedFinishedList };
	}
	/**
	* Records assistant message text / tool-call intents from `turn_end` so a detached
	* small model without full conversation history still sees the main model's reasoning & actions.
	*/
	onTurnEnd(content) {
		const parts = [];
		let textLength = 0;
		for (const block of content) {
			const text = block.type === "text" ? (block.text ?? "").trim() : "";
			if (text) {
				textLength += text.length;
				parts.push(redactSecrets(text).slice(0, 900));
			} else if (block.type === "toolCall" && block.name !== void 0) {
				const intent = block.intent ?? "";
				parts.push(redactSecrets(`ToolCall: ${block.name}${intent ? ` (${intent})` : ""}`));
			}
		}
		if (parts.length === 0) return;
		this.#burst.substantiveTextLength = Math.max(this.#burst.substantiveTextLength, textLength);
		this.#burst.addAssistantNote(parts.join(" | ").slice(0, 1200));
	}
	addManualTask(content) {
		const phases = this.#phases.length > 0 ? this.#phases : [{
			name: "Tasks",
			tasks: []
		}];
		const [added] = appendNewTasks(phases, phases.find((phase) => phase.name === "Tasks") ?? phases[0], [content]);
		if (added === void 0) return void 0;
		this.#updatePhases(normalizePhases(phases));
		return allTasks(this.#phases).find((task) => task.content === added);
	}
	markTaskCompleted(token) {
		const task = allTasks(this.#phases).find((candidate) => candidate.status !== "completed" && matchesTodo(candidate, token));
		if (!task) return void 0;
		task.status = "completed";
		this.#updatePhases(normalizePhases(this.#phases));
		return task;
	}
	/**
	* Records tool execution results, updates ReadSet/WriteSet in the broker,
	* and returns any `additionalContext` to inject at the tool boundary.
	*/
	onToolResult({ toolName, input: rawInput, output, isError }) {
		const input = parseToolInput(rawInput);
		const filePaths = extractFilePaths(this.#broker.cwd, input);
		if (!isError && readToolNames.has(toolName)) this.#recordRead(toolName, filePaths, input, output);
		if (!isError && writeToolNames.has(toolName)) this.#recordWrite(toolName, filePaths, input);
		if (verifyToolNames.has(toolName)) this.#recordVerification(toolName, filePaths, input, output, isError);
		return this.#takePendingContext();
	}
	/**
	* Runs the Sidecar Watcher and resolves to whether the todo list changed:
	* - If no todos exist yet (Turn 1), extracts the structured Todo plan from the main model's exploration
	* - If todos exist and activity accumulated (or `force`), evaluates completed/appended/dropped todos, advances the active cursor, and publishes `<peer-sync>`
	*/
	async runPass(runner, options = {}) {
		const { force = false } = options;
		if (!force && !this.isPassDue) return false;
		const initializing = this.#phases.length === 0;
		const burst = this.#burst;
		this.#burst = new Burst();
		const diff = [...burst.codeSnippets, options.gitDiff ?? ""].filter(Boolean).join("\n");
		const prompt = this.#transcript.length === 0 ? buildOpeningPrompt({
			userGoal: this.#userGoal,
			phases: this.#phases,
			cumulativeReadFiles: this.#cumulativeReadFiles,
			cumulativeTouchedFiles: this.#cumulativeTouchedFiles,
			burst,
			diff
		}) : buildFollowUpPrompt({
			userPrompt: this.#userGoal,
			phases: this.#phases,
			burst,
			diff
		});
		const verdict = await this.#askSidecar(runner, initializing ? "init" : "delta", prompt, options.signal);
		if (!verdict) return false;
		const initTasks = initializing ? verdict.initTasks ?? [] : [];
		if (initializing) {
			if (initTasks.length === 0) return false;
			this.#phases = normalizePhases([{
				name: "Tasks",
				tasks: initTasks.map((content) => ({
					content,
					status: "pending"
				}))
			}]);
		}
		const completed = this.#transitionOpenTasks(verdict.completedTasks, "completed", (task) => !isCompletionVetoed(task, burst, force));
		const dropped = initializing ? [] : this.#transitionOpenTasks(verdict.dropTasks, "abandoned");
		const appended = initializing ? [] : appendNewTasks(this.#phases, this.#phases.at(-1), verdict.appendTasks ?? []);
		const changed = initializing || completed.length > 0 || dropped.length > 0 || appended.length > 0;
		if (changed) {
			this.#updatePhases(normalizePhases(this.#phases));
			this.#stopBlockCount = 0;
			this.#pendingTailNotices.push(initializing ? initStatusNotice(initTasks.length, completed, this.activeTask) : progressStatusNotice(completed, appended, dropped, this.activeTask));
		}
		this.#broker.publishMilestoneSync({
			fromPeerId: this.peerId,
			completedTasks: completed,
			summary: verdict.milestoneSummary,
			touchedFiles: [...burst.touchedFiles],
			exportedSymbols: verdict.exportedSymbolsChanged ?? []
		});
		return changed;
	}
	/**
	* Evaluates `session_stop`: blocks premature stop if open todos remain after flushing any pending write-burst.
	* Resolves to the reason for blocking the stop, or undefined to allow it
	*/
	async evaluateStopGate(runner, options = {}) {
		if (this.paused || this.#phases.length === 0) return void 0;
		if (this.incompleteTasks.length > 0 && this.#burst.hasToolActivity) await this.runPass(runner, {
			...options,
			force: true
		});
		const incomplete = this.incompleteTasks;
		if (incomplete.length === 0) {
			this.#stopBlockCount = 0;
			return;
		}
		if (this.#stopBlockCount >= maxStopBlocks) return void 0;
		this.#stopBlockCount++;
		const taskList = incomplete.map((task) => `  - [${task.id}] ${task.content}`).join("\n");
		return `[Sidecar Todo Gate (${this.#stopBlockCount}/${maxStopBlocks})] You stopped with ${incomplete.length} unverified/incomplete todo item(s):\n${taskList}\nPlease complete the remaining implementation and verification before stopping.`;
	}
	#startList(phases) {
		this.#burst = new Burst();
		this.#cumulativeReadFiles.clear();
		this.#cumulativeTouchedFiles.clear();
		this.#transcript = [];
		this.#stopBlockCount = 0;
		this.#updatePhases(phases);
	}
	#updatePhases(phases) {
		this.#phases = phases;
		this.#broker.updatePeerTodos(this.peerId, phases);
	}
	#recordRead(toolName, filePaths, input, output) {
		this.#burst.reads++;
		this.#broker.recordFileAccess(this.peerId, filePaths, "read");
		for (const filePath of filePaths) this.#cumulativeReadFiles.add(filePath);
		this.#burst.addReadEvidence(summarizeReadEvidence(toolName, filePaths, input, output));
	}
	#recordWrite(toolName, filePaths, input) {
		this.#burst.writes++;
		for (const filePath of filePaths) {
			this.#burst.touchedFiles.add(filePath);
			this.#cumulativeTouchedFiles.add(filePath);
		}
		this.#broker.recordFileAccess(this.peerId, filePaths, "write");
		this.#burst.toolActions.push(`${toolName}(${filePaths.join(", ") || "file"}) -> ok`);
		const code = input.content ?? input.input ?? "";
		if (code.trim()) this.#burst.addCodeSnippet(summarizeCodeChange(filePaths[0] || toolName, toolName, code));
	}
	#recordVerification(toolName, filePaths, input, output, failed) {
		if (failed) this.#burst.verificationFailed = true;
		else if (this.incompleteTasks.length > 0) {
			this.#burst.verifications++;
			this.#burst.verificationFailed = false;
		}
		this.#burst.toolActions.push(summarizeVerification(toolName, input, filePaths, output, failed));
	}
	#takePendingContext() {
		const context = [formatPeerSyncNotices(this.#broker.drainInbox(this.peerId)), this.#pendingTailNotices.join("\n")].filter(Boolean).join("\n\n");
		this.#pendingTailNotices = [];
		return context || void 0;
	}
	async #askSidecar(runner, kind, prompt, signal) {
		const transcript = this.#transcript;
		const startedAt = performance.now();
		const reply = await runner({
			transcript,
			prompt
		}, signal);
		recordSidecarCall(this.telemetry, {
			kind,
			mode: reply.mode,
			modelId: reply.modelId,
			usage: reply.usage,
			durationMs: performance.now() - startedAt
		});
		const verdict = parseSidecarVerdict(reply.replyText);
		if (verdict && reply.mode === "detached-smol") this.#recordExchange(transcript, {
			prompt,
			replyText: reply.replyText
		}, reply.usage);
		return verdict;
	}
	/** Extends `transcript` with the exchange, or starts the list's transcript over when resending it stops paying off */
	#recordExchange(transcript, exchange, usage) {
		if (transcript.length > 0 && usage.cacheRead === 0) {
			this.#transcript = [];
			return;
		}
		transcript.push(exchange);
		if (transcriptTextLength(transcript) > maxTranscriptTextLength) this.#transcript = [];
	}
	/** Moves open tasks named by the sidecar to `status`, returning their contents */
	#transitionOpenTasks(tokens = [], status, isAllowed = () => true) {
		const transitioned = [];
		for (const task of allTasks(this.#phases)) if (isOpen(task) && isAllowed(task) && tokens.some((token) => matchesTodo(task, token))) {
			task.status = status;
			transitioned.push(task.content);
		}
		return transitioned;
	}
};
function transcriptTextLength(transcript) {
	return transcript.reduce((length, exchange) => length + exchange.prompt.length + exchange.replyText.length, 0);
}
/** Appends the contents not on the list yet, ignoring case, to `targetPhase` as pending tasks and returns them */
function appendNewTasks(phases, targetPhase, contents) {
	const knownContents = new Set(allTasks(phases).map((task) => task.content.toLowerCase()));
	const appended = [];
	for (const rawContent of contents) {
		const content = rawContent.trim();
		if (!content || knownContents.has(content.toLowerCase())) continue;
		knownContents.add(content.toLowerCase());
		targetPhase.tasks.push({
			id: `#${allTasks(phases).length + 1}`,
			content,
			status: "pending"
		});
		appended.push(content);
	}
	return appended;
}
function isCompletionVetoed(task, burst, force) {
	if (burst.verificationFailed && verificationTaskPattern.test(task.content)) return true;
	return !force && burst.writes === 0 && burst.substantiveTextLength < 60 && investigationTaskPattern.test(task.content);
}
function initStatusNotice(taskCount, completed, active) {
	return `<sidecar-todo-status>Initialized ${taskCount} todo items.${completed.length > 0 ? ` Completed in Turn 1: ${quoted(completed)}.` : ""} ${activeNote("Active", active)} (Managed automatically by Sidecar Watcher; do not call todo tool.)</sidecar-todo-status>`;
}
function progressStatusNotice(completed, appended, dropped, active) {
	return `<sidecar-todo-status>Sidecar Watcher ${[
		completed.length > 0 ? `marked completed: ${quoted(completed)}` : "",
		appended.length > 0 ? `added: ${quoted(appended)}` : "",
		dropped.length > 0 ? `dropped: ${quoted(dropped)}` : ""
	].filter(Boolean).join("; ")}. ${activeNote("Now in_progress", active)}</sidecar-todo-status>`;
}
function activeNote(label, active) {
	return active ? `${label} (${active.id}): "${active.content}".` : "All todo items are now completed.";
}
function quoted(contents) {
	return contents.map((content) => `"${content}"`).join(", ");
}
// src/index.ts
const readOnlyAgentNames = /* @__PURE__ */ new Set([
	"advisor",
	"scout",
	"seance",
	"reviewer",
	"security-reviewer"
]);
/**
* OMP Extension: Sidecar Todo Watcher & Peer Sync Broker
*/
function sidecarTodoWatcherExtension(pi) {
	const environment = readEnvironment(process$1.env);
	const settings = {
		modelSpec: environment.OMP_WATCHER_MODEL,
		mode: environment.OMP_WATCHER_MODE
	};
	let session;
	/** Excludes `advisor` internal tool sessions, read-only subagents, and sessions that cannot write */
	function isManaged(ctx) {
		const { name, id } = ctx.agent;
		if (readOnlyAgentNames.has(name.toLowerCase()) || readOnlyAgentNames.has(id.toLowerCase())) return false;
		const activeTools = pi.getActiveTools();
		return activeTools.length === 0 || activeTools.some((tool) => writeToolNames.has(tool) || tool === "bash" || tool === "eval");
	}
	function sessionFor(ctx) {
		const peerId = (environment.OMP_PEER_ID ?? ctx.sessionManager.getSessionId()).slice(0, 24);
		if (session?.watcher.peerId === peerId) return session;
		const broker = session?.broker ?? new PeerSyncBroker(environment.OMP_PEER_BROKER_DB ?? join(ctx.cwd, ".omp", "peer-sync.sqlite"), ctx.cwd);
		if (session) endSession(session);
		const watcher = new SidecarTodoWatcher(peerId, broker);
		watcher.restore(findLatestTodoPhases(ctx.sessionManager.getBranch()));
		session = {
			broker,
			watcher,
			ended: new AbortController(),
			rerunRequested: false
		};
		return session;
	}
	function endSession({ broker, watcher, ended }) {
		ended.abort();
		broker.unregisterPeer(watcher.peerId);
	}
	function persistAndRefreshUi(ctx, current) {
		appendStateEntry(pi, current.watcher);
		refreshUi(ctx, current);
	}
	async function collectGitDiff(ctx, files) {
		const safeFiles = files.filter((file) => !isSensitiveFilePath(file)).slice(0, 10);
		if (safeFiles.length === 0) return void 0;
		try {
			const result = await pi.exec("git", [
				"diff",
				"-U2",
				"--",
				...safeFiles
			], {
				cwd: ctx.cwd,
				timeout: 2e3
			});
			const diff = result.code === 0 ? result.stdout.trim() : "";
			return diff ? redactSecrets(diff) : void 0;
		} catch {
			return;
		}
	}
	async function syncFromSessionBranch(_event, ctx) {
		if (!isManaged(ctx)) return;
		const current = sessionFor(ctx);
		const activeTools = pi.getActiveTools();
		if (activeTools.includes("todo")) await pi.setActiveTools(activeTools.filter((tool) => tool !== "todo"));
		current.watcher.restore(findLatestTodoPhases(ctx.sessionManager.getBranch()));
		refreshUi(ctx, current);
	}
	/** Runs watcher passes off the turn's critical path, one at a time, coalescing requests made meanwhile */
	function launchWatcherPass(ctx, current) {
		if (current.inFlightPass) {
			current.rerunRequested = true;
			return;
		}
		const { watcher, ended } = current;
		const runner = createSidecarRunner(ctx, settings);
		const drain = async () => {
			do {
				current.rerunRequested = false;
				const gitDiff = await collectGitDiff(ctx, watcher.pendingTouchedFiles);
				if (await watcher.runPass(runner, {
					gitDiff,
					signal: ended.signal
				})) persistAndRefreshUi(ctx, current);
			} while (current.rerunRequested && watcher.isPassDue);
		};
		current.inFlightPass = new Promise((resolve) => ctx.setTimeout(resolve, 0)).then(drain).catch(() => {}).finally(() => {
			current.inFlightPass = void 0;
		});
	}
	pi.setLabel("Sidecar Todo Watcher & Peer Sync");
	pi.on("session_start", syncFromSessionBranch);
	pi.on("session_switch", syncFromSessionBranch);
	pi.on("session_branch", syncFromSessionBranch);
	pi.on("session_tree", syncFromSessionBranch);
	pi.on("input", async (event, ctx) => {
		if (!isManaged(ctx)) return;
		const current = sessionFor(ctx);
		if (current.watcher.onUserInput(event.text).clearedFinishedList) persistAndRefreshUi(ctx, current);
	});
	pi.on("tool_result", async (event, ctx) => {
		if (!isManaged(ctx)) return void 0;
		const additionalContext = sessionFor(ctx).watcher.onToolResult({
			toolName: event.toolName,
			input: event.input,
			output: outputText(event.content),
			isError: event.isError
		});
		return additionalContext === void 0 ? void 0 : { additionalContext };
	});
	pi.on("turn_end", async (event, ctx) => {
		if (!isManaged(ctx)) return;
		const current = sessionFor(ctx);
		current.watcher.onTurnEnd(event.message.content);
		if (current.watcher.isPassDue) launchWatcherPass(ctx, current);
	});
	pi.on("session_stop", async (event, ctx) => {
		if (!isManaged(ctx)) return void 0;
		const current = sessionFor(ctx);
		if (current.watcher.paused) return void 0;
		try {
			await current.inFlightPass;
			const gitDiff = await collectGitDiff(ctx, current.watcher.pendingTouchedFiles);
			const reason = await current.watcher.evaluateStopGate(createSidecarRunner(ctx, settings), {
				gitDiff,
				signal: event.signal
			});
			persistAndRefreshUi(ctx, current);
			return reason === void 0 ? void 0 : {
				decision: "block",
				reason
			};
		} catch {
			return;
		}
	});
	pi.on("session_shutdown", async () => {
		if (!session) return;
		endSession(session);
		session.broker.close();
		session = void 0;
	});
	pi.registerCommand("peer-todos", {
		description: peerTodosDescription,
		handler: async (args, ctx) => {
			const current = sessionFor(ctx);
			const outcome = runPeerTodosCommand(args, {
				...current,
				settings
			}, ctx);
			if (outcome.changed === "todos") persistAndRefreshUi(ctx, current);
			if (outcome.changed === "hud") refreshUi(ctx, current);
			ctx.ui.notify(outcome.message, outcome.level);
		}
	});
}
/** A tool's text output, kept whole: the watcher scrubs secrets before cutting it down and reads declarations line by line */
function outputText(content) {
	return content.map((block) => block.type === "text" ? (block.text ?? "").trim() : "").filter(Boolean).join("\n") || void 0;
}
export { sidecarTodoWatcherExtension as default };
