/** Format an epoch timestamp relative to `now` using the most useful human unit. */
export function formatRelativeTime(timestamp: number, now = Date.now()): string {
	const seconds = (timestamp - now) / 1000;
	const absolute = Math.abs(seconds);
	const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
		absolute < 60
			? [seconds, "second"]
			: absolute < 3600
				? [seconds / 60, "minute"]
				: absolute < 86_400
					? [seconds / 3600, "hour"]
					: absolute < 604_800
						? [seconds / 86_400, "day"]
						: absolute < 2_629_800
							? [seconds / 604_800, "week"]
							: absolute < 31_557_600
								? [seconds / 2_629_800, "month"]
								: [seconds / 31_557_600, "year"];

	return new Intl.RelativeTimeFormat("en", { numeric: "auto" }).format(Math.round(value), unit);
}
