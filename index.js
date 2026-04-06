import express from "express";
import { renderVideo } from "./render.js";

const app = express();
app.use(express.json({ limit: "50mb" }));

const WORKER_SECRET = process.env.RENDER_WORKER_SECRET || "dev-secret";

// Auth middleware
function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (token !== WORKER_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Render endpoint
app.post("/render", authMiddleware, async (req, res) => {
  const job = req.body;

  if (!job.videoId || !job.scenes || !job.callbackUrl) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  // Respond immediately, process in background
  res.json({ status: "accepted", videoId: job.videoId });

  // Process render in background
  try {
    console.log(`[RENDER] Starting job for video ${job.videoId}`);
    const result = await renderVideo(job);
    console.log(`[RENDER] Completed video ${job.videoId}`);

    // Callback to Vercel
    await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": WORKER_SECRET,
      },
      body: JSON.stringify({
        videoId: job.videoId,
        outputUrl: result.outputUrl,
        thumbnailUrl: result.thumbnailUrl,
        durationSeconds: result.durationSeconds,
      }),
    });
  } catch (error) {
    console.error(`[RENDER] Failed video ${job.videoId}:`, error);

    // Callback with error
    await fetch(job.callbackUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Worker-Secret": WORKER_SECRET,
      },
      body: JSON.stringify({
        videoId: job.videoId,
        error: error.message,
      }),
    }).catch(() => {});
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`[WORKER] Render worker running on port ${PORT}`);
});
