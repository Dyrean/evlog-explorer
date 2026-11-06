export default defineAppConfig({
	ui: {
		colors: {
			primary: "teal",
			neutral: "slate",
			success: "emerald",
			info: "blue",
			warning: "amber",
			error: "rose",
		},
		button: {
			slots: {
				base: "rounded-lg font-medium motion-reduce:transition-none",
				leadingIcon: "size-4",
				trailingIcon: "size-4",
			},
			compoundVariants: [
				{
					color: "neutral",
					variant: "outline",
					class: "bg-default ring-default hover:bg-elevated hover:ring-accented",
				},
				{ color: "neutral", variant: "soft", class: "bg-elevated text-toned hover:bg-accented" },
				{
					color: "primary",
					variant: "solid",
					class:
						"shadow-xs hover:bg-(--explorer-primary-hover) active:bg-(--explorer-primary-active)",
				},
			],
		},
		input: { slots: { base: "rounded-lg placeholder:text-dimmed", leadingIcon: "text-muted" } },
		inputNumber: { slots: { base: "rounded-lg tabular-nums" } },
		select: {
			slots: {
				base: "rounded-lg",
				content: "rounded-xl shadow-xl",
				item: "data-highlighted:not-data-disabled:before:bg-primary/8",
				itemTrailingIcon: "text-primary",
			},
		},
		badge: {
			slots: { base: "font-semibold tracking-wide tabular-nums" },
			variants: { size: { sm: { base: "rounded-md px-1.5 py-0.5 text-[10px]/4" } } },
		},
		table: {
			slots: {
				thead: "bg-muted",
				th: "px-3 py-2.5 text-[11px] font-medium text-muted",
				td: "px-3 py-2 text-xs text-toned",
				tr: "data-[selectable=true]:cursor-pointer motion-safe:transition-colors",
				tbody: "divide-y divide-default/60 [&>tr]:data-[selectable=true]:hover:bg-elevated/60",
			},
			variants: {
				sticky: {
					true: { thead: "bg-muted" },
					header: { thead: "bg-muted" },
				},
			},
		},
		tooltip: {
			slots: {
				content: "h-auto max-w-80 rounded-lg px-3 py-2 shadow-lg",
				text: "whitespace-normal text-pretty leading-5",
			},
		},
		dropdownMenu: { slots: { content: "rounded-xl shadow-xl", group: "p-1.5" } },
		fileUpload: {
			slots: {
				base: "rounded-2xl border-dashed bg-default hover:bg-primary/4 hover:border-primary/50",
				icon: "text-primary",
				label: "font-semibold text-highlighted",
			},
		},
		slideover: { slots: { overlay: "bg-slate-950/50 backdrop-blur-xs", content: "shadow-2xl" } },
		toast: { slots: { root: "rounded-xl shadow-xl", description: "text-xs leading-5" } },
		alert: { slots: { description: "opacity-100" } },
	},
});
