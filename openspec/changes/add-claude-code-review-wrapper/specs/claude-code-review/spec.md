# Spec Delta

## Purpose

Expose Claude Code's built-in code review through a structured Pi tool and wrapper skill, preserving review options while keeping supplementary context, execution status, and side-effect authorization explicit.

## ADDED Requirements

### Requirement: Built-in skill invocation
The system SHALL attempt Claude Code's built-in `/code-review` using the installed CLI in a fresh non-interactive process, without a version allowlist or minimum-version gate. It MUST report missing executables and invocation failures without automatic installation, upgrades, marketplace-plugin fallback, or substituting its own review algorithm.

#### Scenario: Configured command name
- **WHEN** the user consults installation guidance
- **THEN** it documents that `/code-review` must resolve to the built-in skill, not a same-named custom or legacy command
- **AND** collision detection/remediation and command-identity attestation are outside scope; the wrapper does not add an initialization handshake or disable customizations to force resolution

#### Scenario: Installed version
- **WHEN** a valid review is requested with an installed Claude CLI, regardless of version or prior verification
- **THEN** the system attempts the built-in `/code-review` and reports its result
- **AND** it does not resume a prior Claude conversation or reject the request based on version

#### Scenario: Missing installation
- **WHEN** the Claude executable is absent
- **THEN** the system reports a setup error
- **AND** it does not install software or fall back to the legacy plugin

#### Scenario: Installed CLI cannot perform the invocation
- **WHEN** the installed CLI fails to accept the command, options, or expected result protocol
- **THEN** the system reports the invocation or protocol failure and available diagnostics
- **AND** it does not upgrade Claude, retry with different semantics, or fall back to the legacy plugin

#### Scenario: Version diagnostics unavailable
- **WHEN** a version probe fails or returns an unrecognized value but the Claude executable is available
- **THEN** the system records the raw value or an unavailable marker for diagnostics
- **AND** the version probe does not prevent the review attempt

### Requirement: Structured review targets
The system SHALL accept an omitted target for current-diff review or a typed target for a PR number, PR URL, branch/range, or file/directory. A PR number SHALL require repository context from the working directory or an explicit owner/repository. Invalid or ambiguous target encodings MUST be rejected rather than interpreted as options.

#### Scenario: Current diff
- **WHEN** target is omitted
- **THEN** the slash command contains no target
- **AND** upstream reviews the committed upstream-to-HEAD diff and uncommitted changes according to its built-in behavior

#### Scenario: Pull request selection
- **WHEN** PR 123 and repository `owner/project` are supplied
- **THEN** the system selects `https://github.com/owner/project/pull/123` without requiring a checkout

#### Scenario: Branch range or path selection
- **WHEN** a supported branch, range, file, or directory target is supplied
- **THEN** the system passes that target without silently changing its meaning

#### Scenario: PR number without repository context
- **WHEN** a PR number is supplied outside a repository without an explicit owner/repository
- **THEN** the system reports that repository context is required before invoking review

### Requirement: Local effort selection
The system SHALL support `low`, `medium`, `high`, `xhigh`, and `max` as explicit review effort levels. Omitted effort SHALL default to an explicit `medium` slash-command argument rather than inheriting Claude's persisted setting. User-supplied effort SHALL override this default. Run metadata MUST identify the effective effort and whether it was defaulted or user-supplied.

#### Scenario: Explicit effort
- **WHEN** `effort` is `high`
- **THEN** the slash command contains `high` as its effort argument

#### Scenario: Default medium effort
- **WHEN** effort is omitted, regardless of Claude's persisted effort setting
- **THEN** the slash command contains `medium` as its effort argument
- **AND** the run metadata identifies effective effort as `medium` with a defaulted source

### Requirement: Finding limit selection
The system SHALL accept a positive integer, `all`, or `default` for the maximum finding count. Omission SHALL preserve upstream's persisted limit. Explicit values MUST map to `--max-findings` and metadata MUST distinguish explicit selection from inheritance.

