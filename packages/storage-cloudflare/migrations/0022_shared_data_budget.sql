-- Shared data lives in D1, apart from the files in R2, so it has budgets of its own: per artifact, per workspace and
-- for the whole deployment. A counter keeps each total, so a write checks its budgets by reading three rows instead of
-- summing documents, and triggers keep the counters exact on every insert, change and delete, the deletes a purged
-- artifact cascades to included.
--
-- size_bytes is computed from data, so every row has it, those written by a Worker deployed before this migration too.
ALTER TABLE shared_documents ADD COLUMN size_bytes INTEGER GENERATED ALWAYS AS (length(CAST(data AS BLOB))) VIRTUAL;

-- No foreign key to artifacts: a purge deletes the artifact row before its cascade deletes the documents, and each of
-- those deletes still finds the artifact's workspace here. The row goes with the artifact's last document.
CREATE TABLE artifact_shared_usage (
  artifact_id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  documents INTEGER NOT NULL,
  bytes INTEGER NOT NULL
);

CREATE TABLE workspace_shared_usage (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  bytes INTEGER NOT NULL
);

CREATE TABLE deployment_shared_usage (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  bytes INTEGER NOT NULL
);

INSERT INTO artifact_shared_usage (artifact_id, workspace_id, documents, bytes)
  SELECT shared_documents.artifact_id, artifacts.workspace_id, COUNT(*), SUM(shared_documents.size_bytes)
  FROM shared_documents JOIN artifacts ON artifacts.id = shared_documents.artifact_id
  GROUP BY shared_documents.artifact_id;
INSERT INTO workspace_shared_usage (workspace_id, bytes) SELECT workspace_id, SUM(bytes) FROM artifact_shared_usage GROUP BY workspace_id;
INSERT INTO deployment_shared_usage (id, bytes) SELECT 1, COALESCE(SUM(bytes), 0) FROM artifact_shared_usage;

CREATE TRIGGER shared_documents_count_insert AFTER INSERT ON shared_documents
BEGIN
  INSERT INTO artifact_shared_usage (artifact_id, workspace_id, documents, bytes)
    SELECT NEW.artifact_id, workspace_id, 1, NEW.size_bytes FROM artifacts WHERE id = NEW.artifact_id
    ON CONFLICT (artifact_id) DO UPDATE SET documents = documents + 1, bytes = bytes + excluded.bytes;
  INSERT INTO workspace_shared_usage (workspace_id, bytes)
    SELECT workspace_id, NEW.size_bytes FROM artifacts WHERE id = NEW.artifact_id
    ON CONFLICT (workspace_id) DO UPDATE SET bytes = bytes + excluded.bytes;
  UPDATE deployment_shared_usage SET bytes = bytes + NEW.size_bytes;
END;

CREATE TRIGGER shared_documents_count_update AFTER UPDATE OF data ON shared_documents
BEGIN
  UPDATE workspace_shared_usage SET bytes = bytes + NEW.size_bytes - OLD.size_bytes
    WHERE workspace_id = (SELECT workspace_id FROM artifact_shared_usage WHERE artifact_id = NEW.artifact_id);
  UPDATE artifact_shared_usage SET bytes = bytes + NEW.size_bytes - OLD.size_bytes WHERE artifact_id = NEW.artifact_id;
  UPDATE deployment_shared_usage SET bytes = bytes + NEW.size_bytes - OLD.size_bytes;
END;

CREATE TRIGGER shared_documents_count_delete AFTER DELETE ON shared_documents
BEGIN
  UPDATE workspace_shared_usage SET bytes = bytes - OLD.size_bytes
    WHERE workspace_id = (SELECT workspace_id FROM artifact_shared_usage WHERE artifact_id = OLD.artifact_id);
  UPDATE artifact_shared_usage SET documents = documents - 1, bytes = bytes - OLD.size_bytes WHERE artifact_id = OLD.artifact_id;
  DELETE FROM artifact_shared_usage WHERE artifact_id = OLD.artifact_id AND documents = 0;
  UPDATE deployment_shared_usage SET bytes = bytes - OLD.size_bytes;
END;
