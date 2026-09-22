<script setup lang="ts">
defineOptions({ name: "JsonInspector" });

const props = withDefaults(
	defineProps<{
		value: unknown;
		name?: string;
		depth?: number;
	}>(),
	{
		name: undefined,
		depth: 0,
	},
);

const open = ref(props.depth < 2);
const visibleCount = ref(100);
watch(
	() => props.value,
	() => {
		open.value = props.depth < 2;
		visibleCount.value = 100;
	},
);
const isObject = computed(() => typeof props.value === "object" && props.value !== null);
const entries = computed(() => {
	if (Array.isArray(props.value))
		return props.value.map((value, index) => [String(index), value] as const);
	if (typeof props.value === "object" && props.value !== null) return Object.entries(props.value);
	return [];
});
const preview = computed(() =>
	Array.isArray(props.value) ? `Array(${props.value.length})` : `{${entries.value.length}}`,
);
const primitiveClass = computed(() => {
	if (props.value === null) return "text-muted italic";
	if (typeof props.value === "string") return "text-success";
	if (typeof props.value === "number") return "text-info";
	if (typeof props.value === "boolean") return "text-warning";
	return "text-muted";
});
const primitive = computed(() =>
	typeof props.value === "string" ? `"${props.value}"` : String(props.value),
);
</script>

<template>
	<div class="font-mono text-xs leading-5">
		<button
			v-if="isObject"
			type="button"
			class="group flex max-w-full items-center gap-1 rounded px-0.5 text-left hover:bg-elevated"
			:aria-expanded="open"
			@click="open = !open"
		>
			<UIcon
				:name="open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
				class="size-3 shrink-0 text-dimmed"
			/>
			<span v-if="name" class="text-primary">{{ name }}</span>
			<span class="text-dimmed">{{ preview }}</span>
		</button>
		<div v-else class="flex max-w-full gap-2 px-0.5">
			<span v-if="name" class="max-w-1/2 break-all text-primary">{{ name }}:</span>
			<span :class="primitiveClass" class="break-all whitespace-pre-wrap">{{ primitive }}</span>
		</div>

		<div v-if="isObject && open" class="ml-2 border-l border-default pl-2">
			<JsonInspector
				v-for="([key, child], index) in entries.slice(0, visibleCount)"
				:key="`${key}-${index}`"
				:name="key"
				:value="child"
				:depth="depth + 1"
			/>
			<UButton
				v-if="entries.length > visibleCount"
				color="neutral"
				variant="ghost"
				size="xs"
				:label="`Show more (${entries.length - visibleCount} remaining)`"
				@click="visibleCount += 100"
			/>
			<span v-if="entries.length === 0" class="text-dimmed">empty</span>
		</div>
	</div>
</template>
