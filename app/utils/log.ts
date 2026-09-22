import type {
	ImportedLogEvent,
	ImportError,
	LogEventView,
	LogLevel,
	ParsedLogFile,
} from "~/types/log";

const FIELD_PATHS = {
	timestamp: ["timestamp", "time", "ts", "@timestamp", "datetime", "createdAt"],
	level: ["level", "severity", "log.level", "severityText"],
	message: ["message", "msg", "event.message", "error.message"],
	method: ["method", "request.method", "http.method", "http.request.method"],
	path: ["path", "request.path", "request.url", "url", "route", "http.path", "http.route"],
	status: [
		"status",
		"statusCode",
		"response.status",
		"response.statusCode",
		"http.status_code",
		"http.response.status_code",
	],
	duration: [
		"duration",
		"durationMs",
		"duration_ms",
		"elapsed",
		"elapsedMs",
		"latency",
		"response.duration",
		"request.duration",
	],
	requestId: ["requestId", "request_id", "request.id", "context.requestId", "correlationId"],
	traceId: ["traceId", "trace_id", "trace.id", "context.traceId"],
	userId: ["userId", "user_id", "user.id", "context.userId"],
	why: ["why", "error.why"],
	fix: ["fix", "error.fix"],
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueAt(raw: Readonly<Record<string, unknown>>, paths: readonly string[]): unknown {
	for (const path of paths) {
		let value: unknown = raw;
		for (const key of path.split("."))
			value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
		if (value !== undefined && value !== null && value !== "") return value;
	}
}

function text(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (typeof value === "number" || typeof value === "boolean") return String(value);
}

function number(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim() !== "") {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
}

/** Return the first timestamp recognized by the centralized field mapping, in epoch milliseconds. */
export function getTimestamp(event: Readonly<Record<string, unknown>>): number | undefined {
	const value = valueAt(event, FIELD_PATHS.timestamp);
	const numeric = number(value);
	const parsed =
		numeric !== undefined
			? Math.abs(numeric) < 10_000_000_000
				? numeric * 1000
				: numeric
			: typeof value === "string"
				? Date.parse(value)
				: NaN;
	if (Number.isFinite(new Date(parsed).getTime())) return parsed;
}

/** Return a normalized log level. */
export function getLevel(event: Readonly<Record<string, unknown>>): LogLevel {
	const value = text(valueAt(event, FIELD_PATHS.level))?.trim().toLowerCase();
	if (value === "warning") return "warn";
	if (value === "critical" || value === "panic") return "fatal";
	switch (value) {
		case "trace":
		case "debug":
		case "info":
		case "warn":
		case "error":
		case "fatal":
			return value;
		default:
			return "unknown";
	}
}

/** Return the primary event message when present. */
export const getMessage = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.message));
/** Return the normalized HTTP method when present. */
export const getMethod = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.method))?.trim().toUpperCase() || undefined;
/** Return the request path, URL, route, or event name when present. */
export const getPath = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.path)) ?? text(event.event);
/** Return a valid HTTP status code, skipping non-HTTP status fields such as `success`. */
export function getStatus(event: Readonly<Record<string, unknown>>): number | undefined {
	for (const path of FIELD_PATHS.status) {
		const status = number(valueAt(event, [path]));
		if (status !== undefined && Number.isInteger(status) && status >= 100 && status <= 599)
			return status;
	}
}

/** Return duration in milliseconds, accepting numbers and strings such as `1.2s` or `40ms`. */
export function getDuration(event: Readonly<Record<string, unknown>>): number | undefined {
	const value = valueAt(event, FIELD_PATHS.duration);
	let duration = number(value);
	if (typeof value === "string" && duration === undefined) {
		const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(ms|s|µs|us)$/i);
		if (!match) return undefined;
		const unit = match[2]?.toLowerCase();
		duration = Number(match[1]) * (unit === "s" ? 1000 : unit === "ms" ? 1 : 0.001);
	}
	return duration !== undefined && Number.isFinite(duration) && duration >= 0
		? duration
		: undefined;
}

/** Return the request correlation ID when present. */
export const getRequestId = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.requestId));
/** Return the trace ID when present. */
export const getTraceId = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.traceId));
/** Return the user ID when present. */
export const getUserId = (event: Readonly<Record<string, unknown>>): string | undefined =>
	text(valueAt(event, FIELD_PATHS.userId));
/** Return evlog's explanation payload when present. */
export const getWhy = (event: Readonly<Record<string, unknown>>): unknown =>
	valueAt(event, FIELD_PATHS.why);
/** Return evlog's suggested fix payload when present. */
export const getFix = (event: Readonly<Record<string, unknown>>): unknown =>
	valueAt(event, FIELD_PATHS.fix);

/** Project common fields from an imported event without changing its raw JSON. */
export function toLogEventView(event: ImportedLogEvent): LogEventView {
	return {
		...event,
		timestamp: getTimestamp(event.raw),
		level: getLevel(event.raw),
		message: getMessage(event.raw),
		method: getMethod(event.raw),
		path: getPath(event.raw),
		status: getStatus(event.raw),
		duration: getDuration(event.raw),
		requestId: getRequestId(event.raw),
		traceId: getTraceId(event.raw),
		userId: getUserId(event.raw),
		why: getWhy(event.raw),
		fix: getFix(event.raw),
	};
}

function parseObject(
	value: unknown,
	fileName: string,
	lineNumber?: number,
): Omit<ImportedLogEvent, "id" | "fileIndex"> | ImportError {
	if (!isRecord(value)) return { fileName, lineNumber, message: "Event must be a JSON object" };
	return { fileName, lineNumber, raw: value, searchText: JSON.stringify(value).toLowerCase() };
}

/** Parse JSON, JSONL, or NDJSON text while retaining valid lines when others are malformed. */
export function parseLogText(fileName: string, source: string): ParsedLogFile {
	source = source.replace(/^\uFEFF/, "");
	// Line-oriented files retain source line numbers even when there is just one event.
	if (/\.(jsonl|ndjson)$/i.test(fileName)) return parseLines(fileName, source);
	let decoded: unknown;
	try {
		decoded = JSON.parse(source);
	} catch {
		// A broken JSON array is not NDJSON: nested objects must not become fake events.
		if (source.trimStart().startsWith("["))
			return {
				events: [],
				errors: [{ fileName, message: "Invalid JSON array" }],
			};
		return parseLines(fileName, source);
	}
	const values: unknown[] = Array.isArray(decoded)
		? decoded
		: isRecord(decoded) && Array.isArray(decoded.events)
			? decoded.events
			: [decoded];
	const parsed = values.map(value => parseObject(value, fileName));
	return {
		events: parsed.filter(
			(value): value is Omit<ImportedLogEvent, "id" | "fileIndex"> => "raw" in value,
		),
		errors: parsed.filter((value): value is ImportError => "message" in value),
	};
}

function parseLines(fileName: string, source: string): ParsedLogFile {
	const events: Omit<ImportedLogEvent, "id" | "fileIndex">[] = [];
	const errors: ImportError[] = [];
	source.split(/\r?\n/).forEach((line, index) => {
		if (!line.trim()) return;
		try {
			const parsed = parseObject(JSON.parse(line), fileName, index + 1);
			if ("raw" in parsed) events.push(parsed);
			else errors.push(parsed);
		} catch {
			errors.push({ fileName, lineNumber: index + 1, message: "Invalid JSON" });
		}
	});
	return { events, errors };
}
