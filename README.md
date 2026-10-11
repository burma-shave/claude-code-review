# Pi Claude Code review

A local Pi package wrapping Claude Code's **built-in** `/code-review` with a structured `claude_code_review` tool and a `claude-code-review` skill. The manifest delivers `extensions/code-review.ts` and `skills/claude-code-review`. Live integration acceptance is tracked separately; fake-process tests are not evidence of publication support.

## Prerequisites and compatibility

- Node.js 22.19 or newer and Pi with the `@earendil-works/pi-coding-agent` extension API and `typebox` host packages. These are peer dependencies, not bundled copies. Development uses `npm ci`, `npm run typecheck`, and `npm test`.
- Install Claude Code yourself, make `claude` available on PATH, and authenticate it in the account/environment that runs Pi. The wrapper does not install, authenticate, or upgrade software.
- `/code-review` **must resolve to the built-in skill**, not a same-named custom skill or legacy command. Check your Claude customizations yourself. The wrapper does not detect/remediate collisions, attest command identity, disable customizations, or perform an initialization handshake.
- The marketplace code-review plugin is a different interface. It is not used as a fallback, and the wrapper does not load or install it.
- PR reviews use upstream `gh`; install and authenticate GitHub CLI with the required repository access. Numeric PRs also need an explicit `owner/repo` or repository context in the selected working directory.

The wrapper attempts whatever Claude CLI is installed. There is no version allowlist or minimum-version gate. A short best-effort `claude --version` probe supplies diagnostics only: an unfamiliar version, malformed output, or failed probe does not prevent a review attempt when the executable exists. Missing executables and actual invocation/protocol failures are reported, without upgrades, alternate semantics, or automatic retries.

The attributed 2.1.296 interface in `openspec/changes/add-claude-code-review-wrapper/design.md` is a reference, **not an installation requirement** or a compatibility guarantee. Captured smoke fixtures document specific observations, not certification of every release. The selected transport is one stream-JSON user message with policy/context in a preceding text block and only the slash command in the final block; it does not use `--append-system-prompt`. See `docs/compatibility-smoke.md` for evidence and limits.

## Local installation and loading

Review the package source and the execution-access warning below before loading it. Install/authenticate Claude separately, ensure its built-in `/code-review` is unshadowed, and install/authenticate `gh` for PRs.

From this checkout:

```sh
npm ci
pi -e .
```

`-e .` loads the package extension and skill for that invocation without changing settings. Or use an absolute checkout path:

```sh
pi install /absolute/path/to/pi-claude-code-review
```

Add `--local` for project-scoped installation. Project declarations require project trust; inspect them before granting it. Local packages are loaded in place rather than copied. Pi supplies the declared host peers; `npm ci` installs development dependencies for this checkout.

In Pi, invoke the wrapper explicitly:

```text
/skill:claude-code-review review PR 123 in owner/project at high effort; focus on correctness
```

The skill selects `claude_code_review` with `target`, explicit `effort: "high"`, and separate `context`, as shown in the tool examples below. It does not run a shell command. An ordinary request leaves fix/comment disabled. The default permission bypass still applies.

For a one-shot headless request with your configured Pi model:

```sh
pi -e . --print "/skill:claude-code-review review the current diff"
```

The same adapter works in interactive and headless modes; it does not require dialogs. A selected PR and context conceptually arrive at Claude as two text blocks in one serialized user-message record:

```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"Wrapper policy plus supplementary guidance: Focus on correctness."},{"type":"text","text":"/code-review high https://github.com/owner/project/pull/123"}]}}
```

The actual policy is supplied by the runner; multiline context remains JSON data. No context is appended to the target, no initialization handshake occurs, and no prior Pi conversation is synthesized. Normally loaded Claude project instructions still apply.

To disable a temporary load, omit `-e .` next time. For an installed package, use `pi remove /absolute/path/to/pi-claude-code-review` (with `--local` if installed locally), or disable its extension and skill via `pi config`. Restart Pi or `/reload` after changing resource settings. Removing the package does not undo fixes/comments, persisted upstream effort/finding-limit choices, or retained logs. Do not use `pi update` as a remedy for an upstream invocation failure.

## Execution access

Review launches use `--dangerously-skip-permissions` by default, bypassing Claude permission checks. Run only in trusted or isolated environments. Fixes and comments are separately opt-in; omitting those flags is **not** a read-only filesystem/network sandbox. Repository instructions, hooks, and tools can have other effects. OS restrictions and applicable managed policies still apply.

Cloud `ultra` review and its posting controls are manual-only and are never launched by this wrapper. They require claude.ai access and may incur billing.

## Lifecycle and logs

