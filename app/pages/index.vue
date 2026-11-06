<script setup lang="ts">
import { useFuse } from "@vueuse/integrations/useFuse";
import { h, resolveComponent } from "vue";

import { toLogEventView } from "~/utils/log";
import { sampleLogs } from "~/utils/sample";
import { matchesTerms, parseSearch } from "~/utils/search";
import { sessionStore } from "~/utils/session";

import type { TableColumn, TableRow } from "@nuxt/ui";
import type { CorrelationField, ImportError, LogEventView, LogLevel } from "~/types/log";

type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";
type TimeFilter = "all" | "15m" | "1h" | "24h" | "7d" | "custom";

const slowThreshold = ref(1000);
const advancedOpen = ref(false);
const utc = ref(false);
provide("logUtc", utc);
const customStart = ref("");
const customEnd = ref("");
const correlation = ref<{ field: CorrelationField; value: string }>();
const inspectedCorrelation = shallowRef<{ field: "requestId" | "traceId"; value: string }>();
const progress = ref({ name: "", completed: 0, total: 0 });
let importWorker: Worker | undefined;
const sessionBusy = ref(false);
const hasSession = ref(false);
const viewName = ref("");
type SavedView = {
	name: string;
	search: string;
	level: LogLevel | "all" | "errors";
	method: string;
	status: StatusFilter;
	duration: number | "slow";
	timeRange: TimeFilter;
	requestId: string;
	sessionId?: string;
	customStart: string;
	customEnd: string;
	slowThreshold: number;
};
const savedViews = ref<SavedView[]>([]);
function isSavedView(value: unknown): value is SavedView {
	if (!value || typeof value !== "object") return false;
	const view = value as Record<string, unknown>;
	return (
		["name", "search", "method", "requestId", "customStart", "customEnd"].every(
			key => typeof view[key] === "string",
		) &&
		(view.sessionId === undefined || typeof view.sessionId === "string") &&
		levelOptions.some(option => option.value === view.level) &&
		statusOptions.some(option => option.value === view.status) &&
		timeOptions.some(option => option.value === view.timeRange) &&
		(view.duration === "slow" ||
			(typeof view.duration === "number" &&
				Number.isFinite(view.duration) &&
				view.duration >= 0)) &&
		typeof view.slowThreshold === "number" &&
		Number.isFinite(view.slowThreshold) &&
		view.slowThreshold >= 0 &&
		[view.customStart, view.customEnd].every(
			date => date === "" || (typeof date === "string" && Number.isFinite(Date.parse(date))),
		)
	);
}
const desktop = ref(false);
let media: MediaQueryList | undefined;
function updateDesktop() {
	desktop.value = media?.matches ?? false;
}
onMounted(async () => {
	media = window.matchMedia("(min-width: 1280px)");
	updateDesktop();
	media.addEventListener("change", updateDesktop);
	try {
		savedViews.value = JSON.parse(localStorage.getItem("evlog-views") ?? "[]").filter(isSavedView);
	} catch {
		savedViews.value = [];
	}
	try {
		hasSession.value = Boolean(await sessionStore("exists"));
	} catch {
		/* Storage may be unavailable. */
	}
});
const importing = ref(false);
const toast = useToast();
const fileInput = ref<HTMLInputElement>();
const events = shallowRef<LogEventView[]>([]);
const loadedFiles = ref<{ id: string; name: string; eventCount: number }[]>([]);
const importErrors = ref<ImportError[]>([]);
const visibleImportErrors = ref(100);
watch(importErrors, () => {
	visibleImportErrors.value = 100;
});
const selected = shallowRef<LogEventView>();
const detailsOpen = ref(false);
const searchInput = ref("");
const search = ref("");
const level = ref<LogLevel | "all" | "errors">("all");
const file = ref("all");
const method = ref("all");
const status = ref<StatusFilter>("all");
const duration = ref<number | "slow">(0);
const timeRange = ref<TimeFilter>("all");
const requestId = ref("");
const sessionId = ref("");
const sorting = ref([{ id: "timestamp", desc: true }]);

const levelOptions = [
	"all",
	"trace",
	"debug",
	"info",
	"warn",
	"error",
	"fatal",
	"unknown",
	"errors",
].map(value => ({
	label:
		value === "all" ? "All levels" : value === "errors" ? "Errors & fatal" : value.toUpperCase(),
	value,
}));
const statusOptions = [
	{ label: "All statuses", value: "all" },
	{ label: "2xx", value: "2xx" },
	{ label: "3xx", value: "3xx" },
	{ label: "4xx", value: "4xx" },
	{ label: "5xx", value: "5xx" },
];
const durationOptions = [
	{ label: "Any duration", value: 0 },
	{ label: "> 100 ms", value: 100 },
	{ label: "> 500 ms", value: 500 },
	{ label: "> 1 s", value: 1000 },
	{ label: "> 5 s", value: 5000 },
	{ label: "Slow requests", value: "slow" },
];
const timeOptions = [
	{ label: "All time", value: "all" },
	{ label: "Last 15 min", value: "15m" },
	{ label: "Last hour", value: "1h" },
	{ label: "Last 24 hours", value: "24h" },
	{ label: "Last 7 days", value: "7d" },
	{ label: "Custom interval", value: "custom" },
];
const levelColors = {
	trace: "neutral",
	debug: "info",
	info: "info",
	warn: "warning",
	error: "error",
	fatal: "error",
	unknown: "neutral",
} as const;

