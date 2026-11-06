<script setup lang="ts">
import { groupSessionRequests } from "~/utils/timeline";

import type { CorrelationField, LogEventView, LogLevel } from "~/types/log";

const props = defineProps<{
	event: LogEventView;
	relatedEvents?: LogEventView[];
	sessionEvents?: LogEventView[];
}>();

const emit = defineEmits<{
	close: [];
	follow: [field: CorrelationField, value: string];
	select: [event: LogEventView, scope?: "session"];
}>();

const toast = useToast();
const tab = ref("event");
const timelineLimit = ref(100);
const sessionRequests = computed(() => groupSessionRequests(props.sessionEvents ?? []));
watch(
	() => props.event.sessionId,
	value => {
		if (!value && tab.value === "session") tab.value = "event";
	},
);
watch(
	() => props.relatedEvents?.[0]?.id,
	() => {
		timelineLimit.value = 100;
	},
);
function gap(index: number): string {
	const previous = props.relatedEvents?.[index - 1]?.timestamp;
	const current = props.relatedEvents?.[index]?.timestamp;
	return previous === undefined || current === undefined
		? ""
		: `+${formatDuration(current - previous)}`;
}
const levelColors = {
	trace: "neutral",
	debug: "info",
	info: "info",
	warn: "warning",
	error: "error",
	fatal: "error",
	unknown: "neutral",
} as const;

const contextSections = computed(() =>
	Object.entries(props.event.raw)
		.filter(([, value]) => typeof value === "object" && value !== null)
		.filter(([key]) => !["why", "fix"].includes(key)),
);

function statusColor(status?: number): "success" | "info" | "warning" | "error" | "neutral" {
	if (!status) return "neutral";
	if (status >= 500) return "error";
	if (status >= 400) return "warning";
	if (status >= 300) return "info";
	return "success";
}

function formatDuration(duration?: number): string {
	if (duration === undefined) return "—";
	return duration >= 1000
		? `${(duration / 1000).toFixed(2)} s`
		: `${duration.toFixed(duration < 10 ? 1 : 0)} ms`;
}

