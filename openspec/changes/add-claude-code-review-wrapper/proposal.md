# Proposal

## Why

Pi users need a structured way to invoke Claude Code's built-in `/code-review` skill without manually constructing commands or conflating target selection with supplementary context. A reusable extension and wrapper skill will expose the review interface while making editing, posting, inherited settings, and unsupported cloud execution explicit.

## What Changes

- Introduce a standalone Pi package with a `claude_code_review` tool and a `claude-code-review` wrapper skill.
- Formalize current-diff, PR number/URL, branch/range, and file/directory targets; local effort levels; `--fix`; `--comment`; and `--max-findings` (positive integer, `all`, or `default`).
- Accept optional supplementary context separately from the review target, delivered through Claude's appended system prompt rather than appended slash-command arguments.
- Provide working-directory selection, bounded execution, cancellation, readable output, complete run logs, and clear errors.
- Pass `--dangerously-skip-permissions` by default to Claude Code, bypassing its permission checks for unattended execution. Keep fixes and comments separately opt-in. Default omitted effort to an explicit `medium` review argument, with user-supplied effort overriding it. Preserve omitted upstream finding-limit behavior while documenting its persistent default.
- Recognize but reject automated `ultra` and its `--post`/`--no-post` options with manual-invocation guidance; do not silently substitute a local effort level.
- Use whatever Claude Code version is installed, without a version allowlist or minimum-version gate. Record its version for diagnostics and surface invocation failures clearly, without automatic upgrades or marketplace-plugin fallback. Use the supplied 2.1.296 built-in interface as a reference, not an installation requirement.

## Capabilities

### New Capabilities

- `claude-code-review`: Structured, context-aware invocation and reporting of Claude Code's built-in review skill through a Pi tool and instructional wrapper.

### Modified Capabilities

None. The project's capability inventory is empty.

## Impact

- Proposed new package manifest, TypeScript extension and runner modules, wrapper skill, README, and tests in this project; no existing implementation is modified.
- Depends on the installed authenticated Claude Code CLI and Pi's extension API. PR reviews depend on upstream GitHub CLI availability/authentication; repository context depends on the selected working directory.
- Fix mode can change the reviewed working tree; comment mode can publish externally. These modes must be explicitly requested and must never be enabled by optional context or inferred automatically.
- The locally observed CLI is 2.1.281. The 2.1.296 built-in contract is supplied by the maintainer, not verified locally. The marketplace plugin is explicitly outside scope.
- Default permission bypass grants Claude broader execution access and is not a filesystem or network sandbox. Document trusted or isolated execution environments; disabling fix/comment flags does not enforce read-only access.
- Out of scope: implementing a review algorithm, Maglev-specific state or review drafts, automatic CLI upgrades, unattended cloud reviews, package publication, and arbitrary user-supplied CLI permission policies.