let searchTimer: ReturnType<typeof setTimeout> | undefined;
watch(searchInput, value => {
	clearTimeout(searchTimer);
	searchTimer = setTimeout(() => {
		search.value = value.trim();
	}, 150);
});
let disposed = false;
onBeforeUnmount(() => {
	clearTimeout(searchTimer);
	disposed = true;
	importWorker?.terminate();
	media?.removeEventListener("change", updateDesktop);
});

const fileOptions = computed(() => [
	{ label: "All files", value: "all" },
	...loadedFiles.value.map(item => ({ label: item.name, value: item.id })),
]);
const methodOptions = computed(() =>
	[
		"all",
		...new Set(
			events.value.map(event => event.method).filter((value): value is string => Boolean(value)),
		),
	].map(value => ({ label: value === "all" ? "All methods" : value, value })),
);
const maxTimestamp = computed(() =>
	events.value.reduce((latest, event) => Math.max(latest, event.timestamp ?? -Infinity), -Infinity),
);
const hasTimestamps = computed(() => Number.isFinite(maxTimestamp.value));

const minTimestamp = computed(() =>
	events.value.reduce(
		(earliest, event) => Math.min(earliest, event.timestamp ?? Infinity),
		Infinity,
	),
);
const parsedSearch = computed(() => parseSearch(search.value));
const fuzzySearch = computed(() => parsedSearch.value.fuzzy);
const timeError = computed(() =>
	timeRange.value === "custom" &&
	customStart.value &&
	customEnd.value &&
	Date.parse(customStart.value) > Date.parse(customEnd.value)
		? "Start must be before end."
		: "",
);
const filterableEvents = computed(() =>
	events.value.filter(event => {
		if (
			parsedSearch.value.error ||
			timeError.value ||
			!matchesTerms(event, parsedSearch.value.terms)
		)
			return false;
		if (sessionId.value && event.sessionId !== sessionId.value) return false;
		if (correlation.value && event[correlation.value.field] !== correlation.value.value)
			return false;
		if (
			level.value === "errors"
				? !["error", "fatal"].includes(event.level)
				: level.value !== "all" && event.level !== level.value
		)
			return false;
		if (file.value !== "all" && event.fileIndex !== Number(file.value)) return false;
		if (method.value !== "all" && event.method !== method.value) return false;
		if (status.value !== "all" && Math.floor((event.status ?? 0) / 100) !== Number(status.value[0]))
			return false;
		if (duration.value === "slow") {
			if (!event.method || (event.duration ?? -1) < slowThreshold.value) return false;
		} else if (duration.value && (event.duration ?? -1) <= duration.value) return false;
		if (requestId.value && !event.requestId?.toLowerCase().includes(requestId.value.toLowerCase()))
			return false;
		if (timeRange.value === "custom") {
			if (event.timestamp === undefined) return false;
			if (customStart.value && event.timestamp < Date.parse(customStart.value)) return false;
			if (customEnd.value && event.timestamp > Date.parse(customEnd.value)) return false;
		} else if (timeRange.value !== "all") {
			const ranges: Record<Exclude<TimeFilter, "all" | "custom">, number> = {
				"15m": 900_000,
				"1h": 3_600_000,
				"24h": 86_400_000,
				"7d": 604_800_000,
			};
			if (
				event.timestamp === undefined ||
				event.timestamp < maxTimestamp.value - ranges[timeRange.value]
			)
				return false;
		}
		return true;
	}),
);
const { results: searchResults } = useFuse(fuzzySearch, filterableEvents, {
	matchAllWhenSearchEmpty: true,
	fuseOptions: { keys: ["searchText"], threshold: 0.25, ignoreLocation: true },
});
const filteredEvents = computed(() => searchResults.value.map(result => result.item));

