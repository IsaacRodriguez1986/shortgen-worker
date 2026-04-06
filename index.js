import express from "express";
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
  res.json({ status: "ok", timestamp: new Date().toISOString(), memory: process.memoryUsage() });
});

app.post("/render", authMiddleware, async (req, res) => {
  const job = req.body;

  if (!job.videoId || !job.scenes || !job.callbackUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Respond immediately
  res.json({ status: "accepted", videoId: job.videoId });

  // Process with timeout (4 minutes max)
  const timeout = setTimeout(async () => {
    console.error(`[RENDER] TIMEOUT for video ${job.videoId}`);
    await sendCallback(job.callbackUrl, {
      videoId: job.videoId,
      error: "Render timeout after 4 minutes"
    });
  }, 240000);

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
