CREATE VIEW `teacher_workspace_migration_chunks` AS 
  WITH RECURSIVE parts(part) AS (
    SELECT 0
    UNION ALL
    SELECT part + 1 FROM parts WHERE part < 127
  )
  SELECT w.owner_id, p.part, substr(w.data, p.part * 4000 + 1, 4000) AS chunk
  FROM teacher_workspaces w
  JOIN parts p ON p.part * 4000 < length(w.data)
;