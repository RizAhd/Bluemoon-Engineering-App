import { setSetting, useFirst, useQuery, useSetting } from '@/db';
import type { Attachment, Project, Tool, Worker } from '@/db/types';

export function useProjects(includeCompleted = true) {
  return useQuery<Project>(
    `SELECT * FROM projects WHERE deleted_at IS NULL ${includeCompleted ? '' : "AND status != 'completed'"}
     ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, name COLLATE NOCASE`,
  );
}

export function useProject(id: string | null | undefined) {
  return useFirst<Project>('SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
}

/** The project the user is working on. `null` means "all projects". */
export function useCurrentProjectId(): string | null {
  const id = useSetting('current_project');
  const exists = useFirst<{ ok: number }>('SELECT 1 AS ok FROM projects WHERE id = ? AND deleted_at IS NULL', [id ?? '']);
  return id && exists ? id : null;
}

export function setCurrentProject(id: string | null) {
  setSetting('current_project', id);
}

export function useWorkers(activeOnly = false) {
  return useQuery<Worker>(
    `SELECT * FROM workers WHERE deleted_at IS NULL ${activeOnly ? 'AND active = 1' : ''} ORDER BY active DESC, name COLLATE NOCASE`,
  );
}

export function useTools() {
  return useQuery<Tool>('SELECT * FROM tools WHERE deleted_at IS NULL ORDER BY name COLLATE NOCASE');
}

export function useAttachments(ownerTable: string, ownerId: string | null | undefined) {
  return useQuery<Attachment>(
    'SELECT * FROM attachments WHERE owner_table = ? AND owner_id = ? AND deleted_at IS NULL ORDER BY created_at',
    [ownerTable, ownerId ?? ''],
  );
}

export function useAttachmentCounts(ownerTable: string) {
  const rows = useQuery<{ owner_id: string; n: number }>(
    'SELECT owner_id, COUNT(*) AS n FROM attachments WHERE owner_table = ? AND deleted_at IS NULL GROUP BY owner_id',
    [ownerTable],
  );
  return new Map(rows.map((r) => [r.owner_id, r.n]));
}
