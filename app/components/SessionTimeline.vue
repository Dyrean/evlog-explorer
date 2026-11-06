<script setup lang="ts">
import type { LogEventView } from "~/types/log";
import type { SessionRequest } from "~/utils/timeline";
const props = defineProps<{
	requests: SessionRequest[];
	eventCount: number;
	selectedId: string;
	sessionId: string;
}>();
const emit = defineEmits<{ select: [event: LogEventView] }>();
const visibleCount = ref(50);
watch(
	() => props.sessionId,
	() => {
		visibleCount.value = 50;
	},
);
function duration(value: number): string {
	return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value)} ms`;
}
function gap(index: number): string {
	const before = props.requests[index - 1]?.startedAt;
	const current = props.requests[index]?.startedAt;
	if (before === undefined || current === undefined) return "";
	const elapsed = current - before;
	if (elapsed >= 3_600_000) return `+${Number((elapsed / 3_600_000).toFixed(1))} h`;
	if (elapsed >= 60_000) return `+${Number((elapsed / 60_000).toFixed(1))} min`;
	return `+${duration(elapsed)}`;
}
function color(status?: number) {
	return status === undefined
		? "neutral"
		: status >= 500
			? "error"
			: status >= 400
				? "warning"
				: status >= 300
					? "info"
					: "success";
}
</script>

<template>
	<div class="space-y-4">
		<div>
			<p class="text-xs font-medium text-highlighted">
				Session <code class="break-all text-primary">{{ sessionId }}</code>
			</p>
			<p class="mt-1 text-xs leading-5 text-muted">
				{{ requests.length }} requests · {{ eventCount }} session events across all loaded files.
				Oldest first; gaps are between request start times.
			</p>
		</div>
		<p v-if="!requests.length" class="text-sm text-muted">
			No requests were found in the events with this session ID.
		</p>
		<ol v-else class="space-y-3 border-l border-default pl-3">
			<li
				v-for="(request, index) in requests.slice(0, visibleCount)"
				:key="request.id"
				class="overflow-hidden rounded-xl border bg-default"
				:class="
					request.events.some(item => item.id === selectedId)
						? 'border-primary/40'
						: 'border-default'
				"
			>
				<button
					type="button"
					class="w-full space-y-2 p-3 text-left hover:bg-elevated/50"
					:aria-label="`Inspect request ${request.requestId || request.path || index + 1}`"
					@click="emit('select', request.event)"
				>
					<div class="flex items-center justify-between gap-2">
						<span class="font-mono text-xs font-semibold text-highlighted">{{
							request.method || "REQUEST"
						}}</span
						><span class="font-mono text-[10px] text-muted">{{ gap(index) }}</span>
					</div>
					<p class="font-mono text-xs break-all text-highlighted">
						{{ request.path || request.event.message || request.requestId }}
					</p>
					<div class="flex flex-wrap items-center gap-2">
						<UBadge
							v-if="request.status !== undefined"
							:color="color(request.status)"
							variant="subtle"
							size="sm"
							>{{ request.status }}</UBadge
						><span v-if="request.duration !== undefined" class="font-mono text-[11px] text-muted">{{
							duration(request.duration)
						}}</span
						><code v-if="request.requestId" class="text-[10px] break-all text-muted">{{
							request.requestId
						}}</code>
					</div>
				</button>
				<div class="px-3 pb-3"><EventTimestamp :timestamp="request.startedAt" full /></div>
				<details class="border-t border-default px-3 py-2">
					<summary class="cursor-pointer text-xs text-muted">
						{{ request.events.length }} logged events
					</summary>
					<ul class="mt-2 space-y-1">
						<li v-for="item in request.events.slice(0, 100)" :key="item.id">
							<button
								type="button"
								class="w-full rounded-md p-2 text-left text-xs hover:bg-elevated"
								:class="item.id === selectedId ? 'bg-primary/10 text-primary' : 'text-toned'"
								@click="emit('select', item)"
							>
								<span class="mr-2 font-mono text-[10px] uppercase">{{ item.level }}</span
								>{{ item.message || item.path || "Log event" }}
							</button>
						</li>
					</ul>
					<p v-if="request.events.length > 100" class="mt-2 text-xs text-muted">
						Showing the first 100 events. Select this request and open Request timeline to browse
						all events.
					</p>
				</details>
			</li>
		</ol>
		<UButton
			v-if="requests.length > visibleCount"
			label="Show 50 more requests"
			color="neutral"
			variant="outline"
			size="xs"
			@click="visibleCount += 50"
		/>
	</div>
</template>
