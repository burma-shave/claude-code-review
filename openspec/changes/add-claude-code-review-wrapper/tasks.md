# Tasks

## 1. Package and built-in compatibility baseline

- [ ] 1.1 Create the package manifest with explicit Pi extension/skill resource paths, host peer dependencies, TypeScript configuration, and test scripts; verify dependency installation, type checking, and an initial test run succeed without bundling Pi host packages.
- [ ] 1.2 Add attributed fixtures for the supplied 2.1.296 built-in argument reference and a bounded best-effort installed-version probe; verify fake-CLI tests attempt review with 2.1.281, 2.1.296, unknown/new versions, and unavailable/malformed version output, while missing executables fail clearly and no case installs or upgrades software.
- [ ] 1.3 In a separately authorized smoke environment using whatever Claude CLI is installed, observe print-mode `/code-review` resolution, target grammar, reserved tokens/whitespace, JSON result shape, context propagation via `--append-system-prompt`, and legacy/custom skill collision behavior; record results or environment limitations in fixtures/documentation without introducing a version allowlist or 2.1.296 requirement.
- [ ] 1.4 Document the installed-CLI policy, diagnostic-only version reporting, Pi prerequisites, authentication, the built-in-versus-marketplace distinction, and no automatic upgrade or plugin fallback in README; verify instructions agree with fixtures and the local package resource layout.

## 2. Structured inputs and invocation construction

- [ ] 2.1 Implement typed inputs and semantic validation for target kinds, effort, fix/comment booleans, max findings, context, directory, timeout, and recognized cloud-only controls; verify unit tests cover all allowed values, omitted effort normalized to `medium`, user-supplied effort overrides, other omitted defaults, unknown fields, and invalid combinations.
- [ ] 2.2 Implement PR number/repository normalization to canonical GitHub URLs and bounded read-only repository lookup from the selected directory; verify tests cover explicit repository without checkout, direct PR URL without lookup, inferred repository, missing context, malformed URLs, and lookup failures.
- [ ] 2.3 Implement canonical slash-command generation and verified target representation rules; verify table-driven tests cover current diff, PRs, branches/ranges, paths, every local effort, explicit `medium` when effort is omitted regardless of persisted Claude settings, every finding-limit form, inherited finding limits, and flag/newline/reserved-word target rejection.
- [ ] 2.4 Deliver optional context and wrapper authorization policy via a separate appended-system-prompt argv value; verify capture tests prove multiline context, quotes, and shell metacharacters do not alter the target, turn on fix/comment, or construct shell commands.
- [ ] 2.5 Implement pre-execution rejection of `ultra` and cloud posting controls with manual guidance; verify tests assert no review child starts, no local-level substitution occurs, and billing/access caveats appear.
- [ ] 2.6 Document the full tool-input mapping and examples for each target/option, including default medium effort, explicit effort overrides, persistent upstream settings, inherited finding limits, and unrepresentable targets; verify examples against invocation snapshots.

## 3. Subprocess lifecycle and restricted logs

- [ ] 3.1 Implement shell-free, fresh-process execution with resolved cwd, default `--dangerously-skip-permissions`, and no session continuation/persistence; verify fake-executable tests capture exact argv/cwd, require the bypass flag and `/code-review medium` on default review launches, keep fix/comment absent unless explicitly enabled, and cover nonexistent directories and upstream execution failures, including unsupported command/options, without version-based rejection or fallback.
- [ ] 3.2 Implement unique private log directories and streamed full stdout/stderr retention with bounded memory; verify tests cover concurrent runs, restrictive permissions where supported, large output, sensitive-context location, and log-write failure cleanup.
- [ ] 3.3 Apply the total execution timeout and cancellation to preflight, repository lookup, and review subprocess ownership; verify timeout/abort tests terminate owned children and descendants, preserve partial logs, distinguish termination causes, and leave unrelated processes alone.
- [ ] 3.4 Implement idempotent cleanup and Pi shutdown handling; verify race tests cover abort-before-spawn, abort-at-exit, timeout/shutdown overlap, and repeated cleanup without leaked processes or listeners.
- [ ] 3.5 Document default Claude permission bypass, broader execution access, trusted or isolated environment recommendations, remaining OS/managed-policy restrictions, timeout/cancellation limitations, log retention/deletion, and the fact that fixes/comments are not rolled back; verify documentation matches tested lifecycle behavior and does not claim omitted fix/comment flags enforce read-only access.

## 4. Tool result integration

- [ ] 4.1 Implement bounded JSON-envelope decoding and readable upstream result extraction without inventing findings; verify fixtures cover findings, no findings, result-level errors despite exit zero, nonzero exits, invalid/oversized envelopes, and partial failed output.
- [ ] 4.2 Implement result metadata and matching output schema for selected options, effective effort with defaulted/user-supplied source, inherited finding limits, target, cwd, diagnostic version or unavailable marker, duration, status, exit information, and log paths; verify schema validation tests and ensure failure results are marked as errors while retaining structured diagnostics.
- [ ] 4.3 Implement model-facing truncation with status and log notices within the 2000-line/50-KiB response limits; verify boundary tests for multibyte text, line limits, oversized text, and retained complete logs.
- [ ] 4.4 Register `claude_code_review` through the thin Pi extension adapter without startup subprocesses or UI requirements; verify mocked Pi registration/execution tests cover cancellation propagation, headless use, validation errors, and successful results.
- [ ] 4.5 Document result/status semantics, full-log access, defaulted/user-supplied effort and inherited finding-limit reporting, and why completed execution does not imply zero findings or confirmed publication; verify examples against result fixtures.

## 5. Wrapper skill

- [ ] 5.1 Create `skills/claude-code-review/SKILL.md` with valid discovery frontmatter and instructions to use the tool, keep context separate, and clarify ambiguous targets; verify discovery diagnostics and request-to-input examples select the expected tool arguments, document the medium effort default, and preserve explicit effort overrides.
- [ ] 5.2 Add explicit user-authorization rules for fixes/comments, disclosure of default `--dangerously-skip-permissions`, prohibition of automatic side-effect retries or permission-policy changes after failure, and manual-only cloud guidance; verify scenario checks cover ordinary review with bypass enabled but fix/comment disabled, authorized fixes/comments, context requesting publication, trusted or isolated environment guidance, and unsupported ultra requests.
- [ ] 5.3 Document local package installation/loading, wrapper invocation, CLI prerequisites, context examples, and disabling the package; verify the manifest points to the delivered extension/skill and that example requests agree with the typed interface.

## 6. End-to-end acceptance

- [ ] 6.1 Run type checking, all unit/fake-process tests, and package resource validation; verify every delta-spec requirement is represented in the acceptance matrix and no tests require production credentials or external writes by default.
- [ ] 6.2 Load the package in interactive and headless Pi with fake Claude; verify tool/skill discovery, supported targets/options, supplementary context, full-log access, truncation, failure reporting, timeout, and cancellation through the actual adapter.
- [ ] 6.3 Perform an explicitly authorized, non-posting, non-fixing smoke review with the installed Claude CLI in a disposable trusted repository; verify built-in invocation with default `--dangerously-skip-permissions`, separate context effectiveness, absence of fix/comment flags, observed lack of checkout changes (without claiming enforced read-only access), an explicit `medium` argument when effort is omitted, and accurate effort-source/finding-limit/version diagnostics; record actual failures or unavailable test environments without adding a version gate or upgrading Claude.
- [ ] 6.4 Verify real fix/comment behavior only in a separately authorized disposable working tree/test PR, or equivalent captured upstream integration fixtures; record which modes were actually exercised and do not claim untested publication support or execute cloud review.
