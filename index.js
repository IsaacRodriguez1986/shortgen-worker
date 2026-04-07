import express from "express";
import { existsSync } from "fs";
import { renderVideo } from "./render.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

const WORKER_SECRET = process.env.RENDER_WORKER_SECRET || "dev-secret";

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== WORKER_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

app.get("/health", (req, res) => {
  const fontPaths = [
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
  ];
  const fontFound = fontPaths.find(p => existsSync(p)) || null;
  res.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    memory: process.memoryUsage(),
    fontFound,
    version: "2.1-fonts",
  });
});

// Debug: synchronous test render — returns result directly
app.post("/render-test", authMiddleware, async (req, res) => {
  // Capture console output for debugging
  const logs = [];
  const origLog = console.log;
  const origWarn = console.warn;
  const origErr = console.error;
  console.log = (...args) => { logs.push(`LOG: ${args.join(" ")}`); origLog(...args); };
  console.warn = (...args) => { logs.push(`WARN: ${args.join(" ")}`); origWarn(...args); };
  console.error = (...args) => { logs.push(`ERR: ${args.join(" ")}`); origErr(...args); };

  try {
    const result = await renderVideo(req.body);
    console.log = origLog; console.warn = origWarn; console.error = origErr;
    res.json({ status: "ok", result, logs });
  } catch (err) {
    console.log = origLog; console.warn = origWarn; console.error = origErr;
    res.json({ status: "error", error: err.message, logs, stack: err.stack?.split("\n").slice(0, 5) });
  }
});

app.post("/render", authMiddleware, async (req, res) => {
  const job = req.body;

  if (!job.videoId || !job.scenes || !job.callbackUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Respond immediately
  res.json({ status: "accepted", videoId: job.videoId });

  // Dynamic timeout: 3 min per scene + 2 min buffer (minimum 4 minutes)
  const timeoutMs = Math.max((job.scenes.length * 180000) + 120000, 240000);
  const timeout = setTimeout(async () => {
    console.error(`[RENDER] TIMEOUT for video ${job.videoId} after ${timeoutMs / 1000}s`);
    await sendCallback(job.callbackUrl, {
      videoId: job.videoId,
      error: `Render timeout after ${Math.round(timeoutMs / 60000)} minutes`
    });
  }, timeoutMs);

  try {
    console.log(`[RENDER] Starting video ${job.videoId} (${job.scenes.length} scenes)`);
    const result = await renderVideo(job);
    clearTimeout(timeout);
    console.log(`[RENDER] Done! ${job.videoId} → ${result.outputUrl}`);

    await sendCallback(job.callbackUrl, {
      videoId: job.videoId,
      outputUrl: result.outputUrl,
      thumbnailUrl: result.thumbnailUrl,
      durationSeconds: result.durationSeconds,
    });
  } catch (error) {
    clearTimeout(timeout);
    console.error(`[RENDER] FAILED ${job.videoId}:`, error.message);
    console.error(error.stack);

    await sendCallback(job.callbackUrl, {
      videoId: job.videoId,
      error: error.message,
    });
  }
});

async function sendCallback(url, body) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": WORKER_SECRET,
      },
      body: JSON.stringify(body),
    });
    console.log(`[CALLBACK] ${url} → ${res.status}`);
  } catch (err) {
    console.error(`[CALLBACK] FAILED: ${err.message}`);
  }
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[WORKER] Running on port ${PORT}`);
  console.log(`[WORKER] Memory: ${JSON.stringify(process.memoryUsage())}`);
});

// Log unhandled errors
process.on("unhandledRejection", (err) => {
  console.error("[WORKER] Unhandled rejection:", err);
});
process.on("uncaughtException", (err) => {
  console.error("[WORKER] Uncaught exception:", err);
});
