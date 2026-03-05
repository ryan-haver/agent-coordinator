-- TimescaleDB DDL for agent-coordinator telemetry.
-- Applied once on first connection by the telemetry client.

CREATE TABLE IF NOT EXISTS tool_calls (
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id   TEXT        NOT NULL DEFAULT '',
    workspace    TEXT        NOT NULL DEFAULT '',
    agent_id     TEXT        NOT NULL DEFAULT '',
    tool_name    TEXT        NOT NULL,
    phase        TEXT        NOT NULL DEFAULT '',
    duration_ms  INTEGER     NOT NULL DEFAULT 0,
    success      BOOLEAN     NOT NULL DEFAULT TRUE,
    error_msg    TEXT        NOT NULL DEFAULT '',
    args_summary TEXT        NOT NULL DEFAULT ''
);

SELECT create_hypertable('tool_calls', by_range('ts'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session   ON tool_calls (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_agent     ON tool_calls (agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool      ON tool_calls (tool_name, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_workspace ON tool_calls (workspace, ts DESC);
CREATE INDEX IF NOT EXISTS idx_tool_calls_success   ON tool_calls (success, ts DESC);