const stats = computed(() => {
	const data = filteredEvents.value;
	const requests = data.filter(event => Boolean(event.method));
	const durations = requests
		.flatMap(event => (event.duration === undefined ? [] : [event.duration]))
		.sort((a, b) => a - b);
	return {
		errors: data.filter(event => event.level === "error" || event.level === "fatal").length,
		warnings: data.filter(event => event.level === "warn").length,
		requests: requests.length,
		slow: requests.filter(event => (event.duration ?? -1) >= slowThreshold.value).length,
		p95: durations.length ? durations[Math.ceil(durations.length * 0.95) - 1] : undefined,
	};
});
const relatedEvents = computed(() => {
	const anchor = inspectedCorrelation.value;
	return anchor
		? events.value
				.filter(event => event[anchor.field] === anchor.value)
				.sort((a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity))
		: [];
});
const selectedSessionId = computed(() => selected.value?.sessionId);
const sessionEvents = computed(() => {
	const selectedId = selectedSessionId.value;
	return selectedId ? events.value.filter(event => event.sessionId === selectedId) : [];
});
const filterChips = computed(() => [
	...(search.value
		? [
				{
					label: `Search: ${search.value}`,
					clear: () => {
						clearTimeout(searchTimer);
						searchInput.value = "";
						search.value = "";
					},
				},
			]
		: []),
	...(level.value !== "all"
		? [
				{
					label: `Level: ${level.value}`,
					clear: () => {
						level.value = "all";
					},
				},
			]
		: []),
	...(file.value !== "all"
		? [
				{
					label: `File: ${fileOptions.value.find(item => item.value === file.value)?.label}`,
					clear: () => {
						file.value = "all";
					},
				},
			]
		: []),
	...(method.value !== "all"
		? [
				{
					label: `Method: ${method.value}`,
					clear: () => {
						method.value = "all";
					},
				},
			]
		: []),
	...(status.value !== "all"
		? [
				{
					label: `Status: ${status.value}`,
					clear: () => {
						status.value = "all";
					},
				},
			]
		: []),
	...(duration.value
		? [
				{
					label:
						duration.value === "slow"
							? `Slow ≥ ${formatDuration(slowThreshold.value)}`
							: `Duration > ${formatDuration(duration.value)}`,
					clear: () => {
						duration.value = 0;
					},
				},
			]
		: []),
	...(timeRange.value !== "all"
		? [
				{
					label: `Time: ${timeOptions.find(item => item.value === timeRange.value)?.label}`,
					clear: () => {
						timeRange.value = "all";
					},
				},
			]
		: []),
	...(requestId.value
		? [
				{
					label: `Request: ${requestId.value}`,
					clear: () => {
						requestId.value = "";
					},
				},
			]
		: []),
	...(sessionId.value
		? [
				{
					label: `Session: ${sessionId.value}`,
					clear: () => {
						sessionId.value = "";
					},
				},
			]
		: []),
	...(correlation.value
		? [
				{
					label: `${correlation.value.field}: ${correlation.value.value}`,
					clear: () => {
						correlation.value = undefined;
					},
				},
			]
		: []),
]);

const activeFilterCount = computed(() => filterChips.value.length);

type HeaderRenderer = Exclude<NonNullable<TableColumn<LogEventView>["header"]>, string>;

const SortButton = resolveComponent("UButton");
const sortHeader =
	(label: string) =>
	({ column }: Parameters<HeaderRenderer>[0]) =>
		h(SortButton, {
			label,
			color: "neutral",
			variant: "ghost",
			size: "xs",
			trailingIcon: column.getIsSorted()
				? column.getIsSorted() === "asc"
					? "i-lucide-arrow-up"
					: "i-lucide-arrow-down"
				: "i-lucide-arrow-up-down",
			onClick: () => column.toggleSorting(column.getIsSorted() === "asc"),
		});

const columns: TableColumn<LogEventView>[] = [
	{
		accessorKey: "timestamp",
		header: sortHeader("Time"),
		meta: { class: { th: "w-36", td: "w-36" } },
	},
	{
		accessorKey: "level",
		header: sortHeader("Level"),
		meta: { class: { th: "w-20", td: "w-20" } },
	},
	{
		accessorKey: "method",
		header: "Method",
		enableSorting: false,
		meta: { class: { th: "hidden sm:table-cell w-18", td: "hidden sm:table-cell w-18" } },
	},
	{
		accessorKey: "path",
		header: "Path / Event",
		enableSorting: false,
		meta: { class: { th: "max-w-56", td: "max-w-56" } },
	},
	{
		accessorKey: "status",
		header: sortHeader("Status"),
		meta: { class: { th: "hidden md:table-cell w-18", td: "hidden md:table-cell w-18" } },
	},
	{
		accessorKey: "duration",
		header: sortHeader("Duration"),
		meta: { class: { th: "hidden md:table-cell w-24", td: "hidden md:table-cell w-24" } },
	},
	{
		accessorKey: "message",
		header: "Message",
		enableSorting: false,
		meta: { class: { th: "hidden xl:table-cell max-w-80", td: "hidden xl:table-cell max-w-80" } },
	},
	{
		accessorKey: "requestId",
		header: "Request ID",
		enableSorting: false,
		meta: { class: { th: "hidden 2xl:table-cell max-w-40", td: "hidden 2xl:table-cell max-w-40" } },
	},
	{
		accessorKey: "fileName",
		header: "File",
		enableSorting: false,
		meta: { class: { th: "hidden 2xl:table-cell max-w-32", td: "hidden 2xl:table-cell max-w-32" } },
	},
];

function formatDuration(value?: number): string {
	if (value === undefined) return "—";
	return value >= 1000
		? `${(value / 1000).toFixed(2)} s`
		: `${value.toFixed(value < 10 ? 1 : 0)} ms`;
}

function statusColor(value?: number): "success" | "info" | "warning" | "error" | "neutral" {
	if (!value) return "neutral";
	if (value >= 500) return "error";
	if (value >= 400) return "warning";
	if (value >= 300) return "info";
	return "success";
}

function eventCorrelation(
	event?: LogEventView,
): { field: "requestId" | "traceId"; value: string } | undefined {
	return event?.requestId
		? { field: "requestId", value: event.requestId }
		: event?.traceId
			? { field: "traceId", value: event.traceId }
			: undefined;
}
function selectEvent(_event: Event, row: TableRow<LogEventView>): void {
	selected.value = row.original;
	const active = correlation.value;
	inspectedCorrelation.value =
		(active && active.field !== "sessionId"
			? { field: active.field, value: active.value }
			: undefined) ?? eventCorrelation(row.original);
	detailsOpen.value = true;
}
function selectTimelineEvent(event: LogEventView, scope?: "session"): void {
	selected.value = event;
	if (scope === "session") inspectedCorrelation.value = eventCorrelation(event);
}