#### Scenario: Cap or lift finding limit
- **WHEN** a positive integer or `all` is supplied
- **THEN** the command passes that value through `--max-findings`

#### Scenario: Reset finding limit
- **WHEN** `maxFindings` is `default`
- **THEN** the command passes `--max-findings default` to restore upstream's default

#### Scenario: Invalid finding limit
- **WHEN** a zero, negative, or fractional limit is supplied
- **THEN** the system rejects the request before starting a review

### Requirement: Explicit side-effect options
The system SHALL add `--fix` and `--comment` only when their respective typed booleans are true. Both SHALL default to false. Supplementary context MUST NOT be parsed to enable these options. The wrapper skill MUST obtain explicit user authorization for edits or publication and MUST NOT automatically retry these modes.

#### Scenario: Ordinary review
- **WHEN** neither side-effect option is requested
- **THEN** neither flag is included and the wrapper requests review without fixes or publication

#### Scenario: Explicit fixes and comments
- **WHEN** the user authorizes both actions and the corresponding booleans are true
- **THEN** both flags are passed to the built-in skill
- **AND** the wrapper warns that upstream can modify files and publish comments

#### Scenario: Context mentions publication
- **WHEN** context contains a suggestion to fix or post but the booleans remain false
- **THEN** the wrapper leaves both options disabled and communicates that context does not authorize those actions

#### Scenario: Commenting on a non-PR target
- **WHEN** commenting is explicitly enabled for a non-PR target
- **THEN** the flag is passed without inventing a PR target
- **AND** the built-in skill's explanation that commenting does not apply is retained in the output

### Requirement: Separate supplementary context
The system SHALL deliver optional context and wrapper policy in a preceding text block of one JSON-serialized stream-JSON user message, with only the canonical slash command in the final text block. Context MUST remain separate from target arguments and MUST NOT authorize option changes. The system MUST NOT modify project instructions, synthesize an earlier conversation, or rely on `--append-system-prompt` for supplementary-context delivery.

#### Scenario: Focused review context
- **WHEN** a PR target and multiline focus notes are supplied
- **THEN** the notes are included in the preceding text block and the final text block contains only the slash command with the unchanged target
- **AND** the message is sent as a single serialized stdin record, without an initialization handshake

#### Scenario: No context
- **WHEN** context is omitted
- **THEN** no supplementary context is synthesized from Pi's conversation or other files
- **AND** the wrapper-policy block remains present before the final slash-command block

### Requirement: Manual-only cloud review
The system MUST reject tool execution of `ultra` and cloud posting controls `--post`/`--no-post`, without launching a cloud job or silently selecting another level. It SHALL explain the reported interactive-only restriction and provide manual command guidance including billing and access caveats.

#### Scenario: Ultra requested
- **WHEN** a tool request selects `ultra`, with or without a cloud posting preference
- **THEN** the request fails before launching Claude review
- **AND** the response provides a manual `/code-review ultra` invocation and warns of billing and claude.ai access requirements

#### Scenario: Cloud posting option with local effort
- **WHEN** a cloud posting preference is combined with a local effort level
- **THEN** the system rejects the incompatible combination

### Requirement: Safe argument handling
The system MUST launch Claude without shell interpolation and validate inputs before review execution. User targets MUST NOT introduce extra slash-command flags or commands; targets that cannot be unambiguously represented by the wrapper's tested target-encoding rules SHALL produce an actionable validation error. Arbitrary user-supplied CLI arguments MUST NOT be exposed.

#### Scenario: Shell metacharacters
- **WHEN** context contains quotes, newlines, or shell metacharacters
- **THEN** JSON serialization retains them as data in the preceding text block rather than additional stdin records or slash-command arguments
- **AND** the final slash-command block stays unchanged and no host shell interpolation occurs

#### Scenario: Ambiguous target
- **WHEN** a target begins with a flag, contains a command-breaking newline, or collides with the built-in effort/option grammar
- **THEN** the system rejects it or uses a verified equivalent representation without changing the selected target