The total deadline covers directory preparation, numeric-PR repository lookup, the diagnostic version probe, and review execution. Cancellation and Pi's `session_shutdown` stop owned subprocesses and await cleanup. On POSIX, launches have their own process group: termination sends SIGTERM, waits 100 ms, then escalates to SIGKILL. On Windows the implementation uses `taskkill /PID <owned-pid> /T /F`; this path has not been exercised in the current Linux test environment.

Timeout/cancellation results distinguish their first termination cause and preserve available review logs. Cleanup can take longer than the selected timeout. Unrelated processes are not targeted. Descendants that deliberately escape the owned process group/tree, remote jobs, blocked OS I/O, abrupt termination of Pi itself, and OS/managed-policy restrictions are outside the wrapper's cleanup guarantee. No automatic permission-policy changes or retries occur after failure. Claude's default permission bypass grants broader execution access; use a trusted or isolated environment, not an untrusted checkout.

Full review stdout/stderr are streamed into a unique `pi-claude-code-review-*` directory under the OS temporary directory, never the reviewed checkout. Directory permissions exclude group/other access (0700) and files are created with 0600 permissions where supported. Concurrent runs use different directories. Logs may contain proprietary code, credentials, or supplementary review context echoed by upstream. The input policy/context is not separately logged, but upstream output is not redacted. Failed log writes stop the owned review rather than leaving it unobserved.

Logs remain after success, failure, timeout, and cancellation. Inspect the returned `logs.stdout`/`logs.stderr` paths with a file reader, and manually delete the returned per-run directory when no longer needed. Storage is not automatically rotated, so large output consumes disk space. Preflight failures have no review logs; log-setup failures may retain a partial/empty log directory.

**Fixes and published comments are not rolled back** after failure, cancellation, timeout, package removal, or reload. Omitted fix/comment flags request those workflows to stay off; they do not enforce read-only access. Permission bypass, repository instructions, hooks, and configured tools can still have other effects.

## Tool inputs

Unknown fields and arbitrary CLI/permission arguments are rejected. The tool's typed inputs map as follows:

| Input | Selection and mapping |
| --- | --- |
| `target` omitted | Current diff; no target argument. Upstream reviews committed `@{upstream}...HEAD` plus uncommitted changes. |
| `target: {kind: "pr", number, repository?}` | Positive safe-integer PR number; explicit `owner/repo`, or bounded read-only `gh repo view --json nameWithOwner` in the selected directory. Generates a canonical GitHub PR URL. |
| `target: {kind: "pr-url", url}` | `https://github.com/owner/repo/pull/123`, optionally with trailing slash; no repository lookup. No credentials, query, fragment, alternate host, or GitLab MR URLs. |
| `target: {kind: "branch", value}` | Branch or `a...b` range, passed unchanged under the conservative encoding rules below. |
| `target: {kind: "path", value}` | File/directory path, passed unchanged under those rules. |
| `effort` | `low`, `medium`, `high`, `xhigh`, `max`; always explicit in the command. Omission defaults to `medium`, source `defaulted`; an explicit value (including `medium`) has source `user-supplied`. `ultra` is recognized but rejected before execution. |
| `fix`, `comment` | Booleans, default false. Only true generates `--fix`/`--comment`; explicit user authorization is required. Non-PR commenting is passed through; upstream explains non-applicability. |
| `maxFindings` | Positive safe integer, `all`, or `default`, mapped to `--max-findings VALUE`. Omission adds no flag and is reported as `inherited`; the actual inherited cap is not discovered. |
| `context` | Optional string (including multiline/empty text), unchanged in the policy/context text block. Never a target argument or authorization to fix/comment. |
| `workingDirectory` | Optional nonempty directory path. The runner defaults to Pi's cwd and resolves/checks the selected directory before execution. |
| `timeoutSeconds` | Number from 1 to 3600 (fractional seconds allowed), default 1200, for the total preparation and execution deadline. |
| `cloudPost` | `post`/`no-post`, recognized for manual guidance only. Incompatible with local effort; with `ultra`, still rejected. |

Claude persists typed effort and finding-limit choices upstream. This wrapper always sends the chosen local effort (explicit `medium` by default), so prior effort settings cannot alter its default. Its explicit settings can affect later Claude sessions. Omitted finding limits **do** inherit persisted upstream state; `all` lifts the cap and `default` resets it. Inheritance is not a guarantee of any particular count.

### Conservative target encoding

As approved by the operator, path/branch/range text accepts ASCII letters, digits, underscore, dot, slash, hyphen, and internal ordinary spaces. Leading/trailing whitespace, control characters, bare numeric targets, standalone effort/limit words (`low`, `medium`, `high`, `xhigh`, `max`, `ultra`, `all`, `default`), and any space-separated token beginning with `-` are rejected. Unicode, other punctuation, and shell quoting/escaping are not supported. This is deliberately narrower than the filesystem's possible names, not a claim that Claude cannot handle them.

