// Shared helpers for Claude Code hooks in this repo. No dependencies, Node >= 20.
// Hooks are developer guardrails, not a security boundary: on malformed input they fail open
// (exit 0 with a note on stderr) so a broken hook never locks the session.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** Reads and parses the hook JSON payload from stdin. */
export function readInput() {
  try {
    const raw = readFileSync(0, 'utf8');
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (error) {
    process.stderr.write(`[hook] could not parse input: ${error.message}\n`);
    process.exit(0);
  }
}

/** Absolute project root. */
export function projectDir(input) {
  return process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
}

/** Repo-relative POSIX path for a (possibly absolute) file path. */
export function toRelative(filePath, root) {
  const abs = path.resolve(root, filePath);
  return path.relative(root, abs).split(path.sep).join('/');
}

/** PreToolUse: block the tool call, reason is shown to Claude. */
export function deny(reason) {
  emit({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason },
  });
}

/** PreToolUse: require explicit user confirmation. */
export function ask(reason) {
  emit({
    hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: reason },
  });
}

/** PostToolUse / Stop: feed a reason back to Claude so it acts on it. */
export function block(reason) {
  emit({ decision: 'block', reason });
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload));
  process.exit(0);
}
