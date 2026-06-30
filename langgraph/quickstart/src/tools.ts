import { tool } from "langchain";
import * as z from "zod";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * 工作目录边界：所有文件访问都限制在启动时的 cwd 内，防止路径穿越。
 * 这复刻了 Cursor SDK 中 `local: { cwd }` 让 Agent「在某个项目目录内工作」的语义。
 */
const ROOT = process.cwd();
const IGNORED = new Set(["node_modules", ".git", "dist", ".next", ".turbo", ".DS_Store"]);
const MAX_FILE_BYTES = 64 * 1024;

function resolveInside(relPath: string): string {
  const abs = path.resolve(ROOT, relPath);
  if (abs !== ROOT && !abs.startsWith(ROOT + path.sep)) {
    throw new Error(`路径越界，仅允许访问工作目录内：${relPath}`);
  }
  return abs;
}

export const listFiles = tool(
  async ({ dir }: { dir?: string }) => {
    const target = resolveInside(dir ?? ".");
    const entries = await fs.readdir(target, { withFileTypes: true });
    const lines = entries
      .filter((e) => !IGNORED.has(e.name))
      .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
      .sort();
    return lines.length > 0 ? lines.join("\n") : "(空目录)";
  },
  {
    name: "list_files",
    description: "列出工作目录（或其子目录）中的文件与子目录，用于了解项目结构。",
    schema: z.object({
      dir: z.string().optional().describe("相对工作目录的路径，默认当前目录 '.'"),
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
    description: "读取工作目录内某个文件的文本内容，用于查看 README、package.json、源码等。",
    schema: z.object({
      path: z.string().describe("相对工作目录的文件路径，如 'package.json'、'src/index.ts'"),
    }),
  },
);

export const tools = [listFiles, readFile];

/** 把消息内容（可能是字符串或内容块数组）抽取为可打印的纯文本。 */
export function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        typeof block === "string"
          ? block
          : block && typeof block === "object" && (block as { type?: string }).type === "text"
            ? ((block as { text?: string }).text ?? "")
            : "",
      )
      .join("");
  }
  return "";
}
