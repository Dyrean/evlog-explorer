import type { LogEventView } from "~/types/log";

export interface SearchTerm {
	field?: string;
	operator: string;
	value: string;
}
const aliases: Record<string, keyof LogEventView> = {
	status: "status",
	duration: "duration",
	level: "level",
	method: "method",
	path: "path",
	request: "requestId",
	requestId: "requestId",
	trace: "traceId",
	traceId: "traceId",
	session: "sessionId",
	sessionId: "sessionId",
	sid: "sessionId",
	user: "userId",
	userId: "userId",
	file: "fileName",
};

/** Quoted text and field predicates use exact, case-insensitive matching. */
export function parseSearch(query: string): { terms: SearchTerm[]; fuzzy: string; error?: string } {
	const tokens: string[] = [];
	let buffer = "";
	let quote = "";
	for (const character of query) {
		if (quote) {
			buffer += character;
			if (character === quote) quote = "";
		} else if ((character === '"' || character === "'") && (!buffer || /[:=<>]$/.test(buffer))) {
			quote = character;
			buffer += character;
		} else if (/\s/.test(character)) {
			if (buffer) tokens.push(buffer);
			buffer = "";
		} else buffer += character;
	}
	if (quote) return { terms: [], fuzzy: "", error: "Close the quoted search value." };
	if (buffer) tokens.push(buffer);
	const terms: SearchTerm[] = [];
	const fuzzy: string[] = [];
	for (const token of tokens) {
		const match = token.match(/^([\w.]+)(:|>=|<=|>|<|=)(.*)$/);
		if (match) {
			const value = match[3]!.replace(/^("|')(.*)\1$/, "$2");
			if (!value)
				return { terms: [], fuzzy: "", error: `Enter a value after ${match[1]}${match[2]}.` };
			if ([">", "<", ">=", "<="].includes(match[2]!) && !Number.isFinite(Number(value)))
				return {
					terms: [],
					fuzzy: "",
					error: "Numeric comparisons require a number (duration is in milliseconds).",
				};
			terms.push({ field: match[1], operator: match[2]!, value });
		} else if (/^["']/.test(token)) terms.push({ operator: "contains", value: token.slice(1, -1) });
		else fuzzy.push(token);
	}
	return { terms, fuzzy: fuzzy.join(" ") };
}

export function matchesTerms(event: LogEventView, terms: SearchTerm[]): boolean {
	return terms.every(term => {
		if (!term.field) return event.searchText.includes(term.value.toLowerCase());
		let value: unknown;
		const alias = Object.hasOwn(aliases, term.field) ? aliases[term.field] : undefined;
		if (alias) value = event[alias];
		else {
			value = event.raw;
			for (const key of term.field.split("."))
				value =
					value && typeof value === "object" && Object.hasOwn(value, key)
						? (value as Record<string, unknown>)[key]
						: undefined;
		}
		if (value === undefined || value === null) return false;
		if ([">", "<", ">=", "<="].includes(term.operator)) {
			const actual = Number(value),
				expected = Number(term.value);
			if (!Number.isFinite(actual)) return false;
			return term.operator === ">"
				? actual > expected
				: term.operator === "<"
					? actual < expected
					: term.operator === ">="
						? actual >= expected
						: actual <= expected;
		}
		return String(value).toLowerCase() === term.value.toLowerCase();
	});
}
