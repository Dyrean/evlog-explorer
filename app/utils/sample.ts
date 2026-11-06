export function sampleLogs(): File {
	const start = Date.now() - 3_600_000;
	const events = Array.from({ length: 96 }, (_, index) => {
		const request = Math.floor(index / 4);
		const step = index % 4;
		const failed = request % 5 === 0;
		const slow = request % 7 === 0;
		return {
			timestamp: new Date(start + request * 120000 + step * 180).toISOString(),
			level: failed && step === 3 ? "error" : step === 2 && slow ? "warn" : "info",
			message: [
				"Request received",
				"User authenticated",
				slow ? "Database query exceeded budget" : "Database query completed",
				failed ? "Payment provider unavailable" : "Request completed",
			][step],
			requestId: `req-${String(request + 1).padStart(3, "0")}`,
			traceId: `trace-${request + 1}`,
			session: { id: `sess-demo-${(request % 4) + 1}` },
			user: { id: `user-${(request % 4) + 1}` },
			...(step === 3
				? {
						method: "POST",
						path: "/api/checkout",
						status: failed ? 503 : 200,
						duration: slow ? 1850 : 120 + request * 7,
					}
				: {}),
			...(failed && step === 3
				? {
						why: "The payment provider timed out after three attempts.",
						fix: "Check provider health and retry with the same idempotency key.",
						error: { code: "PROVIDER_TIMEOUT", attempts: 3 },
					}
				: {}),
		};
	});
	return new File(
		[events.map(event => JSON.stringify(event)).join("\n")],
		"sample-checkout.ndjson",
		{ type: "application/x-ndjson" },
	);
}
