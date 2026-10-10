# Design

## Context

See `proposal.md` for motivation and `specs/claude-code-review/spec.md` for the behavior contract. This project currently contains only OpenSpec scaffolding and generated Pi planning resources: no package manifest, extension source, tests, or existing capability specifications.

Read-only discovery established:
- Pi supports TypeScript extension factories, `registerTool`, typed schemas, model-facing content, structured result data, cancellation signals, and package manifests that distribute extensions and skills together.
- The installed Pi documentation uses `@earendil-works/pi-coding-agent` and `typebox`; the minimal-tool and truncated-tool examples demonstrate registration and bounded output. The latter's shell-based execution is not suitable for this wrapper.
- Local `claude --version` reports 2.1.281. Its CLI help includes print mode, `--append-system-prompt`, output formats, permission controls, and `--no-session-persistence`.
- The maintainer supplied the built-in 2.1.296 argument contract. It differs materially from the legacy marketplace code-review command, which was inspected in error and must not be used as the specification.

The supplied interface is a reference for invocation construction, not a required version. Test built-in invocation and context delivery against the available installed CLI during implementation, without making those observations a runtime version gate. No live review, write, publication, or CLI upgrade is authorized by this planning workflow.

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

The built-in parser is not a shell. Shell quoting cannot be assumed to solve target whitespace or reserved-word collisions. Use the supplied interface and installed-CLI observations to establish tested target representations; accept only representations covered by those encoding rules. These input-safety checks do not restrict which CLI version can be attempted. For a problematic path, an absolute or `./`-prefixed equivalent can be used when verified. Otherwise reject with guidance rather than guessing. Never append free-form context to the slash command.

Alternative: one raw `args` string would expose command/flag injection and prevent dependable authorization boundaries.

### 3. Context through a separate appended system prompt

Invoke a fresh Claude process using an argv array, conceptually:

```text
claude --print --output-format json --no-session-persistence
  --dangerously-skip-permissions
  [--append-system-prompt <supplementary review context>]
  <canonical /code-review command>
```

The prompt argument remains exactly the slash command. Supplementary context is a separate argv value, with a wrapper header identifying it as review guidance and explicitly stating that fix/comment authorization comes only from selected flags. Include a short wrapper-level side-effect policy even when context is absent. Do not change `CLAUDE.md`, auto-import `AGENTS.md`, copy Pi conversation history, or use `--resume`/`--continue`.

The local help confirms the context transport exists, but a compatibility smoke test must verify the built-in review and any delegated local agents receive the supplementary guidance. The wrapper skill explains that this context is intentional additional guidance beyond normally loaded Claude project instructions.

Alternative: free text appended after the PR becomes part of `Review target`, as the maintainer's inspection showed. Writing project instructions introduces unrelated persistent changes. A streamed multi-message conversation adds unnecessary protocol complexity for the current contract.

### 4. Installed CLI with diagnostic version reporting, not plugin fallback

Use the Claude executable installed on PATH, without a version allowlist, minimum-version requirement, or proof-of-compatibility precondition. Make a short, bounded, best-effort `claude --version` probe for diagnostics. Record parsed/raw version output or an unavailable marker; probe failure or an unfamiliar version string must not prevent a review attempt if the executable is available. Keep the probe within the total execution deadline and honor cancellation.

Store the maintainer-supplied 2.1.296 interface as an attributed reference fixture and test command construction with multiple fake versions, including 2.1.281 and unknown/new versions. Observe actual parser, print-mode, context, and result behavior with the available installed binary in an authorized smoke environment. Document observed limitations without converting them into a version gate or claiming every version supports the requested interface.

Missing executables and actual invocation/protocol failures return clear errors with available diagnostics. Do not load `--plugin-dir`, install the legacy plugin, update Claude, or automatically retry with different options. Where legacy/custom skill collisions are demonstrably ambiguous, report that invocation problem rather than intentionally selecting a plugin fallback; do not require a version certification process.

Alternative: a verified-version allowlist can prevent attempts on otherwise useful installations and was rejected by the maintainer in favor of using whatever version is installed. Runtime failures are surfaced rather than predicted from version numbers.

### 5. Default permission bypass and separate workflow authorization

Fix/comment flags are generated solely from boolean inputs, never from context. The wrapper skill asks when edits/publication are ambiguous and treats those modes as potentially irreversible. It does not auto-retry them. Manual-only `ultra` and cloud posting controls return an error with an example command before any review process starts.

