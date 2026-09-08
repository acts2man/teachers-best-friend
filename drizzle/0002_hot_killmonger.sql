DROP VIEW `teacher_workspace_migration_chunks`;
--> statement-breakpoint
CREATE TABLE `teacher_workspace_migration_chunks` (
	`owner_id` text NOT NULL,
	`part` integer NOT NULL,
	`chunk` text NOT NULL
);
--> statement-breakpoint
WITH RECURSIVE parts(part) AS (
	SELECT 0
	UNION ALL
	SELECT part + 1 FROM parts WHERE part < 127
)
INSERT INTO `teacher_workspace_migration_chunks` (`owner_id`, `part`, `chunk`)
SELECT w.`owner_id`, p.`part`, substr(w.`data`, p.`part` * 4000 + 1, 4000)
FROM `teacher_workspaces` w
JOIN parts p ON p.`part` * 4000 < length(w.`data`);
