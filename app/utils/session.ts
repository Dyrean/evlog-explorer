/** Explicitly saved sessions stay in this browser's IndexedDB. */
export async function sessionStore(
	action: "save" | "load" | "delete" | "exists",
	value?: unknown,
): Promise<unknown> {
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open("evlog-explorer", 1);
		request.addEventListener("upgradeneeded", () => request.result.createObjectStore("sessions"));
		request.addEventListener("success", () => resolve(request.result));
		request.addEventListener("error", () => reject(request.error));
	});
	try {
		return await new Promise((resolve, reject) => {
			const transaction = db.transaction(
				"sessions",
				action === "load" || action === "exists" ? "readonly" : "readwrite",
			);
			const store = transaction.objectStore("sessions");
			const request =
				action === "exists"
					? store.count("latest")
					: action === "load"
						? store.get("latest")
						: action === "save"
							? store.put(value, "latest")
							: store.delete("latest");
			transaction.addEventListener("complete", () => resolve(request.result));
			transaction.addEventListener("error", () => reject(transaction.error));
			transaction.addEventListener("abort", () => reject(transaction.error));
		});
	} finally {
		db.close();
	}
}