Pass `--dangerously-skip-permissions` by default on every review invocation, as explicitly requested by the maintainer. This avoids Claude permission prompts during unattended execution. Do not expose arbitrary allowed-tool strings or raw permission arguments; do not automatically change permission policy or retry after an execution failure. OS restrictions and any applicable managed policy still apply; return upstream diagnostics if execution is blocked.

Permission bypass is distinct from workflow selection: `--fix` and `--comment` remain false by default and require explicit user authorization. Their absence requests review without those workflows but does not enforce read-only access. Claude, repository instructions, hooks, and configured tools can have effects beyond those flags, with Claude permission checks bypassed. Document broader execution access and recommend trusted or isolated environments. Stronger isolation is outside this change.

Alternative: retaining permission checks can block unattended reviews and was rejected in favor of the maintainer's explicit default. This choice trades permission safeguards for unattended execution, not for automatic authorization of fixes or publication.

### 6. Abortable runner with restricted logs

Use Node subprocess APIs with `shell: false`, argument arrays, and the resolved working directory. Apply the total timeout to preparation and review execution. Stream stdout/stderr into separate files within a unique per-run private directory under the OS temp root (directory permissions 0700 and files 0600 where supported). Never store logs in the reviewed checkout or shared canonical maintainer state.

Retain bounded in-memory output for the response rather than buffering unbounded process output. For Claude's JSON envelope, parse from the captured output with explicit bounds and retain the raw log when the envelope is oversized or invalid. Treat a malformed expected result as a protocol error, not a successful empty review. Detect both nonzero exit status and the CLI result envelope's reported failure.

On timeout/cancellation terminate the owned process tree, escalating after a short grace period and waiting for close. Use POSIX process groups and an appropriate owned-tree termination path on Windows; do not kill unrelated Claude processes. Cleanup must be idempotent and compatible with Pi shutdown. Logs remain available after completion; document their sensitivity, location, and manual deletion. A failed log write is an execution error, and a running child is stopped rather than left unobserved.

Alternative: synchronous execution blocks Pi cancellation; capturing unlimited output risks memory exhaustion. Automatic log deletion removes diagnostics that the tool advertises.

### 7. Results describe execution, not reconstructed findings

Return `completed`, `failed`, `cancelled`, or `timed-out` status; selected target and options; effective effort with defaulted/user-supplied source and finding-limit inheritance markers; resolved cwd; CLI version; duration; exit code/signal; and log paths. Mark failures as tool errors while preserving structured data. Preflight errors have no review log if no run was started.

Present upstream result text rather than inventing finding counts or GitHub publication outcomes. An exit-zero run with findings is still completed execution, not a clean review. Truncate displayed content using Pi's 2000-line/50-KiB limits, reserve room for status/truncation/log notices, and state where full output can be read. Do not claim cancellation rolls back files or external comments.

Alternative: parsing prose into a review schema is fragile and unnecessary for exposing the built-in skill.

## Risks / Trade-offs

- [The supplied interface may differ from the installed CLI] → Attempt the installed version, report its version diagnostically, test against the available binary, and surface actual invocation/protocol failures without a version gate or automatic upgrade.
- [Claude persists effort and finding-limit settings] → Explicitly pass `medium` when effort is omitted, report its defaulted source, and disclose that passed settings can affect later Claude sessions. Finding-limit omission still inherits upstream state and must be identified as such.
- [Supplementary guidance can conflict with project instructions or contain prompt injection] → Keep workflow options separate, communicate authorization boundaries, and recommend trusted or isolated environments; prompt instructions are not access controls.
- [Default permission bypass grants broader execution access] → Disclose the bypass in README and the wrapper skill, test the default flag explicitly, and never claim that omitted fix/comment flags provide a read-only sandbox.
- [OS restrictions or managed policy may still block execution] → Return actionable diagnostics without automatic policy changes or retries.
- [Fixes/comments may occur before failure or cancellation] → Never imply rollback or automatically retry side-effecting runs.
- [Logs can include proprietary code and review notes] → Restrict local permissions, avoid checkout writes, and document retention/deletion.
- [Binary releases change parser/output or plugin precedence] → Maintain invocation/result fixtures and document observed behavior; fail clearly on actual errors rather than rejecting version numbers or substituting a marketplace plugin.

## Migration Plan

There is no existing implementation or persisted package state to migrate. Implement and test the package locally, perform the explicitly authorized compatibility smoke checks, then load it through the documented local Pi package manifest. Publication is a separate action.

Rollback consists of removing the package resource declaration and reloading Pi. This does not undo earlier fixes, published comments, upstream persistent settings, or retained run logs; document those separately.
