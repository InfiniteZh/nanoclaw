#!/usr/bin/env bash
set -euo pipefail

CLAUDE_HOME="${HOME}/.claude"
SESSIONS_DIR="/data/sessions"

mkdir -p "$CLAUDE_HOME/projects"

# Create a unified view: each nanoclaw group becomes a separate project
# in claude-code-viewer, named by the group identifier.
link_sessions() {
  if [ ! -d "$SESSIONS_DIR" ]; then
    echo "[viewer] No sessions directory found at $SESSIONS_DIR"
    return
  fi

  for group_dir in "$SESSIONS_DIR"/*/; do
    [ -d "$group_dir" ] || continue
    group_name=$(basename "$group_dir")
    [ "$group_name" = "tasks" ] && continue

    src="$group_dir.claude/projects"
    [ -d "$src" ] || continue

    # For each project inside this group's .claude/projects/
    for proj_dir in "$src"/*/; do
      [ -d "$proj_dir" ] || continue
      proj_name=$(basename "$proj_dir")

      # Target: ~/.claude/projects/{group_name}--{proj_name}/
      target="$CLAUDE_HOME/projects/${group_name}"
      mkdir -p "$target"

      # Symlink all JSONL files
      for jsonl in "$proj_dir"*.jsonl; do
        [ -f "$jsonl" ] || continue
        fname=$(basename "$jsonl")
        ln -sf "$jsonl" "$target/$fname"
      done
    done
  done

  echo "[viewer] Linked sessions from $SESSIONS_DIR into $CLAUDE_HOME/projects/"
  ls -la "$CLAUDE_HOME/projects/" 2>/dev/null || true
}

link_sessions

# Re-link sessions periodically in background (new groups may appear)
(
  while true; do
    sleep 30
    link_sessions 2>/dev/null
  done
) &

exec "$@"
