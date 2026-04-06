import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import path from "path";

const WORK_DIR = "/tmp/shortgen-renders";

export async function renderVideo(job) {
  const jobDir = path.join(WORK_DIR, job.videoId);
  mkdirSync(jobDir, { recursive: true });

  try {
    // Step 1: Download assets (streaming to avoid memory issues)
    console.log(`[${job.videoId}] Downloading ${job.scenes.length} scenes...`);
    const sceneFiles = [];

    for (let i = 0; i < job.scenes.length; i++) {
      const scene = job.scenes[i];
      const voicePath = path.join(jobDir, `voice_${i}.wav`);

      if (!scene.voiceUrl || !scene.voiceUrl.startsWith("http")) {
        console.warn(`[${job.videoId}] Scene ${i}: no voice, skipping`);
        continue;
      }

      // Download voice (streaming)
      await streamDownload(scene.voiceUrl, voicePath);
      console.log(`[${job.videoId}] Voice ${i}: downloaded`);

      // Download visual
      let visualPath = path.join(jobDir, `visual_${i}.png`);
      let isVideo = false;

      if (scene.visualUrl && scene.visualUrl.startsWith("http")) {
        // Detect type from URL first
        isVideo = scene.visualUrl.includes(".mp4") || scene.visualUrl.includes("video");
        visualPath = path.join(jobDir, `visual_${i}.${isVideo ? "mp4" : "png"}`);
        await streamDownload(scene.visualUrl, visualPath);
        console.log(`[${job.videoId}] Visual ${i}: downloaded (${isVideo ? "video" : "image"})`);
      } else {
        // Create black frame
        execSync(`ffmpeg -y -f lavfi -i color=c=black:s=1080x1920 -frames:v 1 "${visualPath}"`, { timeout: 5000, stdio: "pipe" });
      }

      sceneFiles.push({ voicePath, visualPath, isVideo });
    }

    if (sceneFiles.length === 0) throw new Error("No scenes downloaded");

    // Step 2: Compose clips
    console.log(`[${job.videoId}] Composing ${sceneFiles.length} clips...`);
    const clips = [];

    for (let i = 0; i < sceneFiles.length; i++) {
      const { voicePath, visualPath, isVideo } = sceneFiles[i];
      const clipPath = path.join(jobDir, `clip_${i}.mp4`);

      let dur = 5;
      try {
        dur = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`,
          { stdio: "pipe" }
        ).toString().trim()) || 5;
      } catch {}

      console.log(`[${job.videoId}] Scene ${i}: ${dur}s, ${isVideo ? "video" : "image"}`);

      try {
        if (isVideo) {
          execSync(
            `ffmpeg -y -i "${visualPath}" -i "${voicePath}" -map 0:v -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -r 30 -t ${dur} -shortest "${clipPath}"`,
            { timeout: 180000, stdio: "pipe" }
          );
        } else {
          execSync(
            `ffmpeg -y -loop 1 -i "${visualPath}" -i "${voicePath}" -c:v libx264 -tune stillimage -preset fast -crf 23 -c:a aac -b:a 128k -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -r 30 -pix_fmt yuv420p -t ${dur} -shortest "${clipPath}"`,
            { timeout: 180000, stdio: "pipe" }
          );
        }
        if (existsSync(clipPath)) {
          clips.push(clipPath);
          console.log(`[${job.videoId}] Clip ${i}: OK`);
        }
      } catch (err) {
        console.error(`[${job.videoId}] Clip ${i} FAILED:`, err.stderr?.toString().slice(-150));
        // Fallback: black + audio
        try {
          execSync(
            `ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=30 -i "${voicePath}" -c:v libx264 -c:a aac -t ${dur} -pix_fmt yuv420p -shortest "${clipPath}"`,
            { timeout: 60000, stdio: "pipe" }
          );
          if (existsSync(clipPath)) clips.push(clipPath);
        } catch {}
      }
    }

    if (clips.length === 0) throw new Error("No clips generated");

    // Step 3: Concat
    console.log(`[${job.videoId}] Concatenating ${clips.length} clips...`);
    const concatFile = path.join(jobDir, "list.txt");
    writeFileSync(concatFile, clips.map(p => `file '${p}'`).join("\n"));

    const outputPath = path.join(jobDir, "output.mp4");
    if (clips.length === 1) {
      execSync(`cp "${clips[0]}" "${outputPath}"`, { stdio: "pipe" });
    } else {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`,
        { timeout: 60000, stdio: "pipe" }
      );
    }

    // Step 4: Music (optional)
    let finalPath = outputPath;
    if (job.musicUrl) {
      const musicPath = path.join(jobDir, "music.mp3");
      try {
        await streamDownload(job.musicUrl, musicPath);
        const vol = (job.musicVolume || 20) / 100;
        const withMusic = path.join(jobDir, "final.mp4");
        execSync(
          `ffmpeg -y -i "${outputPath}" -i "${musicPath}" -filter_complex "[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac "${withMusic}"`,
          { timeout: 120000, stdio: "pipe" }
        );
        finalPath = withMusic;
      } catch {}
    }

    // Step 5: Thumbnail
    const thumbPath = path.join(jobDir, "thumb.jpg");
    try {
      execSync(`ffmpeg -y -i "${finalPath}" -ss 1 -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 10000, stdio: "pipe" });
    } catch {
      try { execSync(`ffmpeg -y -i "${finalPath}" -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 10000, stdio: "pipe" }); } catch {}
    }

    // Step 6: Duration
    let duration = 0;
    try {
      duration = Math.round(parseFloat(execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalPath}"`,
        { stdio: "pipe" }
      ).toString().trim()));
    } catch {}

    // Step 7: Upload to Supabase
    console.log(`[${job.videoId}] Uploading to Supabase...`);
    const videoBuffer = readFileSync(finalPath);
    const outputUrl = await uploadToSupabase(`renders/${job.videoId}/final.mp4`, videoBuffer, "video/mp4");

    let thumbnailUrl = null;
    if (existsSync(thumbPath)) {
      const tb = readFileSync(thumbPath);
      thumbnailUrl = await uploadToSupabase(`renders/${job.videoId}/thumb.jpg`, tb, "image/jpeg");
    }

    // Cleanup
    try { execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" }); } catch {}

    return { outputUrl, thumbnailUrl, durationSeconds: duration };
  } catch (err) {
    try { execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" }); } catch {}
    throw err;
  }
}

async function streamDownload(url, dest) {
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`Download ${res.status}: ${url.slice(0, 80)}`);
  const ws = createWriteStream(dest);
  await pipeline(res.body, ws);
}

async function uploadToSupabase(filePath, buffer, contentType) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase not configured on worker");

  const res = await fetch(`${url}/storage/v1/object/videos/${filePath}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": contentType,
      "x-upsert": "true",
    },
    body: buffer,
  });

  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
  return `${url}/storage/v1/object/public/videos/${filePath}`;
}
