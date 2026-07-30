import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname);
const vite = resolve(root, "../node_modules/vite/bin/vite.js");
const chromeCandidates = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
];
const chrome = chromeCandidates.find(existsSync);
if (!chrome) throw new Error("Chrome or Edge is required for computed geometry tests.");

const port = 4179;
const server = spawn(process.execPath, [vite, "--config", "vite.config.ts", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], {
  cwd: root,
  stdio: ["ignore", "pipe", "pipe"],
});

const waitForServer = () => new Promise((resolveReady, reject) => {
  const timeout = setTimeout(() => reject(new Error("Timed out starting geometry test server.")), 20_000);
  const inspect = (chunk) => {
    const output = chunk.toString();
    if (output.includes("Local:") || output.includes("ready in")) {
      clearTimeout(timeout);
      resolveReady();
    }
  };
  server.stdout.on("data", inspect);
  server.stderr.on("data", inspect);
  server.on("exit", (code) => reject(new Error(`Geometry test server exited with ${code}.`)));
});

const delay = (milliseconds) => new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));

async function runChrome(density, width, height) {
  const debuggingPort = 9229;
  const profileDirectory = mkdtempSync(join(tmpdir(), "erve-density-chrome-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${debuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    "about:blank",
  ], { stdio: "ignore" });

  try {
    let page;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      try {
        const targets = await fetch(`http://127.0.0.1:${debuggingPort}/json`).then((response) => response.json());
        page = targets.find((target) => target.type === "page");
        if (page) break;
      } catch {
        // Chrome may not have opened its DevTools socket yet.
      }
      await delay(50);
    }
    if (!page) throw new Error("Chrome DevTools endpoint did not become ready.");

    const socket = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener("open", resolveOpen, { once: true });
      socket.addEventListener("error", rejectOpen, { once: true });
    });
    let commandId = 0;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const { resolveCommand, rejectCommand } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) rejectCommand(new Error(message.error.message));
        else resolveCommand(message.result);
      }
    });
    const command = (method, params = {}) => new Promise((resolveCommand, rejectCommand) => {
      const id = ++commandId;
      pending.set(id, { resolveCommand, rejectCommand });
      socket.send(JSON.stringify({ id, method, params }));
    });

    await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await command("Page.navigate", { url: `http://127.0.0.1:${port}/?density=${density}` });

    let result;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const evaluation = await command("Runtime.evaluate", {
        expression: `(() => { const node = document.querySelector('#geometry-result'); return node ? { status: node.dataset.status, text: node.textContent } : null; })()`,
        returnByValue: true,
      });
      result = evaluation.result.value;
      if (result) break;
      await delay(100);
    }
    if (!result) throw new Error("Geometry result did not render.");
    const payload = JSON.parse(result.text);
    if (result.status !== "pass") throw new Error(`${density} ${width}x${height}: ${payload.failures.join(", ")}`);
    if (process.env.ERVE_GEOMETRY_SCREENSHOTS === "1") {
      const screenshot = await command("Page.captureScreenshot", { format: "png", fromSurface: true });
      const screenshotPath = join(tmpdir(), `erve-density-${density}-${width}x${height}.png`);
      writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
      process.stdout.write(`screenshot ${screenshotPath}\n`);
    }
    await command("Browser.close").catch(() => {});
    socket.close();
    await delay(300);
    return payload.measurements;
  } finally {
    child.kill();
    await delay(100);
    try {
      rmSync(profileDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch {
      // Windows can briefly retain Chrome profile locks after Browser.close.
    }
  }
}

try {
  await waitForServer();
  for (const scenario of [["touch", 390, 844], ["compact", 1440, 900], ["compact", 320, 800]]) {
    const measurements = await runChrome(...scenario);
    process.stdout.write(`${scenario.join(" ")} ${JSON.stringify(measurements)}\n`);
  }
} finally {
  server.kill();
}
