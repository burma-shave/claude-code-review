# Design

## Context

See `proposal.md` for motivation and `specs/claude-code-review/spec.md` for the behavior contract. This is a greenfield wrapper. Implementation progress is tracked in `tasks.md`; this design records the approach rather than a snapshot of delivered files.

Read-only discovery established:
- Pi supports TypeScript extension factories, `registerTool`, typed schemas, model-facing content, structured result data, cancellation signals, and package manifests that distribute extensions and skills together.
- The installed Pi documentation uses `@earendil-works/pi-coding-agent` and `typebox`; the minimal-tool and truncated-tool examples demonstrate registration and bounded output. The latter's shell-based execution is not suitable for this wrapper.
- Initial discovery observed Claude 2.1.281 and print-mode CLI controls. Later authorized smoke tests observed installed Claude 2.1.296; the relevant context-transport observations are preserved below. Neither version is an environment prerequisite.
- The built-in argument contract is recorded in the next section. The legacy marketplace code-review command is a different interface and must not be used as the specification.

The recorded interface is a reference for invocation construction, not a required version. Test built-in invocation and context delivery against the available installed CLI during implementation, without making those observations a runtime version gate. No live review, write, publication, or CLI upgrade is authorized by this planning workflow. Earlier local discovery is historical evidence, not a prerequisite or a claim about a future implementation environment.

### Recorded built-in interface reference (Claude Code 2.1.296)

**Attribution and evidence:** The maintainer reported the following interface from the argument hint and strings in the Claude Code 2.1.296 binary; there is no built-in `SKILL.md` for this reference. This section preserves that report in the repository. It is not independently verified runtime evidence, a minimum-version requirement, or a dependency on the original conversation or binary. Implementers can derive attributed fixtures directly from this section. The delta spec defines wrapper requirements; the decisions below define wrapper-specific defaults and transport.

Argument hint:

```text
/code-review [low|medium|high|xhigh|max|ultra] [--fix] [--comment] [<pr#>|<branch>|<path>] [--max-findings <n>|all|default]
```

**Review targets:**

| Form | Reported upstream behavior |
| --- | --- |
| Omitted | Current diff: committed `@{upstream}...HEAD` plus uncommitted working-tree changes. |
| `123` or a PR URL | That PR, fetched with `gh`. This wrapper normalizes numeric PRs to full GitHub URLs. |
| A branch or `a...b` | That branch or range. |
| A path | A file or directory. |

**Effort:**

- `low` and `medium`: fewer findings, high confidence only.
- `high`, `xhigh`, and `max`: wider coverage; some findings may be uncertain. At levels using subagents, the prompt asks for about one finder per 150 diff lines, bounded between two and eight. This is upstream behavior, not a wrapper scheduling requirement.
- `ultra`: billed multi-agent cloud review requiring claude.ai access and direct user invocation; Claude cannot launch it. `/ultrareview` is the old alias. The wrapper rejects automated cloud review.
- Omitted effort reuses the last typed effort, which persists upstream. The wrapper deliberately differs: it always supplies an explicit effort, defaulting to `medium`.

**Flags:**

- `--fix`: after review, applies findings to the working tree, skipping findings judged wrong or not worth fixing, then runs relevant checks.
- `--comment`: posts findings as inline PR comments; on a GitLab MR it posts a general note. On a non-PR target it prints findings and explains that commenting did not apply. This report does not by itself establish wrapper support for GitLab URLs.
- `--max-findings <n>` caps findings; `all` lifts the cap. The selection persists until `--max-findings default` resets it. Omission inherits upstream state.
- `--post` and `--no-post` are ultra-only. `--post` offers publication of the finished cloud review as a single PR comment from the user's GitHub account; `--no-post` hides that option. Server-side settings can disable posting, in which case `--post` is ignored. Both controls are manual-only in this wrapper.
- Flags may appear before or after the target. The wrapper uses a single canonical ordering for reproducible tests.

**Context and parser behavior:**