function applyPreset(preset: "errors" | "warnings" | "slow" | "4xx" | "5xx"): void {
	if (preset === "errors") level.value = "errors";
	if (preset === "warnings") level.value = "warn";
	if (preset === "slow") duration.value = "slow";
	if (preset === "4xx" || preset === "5xx") status.value = preset;
}

function clearFilters(): void {
	clearTimeout(searchTimer);
	searchInput.value = "";
	search.value = "";
	level.value = "all";
	file.value = "all";
	method.value = "all";
	status.value = "all";
	duration.value = 0;
	timeRange.value = "all";
	requestId.value = "";
	sessionId.value = "";
	correlation.value = undefined;
	customStart.value = "";
	customEnd.value = "";
}

function clearLogs(): void {
	if (importing.value) return;
	detailsOpen.value = false;
	events.value = [];
	loadedFiles.value = [];
	importErrors.value = [];
	selected.value = undefined;
	inspectedCorrelation.value = undefined;
	clearFilters();
}

function openFilePicker(): void {
	fileInput.value?.click();
}

async function onNativeFiles(event: Event): Promise<void> {
	const input = event.currentTarget;
	if (!(input instanceof HTMLInputElement) || !input.files) return;
	const files = [...input.files];
	input.value = "";
	await importFiles(files);
}

