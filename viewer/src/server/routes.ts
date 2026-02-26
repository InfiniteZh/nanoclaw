import { Hono } from "hono";
import { listProjects } from "./project-service.js";
import { listSessions, getSession } from "./session-service.js";
import { listTasks, listTaskSessions, getTaskSession } from "./task-service.js";

const api = new Hono();

api.get("/api/projects", async (c) => {
  const projects = await listProjects();
  return c.json(projects);
});

api.get("/api/projects/:id", async (c) => {
  const id = c.req.param("id");
  const sessions = await listSessions(id);
  return c.json(sessions);
});

api.get("/api/projects/:id/sessions/:sid", async (c) => {
  const id = c.req.param("id");
  const sid = c.req.param("sid");
  try {
    const { entries, toolResults, subagents } = await getSession(id, sid);
    // Convert Map to plain object for JSON serialization
    const toolResultsObj: Record<string, unknown> = {};
    for (const [k, v] of toolResults) {
      toolResultsObj[k] = v;
    }
    return c.json({ entries, toolResults: toolResultsObj, subagents });
  } catch {
    return c.json({ error: "Session not found" }, 404);
  }
});

// Task routes
api.get("/api/tasks", async (c) => {
  const tasks = await listTasks();
  return c.json(tasks);
});

api.get("/api/tasks/:taskId", async (c) => {
  const taskId = c.req.param("taskId");
  const sessions = await listTaskSessions(taskId);
  return c.json(sessions);
});

api.get("/api/tasks/:taskId/sessions/:sid", async (c) => {
  const taskId = c.req.param("taskId");
  const sid = c.req.param("sid");
  try {
    const { entries, toolResults, subagents } = await getTaskSession(taskId, sid);
    const toolResultsObj: Record<string, unknown> = {};
    for (const [k, v] of toolResults) {
      toolResultsObj[k] = v;
    }
    return c.json({ entries, toolResults: toolResultsObj, subagents });
  } catch {
    return c.json({ error: "Session not found" }, 404);
  }
});

export { api };
