<script setup lang="ts">
import { useFuse } from "@vueuse/integrations/useFuse";
import { h, resolveComponent } from "vue";

import { parseLogText, toLogEventView } from "~/utils/log";

import type { TableColumn, TableRow } from "@nuxt/ui";
import type { ImportedLogEvent, ImportError, LogEventView, LogLevel } from "~/types/log";

type StatusFilter = "all" | "2xx" | "3xx" | "4xx" | "5xx";
type TimeFilter = "all" | "15m" | "1h" | "24h" | "7d";

const slowThreshold = ref(1000);
const importing = ref(false);
const toast = useToast();
const fileInput = ref<HTMLInputElement>();
const events = shallowRef<LogEventView[]>([]);
const loadedFiles = ref<{ id: string; name: string; eventCount: number }[]>([]);
const importErrors = ref<ImportError[]>([]);
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
];
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
		search.value = value.trim().toLowerCase();
	}, 150);
});
let disposed = false;
onBeforeUnmount(() => {
	clearTimeout(searchTimer);
	disposed = true;
});

const fileOptions = computed(() => [
	{ label: "All files", value: "all" },
	...loadedFiles.value.map(item => ({ label: item.name, value: item.id })),
]);
const methodOptions = computed(() => [
	"all",
	...new Set(
		events.value.map(event => event.method).filter((value): value is string => Boolean(value)),
	),
]);
const maxTimestamp = computed(() =>
	events.value.reduce((latest, event) => Math.max(latest, event.timestamp ?? -Infinity), -Infinity),
);
const hasTimestamps = computed(() => Number.isFinite(maxTimestamp.value));

