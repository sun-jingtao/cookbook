import { tool } from "langchain";
import * as z from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 构建目录：agent 生成的应用全部写在这里（默认 ./app-output，可用
 * APP_BUILDER_DIR 覆盖）。所有读写都限制在此目录内，防止路径穿越，
 * 对应原案例「隔离的预览工作区」。
 */
export const BUILD_DIR = path.resolve(process.cwd(), process.env.APP_BUILDER_DIR ?? "app-output");
const IGNORED = new Set(["node_modules", ".git", ".DS_Store"]);
const MAX_FILE_BYTES = 128 * 1024;

function resolveInside(relPath: string): string {
  const abs = path.resolve(BUILD_DIR, relPath);
  if (abs !== BUILD_DIR && !abs.startsWith(BUILD_DIR + path.sep)) {
    throw new Error(`路径越界，仅允许访问构建目录内：${relPath}`);
  }
  return abs;
}

export const listFiles = tool(
  async ({ dir }: { dir?: string }) => {
    const target = resolveInside(dir ?? ".");
    const entries = await fs.readdir(target, { withFileTypes: true }).catch(() => []);
    const lines = entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return lines.length > 0 ? lines.join("\n") : "(空目录)";
  },
  {
    name: "list_files",
    description: "列出构建目录（或其子目录）中已有的文件，用于了解当前应用结构。",
    schema: z.object({
      dir: z.string().optional().describe("相对构建目录的路径，默认 '.'"),
    }),
  },
);

export const readFile = tool(
  async ({ path: relPath }: { path: string }) => {
    const abs = resolveInside(relPath);
    const buf = await fs.readFile(abs);
    const text = buf.subarray(0, MAX_FILE_BYTES).toString("utf8");
    return buf.byteLength > MAX_FILE_BYTES ? `${text}\n…(文件较大，已截断)` : text;
  },
  {
    name: "read_file",
    description: "读取构建目录内某个文件的当前内容，便于在其基础上迭代修改。",
    schema: z.object({
      path: z.string().describe("相对构建目录的文件路径，如 'index.html'"),
    }),
  },
);

export const writeFile = tool(
  async ({ path: relPath, content }: { path: string; content: string }) => {
    const abs = resolveInside(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, "utf8");
    return `已写入 ${relPath}（${Buffer.byteLength(content, "utf8")} 字节）`;
  },
  {
    name: "write_file",
    description: "把内容写入构建目录内的文件（覆盖或新建），用于搭建或迭代应用。会自动创建父目录。",
    schema: z.object({
      path: z.string().describe("相对构建目录的文件路径，如 'index.html'、'app.js'"),
      content: z.string().describe("文件的完整内容"),
    }),
  },
);

export const tools = [listFiles, readFile, writeFile];