Supply a verified equivalent explicitly where appropriate: `./high` selects the path named `high`; bare `high` is rejected. The wrapper does not invent quoting, correct typos, or change target text. If no supported equivalent exists, review the current diff or invoke Claude manually after inspecting its grammar. Reference evidence includes ordinary paths, `folder with spaces/sample.py`, `./high`, and `baseline...HEAD`; these do not certify every CLI version.

### Input/command examples

These are structured tool inputs, **not shell commands**. The displayed slash commands are invocation snapshots; context stays in the preceding text block of the single stream-JSON user message.

Current diff with default medium:

```json
{}
```

Command: `/code-review medium`

Explicit numeric PR without requiring a checkout:

```json
{"target":{"kind":"pr","number":123,"repository":"owner/project"},"effort":"high"}
```

Command: `/code-review high https://github.com/owner/project/pull/123`

Direct PR URL, unlimited findings, and multiline focus notes:

```json
{"target":{"kind":"pr-url","url":"https://github.com/owner/project/pull/123/"},"maxFindings":"all","context":"Focus on correctness.\nIgnore hypothetical unsupported callers."}
```

Command: `/code-review medium --max-findings all https://github.com/owner/project/pull/123`

Branch/range with a cap:

```json
{"target":{"kind":"branch","value":"baseline...HEAD"},"effort":"xhigh","maxFindings":3}
```

Command: `/code-review xhigh --max-findings 3 baseline...HEAD`

Whitespace-containing file, selected directory, and shorter timeout:

```json
{"target":{"kind":"path","value":"folder with spaces/sample.py"},"effort":"low","workingDirectory":"/tmp/trusted-review","timeoutSeconds":60}
```

Command: `/code-review low folder with spaces/sample.py`

Directory and reset of the persisted finding cap:

```json
{"target":{"kind":"path","value":"src/"},"effort":"max","maxFindings":"default"}
```

Command: `/code-review max --max-findings default src/`

Reserved filename with separately authorized fixes/comments (potentially irreversible):

```json
{"target":{"kind":"path","value":"./high"},"effort":"medium","fix":true,"comment":true}
```

Command: `/code-review medium --fix --comment ./high`

For a numeric PR with no explicit repository, use `{"target":{"kind":"pr","number":123}}` in a repository where authenticated `gh` can determine `owner/repo`. Missing context is an error, not an invented repository.

An `{"effort":"ultra","cloudPost":"no-post"}` request fails without launching review. Manual guidance is `/code-review ultra --no-post` in an interactive Claude session with the intended target; claude.ai access and billing apply. `--post` offers publication, but server-side settings may disable it. No automatic substitution or cloud execution occurs.

## Results

Model-facing text starts with the execution status, includes the upstream final result (not reconstructed findings), and ends with full stdout/stderr log paths. The entire response is limited to 2000 lines/50 KiB; a truncation notice directs you to the retained logs. Read `logs.stdout` for the complete stream-JSON event sequence and `logs.stderr` for diagnostics. Intermediate events are not presented as the final review.

`details` and `structuredContent` contain matching output-schema metadata:
- `selectedTarget`: the typed selection, or null for current diff; `target`: the resolved command target (null for current diff or unresolved preflight).
- `options`: effective effort and `effortSource` (`defaulted` or `user-supplied`), selected fix/comment booleans, timeout, and finding-limit selection. Omission reports `{ "source": "inherited" }`, never a guessed effective cap. Invalid input has null options. Context is not duplicated in metadata.
- `cwd`, `durationMs`, `exitCode`, `exitSignal`, `logs`, and `diagnostic`. Preflight failures may have null exit information and logs.
- `version`: `reported` with parsed version and raw output, `unrecognized` with raw output, or `unavailable` with optional diagnostic. This is not a compatibility gate.

Status is `completed`, `failed`, `cancelled`, or `timed-out`. All but `completed` set `isError: true` while retaining structured diagnostics. Nonzero exit, an upstream result-level error even at exit zero, and invalid/missing/duplicate/oversized final results are failures. Cancellation/timeout preserve partial logs and do not roll back effects.

**Completed execution does not mean zero findings or confirmed publication.** Read the upstream report; the wrapper does not infer finding counts or GitHub outcomes from prose or exit status.

Example metadata selections from fake-result fixtures (not live publication evidence):

```json
{"status":"completed","options":{"effort":"medium","effortSource":"defaulted","fix":false,"comment":false,"findingLimit":{"source":"inherited"},"timeoutSeconds":1200}}
```

```json
{"status":"completed","options":{"effort":"high","effortSource":"user-supplied","fix":true,"comment":true,"findingLimit":{"source":"user-supplied","value":"all"},"timeoutSeconds":1200}}
```

These are excerpts; the full result also includes the target, cwd, version, duration, exit information, diagnostic, and log paths. A report such as “One possible finding; publication not confirmed.” is still completed execution, not a clean-review or publication assertion.
