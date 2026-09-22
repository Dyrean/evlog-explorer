<script setup lang="ts">
useHead({
	meta: [{ name: "viewport", content: "width=device-width, initial-scale=1" }],
	link: [{ rel: "icon", href: "/favicon.ico" }],
	htmlAttrs: { lang: "en" },
});

useSeoMeta({
	title: "Evlog Explorer",
	description: "Explore evlog structured logs privately in your browser.",
});
</script>

<template>
	<UApp>
		<NuxtPage />
	</UApp>
</template>
