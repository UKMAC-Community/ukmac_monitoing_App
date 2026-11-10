# FEATURE-AI-BACKEND

Owner: Codex delegated backend implementer. State: READY_FOR_REVIEW.

Owned files: `src-tauri/src/ai.rs` (new), `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml` only if needed.

Original lib.rs and Cargo.toml are backed up under `.pm/backups/FEATURE-AI-BACKEND/` with relative paths.

Scope: configurable OpenRouter/local compatible AI connection; private credentials outside SQLite; bounded metadata-only chart generation; connection check; cancellation; focused Rust tests. No native relaunch or live provider calls.

Official references inspected:
- https://openrouter.ai/docs/api_reference/overview
- https://docs.ollama.com/api/openai-compatibility

## Implemented

- New `ai.rs` and Tauri state/command registration in `lib.rs`; no dependency changes.
- Commands: `ai_status`, `ai_save_connection`, `ai_test_connection`, `ai_generate_visuals`, `ai_cancel_generation`, `ai_clear_connection`.
- `ai_generate_visuals` input: `{requestId,prompt,columns:[{key,name,kind}],rowCount,allowedTypes}`. Returns the raw assistant text string for the frontend's strict visual-schema validator.
- Request-specific cancellation: `{requestId}` cancels only a matching active generation. Superseding a request cancels the former request; stale finish/cancel messages leave the new request intact.
- Connection: provider `openrouter` or `local`, baseUrl, model, API key. OpenRouter's HTTPS endpoint is fixed; user-configured compatible servers support HTTPS or loopback/private-LAN HTTP. Redirects are disabled. Local calls bypass system proxies.
- Keys are saved by atomic owner-only file replacement in `ai.json`, separate from SQLite. Status returns configured/provider/baseUrl/model/hasKey, never the key. Blank keys are retained only when provider and destination match; changing destinations clears the prior key.
- No default model, provider calls, or account actions occur at startup. Connection testing is GET `/models` and sends no prompt/table metadata. Generation is a non-streaming chat-completions request with explicit schema instructions, bounded response size and a 45-second timeout. It sends no row values.
- Provider failures are mapped to useful messages without raw response bodies or credentials.

## Validation

`cargo test --offline ai::tests --lib -- --test-threads=1`: **6 passed**, 37 existing tests filtered out. This compiles the Rust library and tests URL/key/input validation, owner-only storage, metadata-only payload shape, completion extraction/error sanitisation and request-specific cancellation.

`cargo fmt -- --check` across the repository reports extensive pre-existing formatting differences. No global formatting changes were made. Only owned `ai.rs` and `lib.rs` were formatted using `rustfmt --edition 2024 --config skip_children=true`.

A loopback fixture bind probe was denied by the sandbox (`PermissionError: [Errno 1] Operation not permitted`). No socket fixture test, live provider call, real local model generation, native UI integration or release binary was verified. This limit is reported explicitly rather than treating unrun checks as passing.

## PM acceptance

Pending independent review and frontend integration.