- There is no dedicated supplementary-context option in the slash-command interface. In local review, arguments other than levels or flags become the target text, inserted verbatim as ``Review target: `<your text>` ``. For example, `/code-review high 123 focus on the GTFS-RT parsing` labels the extra words as target text, not as a separate note. Model interpretation is not guaranteed.
- With `ultra`, the cloud reviewer does not see that extra note. The local session is told it was interpreted as a review note and uses it only to prioritize returned findings.
- Interactive review runs within a session or a fork, so preceding conversation can influence it. A fresh print-mode process does not inherit Pi's conversation.
- Working-directory `CLAUDE.md` files load normally. Plain Claude does not automatically load `AGENTS.md`; a `CLAUDE.md` can import it using `@AGENTS.md`. No assumption is made that a reviewed checkout does so.
- The reference does not establish shell-style quoting, reserved-token escaping, print-mode result shape, appended-system-prompt propagation to delegated agents, or precedence over colliding custom/legacy skills. Those remain verification work, not facts inferred from this report. Do not invent an encoding or claim compatibility that has not been tested.

**Historical motivation:** The maintainer reported that an earlier Maglev wrapper launched a fresh `claude -p "/code-review <PR URL>"` without an effort or supplementary context. That invocation inherits persisted effort and receives the URL plus normally loaded project instructions, not prior Pi review notes. This is background only; implementation does not require that checkout, its source line, or any earlier OpenSpec change. The standalone wrapper instead supplies explicit effort and uses the separate stream-JSON text-block transport described below.

### Recorded context-transport observations (installed Claude Code 2.1.296)

Separately user-authorized smoke tests used disposable synthetic repositories containing this committed Python function:

```python
def reciprocal(value):
    return 1 / value
```

The working-tree change replaced the return with `return 0 if value == 0 else 1 / value`. Tests used explicit `medium`, `--dangerously-skip-permissions`, and `--no-session-persistence`, with no fix/comment flags or cloud review. These are observations of the installed CLI, not guarantees about every version or a new review algorithm.

- **Rejected transport:** `/code-review medium sample.py` with separate `--append-system-prompt` guidance returned findings directly contrary to that guidance (which required the zero sentinel and mixed numeric return types). An earlier request to include `CONTEXT_SMOKE_296` was also ignored. These tests establish failure to reliably deliver effective guidance, not the precise internal cause.
- **Selected transport:** `--input-format stream-json --output-format stream-json --verbose` received one user message with a guidance text block first and `/code-review medium sample.py` as the final text block, with no initialization request and no appended-system-prompt flag. The result was exit zero, `type: "result"`, `subtype: "success"`, `is_error: false`, and `local_command: "code_review"`. Its result began: "I found no correctness bugs in the change to `sample.py`. CONTEXT_BLOCK_296" and explicitly stated that it left out the zero sentinel, removed exception, mixed numeric types, arrays, and callers as requested.
- The successful message's guidance specified that zero returns the integer 0 sentinel, nonzero scalar int/float inputs return `1/value`, arrays and hypothetical callers are unsupported/out of scope, and fixing, editing, publication, and cloud review are not authorized. It requested the exact marker `CONTEXT_BLOCK_296`. The guidance was not placed in the slash-command target.
- Stream events identified a foreground `general-purpose` fork with `parent_tool_use_id: "forked-command-code-review"`; its generated review prompt still began with only `Review target: sample.py` (formatted with backticks). The final fork report acknowledged the supplementary requirements. No additional finder subagents were spawned, so propagation to nested finders remains an acceptance-test limit, not an established fact.
- A separate exploratory initialization-plus-message test also acknowledged its context marker, but initialization is unnecessary for the successful selected transport and is not part of the wrapper design.
- A deliberately created `.claude/skills/code-review/SKILL.md` in a disposable repository returned `CUSTOM_SKILL_COLLISION_296` instead of a built-in review. The approved scope treats an unshadowed built-in name as a prerequisite; it does not add collision detection, command-identity attestation, an initialization handshake, safe-mode changes, or customization disabling.

The earlier appended-context and collision blockers recorded in `docs/compatibility-smoke.md` are superseded by the transport and scope decisions here. The observations needed to implement the revised approach are embedded in this artifact; the original conversation, temporary repositories, and private logs are not prerequisites. The pending implementation tasks must derive new transport fixtures from this section and verify the actual adapter before claiming end-to-end completion.

## Goals / Non-Goals