const filterableEvents = computed(() =>
	events.value.filter(event => {
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
		if (timeRange.value !== "all") {
			const ranges: Record<Exclude<TimeFilter, "all">, number> = {
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
const { results: searchResults } = useFuse(search, filterableEvents, {
	matchAllWhenSearchEmpty: true,
	fuseOptions: { keys: ["searchText"], threshold: 0.25, ignoreLocation: true },
});
const filteredEvents = computed(() => searchResults.value.map(result => result.item));

const stats = computed(() => {
	const errors = events.value.filter(
		event => event.level === "error" || event.level === "fatal",
	).length;
	const warnings = events.value.filter(event => event.level === "warn").length;
	const requests = events.value.filter(event => Boolean(event.method)).length;
	const slow = events.value.filter(
		event => event.method && (event.duration ?? -1) >= slowThreshold.value,
	).length;
	const durations = events.value.flatMap(event =>
		event.duration === undefined ? [] : [event.duration],
	);
	const average = durations.length
		? durations.reduce((sum, value) => sum + value, 0) / durations.length
		: undefined;
	return { errors, warnings, requests, slow, average };
});

const activeFilterCount = computed(
	() =>
		[
			level.value !== "all",
			file.value !== "all",
			method.value !== "all",
			status.value !== "all",
			duration.value !== 0,
			timeRange.value !== "all",
			Boolean(requestId.value),
			Boolean(search.value),
		].filter(Boolean).length,
);

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

function selectEvent(_event: Event, row: TableRow<LogEventView>): void {
	selected.value = row.original;
	detailsOpen.value = true;
}

function applyPreset(preset: "errors" | "warnings" | "slow" | "4xx" | "5xx"): void {
	clearFilters();
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
}

function clearLogs(): void {
	if (importing.value) return;
	detailsOpen.value = false;
	events.value = [];
	loadedFiles.value = [];
	importErrors.value = [];
	selected.value = undefined;
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

async function importFiles(value: File[] | File | null | undefined): Promise<void> {
	const files = value ? (Array.isArray(value) ? value : [value]) : [];
	if (!files.length || importing.value) return;
	importing.value = true;

	try {
		let imported = 0;
		const newEvents: LogEventView[] = [];
		const newFiles: { id: string; name: string; eventCount: number }[] = [];
		const newErrors: ImportError[] = [];

		for (const sourceFile of files) {
			const fileIndex = loadedFiles.value.length + newFiles.length;
			try {
				// ponytail: files are parsed in memory; move parsing to a worker for very large files.
				const source = await sourceFile.text();
				if (disposed) return;
				const result = parseLogText(sourceFile.name, source);
				const fileEvents = result.events.map(event =>
					toLogEventView({
						...event,
						id: crypto.randomUUID(),
						fileIndex,
					} satisfies ImportedLogEvent),
				);
				for (const event of fileEvents) newEvents.push(event);
				for (const error of result.errors) newErrors.push(error);
				if (fileEvents.length) {
					imported += fileEvents.length;
					newFiles.push({
						id: String(fileIndex),
						name: sourceFile.name,
						eventCount: fileEvents.length,
					});
				}
			} catch {
				if (disposed) return;
				newErrors.push({ fileName: sourceFile.name, message: "Could not read or process file" });
			}
		}

		events.value = [...events.value, ...newEvents];
		loadedFiles.value = [...loadedFiles.value, ...newFiles];
		importErrors.value = newErrors;

		if (imported)
			toast.add({
				title: `Imported ${imported.toLocaleString()} event${imported === 1 ? "" : "s"}`,
				description: `${newFiles.length} file${newFiles.length === 1 ? "" : "s"} processed locally`,
				color: "success",
				icon: "i-lucide-check-circle",
			});
		if (newErrors.length)
			toast.add({
				title: `${newErrors.length} entr${newErrors.length === 1 ? "y" : "ies"} could not be parsed`,
				description: imported
					? "Valid events were imported. See the parsing notice for details."
					: "No events imported. See the parsing notice for details.",
				color: "warning",
				icon: "i-lucide-triangle-alert",
			});
		if (!imported && !newErrors.length) toast.add({ title: "No events found", color: "warning" });
	} finally {
		importing.value = false;
	}
}
</script>

<template>
	<div class="flex h-dvh min-h-[560px] flex-col overflow-hidden bg-default">
		<header
			class="flex h-14 shrink-0 items-center justify-between border-b border-default px-3 sm:px-5"
		>
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-8 items-center justify-center rounded-lg bg-primary text-inverted shadow-sm shadow-primary/20"
				>
					<UIcon name="i-lucide-activity" class="size-4" />
				</div>
				<div class="min-w-0">
					<h1 class="truncate text-sm font-semibold text-highlighted">Evlog Explorer</h1>
					<p class="hidden text-[11px] text-dimmed sm:block">Local structured log analysis</p>
				</div>
				<template v-if="events.length">
					<USeparator orientation="vertical" class="mx-1 h-5" />
					<span class="hidden text-xs text-muted md:inline">{{ loadedFiles.length }} files</span>
					<UBadge color="neutral" variant="subtle" size="sm">
						{{ events.length.toLocaleString() }} events
					</UBadge>
				</template>
			</div>

			<div class="flex items-center gap-1">
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
					label="Import logs"
					:loading="importing"
					size="sm"
					@click="openFilePicker"
				/>
				<UTooltip v-if="events.length" text="Clear all logs">
					<UButton
						icon="i-lucide-trash-2"
						color="neutral"
						variant="ghost"
						size="sm"
						aria-label="Clear all logs"
						:disabled="importing"
						@click="clearLogs"
					/>
				</UTooltip>
				<UColorModeButton size="sm" />
			</div>
		</header>

		<UAlert
			v-if="!events.length && importErrors.length"
			color="warning"
			title="No valid events imported"
			class="shrink-0"
		>
			<template #description>
				<ul class="max-h-28 overflow-auto text-xs">
					<li v-for="(issue, index) in importErrors" :key="index">
						{{ issue.fileName }}{{ issue.lineNumber ? `:${issue.lineNumber}` : "" }} —
						{{ issue.message }}
					</li>
				</ul>
			</template>
		</UAlert>

		<main v-if="!events.length" class="grid min-h-0 flex-1 place-items-center overflow-y-auto p-6">
			<div class="w-full max-w-xl">
				<UEmpty
					icon="i-lucide-file-search-2"
					title="Import evlog files"
					description="Drop evlog files here or choose files to start exploring. Your logs are processed locally and never uploaded."
					variant="naked"
					size="lg"
				>
					<template #body>
						<UFileUpload
							multiple
							accept=".json,.jsonl,.ndjson,application/json"
							label="Drop files here"
							description="JSON, JSONL, or NDJSON · processed in this browser"
							icon="i-lucide-cloud-upload"
							class="mt-5 min-h-48 w-full"
							:preview="false"
							:disabled="importing"
							reset
							@update:model-value="importFiles"
						/>
						<div class="mt-4 flex items-center justify-center gap-2 text-xs text-dimmed">
							<UIcon name="i-lucide-shield-check" class="size-4 text-success" />
							No backend · no uploads · no analytics
						</div>
					</template>
				</UEmpty>
			</div>
		</main>

		<main v-else class="flex min-h-0 flex-1 flex-col">
			<section class="shrink-0 border-b border-default bg-elevated/20 px-3 py-3 sm:px-4">
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
					<button
						type="button"
						class="rounded-lg border border-default bg-default px-3 py-2 text-left hover:border-accented hover:bg-elevated"
						@click="clearFilters"
					>
						<span class="text-[10px] font-medium tracking-wide text-dimmed uppercase"
							>Total events</span
						>
						<strong class="mt-0.5 block text-lg text-highlighted">{{
							events.length.toLocaleString()
						}}</strong>
					</button>
					<button
						type="button"
						class="rounded-lg border border-default bg-default px-3 py-2 text-left hover:border-error/50"
						@click="applyPreset('errors')"
					>
						<span
							class="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-dimmed uppercase"
							><span class="size-1.5 rounded-full bg-error" />Errors</span
						>
						<strong class="mt-0.5 block text-lg text-error">{{
							stats.errors.toLocaleString()
						}}</strong>
					</button>
					<button
						type="button"
						class="rounded-lg border border-default bg-default px-3 py-2 text-left hover:border-warning/50"
						@click="applyPreset('warnings')"
					>
						<span
							class="flex items-center gap-1.5 text-[10px] font-medium tracking-wide text-dimmed uppercase"
							><span class="size-1.5 rounded-full bg-warning" />Warnings</span
						>
						<strong class="mt-0.5 block text-lg text-warning">{{
							stats.warnings.toLocaleString()
						}}</strong>
					</button>
					<div class="rounded-lg border border-default bg-default px-3 py-2">
						<span class="text-[10px] font-medium tracking-wide text-dimmed uppercase"
							>Requests</span
						>
						<strong class="mt-0.5 block text-lg text-highlighted">{{
							stats.requests.toLocaleString()
						}}</strong>
					</div>
					<button
						type="button"
						class="rounded-lg border border-default bg-default px-3 py-2 text-left hover:border-warning/50"
						@click="applyPreset('slow')"
					>
						<span class="text-[10px] font-medium tracking-wide text-dimmed uppercase"
							>Slow ≥ {{ formatDuration(slowThreshold) }}</span
						>
						<strong class="mt-0.5 block text-lg text-highlighted">{{
							stats.slow.toLocaleString()
						}}</strong>
					</button>
					<div class="rounded-lg border border-default bg-default px-3 py-2">
						<span class="text-[10px] font-medium tracking-wide text-dimmed uppercase"
							>Avg duration</span
						>
						<strong class="mt-0.5 block font-mono text-lg text-highlighted">{{
							formatDuration(stats.average)
						}}</strong>
					</div>
				</div>
			</section>

			<section class="shrink-0 space-y-2 border-b border-default px-3 py-2.5 sm:px-4">
				<div class="flex flex-wrap items-center gap-2">
					<UInput
						v-model="searchInput"
						icon="i-lucide-search"
						placeholder="Fuzzy search every field…"
						aria-label="Search all event fields"
						size="sm"
						class="min-w-52 flex-1"
						:ui="{ base: 'font-mono' }"
					/>
					<USelect
						v-model="level"
						:items="levelOptions"
						size="sm"
						class="w-28"
						aria-label="Level filter"
					/>
					<USelect
						v-model="file"
						:items="fileOptions"
						value-key="value"
						size="sm"
						class="w-40"
						aria-label="File filter"
					/>
					<USelect
						v-model="method"
						:items="methodOptions"
						size="sm"
						class="w-28"
						aria-label="Method filter"
					/>
					<USelect
						v-model="status"
						:items="statusOptions"
						value-key="value"
						size="sm"
						class="w-32"
						aria-label="Status filter"
					/>
					<USelect
						v-model="duration"
						:items="durationOptions"
						value-key="value"
						size="sm"
						class="w-36"
						aria-label="Duration filter"
					/>
					<USelect
						v-if="hasTimestamps"
						v-model="timeRange"
						:items="timeOptions"
						value-key="value"
						size="sm"
						class="w-34"
						aria-label="Time range relative to newest imported event"
						title="Relative to the newest imported event"
					/>
					<UDropdownMenu
						:items="[
							[
								{
									label: 'Errors',
									icon: 'i-lucide-circle-x',
									onSelect: () => applyPreset('errors'),
								},
								{
									label: 'Warnings',
									icon: 'i-lucide-triangle-alert',
									onSelect: () => applyPreset('warnings'),
								},
								{
									label: 'Slow requests',
									icon: 'i-lucide-timer',
									onSelect: () => applyPreset('slow'),
								},
								{ label: '4xx responses', onSelect: () => applyPreset('4xx') },
								{ label: '5xx responses', onSelect: () => applyPreset('5xx') },
							],
						]"
					>
						<UButton
							label="Presets"
							icon="i-lucide-zap"
							color="neutral"
							variant="outline"
							size="sm"
						/>
					</UDropdownMenu>
				</div>
				<div class="flex min-h-7 flex-wrap items-center gap-1.5">
					<span class="mr-1 text-[11px] text-dimmed"
						>{{ filteredEvents.length.toLocaleString() }} shown</span
					>
					<label class="flex items-center gap-2 text-xs text-muted">
						Slow threshold (ms)
						<UInputNumber v-model="slowThreshold" :min="0" :step="100" size="xs" class="w-32" />
					</label>
					<UInput
						v-model="requestId"
						icon="i-lucide-git-branch"
						placeholder="Request ID"
						aria-label="Filter by request ID"
						size="xs"
						class="w-40"
					/>
					<UBadge
						v-if="level !== 'all'"
						:color="level === 'errors' ? 'error' : levelColors[level]"
						variant="subtle"
						size="sm"
					>
						level: {{ level }}
					</UBadge>
					<UBadge
						v-if="status !== 'all'"
						:color="statusColor(Number(status[0]) * 100)"
						variant="subtle"
						size="sm"
					>
						status: {{ status }}
					</UBadge>
					<UBadge v-if="duration" color="warning" variant="subtle" size="sm">
						{{
							duration === "slow"
								? `Requests ≥ ${formatDuration(slowThreshold)}`
								: `Duration > ${formatDuration(duration)}`
						}}
					</UBadge>
					<UButton
						v-if="activeFilterCount"
						:label="`Clear filters (${activeFilterCount})`"
						icon="i-lucide-x"
						color="neutral"
						variant="ghost"
						size="xs"
						@click="clearFilters"
					/>
				</div>
				<UAlert
					v-if="importErrors.length"
					color="warning"
					variant="subtle"
					icon="i-lucide-triangle-alert"
					:title="`${importErrors.length} parsing issue${importErrors.length === 1 ? '' : 's'}`"
				>
					<template #description>
						<p class="mt-1 text-xs">
							Parsing issues: {{ importErrors[0]?.fileName
							}}{{ importErrors[0]?.lineNumber ? `:${importErrors[0].lineNumber}` : "" }} —
							{{ importErrors[0]?.message }}
						</p>
						<details v-if="importErrors.length > 1" class="mt-2 text-xs">
							<summary class="cursor-pointer font-medium">View all parsing issues</summary>
							<ul class="mt-1 max-h-28 list-disc space-y-1 overflow-y-auto pl-5 font-mono">
								<li
									v-for="(error, index) in importErrors"
									:key="`${error.fileName}-${error.lineNumber}-${index}`"
								>
									{{ error.fileName }}{{ error.lineNumber ? `:${error.lineNumber}` : "" }} —
									{{ error.message }}
								</li>
							</ul>
						</details>
					</template>
					<template #actions>
						<UButton
							label="Dismiss"
							color="warning"
							variant="ghost"
							size="xs"
							@click="importErrors = []"
						/>
					</template>
				</UAlert>
			</section>

			<div class="min-h-0 flex-1">
				<div class="h-full overflow-hidden">
					<UTable
						v-model:sorting="sorting"
						:data="filteredEvents"
						:columns="columns"
						:virtualize="{ estimateSize: 37, overscan: 15 }"
						:watch-options="{ deep: false }"
						:get-row-id="event => event.id"
						sticky
						class="h-full"
						:ui="{ th: 'px-3 py-2 text-[11px]', td: 'px-3 py-2 text-xs', tr: 'cursor-pointer' }"
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
			</div>
		</main>

		<USlideover
			v-if="selected"
			v-model:open="detailsOpen"
			:close="false"
			title="Event details"
			description="Inspect the original structured log event."
			class="max-w-2xl"
			@after:leave="!detailsOpen && (selected = undefined)"
		>
			<template #content>
				<EventDetail :event="selected" @close="detailsOpen = false" />
			</template>
		</USlideover>
	</div>
</template>
