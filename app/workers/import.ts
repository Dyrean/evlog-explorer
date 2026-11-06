/// <reference lib="webworker" />
import { parseLogText, toLogEventView } from "../utils/log";

import type { ImportError, LogEventView } from "../types/log";

self.addEventListener(
	"message",
	async (message: MessageEvent<{ files: File[]; startIndex: number }>) => {
		const events: LogEventView[] = [];
		const files: { id: string; name: string; eventCount: number }[] = [];
		const errors: ImportError[] = [];
		try {
			for (const [index, file] of message.data.files.entries()) {
				self.postMessage(
					{ type: "progress", name: file.name, completed: index, total: message.data.files.length },
					[],
				);
				try {
					const result = parseLogText(file.name, await file.text());
					const fileIndex = message.data.startIndex + files.length;
					for (const event of result.events)
						events.push(toLogEventView({ ...event, id: crypto.randomUUID(), fileIndex }));
					for (const error of result.errors) errors.push(error);
					if (result.events.length)
						files.push({
							id: String(fileIndex),
							name: file.name,
							eventCount: result.events.length,
						});
				} catch {
					errors.push({ fileName: file.name, message: "Could not read or process file" });
				}
			}
			self.postMessage({ type: "done", events, files, errors }, []);
		} catch {
			self.postMessage({ type: "error" }, []);
		}
	},
);