### Requirement: Default Claude permission bypass
The system SHALL include `--dangerously-skip-permissions` by default when launching Claude review. It MUST document that Claude permission checks are bypassed, recommend trusted or isolated environments, and distinguish bypass from the separately opt-in fix/comment flags. It MUST NOT claim that omitted fix/comment flags enforce read-only execution.

#### Scenario: Default review launch
- **WHEN** a valid review is launched with default options
- **THEN** Claude receives `--dangerously-skip-permissions`
- **AND** neither `--fix` nor `--comment` is included

#### Scenario: Permission bypass disclosure
- **WHEN** a user consults the wrapper skill or installation guidance
- **THEN** it explains the default permission bypass and broader execution access
- **AND** it recommends trusted or isolated execution environments without claiming a read-only sandbox

### Requirement: Working directory and bounded execution
The system SHALL default the working directory to Pi's current directory and accept an explicit existing directory. It SHALL support a timeout from 1 to 3600 seconds, defaulting to 1200, propagate cancellation, and terminate owned subprocesses on cancellation or timeout. These behaviors MUST work without interactive UI.

#### Scenario: Explicit directory
- **WHEN** an existing working directory is supplied
- **THEN** review runs there and reports the resolved directory

#### Scenario: Invalid directory
- **WHEN** the selected directory is absent or is a file
- **THEN** the system reports a validation error before launching review

#### Scenario: Cancelled or timed-out review
- **WHEN** cancellation occurs or the deadline expires
- **THEN** owned review subprocesses are terminated and available output is retained
- **AND** the result distinguishes cancellation from timeout and does not claim side effects were rolled back

### Requirement: Review results and logs
The system SHALL return readable output and structured metadata identifying the target, effective options, CLI version, working directory, duration, completion status, exit information, and full log path. Model-facing output SHALL be bounded to 2000 lines or 50 KiB, with a truncation notice. Full stdout and stderr SHALL be retained in a uniquely named restricted local log.

#### Scenario: Successful review
- **WHEN** Claude exits successfully
- **THEN** its findings or no-findings response is extracted from the final top-level result envelope using bounded incremental newline-delimited stream-JSON decoding and returned with completed execution metadata
- **AND** intermediate events are not presented as a completed review, and exit success is not interpreted as zero findings

#### Scenario: Failed review
- **WHEN** Claude fails or reports an execution error
- **THEN** the tool marks the run as failed and preserves diagnostics and available output

#### Scenario: Large output
- **WHEN** output exceeds the display limit
- **THEN** the response is truncated with an explicit notice and the complete local log path

#### Scenario: Invalid final result
- **WHEN** the final top-level result is missing, malformed, oversized, or duplicated
- **THEN** the system reports a protocol failure with retained logs rather than a successful empty review

#### Scenario: Large intermediate event
- **WHEN** an intermediate stream-JSON event exceeds the decoder's in-memory bound but a valid final result follows
- **THEN** the system retains the full event in the stdout log, discards its buffered remainder through the next newline, and continues decoding the final result
- **AND** it does not invent findings or mistake the intermediate event for a final review

### Requirement: Wrapper skill and installation guidance
The package SHALL include a discoverable wrapper skill documenting tool inputs, target examples, context delivery, inherited settings, side effects, manual-only options, and CLI compatibility, including the prerequisite that `/code-review` is not shadowed by a custom or legacy command. It MUST route supported requests through the tool and ask for clarification when the target or side-effect authorization is unclear.

#### Scenario: Wrapper use
- **WHEN** a user requests a PR review with extra focus context through the wrapper skill
- **THEN** the skill maps the request to structured tool inputs without constructing a shell command

#### Scenario: Ambiguous fix authorization
- **WHEN** a review request does not clearly authorize edits
- **THEN** the skill leaves fix mode off or asks for clarification rather than enabling it

#### Scenario: Package loaded
- **WHEN** the package is loaded in Pi
- **THEN** its review tool and wrapper skill are discoverable using the documented package resource paths
