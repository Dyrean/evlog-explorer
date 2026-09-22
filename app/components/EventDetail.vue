<script setup lang="ts">
import type { LogEventView, LogLevel } from "~/types/log";

const props = defineProps<{
	event: LogEventView;
}>();

const emit = defineEmits<{
	close: [];
}>();

const toast = useToast();
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
	<article class="flex h-full min-h-0 w-full flex-col bg-default">
		<header class="flex items-start justify-between gap-3 border-b border-default px-4 py-3">
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

		<div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
			<section
				v-if="event.requestId || event.traceId || event.userId"
				class="grid gap-2 rounded-lg border border-default bg-elevated/30 p-3 text-xs"
			>
				<div v-if="event.requestId" class="flex items-center justify-between gap-3">
					<span class="text-muted">Request ID</span
					><code class="truncate text-highlighted">{{ event.requestId }}</code>
				</div>
				<div v-if="event.traceId" class="flex items-center justify-between gap-3">
					<span class="text-muted">Trace ID</span
					><code class="truncate text-highlighted">{{ event.traceId }}</code>
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
				<div class="rounded-lg border border-default bg-elevated/20 p-3">
					<JsonInspector :value="value" />
				</div>
			</section>

			<section>
				<h3 class="mb-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
					All event data
				</h3>
				<div class="rounded-lg border border-default bg-elevated/20 p-3">
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
