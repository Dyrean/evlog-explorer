# Evlog Explorer

A local-first structured log explorer for [`evlog`](https://github.com/haydenbleasel/evlog), built with Nuxt 4 and Nuxt UI.

Import `.json`, `.jsonl`, or `.ndjson` files to search, filter, sort, correlate, and inspect events. Files are parsed entirely in your browser—there is no backend, upload, server database, or analytics.

## Exploring logs

- Try **Explore sample logs** to investigate a simulated checkout incident.
- Search unquoted text fuzzily, or use `"payment provider"` for a literal phrase.
- Combine exact fields and numeric comparisons: `status:503 duration>1000`,
  `request:req-001`, or `user.id:user-1`. Durations are milliseconds; field names
  follow the original JSON casing. Predicates combine with AND.
- Open an event and click its request or trace ID to follow related events across
  files. The timeline includes all related imported events, independent of other
  filters, in chronological order.
- Session IDs logged as `session.id`, `sessionId`, `session_id`, `context.sessionId`,
  `context.session.id`, or `sid` are recognized. Click **Session ID** in an event
  to see a chronological request timeline, with each request's logged events.
  Search with `session:sess-local-001` or use the exact Session ID filter.
  Log the decoded JWT `sid` as a session field; the explorer reads the logged ID.
  The timeline uses events carrying that ID across loaded files. Events without
  a request ID stay separate rather than being guessed into a request.
- Relative time filters end at the newest imported event. Custom interval inputs
  use your device's local timezone; the UTC toggle changes displayed timestamps.
- Export matching events as NDJSON, or save named filter views on this device.
  Views exclude file selection and request/trace correlation.
- **Save session on this device** stores logs explicitly in IndexedDB. Restore
  from the start screen and delete saved data through the session actions menu.
  Clearing loaded logs does not delete a saved session.

Parsing runs in a cancellable web worker, with progress by file. Files and
normalized events still need to fit in browser memory; imports are committed
only after the batch finishes. Malformed entries are reported while valid ones
are retained. No logs are persisted unless you save a session; saved views may
contain search text or IDs you entered.

## Run locally

```bash
pnpm install
pnpm dev
```

Open `http://localhost:3000`.

## Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```