**Goals:**
- Keep typed input normalization and command generation independently testable.
- Use one execution path in both interactive and headless Pi modes.
- Preserve upstream review semantics rather than reimplementing parsing or reviewing logic.
- Make inherited settings, errors, logging, and potentially irreversible effects visible.

**Non-Goals:**
- A custom terminal UI, secondary review algorithm, or findings schema that would require guessing at upstream prose.
- Reuse of Maglev Bench state, repository-specific identifiers, or review-draft tooling.
- Guaranteeing a filesystem/network sandbox through prompt instructions alone.
- Automatically running cloud reviews or escalating CLI permissions when a review fails.
- Detecting or remediating custom/legacy skill-name collisions, attesting command identity, or running an initialization handshake. Users must provide an environment where `/code-review` resolves to the built-in.

## Decisions

### 1. Standalone package with a thin extension adapter

Proposed layout:

```text
package.json
extensions/code-review.ts
src/inputs.ts
src/invocation.ts
src/runner.ts
src/results.ts
skills/claude-code-review/SKILL.md
tests/
README.md
```

Expose `extensions/code-review.ts` and the wrapper skill through an explicit `pi` manifest. Declare Pi and TypeBox host dependencies as peers, not bundled runtime duplicates. Use a TypeScript-aware test runner and type-checking configuration established in this greenfield package.

The adapter registers `claude_code_review`, validates through the typed schema plus semantic checks, delegates to pure normalization/invocation modules, and returns bounded content plus matching output-schema/structured metadata. No processes are started during extension registration. Runtime resources belong to the active tool execution and are cleaned up on abort/shutdown.

Alternative: a single large extension file is simpler initially but couples parser, subprocess, and tool tests. A Maglev-specific extension is inappropriate for this reusable project.

### 2. Typed target discriminators and explicit option mapping

Use optional `target` with these forms:

- `{ kind: "pr", number: positiveInteger, repository?: "owner/repo" }`
- `{ kind: "pr-url", url: string }`
- `{ kind: "branch", value: string }` (also covers `a...b` ranges)
- `{ kind: "path", value: string }`

Omitted target means the current diff. A numeric PR resolves to a canonical GitHub PR URL using the explicit repository or bounded read-only `gh repo view --json nameWithOwner` from the selected directory. A direct PR URL does not require local Git discovery. Validate PR URL structure without accepting arbitrary web URLs; include GitLab MR URL support only if covered by the wrapper's target-encoding tests, otherwise return a clear unsupported-target error.

Other inputs: `effort` (local levels plus recognized manual-only `ultra`, default `medium`), `fix` and `comment` (default false), `maxFindings` (positive integer, `all`, `default`, or omitted), `context`, `workingDirectory`, and `timeoutSeconds` (1–3600, default 1200). A `cloudPost` enum of `post`/`no-post` represents the upstream cloud flags only for validation and manual guidance, never execution. Unknown fields, invalid combinations, empty supplied targets, and unrepresentable parser inputs are rejected.

Build a canonical slash command in effort/options/target order. Normalize omitted effort to `medium` and always include the selected local effort as an explicit slash-command argument, so prior Claude settings cannot change the wrapper's default. Report effective effort with a `defaulted` or `user-supplied` source. An omitted finding limit remains omitted and is reported as `inherited`, not as a discovered effective value. Passed effort and finding-limit settings can themselves persist upstream, and documentation must state this.

The built-in parser is not a shell. Shell quoting cannot be assumed to solve target whitespace or reserved-word collisions. Use the recorded interface reference above and installed-CLI observations to establish tested target representations; accept only representations covered by those encoding rules. These input-safety checks do not restrict which CLI version can be attempted. For a problematic path, an absolute or `./`-prefixed equivalent can be used when verified. Otherwise reject with guidance rather than guessing. Never append free-form context to the slash command.

Alternative: one raw `args` string would expose command/flag injection and prevent dependable authorization boundaries.

### 3. Context through separate text blocks in one stream-JSON message

Invoke a fresh Claude process using a shell-free argv array:

```text
claude --print --input-format stream-json --output-format stream-json
  --verbose --no-session-persistence --dangerously-skip-permissions
```

