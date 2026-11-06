<script setup lang="ts">
import { formatRelativeTime } from "~/utils/time";

const props = defineProps<{ timestamp?: number; full?: boolean }>();
const now = ref(Date.now());
const utc = inject("logUtc", ref(false));
const date = computed(() =>
	props.timestamp === undefined ? undefined : new Date(props.timestamp),
);
const label = computed(() => {
	if (!date.value) return "—";
	return props.full
		? date.value.toLocaleString(undefined, {
				dateStyle: "medium",
				timeStyle: "medium",
				timeZone: utc.value ? "UTC" : undefined,
			})
		: date.value.toLocaleTimeString(undefined, {
				hour12: false,
				timeZone: utc.value ? "UTC" : undefined,
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit",
				fractionalSecondDigits: 3,
			});
});
const tooltip = computed(() =>
	props.timestamp === undefined
		? ""
		: `${formatRelativeTime(props.timestamp, now.value)} · ${date.value?.toISOString()}`,
);
</script>

<template>
	<UTooltip v-if="date" :text="tooltip" @update:open="now = Date.now()">
		<time
			:datetime="date.toISOString()"
			tabindex="0"
			class="cursor-help font-mono text-[11px] text-muted"
			>{{ label }}</time
		>
	</UTooltip>
	<span v-else class="font-mono text-[11px] text-muted">—</span>
</template>
