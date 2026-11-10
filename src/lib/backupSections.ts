// §82: the parts a backup can hold, in display order. A leaf module with no imports, so the
// Worker's tool schema (src/server/handleAgentRequest.ts, run under plain node in tests) can
// list them without loading the backup logic itself (src/lib/backupJson.ts).
export const BACKUP_SECTIONS = [
  "habits",
  "recurringTasks",
  "singleTasksOpen",
  "habitHistory",
  "recurringTaskHistory",
  "singleTasksDone",
  "categories",
  "goals",
  "weekStart",
] as const;
export type BackupSection = (typeof BACKUP_SECTIONS)[number];
