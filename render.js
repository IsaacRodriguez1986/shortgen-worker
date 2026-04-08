import { bundle } from "@remotion/bundler";
import { renderMedia, selectComposition } from "@remotion/renderer";
import { readFileSync, existsSync, mkdirSync, rmSync } from "fs";
import { execSync } from "child_process";
import path from "path";

const WORK_DIR = "/tmp/viratronik-renders";
let cachedBundle = null;

async function getBundle() {
  if (cachedBundle) return cachedBundle;
  console.log("[REMOTION] Bundling...");
  const s = Date.now();
  cachedBundle = await bundle({
    entryPoint: path.resolve("./remotion/index.ts"),
    webpackOverride: (c) => c,
  });
  console.log(`[REMOTION] Bundle ready (${((Date.now()-s)/1000).toFixed(1)}s)`);
  return cachedBundle;
}

function isVideoUrl(url) {
  if (!url) return false;
  return url.includes(".mp4") || url.includes(".webm") || url.includes(".mov") || url.includes("pexels.com/video");
}

export async function renderVideo(job) {
  const dir = path.join(WORK_DIR, job.videoId);
  mkdirSync(dir, { recursive: true });
  try {
    const bundleLocation = await getBundle();
    const scenes = job.scenes.map((s) => ({
      voiceUrl: s.voiceUrl || "", visualUrl: s.visualUrl || "",
      narration: s.narration || "", duration: s.duration || 5,
      isVideo: isVideoUrl(s.visualUrl),
    }));
    const totalFrames = scenes.reduce((sum, s) => sum + Math.round(s.duration * 30), 0);
    const inputProps = {
      scenes, subtitleStyle: job.subtitleStyle || "hormozi",
      musicUrl: job.musicUrl || null, musicVolume: (job.musicVolume || 20) / 100,
    };
    console.log(`[${job.videoId}] Rendering ${scenes.length} scenes (${totalFrames} frames)...`);
    const comp = await selectComposition({ serveUrl: bundleLocation, id: "ShortVideo", inputProps });
    comp.durationInFrames = totalFrames; comp.fps = 30; comp.width = 1080; comp.height = 1920;
    const out = path.join(dir, "output.mp4");
    const s = Date.now();
    await renderMedia({
      composition: comp, serveUrl: bundleLocation, codec: "h264",
      outputLocation: out, inputProps, concurrency: 2,
      chromiumOptions: { disableWebSecurity: true },
    });
    console.log(`[${job.videoId}] Render done (${((Date.now()-s)/1000).toFixed(1)}s)`);
    const buf = readFileSync(out);
    const outputUrl = await upload(`renders/${job.videoId}/final.mp4`, buf, "video/mp4");
    let thumbnailUrl = null;
    const thumb = path.join(dir, "thumb.jpg");
    try {
      execSync(`ffmpeg -y -i "${out}" -ss 1 -vframes 1 -q:v 2 "${thumb}"`, { timeout: 10000, stdio: "pipe" });
      if (existsSync(thumb)) thumbnailUrl = await upload(`renders/${job.videoId}/thumb.jpg`, readFileSync(thumb), "image/jpeg");
    } catch {}
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    const dur = Math.round(totalFrames / 30);
    console.log(`[${job.videoId}] DONE — ${dur}s, ${(buf.length/(1024*1024)).toFixed(1)}MB`);
    return { outputUrl, thumbnailUrl, durationSeconds: dur };
  } catch (e) {
    try { rmSync(dir, { recursive: true, force: true }); } catch {}
    throw e;
  }
}

async function upload(fp, buf, ct) {
  const u = process.env.SUPABASE_URL, k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!u || !k) throw new Error("Supabase not configured");
  const r = await fetch(`${u}/storage/v1/object/videos/${fp}`, {
    method: "POST", headers: { Authorization: `Bearer ${k}`, "Content-Type": ct, "x-upsert": "true" }, body: buf,
  });
  if (!r.ok) throw new Error(`Upload failed: ${await r.text()}`);
  return `${u}/storage/v1/object/public/videos/${fp}`;
}