Do not supply a positional prompt. Write exactly one JSON-serialized user-message record followed by a newline to stdin, then close stdin. Its `message.content` is an ordered array: the first text block contains the wrapper authorization policy plus optional supplementary context, and the final text block contains only the canonical slash command. Do not send an initialization request, earlier conversation turns, or control-channel command discovery. Conceptual wire shape:

```json
{"type":"user","session_id":"","message":{"role":"user","content":[{"type":"text","text":"Wrapper policy and optional supplementary review guidance"},{"type":"text","text":"/code-review medium sample.py"}]}}
```

JSON serialization keeps multiline context, quotes, and metacharacters as data inside the first block, never extra records or slash-command arguments. The canonical command block must remain last even if context contains slash commands or flag-like text. Fix/comment flags derive only from typed booleans. The policy identifies context as guidance, not authorization to change options, and remains present when user context is omitted. Do not synthesize supplementary context from Pi history or files, change `CLAUDE.md`, auto-import `AGENTS.md`, resume a session, or use a custom skill to replace the built-in.

The recorded no-handshake test above demonstrated effective context delivery to the built-in foreground review fork on the installed CLI. Nested finder propagation still needs verification in authorized acceptance tests; do not claim that prompt guidance enforces a security sandbox. The wrapper skill explains this intentional additional context beyond normally loaded Claude project instructions.

Alternatives: `--append-system-prompt` was rejected because its guidance did not reliably affect the built-in review in the observed environment. Free text appended after a target becomes part of `Review target`. Writing project instructions introduces unrelated persistent changes. A multi-turn streamed conversation or initialization handshake adds complexity that the tested single-message transport does not require.

### 4. Installed CLI with diagnostic version reporting, not plugin fallback

Use the Claude executable installed on PATH, without a version allowlist, minimum-version requirement, or proof-of-compatibility precondition. Make a short, bounded, best-effort `claude --version` probe for diagnostics. Record parsed/raw version output or an unavailable marker; probe failure or an unfamiliar version string must not prevent a review attempt if the executable is available. Keep the probe within the total execution deadline and honor cancellation.

Derive an attributed reference fixture from this document's recorded built-in interface reference (Claude Code 2.1.296), without requiring the original conversation or binary, and test command construction with multiple fake versions, including 2.1.281 and unknown/new versions. Observe actual parser, print-mode, context, and result behavior with the available installed binary in an authorized smoke environment. Document observed limitations without converting them into a version gate or claiming every version supports the requested interface.

Missing executables and actual invocation/protocol failures return clear errors with available diagnostics. Do not load `--plugin-dir`, install the legacy plugin, update Claude, or automatically retry with different options. Document that users must avoid a same-named custom/legacy skill shadowing `/code-review`. The wrapper does not detect collisions, require a `builtin` or `local_command` identity marker, issue an initialization handshake, force safe mode, disable customizations, or automatically select another command. Invocation/protocol failures are still reported normally; do not require a version certification process.

Alternative: a verified-version allowlist can prevent attempts on otherwise useful installations and was rejected by the maintainer in favor of using whatever version is installed. Runtime failures are surfaced rather than predicted from version numbers.

### 5. Default permission bypass and separate workflow authorization

Fix/comment flags are generated solely from boolean inputs, never from context. The wrapper skill asks when edits/publication are ambiguous and treats those modes as potentially irreversible. It does not auto-retry them. Manual-only `ultra` and cloud posting controls return an error with an example command before any review process starts.

Pass `--dangerously-skip-permissions` by default on every review invocation, as explicitly requested by the maintainer. This avoids Claude permission prompts during unattended execution. Do not expose arbitrary allowed-tool strings or raw permission arguments; do not automatically change permission policy or retry after an execution failure. OS restrictions and any applicable managed policy still apply; return upstream diagnostics if execution is blocked.

Permission bypass is distinct from workflow selection: `--fix` and `--comment` remain false by default and require explicit user authorization. Their absence requests review without those workflows but does not enforce read-only access. Claude, repository instructions, hooks, and configured tools can have effects beyond those flags, with Claude permission checks bypassed. Document broader execution access and recommend trusted or isolated environments. Stronger isolation is outside this change.

Alternative: retaining permission checks can block unattended reviews and was rejected in favor of the maintainer's explicit default. This choice trades permission safeguards for unattended execution, not for automatic authorization of fixes or publication.

### 6. Abortable runner with restricted logs

