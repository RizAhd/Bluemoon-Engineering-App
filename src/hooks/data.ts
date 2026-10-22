import { setSetting, useFirst, useQuery, useSetting } from '@/db';
import type { Attachment, Project, ProjectWorkerBalance, Tool, WageDay, Worker } from '@/db/types';

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

const EMPTY_PROJECT = '';

/** Workers assigned to a project with their balance there. `[]` when no project is chosen. Active first, then name. */
export function useProjectWorkers(projectId: string | null): ProjectWorkerBalance[] {
  const rows = useQuery<ProjectWorkerBalance>(
    'SELECT * FROM v_project_worker_balance WHERE project_id = ? ORDER BY active DESC, name COLLATE NOCASE',
    [projectId ?? EMPTY_PROJECT],
  );
  return projectId ? rows : [];
}

/** Work and pay per worker on one project for one day. `[]` when no project is chosen. */
export function useWageDay(projectId: string | null, day: string): WageDay[] {
  const rows = useQuery<WageDay>('SELECT * FROM v_wage_day WHERE project_id = ? AND day = ?', [projectId ?? EMPTY_PROJECT, day]);
  return projectId ? rows : [];
}

/** The projects a worker is assigned to, with their balance on each. */
export function useWorkerProjects(workerId: string): (ProjectWorkerBalance & { project_name: string })[] {
  return useQuery<ProjectWorkerBalance & { project_name: string }>(
    `SELECT b.*, p.name AS project_name
     FROM v_project_worker_balance b
     JOIN projects p ON p.id = b.project_id AND p.deleted_at IS NULL
     WHERE b.worker_id = ?
     ORDER BY CASE p.status WHEN 'active' THEN 0 WHEN 'on_hold' THEN 1 ELSE 2 END, b.active DESC, p.name COLLATE NOCASE`,
    [workerId],
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
