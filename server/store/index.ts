// The write path (docs/02-architecture.md, "The write path"; D7, D14): the one module that reads and writes the
// human-editable files in the data home (config.yaml, apps/<slug>.yaml, bookmarks/<group>.yaml, ignore.yaml). The
// HTTP API, the CLI and MCP all call it; nothing else writes those files. Atomic writes (tmp + rename), validation
// before writing, ETag/If-Match, comment-preserving round trips, and "rename to backups/, never delete".
// Not implemented yet: v0 (docs/08-roadmap.md).
export {};
