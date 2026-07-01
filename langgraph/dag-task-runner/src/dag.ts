/**
 * DAG 文件的解析、校验、环检测与分层（Kahn 算法）。
 * 形态刻意做得很小 —— 见 ../examples/example_dag.json。
 *
 * 这部分与框架无关，从原 Cursor SDK 案例移植精简而来。环检测在
 * 编译成 LangGraph 图之前先行，能给出比图运行期更清晰的错误。
 */

export type Complexity = "HIGH" | "MED" | "LOW";

export interface Task {
  id: string;
  depends_on: string[];
  complexity: Complexity;
  subtask_prompt: string;
}

export interface DAG {
  title: string;
  tasks: Task[];
}

const COMPLEXITY_VALUES = new Set<Complexity>(["HIGH", "MED", "LOW"]);

export function parseDAG(raw: unknown): DAG {
  if (!raw || typeof raw !== "object") {
    throw new Error("DAG 文件必须是一个 JSON 对象。");
  }
  const obj = raw as Record<string, unknown>;
  if (typeof obj.title !== "string" || obj.title.trim() === "") {
    throw new Error("DAG.title 必须是非空字符串。");
  }
  if (!Array.isArray(obj.tasks) || obj.tasks.length === 0) {
    throw new Error("DAG.tasks 必须是非空数组。");
  }

  const tasks = obj.tasks.map((t, i) => validateTask(t, i));
  const ids = new Set<string>();
  for (const t of tasks) {
    if (ids.has(t.id)) throw new Error(`重复的 task id：${t.id}`);
    ids.add(t.id);
  }
  for (const t of tasks) {
    for (const dep of t.depends_on) {
      if (!ids.has(dep)) throw new Error(`任务 ${t.id} 依赖了未知 id：${dep}`);
      if (dep === t.id) throw new Error(`任务 ${t.id} 依赖了自身。`);
    }
  }

  detectCycle(tasks);
  return { title: obj.title, tasks };
}

function validateTask(raw: unknown, index: number): Task {
  if (!raw || typeof raw !== "object") {
    throw new Error(`tasks[${index}] 必须是对象。`);
  }
  const t = raw as Record<string, unknown>;
  if (typeof t.id !== "string" || t.id.trim() === "") {
    throw new Error(`tasks[${index}].id 必须是非空字符串。`);
  }
  const depends_on = t.depends_on ?? [];
  if (!Array.isArray(depends_on) || depends_on.some((d) => typeof d !== "string")) {
    throw new Error(`tasks[${index}].depends_on 必须是字符串数组。`);
  }
  if (typeof t.complexity !== "string" || !COMPLEXITY_VALUES.has(t.complexity as Complexity)) {
    throw new Error(`tasks[${index}].complexity 必须是 HIGH | MED | LOW 之一。`);
  }
  if (typeof t.subtask_prompt !== "string" || t.subtask_prompt.trim() === "") {
    throw new Error(`tasks[${index}].subtask_prompt 必须是非空字符串。`);
  }
  return {
    id: t.id,
    depends_on: [...new Set(depends_on as string[])],
    complexity: t.complexity as Complexity,
    subtask_prompt: t.subtask_prompt,
  };
}

/** 迭代式 DFS + 递归栈，发现第一个环即抛错。 */
function detectCycle(tasks: Task[]): void {
  const adj = new Map<string, string[]>();
  for (const t of tasks) adj.set(t.id, []);
  for (const t of tasks) {
    for (const dep of t.depends_on) adj.get(dep)!.push(t.id);
  }

  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const t of tasks) color.set(t.id, WHITE);

  for (const start of tasks) {
    if (color.get(start.id) !== WHITE) continue;
    const stack: Array<{ id: string; childIdx: number }> = [{ id: start.id, childIdx: 0 }];
    const path: string[] = [start.id];
    color.set(start.id, GRAY);

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const children = adj.get(top.id)!;
      if (top.childIdx >= children.length) {
        color.set(top.id, BLACK);
        path.pop();
        stack.pop();
        continue;
      }
      const child = children[top.childIdx++];
      const cColor = color.get(child) ?? WHITE;
      if (cColor === GRAY) {
        const cycle = [...path.slice(path.indexOf(child)), child].join(" -> ");
        throw new Error(`检测到环：${cycle}`);
      }
      if (cColor === WHITE) {
        color.set(child, GRAY);
        path.push(child);
        stack.push({ id: child, childIdx: 0 });
      }
    }
  }
}

/**
 * Kahn 算法 —— 把任务按 rank 分层，仅用于运行前打印执行计划。
 * 同一层内的任务彼此无依赖，LangGraph 会自动并行它们。
 */
export function computeRanks(dag: DAG): Task[][] {
  const remaining = new Map<string, number>();
  const byId = new Map<string, Task>();
  for (const t of dag.tasks) {
    remaining.set(t.id, t.depends_on.length);
    byId.set(t.id, t);
  }
  const dependents = new Map<string, string[]>();
  for (const t of dag.tasks) dependents.set(t.id, []);
  for (const t of dag.tasks) {
    for (const dep of t.depends_on) dependents.get(dep)!.push(t.id);
  }

  const ranks: Task[][] = [];
  let frontier = dag.tasks.filter((t) => remaining.get(t.id) === 0);
  while (frontier.length > 0) {
    ranks.push(frontier);
    const next: Task[] = [];
    for (const t of frontier) {
      for (const child of dependents.get(t.id)!) {
        const r = remaining.get(child)! - 1;
        remaining.set(child, r);
        if (r === 0) next.push(byId.get(child)!);
      }
    }
    frontier = next;
  }
  return ranks;
}
