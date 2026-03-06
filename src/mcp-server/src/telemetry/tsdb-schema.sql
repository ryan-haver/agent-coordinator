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

-- ── Agent Events (lifecycle tracking) ────────────────────────────────

CREATE TABLE IF NOT EXISTS agent_events (
    ts           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_id   TEXT        NOT NULL DEFAULT '',
    workspace    TEXT        NOT NULL DEFAULT '',
    agent_id     TEXT        NOT NULL DEFAULT '',
    event_type   TEXT        NOT NULL,  -- status_change, file_claim, file_release, phase_advance, issue_report
    phase        TEXT        NOT NULL DEFAULT '',
    model        TEXT        NOT NULL DEFAULT '',
    detail       JSONB       NOT NULL DEFAULT '{}',
    duration_ms  INTEGER     NOT NULL DEFAULT 0
);

SELECT create_hypertable('agent_events', by_range('ts'), if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_agent_events_session ON agent_events (session_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent   ON agent_events (agent_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_type    ON agent_events (event_type, ts DESC);

-- ── Model Performance (continuous aggregate) ─────────────────────────

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_matviews WHERE matviewname = 'model_performance'
    ) THEN
        EXECUTE $view$
            CREATE MATERIALIZED VIEW model_performance
            WITH (timescaledb.continuous) AS
            SELECT
                time_bucket('1 hour', ts) AS bucket,
                agent_id,
                tool_name,
                COUNT(*)                                    AS total_calls,
                AVG(duration_ms)::int                       AS avg_duration_ms,
                COUNT(*) FILTER (WHERE NOT success)         AS failures,
                COUNT(*) FILTER (WHERE success)             AS successes
            FROM tool_calls
            GROUP BY bucket, agent_id, tool_name
            WITH NO DATA
        $view$;
    END IF;
END $$;