function followId(field: CorrelationField, value: string): void {
	clearFilters();
	correlation.value = { field, value };
	inspectedCorrelation.value =
		field === "sessionId" ? eventCorrelation(selected.value) : { field, value };
}
function cancelImport(): void {
	importWorker?.terminate();
	importWorker = undefined;
	importing.value = false;
	toast.add({
		title: "Import cancelled",
		description: "Previously loaded events are still available.",
		color: "neutral",
	});
}
function importFiles(value: File[] | File | null | undefined): void {
	const files = value ? (Array.isArray(value) ? value : [value]) : [];
	if (!files.length || importing.value || sessionBusy.value) return;
	importing.value = true;
	progress.value = { name: files[0]!.name, completed: 0, total: files.length };
	try {
		importWorker = new Worker(new URL("../workers/import.ts", import.meta.url), { type: "module" });
		importWorker.addEventListener("message", message => {
			if (disposed) return;
			if (message.data.type === "progress") {
				progress.value = message.data;
				return;
			}
			if (message.data.type === "done") {
				events.value = [...events.value, ...message.data.events];
				loadedFiles.value = [...loadedFiles.value, ...message.data.files];
				importErrors.value = [...importErrors.value, ...message.data.errors];
				toast.add({
					title: `Imported ${message.data.events.length.toLocaleString()} events`,
					description: message.data.errors.length
						? `${message.data.errors.length} parsing issues; valid events were retained.`
						: "Processed locally in your browser.",
					color: message.data.errors.length ? "warning" : "success",
				});
			} else toast.add({ title: "Import failed", color: "error" });
			importWorker?.terminate();
			importWorker = undefined;
			importing.value = false;
		});
		importWorker.addEventListener("error", () => {
			importWorker?.terminate();
			importWorker = undefined;
			importing.value = false;
			toast.add({
				title: "Import failed",
				description: "Try a smaller file or check its format.",
				color: "error",
			});
		});
		importWorker.postMessage({ files, startIndex: loadedFiles.value.length }, []);
	} catch {
		importWorker?.terminate();
		importWorker = undefined;
		importing.value = false;
		toast.add({ title: "Could not start import", color: "error" });
	}
}
function exportEvents(): void {
	const blob = new Blob([filteredEvents.value.map(event => JSON.stringify(event.raw)).join("\n")], {
		type: "application/x-ndjson",
	});
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = "evlog-filtered.ndjson";
	link.click();
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function persistViews(): void {
	try {
		localStorage.setItem("evlog-views", JSON.stringify(savedViews.value));
	} catch {
		toast.add({ title: "Could not save views in this browser", color: "error" });
	}
}
function saveView(): void {
	const name = viewName.value.trim();
	if (!name) return;
	const view: SavedView = {
		name,
		search: searchInput.value,
		level: level.value,
		method: method.value,
		status: status.value,
		duration: duration.value,
		timeRange: timeRange.value,
		requestId: requestId.value,
		sessionId: sessionId.value,
		customStart: customStart.value,
		customEnd: customEnd.value,
		slowThreshold: slowThreshold.value,
	};
	savedViews.value = [...savedViews.value.filter(item => item.name !== name), view];
	persistViews();
	viewName.value = "";
}
function loadView(view: SavedView): void {
	clearFilters();
	searchInput.value = view.search;
	level.value = view.level;
	method.value = view.method;
	status.value = view.status;
	duration.value = view.duration;
	timeRange.value = view.timeRange;
	requestId.value = view.requestId;
	sessionId.value = view.sessionId ?? "";
	customStart.value = view.customStart;
	customEnd.value = view.customEnd;
	slowThreshold.value = view.slowThreshold;
}
async function manageSession(action: "save" | "load" | "delete"): Promise<void> {
	if (sessionBusy.value || importing.value) return;
	sessionBusy.value = true;
	try {
		const result = (await sessionStore(
			action,
			action === "save"
				? {
						version: 1,
						events: events.value,
						files: JSON.parse(JSON.stringify(loadedFiles.value)),
						errors: JSON.parse(JSON.stringify(importErrors.value)),
					}
				: undefined,
		)) as
			| {
					version: number;
					events: LogEventView[];
					files: typeof loadedFiles.value;
					errors: ImportError[];
			  }
			| undefined;
		if (action === "load") {
			if (
				!result ||
				result.version !== 1 ||
				!Array.isArray(result.events) ||
				!Array.isArray(result.files)
			)
				throw new Error("Invalid session");
			const restoredEvents = result.events.map(toLogEventView);
			clearLogs();
			events.value = restoredEvents;
			loadedFiles.value = result.files;
			importErrors.value = result.errors ?? [];
		}
		hasSession.value = action !== "delete";
		toast.add({
			title:
				action === "save"
					? "Session saved on this device"
					: action === "load"
						? "Session restored"
						: "Saved session deleted",
			color: "success",
		});
	} catch {
		toast.add({
			title: "Could not access saved session",
			description: "Browser storage may be unavailable or full.",
			color: "error",
		});
	} finally {
		sessionBusy.value = false;
	}
}
function formatRange(value: number): string {
	return Number.isFinite(value)
		? new Date(value).toLocaleString(undefined, {
				timeZone: utc.value ? "UTC" : undefined,
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
			})
		: "No timestamps";
}
</script>

<template>
	<div class="explorer-shell flex h-dvh min-h-[480px] flex-col overflow-hidden">
		<header
			class="explorer-header relative z-10 flex h-16 shrink-0 items-center justify-between gap-3 border-b border-default px-4 sm:px-6"
		>
			<div class="flex min-w-0 items-center gap-3">
				<div class="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
					<UIcon name="i-lucide-activity" class="size-5" />
				</div>
				<div>
					<h1 class="text-sm font-semibold tracking-tight text-highlighted">Evlog Explorer</h1>
					<p class="text-[11px] text-muted">Find the story behind your logs</p>
				</div>
				<UBadge color="neutral" variant="outline" class="hidden sm:inline-flex"
					><UIcon name="i-lucide-lock-keyhole" class="mr-1 size-3" />Local only</UBadge
				>
			</div>
			<div class="flex items-center gap-2">
				<input
					ref="fileInput"
					type="file"
					multiple
					accept=".json,.jsonl,.ndjson,application/json"
					class="hidden"
					@change="onNativeFiles"
				/>
				<UButton
					v-if="events.length"
					icon="i-lucide-upload"
					label="Import"
					size="sm"
					:loading="importing"
					:disabled="sessionBusy"
					@click="openFilePicker"
				/>
				<UDropdownMenu
					v-if="events.length"
					:items="[
						{
							label: 'Export matching events',
							icon: 'i-lucide-download',
							disabled: !filteredEvents.length,
							onSelect: exportEvents,
						},
						{
							label: 'Save session on this device',
							icon: 'i-lucide-hard-drive',
							disabled: sessionBusy || importing,
							onSelect: () => manageSession('save'),
						},
						{
							label: 'Delete saved session',
							icon: 'i-lucide-eraser',
							disabled: !hasSession || sessionBusy || importing,
							onSelect: () => manageSession('delete'),
						},
						{
							label: 'Clear loaded logs',
							icon: 'i-lucide-trash-2',
							disabled: importing || sessionBusy,
							onSelect: clearLogs,
						},
					]"
					><UButton
						icon="i-lucide-ellipsis"
						aria-label="Session actions"
						variant="ghost"
						color="neutral"
				/></UDropdownMenu>
				<UColorModeButton size="sm" />
			</div>
		</header>

		<div
			v-if="importing"
			class="shrink-0 border-b border-primary/20 bg-primary/5 px-4 py-3"
			role="status"
			aria-live="polite"
		>
			<div class="flex items-center justify-between gap-3 text-xs">
				<span class="truncate"
					>Importing {{ progress.name }} · file {{ progress.completed + 1 }} of
					{{ progress.total }}</span
				><UButton
					label="Cancel import"
					size="xs"
					color="neutral"
					variant="outline"
					@click="cancelImport"
				/>
			</div>
			<progress
				:value="progress.completed"
				:max="progress.total"
				class="mt-2 h-1 w-full accent-[var(--ui-primary)]"
			/>
		</div>
		<div
			v-if="importErrors.length"
			class="shrink-0 border-b border-warning/20 bg-warning/5 px-4 py-2"
		>
			<details class="text-xs">
				<summary class="cursor-pointer text-warning">
					{{ importErrors.length }} parsing issues · valid events retained
				</summary>
				<div class="mt-2 flex items-start gap-3">
					<ul class="max-h-28 flex-1 overflow-auto font-mono">
						<li v-for="(issue, index) in importErrors.slice(0, visibleImportErrors)" :key="index">
							{{ issue.fileName }}{{ issue.lineNumber ? `:${issue.lineNumber}` : "" }} —
							{{ issue.message }}
						</li>
					</ul>
					<UButton
						label="Dismiss"
						size="xs"
						variant="ghost"
						color="neutral"
						@click="importErrors = []"
					/>
				</div>
				<UButton
					v-if="importErrors.length > visibleImportErrors"
					:label="`Show more (${importErrors.length - visibleImportErrors} remaining)`"
					size="xs"
					variant="ghost"
					color="neutral"
					@click="visibleImportErrors += 100"
				/>
			</details>
		</div>

		<main v-if="!events.length" class="min-h-0 flex-1 overflow-auto">
			<div class="mx-auto flex min-h-full max-w-5xl flex-col justify-center px-6 py-12">
				<div class="mb-8 max-w-xl">
					<p class="mb-3 text-xs font-semibold tracking-widest text-primary uppercase">
						Your logs. Your device.
					</p>
					<h2 class="text-3xl font-semibold tracking-tight text-highlighted sm:text-4xl">
						From a log file to<br />a clearer picture.
					</h2>
					<p class="mt-4 text-sm leading-6 text-muted">
						Find failed requests, investigate slow responses, and follow each event back to its
						context. Everything runs in your browser.
					</p>
				</div>
				<div class="grid items-start gap-8 md:grid-cols-[1.3fr_1fr]">
					<div>
						<UFileUpload
							multiple
							accept=".json,.jsonl,.ndjson,application/json"
							label="Drop your log files here"
							description="JSON, JSONL, or NDJSON"
							icon="i-lucide-folder-open"
							class="min-h-56 w-full"
							:preview="false"
							:disabled="importing || sessionBusy"
							reset
							@update:model-value="importFiles"
						/>
						<div class="mt-4 flex flex-wrap items-center gap-3">
							<UButton
								label="Explore sample logs"
								icon="i-lucide-sparkles"
								color="neutral"
								variant="outline"
								:disabled="importing || sessionBusy"
								@click="importFiles(sampleLogs())"
							/><UButton
								v-if="hasSession"
								label="Restore saved session"
								icon="i-lucide-history"
								color="neutral"
								variant="ghost"
								:loading="sessionBusy"
								:disabled="importing || sessionBusy"
								@click="manageSession('load')"
							/>
						</div>
					</div>
					<div class="space-y-6 py-2">
						<div
							v-for="feature in [
								{
									icon: 'i-lucide-list-filter',
									title: 'Find exactly what matters',
									text: 'Search every field, narrow by status or latency, and save useful views.',
								},
								{
									icon: 'i-lucide-git-branch',
									title: 'Follow the whole request',
									text: 'Connect events through request and trace IDs, across multiple files.',
								},
								{
									icon: 'i-lucide-shield-check',
									title: 'Keep sensitive data local',
									text: 'No uploads, accounts, or analytics. Save sessions only when you choose.',
								},
							]"
							:key="feature.title"
							class="flex gap-3"
						>
							<UIcon :name="feature.icon" class="mt-0.5 size-5 shrink-0 text-primary" />
							<div>
								<h3 class="text-sm font-medium text-highlighted">{{ feature.title }}</h3>
								<p class="mt-1 text-xs leading-5 text-muted">{{ feature.text }}</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</main>

		<main v-else class="flex min-h-0 flex-1 flex-col">
			<section class="explorer-overview shrink-0 border-b border-default px-4 py-4 sm:px-6">
				<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
					<div class="flex items-baseline gap-2">
						<h2 class="text-sm font-semibold text-highlighted">Overview</h2>
						<span class="text-xs text-muted">{{
							activeFilterCount ? "Matching events" : "All imported events"
						}}</span>
					</div>
					<span class="text-[11px] text-muted"
						>{{ loadedFiles.length }} {{ loadedFiles.length === 1 ? "file" : "files" }} ·
						{{ events.length.toLocaleString() }} events</span
					>
				</div>
				<div class="grid grid-cols-3 gap-2 lg:grid-cols-6">
					<div class="metric">
						<span>Matching</span><strong>{{ filteredEvents.length.toLocaleString() }}</strong>
					</div>
					<button class="metric hover:bg-error/5" @click="applyPreset('errors')">
						<span>Errors</span
						><strong class="text-error">{{ stats.errors.toLocaleString() }}</strong>
					</button>
					<button class="metric hover:bg-warning/5" @click="applyPreset('warnings')">
						<span>Warnings</span
						><strong class="text-warning">{{ stats.warnings.toLocaleString() }}</strong>
					</button>
					<div class="metric">
						<span>Requests</span><strong>{{ stats.requests.toLocaleString() }}</strong>
					</div>
					<button class="metric hover:bg-warning/5" @click="applyPreset('slow')">
						<span>Slow ≥ {{ formatDuration(slowThreshold) }}</span
						><strong>{{ stats.slow.toLocaleString() }}</strong>
					</button>
					<div class="metric">
						<span>Request p95</span
						><strong class="font-mono">{{ formatDuration(stats.p95) }}</strong>
					</div>
				</div>
			</section>

			<section class="explorer-toolbar shrink-0 border-b border-default px-4 py-3 sm:px-6">
				<div class="flex flex-wrap items-center gap-2">
					<UInput
						v-model="searchInput"
						icon="i-lucide-search"
						placeholder="Search logs… or status:503 duration>1000"
						aria-label="Search logs"
						class="min-w-60 flex-1"
						:ui="{ base: 'font-mono text-xs' }"
					/>
					<USelect v-model="level" :items="levelOptions" aria-label="Level filter" class="w-28" />
					<USelect
						v-if="hasTimestamps"
						v-model="timeRange"
						:items="timeOptions"
						value-key="value"
						aria-label="Time range before newest imported event"
						class="w-40"
					/>
					<UButton
						label="Filters & views"
						icon="i-lucide-sliders-horizontal"
						:variant="advancedOpen ? 'soft' : 'outline'"
						:color="advancedOpen ? 'primary' : 'neutral'"
						:aria-expanded="advancedOpen"
						@click="advancedOpen = !advancedOpen"
					/>
				</div>
				<div class="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
					<span
						>Imported: {{ formatRange(minTimestamp) }} → {{ formatRange(maxTimestamp) }} ·
						{{ utc ? "UTC" : "Local time"
						}}<span v-if="timeRange !== 'all' && timeRange !== 'custom'">
							· range ends at newest event</span
						></span
					>
					<div class="flex items-center gap-2">
						<UTooltip
							text="Quoted phrases match literally. Field filters match exactly: status:503, user.id:user-1, session:sess-001, duration>1000. Unquoted text uses fuzzy search."
							><UButton
								label="Search syntax"
								icon="i-lucide-circle-help"
								size="xs"
								color="neutral"
								variant="ghost" /></UTooltip
						><UButton
							:label="utc ? 'Use local time' : 'Use UTC'"
							size="xs"
							color="neutral"
							variant="ghost"
							@click="utc = !utc"
						/>
					</div>
				</div>
				<p v-if="parsedSearch.error || timeError" role="alert" class="mt-2 text-xs text-error">
					{{ parsedSearch.error || timeError }}
				</p>
				<div v-if="timeRange === 'custom'" class="mt-3 flex flex-wrap gap-3">
					<label class="text-xs text-muted"
						>Start (local time)<input
							v-model="customStart"
							type="datetime-local"
							class="date-input" /></label
					><label class="text-xs text-muted"
						>End (local time)<input v-model="customEnd" type="datetime-local" class="date-input"
					/></label>
				</div>
				<div
					v-if="advancedOpen"
					class="mt-3 max-h-[32vh] space-y-4 overflow-auto rounded-xl border border-default bg-elevated/20 p-3"
				>
					<div class="flex flex-wrap items-end gap-3">
						<label class="filter-label"
							>Source file<USelect
								v-model="file"
								:items="fileOptions"
								value-key="value"
								aria-label="File filter"
								class="w-44"
						/></label>
						<label class="filter-label"
							>Method<USelect
								v-model="method"
								:items="methodOptions"
								aria-label="Method filter"
								class="w-28"
						/></label>
						<label class="filter-label"
							>HTTP status<USelect
								v-model="status"
								:items="statusOptions"
								value-key="value"
								aria-label="Status filter"
								class="w-32"
						/></label>
						<label class="filter-label"
							>Duration<USelect
								v-model="duration"
								:items="durationOptions"
								value-key="value"
								aria-label="Duration filter"
								class="w-40"
						/></label>
						<label class="filter-label"
							>Request ID contains<UInput
								v-model="requestId"
								placeholder="Request ID"
								aria-label="Request ID contains"
								class="w-40"
						/></label>
						<label class="filter-label"
							>Session ID (exact)<UInput
								v-model="sessionId"
								placeholder="Session ID"
								aria-label="Session ID exact match"
								class="w-44"
						/></label>
						<label class="filter-label"
							>Slow threshold (ms)<UInputNumber
								v-model="slowThreshold"
								:min="0"
								:step="100"
								aria-label="Slow threshold in milliseconds"
								class="w-36"
						/></label>
					</div>
					<div class="flex flex-wrap items-center gap-2 border-t border-default pt-3">
						<span class="mr-1 text-xs text-muted">Quick views</span
						><UButton
							v-for="preset in ['errors', 'warnings', 'slow', '4xx', '5xx'] as const"
							:key="preset"
							:label="preset"
							size="xs"
							color="neutral"
							variant="soft"
							@click="applyPreset(preset)"
						/>
					</div>
					<div class="flex flex-wrap items-center gap-2">
						<UInput
							v-model="viewName"
							placeholder="Name this view"
							aria-label="Saved view name"
							size="sm"
							@keydown.enter="saveView"
						/><UButton
							label="Save view"
							icon="i-lucide-bookmark"
							size="sm"
							color="neutral"
							variant="outline"
							:disabled="!viewName.trim()"
							@click="saveView"
						/><span class="text-[11px] text-muted"
							>Saves filters on this device; file selection and correlation are excluded.</span
						>
					</div>
					<div v-if="savedViews.length" class="flex flex-wrap gap-2">
						<div
							v-for="view in savedViews"
							:key="view.name"
							class="flex items-center rounded-md border border-default"
						>
							<UButton
								:label="view.name"
								size="xs"
								color="neutral"
								variant="ghost"
								@click="loadView(view)"
							/><UButton
								icon="i-lucide-x"
								:aria-label="`Delete view ${view.name}`"
								size="xs"
								color="neutral"
								variant="ghost"
								@click="
									savedViews = savedViews.filter(item => item.name !== view.name);
									persistViews();
								"
							/>
						</div>
					</div>
				</div>
				<div v-if="activeFilterCount" class="mt-2 flex flex-wrap items-center gap-1.5">
					<UButton
						v-for="chip in filterChips"
						:key="chip.label"
						:label="chip.label"
						trailing-icon="i-lucide-x"
						:aria-label="`Remove ${chip.label}`"
						size="xs"
						color="primary"
						variant="soft"
						class="max-w-full"
						:ui="{ label: 'truncate' }"
						@click="chip.clear()"
					/><UButton
						label="Clear all"
						size="xs"
						color="neutral"
						variant="ghost"
						@click="clearFilters"
					/>
				</div>
			</section>

			<div class="flex min-h-0 flex-1">
				<section class="flex min-w-0 flex-1 flex-col bg-default" aria-label="Log events">
					<div class="flex shrink-0 items-center justify-between border-b border-default px-4 py-2">
						<span class="text-xs text-muted"
							>{{ filteredEvents.length.toLocaleString() }} matching events</span
						><UButton
							label="Export"
							icon="i-lucide-download"
							size="xs"
							color="neutral"
							variant="ghost"
							:disabled="!filteredEvents.length"
							@click="exportEvents"
						/>
					</div>
					<div class="min-h-0 flex-1">
						<UTable
							v-model:sorting="sorting"
							:data="filteredEvents"
							:columns="columns"
							:virtualize="{ estimateSize: 37, overscan: 15 }"
							:watch-options="{ deep: false }"
							:get-row-id="event => event.id"
							:meta="{
								class: {
									tr: (row: TableRow<LogEventView>) =>
										row.original.id === selected?.id && detailsOpen ? 'log-row-selected' : '',
								},
							}"
							sticky
							class="log-table h-full"
							@select="selectEvent"
						>
							<template #timestamp-cell="{ row }">
								<EventTimestamp :timestamp="row.original.timestamp" />
							</template>
							<template #level-cell="{ row }">
								<UBadge :color="levelColors[row.original.level]" variant="subtle" size="sm">
									{{ row.original.level.toUpperCase() }}
								</UBadge>
							</template>
							<template #method-cell="{ row }">
								<span class="font-mono text-xs font-medium text-highlighted">{{
									row.original.method || "—"
								}}</span>
							</template>
							<template #path-cell="{ row }">
								<span class="block truncate font-mono text-xs text-highlighted">{{
									row.original.path || row.original.message || "Log event"
								}}</span>
							</template>
							<template #status-cell="{ row }">
								<UBadge
									v-if="row.original.status"
									:color="statusColor(row.original.status)"
									variant="subtle"
									size="sm"
									class="font-mono"
								>
									{{ row.original.status }} </UBadge
								><span v-else>—</span>
							</template>
							<template #duration-cell="{ row }">
								<span
									class="font-mono"
									:class="
										(row.original.duration ?? 0) >= slowThreshold ? 'font-medium text-warning' : ''
									"
									>{{ formatDuration(row.original.duration) }}</span
								>
							</template>
							<template #message-cell="{ row }">
								<span class="block truncate">{{ row.original.message || "—" }}</span>
							</template>
							<template #requestId-cell="{ row }">
								<code class="block truncate text-[11px]">{{ row.original.requestId || "—" }}</code>
							</template>
							<template #fileName-cell="{ row }">
								<span class="block truncate text-[11px] text-dimmed">{{
									row.original.fileName
								}}</span>
							</template>
							<template #empty>
								<UEmpty
									icon="i-lucide-search-x"
									title="No matching events"
									description="Try clearing or changing your filters."
									variant="naked"
								/>
							</template>
						</UTable>
					</div>
				</section>
				<aside
					v-if="selected && detailsOpen && desktop"
					class="w-[420px] shrink-0 border-l border-default 2xl:w-[480px]"
					aria-label="Event inspector"
				>
					<EventDetail
						:event="selected"
						:related-events="relatedEvents"
						:session-events="sessionEvents"
						@close="detailsOpen = false"
						@follow="followId"
						@select="selectTimelineEvent"
					/>
				</aside>
			</div>
			<footer
				class="flex shrink-0 items-center justify-between gap-2 border-t border-default px-4 py-2 text-[10px] text-dimmed"
			>
				<span class="flex items-center gap-1"
					><UIcon name="i-lucide-shield-check" class="size-3" />Processed on your device</span
				><span>Sessions are saved only when you choose</span>
			</footer>
		</main>
		<USlideover
			v-if="selected && !desktop"
			v-model:open="detailsOpen"
			:close="false"
			title="Event details"
			description="Inspect event data and related events"
			class="max-w-2xl"
			><template #content
				><EventDetail
					:event="selected"
					:related-events="relatedEvents"
					:session-events="sessionEvents"
					@close="detailsOpen = false"
					@follow="followId"
					@select="selectTimelineEvent" /></template
		></USlideover>
	</div>
</template>
