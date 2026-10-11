---
name: claude-code-review
description: Review a current diff, GitHub PR, branch/range, or path using the installed Claude Code built-in /code-review via the claude_code_review tool. Use when the user requests Claude Code review or this wrapper.
compatibility: Requires the claude_code_review Pi tool, authenticated Claude Code on PATH, and an unshadowed built-in /code-review; GitHub PR reviews also need authenticated gh.
---

# Claude Code review

Use `claude_code_review` for supported reviews. Do not construct shell commands, use the marketplace plugin, or implement a replacement reviewer. If the tool is unavailable, explain that the package must be loaded; do not silently fall back to bash.

## Map the request

- Omit `target` for current diff (upstream-to-HEAD plus uncommitted changes).
- PR number: `{ "kind": "pr", "number": 123, "repository": "owner/project" }`. Repository may be omitted only when the selected directory supplies repository context. Ask if the repository is ambiguous.
- GitHub PR URL: `{ "kind": "pr-url", "url": "https://github.com/owner/project/pull/123" }`.
- Branch/range: `{ "kind": "branch", "value": "baseline...HEAD" }`.
- File/directory: `{ "kind": "path", "value": "src/" }`. Ask whether ambiguous text names a branch or path; do not guess.
- Omitted effort defaults to an explicit `medium` argument. Preserve explicit `low`, `medium`, `high`, `xhigh`, or `max` requests, even an explicit medium. Report whether effort was defaulted or user-supplied.
- `maxFindings` accepts a positive integer, `all`, or `default`. Omission inherits Claude's persisted finding limit, whose effective value is unknown. `all` lifts the cap; `default` resets it. Passed effort and finding limits may persist into later Claude sessions.
- Put only supplied review guidance into `context`. Keep it separate from target arguments; do not synthesize prior conversation or import project files. The runner sends policy/context in a preceding text block and only the canonical slash command in the final block of one stream-JSON user message. It does not use `--append-system-prompt` or modify project instructions.
- `workingDirectory` defaults to Pi's cwd; select a trusted existing directory when requested. `timeoutSeconds` is 1–3600, default 1200.
- Unsupported/ambiguous target encodings must be clarified, not escaped speculatively. Targets beginning with flags, newlines, reserved bare words, or unsupported punctuation are rejected. For the path named `high`, explicitly use `./high`. See package README for the conservative encoding rules.

## Request-to-input examples

“Review the current diff”:
```json
{}
```

“Review PR 123 in owner/project at high effort; focus on correctness”:
```json
{"target":{"kind":"pr","number":123,"repository":"owner/project"},"effort":"high","context":"Focus on correctness."}
```

“Review this PR URL with unlimited findings”:
```json
{"target":{"kind":"pr-url","url":"https://github.com/owner/project/pull/123"},"maxFindings":"all"}
```

“Review baseline...HEAD at xhigh with at most three findings”:
```json
{"target":{"kind":"branch","value":"baseline...HEAD"},"effort":"xhigh","maxFindings":3}
```

“Review src/ at medium and reset the finding limit”:
```json
{"target":{"kind":"path","value":"src/"},"effort":"medium","maxFindings":"default"}
```

## Report results

Return the upstream report and execution status without inventing finding counts or publication outcomes. Completed execution does not mean zero findings or confirmed publication. Distinguish failed, cancelled, and timed-out runs. Include diagnostic version/effort/finding-limit metadata and full log paths; use a file reader for truncated output. Logs are sensitive, retained locally, and manually deleted. Cancellation does not roll back effects.
