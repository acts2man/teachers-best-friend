DELETE FROM `teacher_workspace_migration_chunks`;
--> statement-breakpoint
WITH RECURSIVE parts(part) AS (
	SELECT 0
	UNION ALL
	SELECT part + 1 FROM parts WHERE part < 255
)
INSERT INTO `teacher_workspace_migration_chunks` (`owner_id`, `part`, `chunk`)
SELECT w.`owner_id`, p.`part`, substr(w.`data`, p.`part` * 1500 + 1, 1500)
FROM `teacher_workspaces` w
JOIN parts p ON p.`part` * 1500 < length(w.`data`);
--> statement-breakpoint
CREATE INDEX `idx_teacher_workspace_migration_chunks_part` ON `teacher_workspace_migration_chunks` (`part`);
