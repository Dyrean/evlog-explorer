/** A JSON object imported from a local log file, plus non-destructive source metadata. */
export interface ImportedLogEvent {
	readonly id: string;
	readonly fileName: string;
	readonly fileIndex: number;
	readonly lineNumber?: number;
	readonly raw: Readonly<Record<string, unknown>>;
	readonly searchText: string;
}

/** A malformed entry encountered while importing a file. */
export interface ImportError {
	readonly fileName: string;
	readonly lineNumber?: number;
	readonly message: string;
}

/** Canonical levels understood by the explorer. */
export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "unknown";

/** Values projected from an imported event for display and filtering. */
export interface LogEventView extends ImportedLogEvent {
	readonly timestamp?: number;
	readonly level: LogLevel;
	readonly message?: string;
	readonly method?: string;
	readonly path?: string;
	readonly status?: number;
	readonly duration?: number;
	readonly requestId?: string;
	readonly traceId?: string;
	readonly userId?: string;
	readonly why?: unknown;
	readonly fix?: unknown;
}

/** Result of parsing one local file. */
export interface ParsedLogFile {
	readonly events: readonly Omit<ImportedLogEvent, "id" | "fileIndex">[];
	readonly errors: readonly ImportError[];
}