function display(value: unknown): string {
	return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function copyJson(): Promise<void> {
	try {
		await navigator.clipboard.writeText(JSON.stringify(props.event.raw, null, 2));
		toast.add({ title: "Event JSON copied", color: "success", icon: "i-lucide-check" });
	} catch {
		toast.add({ title: "Could not copy event", color: "error" });
	}
}

function levelColor(level: LogLevel): (typeof levelColors)[LogLevel] {
	return levelColors[level];
}
</script>

<template>
	<article class="explorer-inspector flex h-full min-h-0 w-full flex-col">
		<header
			class="explorer-inspector-header flex items-start justify-between gap-3 border-b border-default px-4 py-4"
		>
			<div class="min-w-0">
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<UBadge :color="levelColor(event.level)" variant="subtle" size="sm">
						{{ event.level.toUpperCase() }}
					</UBadge>
					<UBadge v-if="event.method" color="neutral" variant="outline" size="sm" class="font-mono">
						{{ event.method }}
					</UBadge>
					<UBadge
						v-if="event.status"
						:color="statusColor(event.status)"
						variant="subtle"
						size="sm"
						class="font-mono"
					>
						{{ event.status }}
					</UBadge>
					<span v-if="event.duration !== undefined" class="font-mono text-xs text-muted">{{
						formatDuration(event.duration)
					}}</span>
				</div>
				<h2 class="text-sm font-semibold break-all text-highlighted">
					{{ event.path || event.message || "Log event" }}
				</h2>
				<div class="mt-1"><EventTimestamp :timestamp="event.timestamp" full /></div>
			</div>
			<div class="flex shrink-0">
				<UTooltip text="Copy JSON">
					<UButton
						icon="i-lucide-copy"
						color="neutral"
						variant="ghost"
						size="xs"
						aria-label="Copy event JSON"
						@click="copyJson"
					/>
				</UTooltip>
				<UButton
					icon="i-lucide-x"
					color="neutral"
					variant="ghost"
					size="xs"
					aria-label="Close details"
					@click="emit('close')"
				/>
			</div>
		</header>

		<div
			class="flex shrink-0 flex-wrap gap-2 border-b border-default px-4 py-2"
			role="group"
			aria-label="Inspector view"
		>
			<UButton
				label="Event data"
				:aria-pressed="tab === 'event'"
				:variant="tab === 'event' ? 'soft' : 'ghost'"
				:color="tab === 'event' ? 'primary' : 'neutral'"
				size="xs"
				@click="tab = 'event'"
			/>
			<UButton
				:label="`Request timeline (${relatedEvents?.length ?? 0})`"
				:aria-pressed="tab === 'timeline'"
				:variant="tab === 'timeline' ? 'soft' : 'ghost'"
				:color="tab === 'timeline' ? 'primary' : 'neutral'"
				size="xs"
				@click="tab = 'timeline'"
			/>
			<UButton
				v-if="event.sessionId"
				:label="`Session timeline (${sessionRequests.length})`"
				:aria-pressed="tab === 'session'"
				:variant="tab === 'session' ? 'soft' : 'ghost'"
				:color="tab === 'session' ? 'primary' : 'neutral'"
				size="xs"
				@click="tab = 'session'"
			/>
		</div>
		<div v-if="tab === 'session' && event.sessionId" class="min-h-0 flex-1 overflow-auto p-4">
			<SessionTimeline
				:requests="sessionRequests"
				:event-count="sessionEvents?.length ?? 0"
				:selected-id="event.id"
				:session-id="event.sessionId"
				@select="emit('select', $event, 'session')"
			/>
		</div>
		<div v-else-if="tab === 'timeline'" class="min-h-0 flex-1 overflow-auto p-4">
			<p class="mb-4 text-xs leading-5 text-muted">
				Related events across all loaded files, ordered oldest first. Time gaps are relative to the
				previous event.
			</p>
			<p v-if="!relatedEvents?.length" class="text-sm text-muted">
				This event has no request or trace ID to correlate.
			</p>
			<ol v-else class="space-y-1 border-l border-default pl-3">
				<li v-for="(item, index) in relatedEvents.slice(0, timelineLimit)" :key="item.id">
					<button
						class="w-full rounded-lg border p-3 text-left transition-colors hover:bg-elevated"
						:class="item.id === event.id ? 'border-primary/40 bg-primary/5' : 'border-transparent'"
						:aria-current="item.id === event.id ? 'true' : undefined"
						@click="emit('select', item)"
					>
						<div class="mb-1 flex items-center justify-between gap-2">
							<span
								class="text-[10px] font-semibold uppercase"
								:class="
									item.level === 'error' || item.level === 'fatal' ? 'text-error' : 'text-muted'
								"
								>{{ item.level }}</span
							><span class="font-mono text-[10px] text-muted">{{ gap(index) }}</span>
						</div>
						<p class="text-xs font-medium break-words text-highlighted">
							{{ item.message || item.path || "Log event" }}
						</p>
						<div class="mt-2"><EventTimestamp :timestamp="item.timestamp" /></div>
					</button>
				</li>
			</ol>
			<UButton
				v-if="relatedEvents && relatedEvents.length > timelineLimit"
				label="Show 100 more events"
				variant="outline"
				color="neutral"
				size="xs"
				class="mt-3"
				@click="timelineLimit += 100"
			/>
		</div>
		<div v-else class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
			<section
				v-if="event.requestId || event.traceId || event.sessionId || event.userId"
				class="grid gap-2 rounded-lg border border-default bg-elevated/30 p-3 text-xs"
			>
				<div v-if="event.requestId" class="flex items-center justify-between gap-3">
					<span class="text-muted">Request ID</span
					><button
						class="min-w-0 truncate font-mono text-primary underline decoration-primary/30 underline-offset-4"
						:title="`Show all events for ${event.requestId}`"
						@click="
							emit('follow', 'requestId', event.requestId);
							tab = 'timeline';
						"
					>
						{{ event.requestId }}
					</button>
				</div>
				<div v-if="event.traceId" class="flex items-center justify-between gap-3">
					<span class="text-muted">Trace ID</span
					><button
						class="min-w-0 truncate font-mono text-primary underline decoration-primary/30 underline-offset-4"
						:title="`Show all events for ${event.traceId}`"
						@click="
							emit('follow', 'traceId', event.traceId);
							tab = 'timeline';
						"
					>
						{{ event.traceId }}
					</button>
				</div>
				<div v-if="event.sessionId" class="flex items-center justify-between gap-3">
					<span class="shrink-0 text-muted">Session ID</span
					><button
						class="min-w-0 truncate font-mono text-primary underline decoration-primary/30 underline-offset-4"
						:title="`Show session ${event.sessionId}`"
						@click="
							emit('follow', 'sessionId', event.sessionId);
							tab = 'session';
						"
					>
						{{ event.sessionId }}
					</button>
				</div>
				<div v-if="event.userId" class="flex items-center justify-between gap-3">
					<span class="text-muted">User ID</span
					><code class="truncate text-highlighted">{{ event.userId }}</code>
				</div>
			</section>

			<section v-if="event.message">
				<h3 class="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">
					Message
				</h3>
				<p class="text-sm leading-6 text-highlighted">
					{{ event.message }}
				</p>
			</section>

			<UAlert
				v-if="event.why !== undefined"
				color="error"
				variant="subtle"
				icon="i-lucide-circle-help"
				title="Why it happened"
				:description="display(event.why)"
				:ui="{ description: 'whitespace-pre-wrap font-mono text-xs' }"
			/>
			<UAlert
				v-if="event.fix !== undefined"
				color="success"
				variant="subtle"
				icon="i-lucide-wrench"
				title="Suggested fix"
				:description="display(event.fix)"
				:ui="{ description: 'whitespace-pre-wrap font-mono text-xs' }"
			/>

			<section v-for="[name, value] in contextSections" :key="name">
				<h3 class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
					{{ name }}
				</h3>
				<div class="explorer-json">
					<JsonInspector :value="value" />
				</div>
			</section>

			<section>
				<h3 class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
					All event data
				</h3>
				<div class="explorer-json">
					<JsonInspector :value="event.raw" />
				</div>
			</section>

			<p class="border-t border-default pt-3 text-[11px] text-dimmed">
				{{ event.fileName
				}}<template v-if="event.lineNumber"> · line {{ event.lineNumber }} </template>
			</p>
		</div>
	</article>
</template>
