import type { LogEventView } from "~/types/log";

export interface SessionRequest {
	id: string;
	requestId?: string;
	method?: string;
	path?: string;
	status?: number;
	duration?: number;
	startedAt?: number;
	event: LogEventView;
	events: LogEventView[];
}

/** Session events become one entry per request; uncorrelated requests stay separate. */
export function groupSessionRequests(events: readonly LogEventView[]): SessionRequest[] {
	const groups = new Map<string, LogEventView[]>();
	for (const event of events) {
		if (!event.requestId && !event.method && !event.path) continue;
		const key = event.requestId ? `request:${event.requestId}` : `event:${event.id}`;
		const group = groups.get(key);
		if (group) group.push(event);
		else groups.set(key, [event]);
	}
	return [...groups.entries()]
		.map(([id, group]) => {
			const ordered = [...group].sort(
				(a, b) => (a.timestamp ?? Infinity) - (b.timestamp ?? Infinity),
			);
			const latest = ordered.toReversed();
			const event =
				latest.find(item => item.status !== undefined) ??
				latest.find(item => item.method) ??
				latest[0]!;
			return {
				id,
				requestId: event.requestId,
				method: ordered.find(item => item.method)?.method,
				path: ordered.find(item => item.path)?.path,
				status: event.status,
				duration: latest.find(item => item.duration !== undefined)?.duration,
				startedAt: ordered[0]?.timestamp,
				event,
				events: ordered,
			};
		})
		.sort((a, b) => (a.startedAt ?? Infinity) - (b.startedAt ?? Infinity));
}
