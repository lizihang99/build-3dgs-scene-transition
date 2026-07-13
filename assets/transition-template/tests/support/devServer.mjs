import { spawn } from "node:child_process";
import { resolve } from "node:path";

export function startDevServer(appDir, port) {
  return spawn(process.execPath, [resolve(appDir, "node_modules", "vite", "bin", "vite.js"), "--host", "127.0.0.1", "--port", String(port)], {
    cwd: appDir,
    env: { ...process.env, BROWSER: "none" },
    stdio: ["ignore", "pipe", "pipe"]
  });
}

export async function stopDevServer(server, timeoutMs = 1500) {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const onExit = new Promise((resolve) => server.once("exit", resolve));
  try {
    server.kill("SIGTERM");
  } catch {
    return;
  }
  const timedOut = await Promise.race([
    onExit.then(() => false),
    new Promise((resolve) => setTimeout(() => resolve(true), timeoutMs))
  ]);
  if (timedOut && server.exitCode === null) {
    try {
      server.kill("SIGKILL");
    } catch {
      return;
    }
    await onExit;
  }
}