Use Node subprocess APIs with `shell: false`, argument arrays, and the resolved working directory. Apply the total timeout to preparation and review execution. Stream stdout/stderr into separate files within a unique per-run private directory under the OS temp root (directory permissions 0700 and files 0600 where supported). Never store logs in the reviewed checkout or shared canonical maintainer state.

Retain bounded in-memory output for the response rather than buffering unbounded process output. Decode stdout incrementally as newline-delimited stream-JSON records with explicit per-record and retained-result bounds; never buffer the entire event stream. Retain all bytes in the raw stdout log. Intermediate progress, assistant, user, and system events are not the final report. Extract readable text only from the final top-level `type: "result"` envelope; a missing, malformed, oversized, or duplicate final result is a protocol error, not a successful empty review. If a record exceeds the decoding bound, discard its in-memory remainder through the next newline while retaining the raw log; an oversized intermediate event must not prevent a later valid result from being read. Detect both nonzero exit status and the result envelope's reported failure. A broken stdin write is an execution failure; stop the owned child, retain diagnostics, and do not retry with alternate semantics.

On timeout/cancellation terminate the owned process tree, escalating after a short grace period and waiting for close. Use POSIX process groups and an appropriate owned-tree termination path on Windows; do not kill unrelated Claude processes. Cleanup must be idempotent and compatible with Pi shutdown. Logs remain available after completion; document their sensitivity, location, and manual deletion. A failed log write is an execution error, and a running child is stopped rather than left unobserved.

Alternative: synchronous execution blocks Pi cancellation; capturing unlimited output risks memory exhaustion. Automatic log deletion removes diagnostics that the tool advertises.

### 7. Results describe execution, not reconstructed findings

Return `completed`, `failed`, `cancelled`, or `timed-out` status; selected target and options; effective effort with defaulted/user-supplied source and finding-limit inheritance markers; resolved cwd; CLI version; duration; exit code/signal; and log paths. Mark failures as tool errors while preserving structured data. Preflight errors have no review log if no run was started.

Present upstream result text rather than inventing finding counts or GitHub publication outcomes. An exit-zero run with findings is still completed execution, not a clean review. Truncate displayed content using Pi's 2000-line/50-KiB limits, reserve room for status/truncation/log notices, and state where full output can be read. Do not claim cancellation rolls back files or external comments.

Alternative: parsing prose into a review schema is fragile and unnecessary for exposing the built-in skill.

## Risks / Trade-offs

- [The recorded interface may differ from the installed CLI] → Attempt the installed version, report its version diagnostically, test against the available binary, and surface actual invocation/protocol failures without a version gate or automatic upgrade.
- [Claude persists effort and finding-limit settings] → Explicitly pass `medium` when effort is omitted, report its defaulted source, and disclose that passed settings can affect later Claude sessions. Finding-limit omission still inherits upstream state and must be identified as such.
- [Supplementary guidance can conflict with project instructions or contain prompt injection] → Keep workflow options separate, communicate authorization boundaries, and recommend trusted or isolated environments; prompt instructions are not access controls.
- [Default permission bypass grants broader execution access] → Disclose the bypass in README and the wrapper skill, test the default flag explicitly, and never claim that omitted fix/comment flags provide a read-only sandbox.
- [OS restrictions or managed policy may still block execution] → Return actionable diagnostics without automatic policy changes or retries.
- [Fixes/comments may occur before failure or cancellation] → Never imply rollback or automatically retry side-effecting runs.
- [Logs can include proprietary code and review notes] → Restrict local permissions, avoid checkout writes, and document retention/deletion.
- [Binary releases change parser/output or plugin precedence] → Maintain invocation/result fixtures and document observed behavior; fail clearly on actual errors rather than rejecting version numbers or substituting a marketplace plugin. Skill-name collisions are outside wrapper handling; document the unshadowed-name prerequisite instead of adding an identity handshake.

## Migration Plan

There is no existing implementation or persisted package state to migrate. Implement and test the package locally, perform the explicitly authorized compatibility smoke checks, then load it through the documented local Pi package manifest. Publication is a separate action.

Rollback consists of removing the package resource declaration and reloading Pi. This does not undo earlier fixes, published comments, upstream persistent settings, or retained run logs; document those separately.
