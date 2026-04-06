import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import path from "path";

const WORK_DIR = "/tmp/shortgen-renders";

export async function renderVideo(job) {
  const jobDir = path.join(WORK_DIR, job.videoId);
  mkdirSync(jobDir, { recursive: true });

  try {
    console.log(`[${job.videoId}] Downloading ${job.scenes.length} scenes...`);

    // Step 1: Download all assets
    const sceneFiles = [];

    for (let i = 0; i < job.scenes.length; i++) {
      const scene = job.scenes[i];
      const voicePath = path.join(jobDir, `voice_${i}.wav`);
      const visualPath = path.join(jobDir, `visual_${i}`);

      // Download voice
      if (scene.voiceUrl && scene.voiceUrl.startsWith("http")) {
        await downloadFile(scene.voiceUrl, voicePath);
      } else {
        console.warn(`[${job.videoId}] Scene ${i}: no voice URL`);
        continue;
      }

      // Download visual and detect type
      let realVisualPath = visualPath + ".png";
      if (scene.visualUrl && scene.visualUrl.startsWith("http")) {
        const buf = await downloadFile(scene.visualUrl);
        const isVideo = isVideoBuffer(buf, scene.visualUrl);
        realVisualPath = visualPath + (isVideo ? ".mp4" : ".png");
        writeFileSync(realVisualPath, buf);
      } else {
        console.warn(`[${job.videoId}] Scene ${i}: no visual URL, using black frame`);
        createBlackFrame(realVisualPath);
      }

      sceneFiles.push({
        voicePath,
        visualPath: realVisualPath,
        isVideo: realVisualPath.endsWith(".mp4"),
        narration: scene.narration,
        duration: scene.duration,
      });
    }

    if (sceneFiles.length === 0) {
      throw new Error("No scenes could be downloaded");
    }

    // Download music
    let musicPath = null;
    if (job.musicUrl && job.musicUrl.startsWith("http")) {
      musicPath = path.join(jobDir, "music.mp3");
      try {
        const buf = await downloadFile(job.musicUrl);
        writeFileSync(musicPath, buf);
      } catch {
        console.warn(`[${job.videoId}] Music download failed, continuing without`);
        musicPath = null;
      }
    }

    // Step 2: Compose each scene (visual + audio)
    console.log(`[${job.videoId}] Composing ${sceneFiles.length} scenes...`);
    const clips = [];

    for (let i = 0; i < sceneFiles.length; i++) {
      const { voicePath, visualPath, isVideo } = sceneFiles[i];
      const clipPath = path.join(jobDir, `clip_${i}.mp4`);

      // Get voice duration
      let dur = 5;
      try {
        dur = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`,
          { stdio: "pipe" }
        ).toString().trim()) || 5;
      } catch {}

      try {
        if (isVideo) {
          execSync(
            `ffmpeg -y -i "${visualPath}" -i "${voicePath}" -map 0:v -map 1:a -c:v libx264 -preset fast -crf 23 -c:a aac -b:a 128k -shortest -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -r 30 -t ${dur} "${clipPath}"`,
            { timeout: 120000, stdio: "pipe" }
          );
        } else {
          execSync(
            `ffmpeg -y -loop 1 -i "${visualPath}" -i "${voicePath}" -c:v libx264 -tune stillimage -preset fast -crf 23 -c:a aac -b:a 128k -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black" -r 30 -pix_fmt yuv420p -t ${dur} -shortest "${clipPath}"`,
            { timeout: 120000, stdio: "pipe" }
          );
        }
        if (existsSync(clipPath)) clips.push(clipPath);
      } catch (err) {
        console.error(`[${job.videoId}] Scene ${i} FFmpeg error:`, err.stderr?.toString().slice(-200));
        // Fallback: black video + audio
        try {
          execSync(
            `ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=30 -i "${voicePath}" -c:v libx264 -preset fast -c:a aac -t ${dur} -pix_fmt yuv420p -shortest "${clipPath}"`,
            { timeout: 60000, stdio: "pipe" }
          );
          if (existsSync(clipPath)) clips.push(clipPath);
        } catch {}
      }
    }

    if (clips.length === 0) throw new Error("No clips were generated");

    // Step 3: Concatenate
    console.log(`[${job.videoId}] Concatenating ${clips.length} clips...`);
    const concatPath = path.join(jobDir, "concat.txt");
    writeFileSync(concatPath, clips.map(p => `file '${p}'`).join("\n"));

    const concatenatedPath = path.join(jobDir, "concatenated.mp4");
    if (clips.length === 1) {
      execSync(`cp "${clips[0]}" "${concatenatedPath}"`, { stdio: "pipe" });
    } else {
      execSync(
        `ffmpeg -y -f concat -safe 0 -i "${concatPath}" -c copy "${concatenatedPath}"`,
        { timeout: 120000, stdio: "pipe" }
      );
    }

    // Step 4: Add music
    let finalPath = concatenatedPath;
    if (musicPath && existsSync(musicPath)) {
      const withMusicPath = path.join(jobDir, "final.mp4");
      const vol = (job.musicVolume || 20) / 100;
      try {
        execSync(
          `ffmpeg -y -i "${concatenatedPath}" -i "${musicPath}" -filter_complex "[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first[a]" -map 0:v -map "[a]" -c:v copy -c:a aac "${withMusicPath}"`,
          { timeout: 120000, stdio: "pipe" }
        );
        finalPath = withMusicPath;
      } catch {
        console.warn(`[${job.videoId}] Music mixing failed`);
      }
    }

    // Step 5: Thumbnail
    console.log(`[${job.videoId}] Generating thumbnail...`);
    const thumbPath = path.join(jobDir, "thumb.jpg");
    try {
      execSync(`ffmpeg -y -i "${finalPath}" -ss 1 -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 10000, stdio: "pipe" });
    } catch {
      try {
        execSync(`ffmpeg -y -i "${finalPath}" -vframes 1 -q:v 2 "${thumbPath}"`, { timeout: 10000, stdio: "pipe" });
      } catch {}
    }

    // Step 6: Duration
    let duration = 0;
    try {
      duration = Math.round(parseFloat(execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${finalPath}"`,
        { stdio: "pipe" }
      ).toString().trim()));
    } catch {}

    // Step 7: Upload to Supabase Storage
    console.log(`[${job.videoId}] Uploading to Supabase...`);
    const videoBuffer = readFileSync(finalPath);
    const thumbBuffer = existsSync(thumbPath) ? readFileSync(thumbPath) : null;

    const outputUrl = await uploadToSupabase(
      `renders/${job.videoId}/final.mp4`,
      videoBuffer,
      "video/mp4"
    );

    let thumbnailUrl = null;
    if (thumbBuffer) {
      thumbnailUrl = await uploadToSupabase(
        `renders/${job.videoId}/thumb.jpg`,
        thumbBuffer,
        "image/jpeg"
      );
    }

    console.log(`[${job.videoId}] Done! Duration: ${duration}s`);

    return { outputUrl, thumbnailUrl, durationSeconds: duration };
  } finally {
    // Cleanup temp files
    try {
      execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" });
    } catch {}
  }
}

async function downloadFile(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

function isVideoBuffer(buf, url) {
  if (buf.length > 8 && buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
  if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true;
  if (url.includes(".mp4") || url.includes("video")) return true;
  return false;
}

function createBlackFrame(outputPath) {
  try {
    execSync(`ffmpeg -y -f lavfi -i color=c=black:s=1080x1920 -frames:v 1 "${outputPath}"`, { timeout: 5000, stdio: "pipe" });
  } catch {
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
    writeFileSync(outputPath, png);
  }
}

async function uploadToSupabase(filePath, buffer, contentType) {
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    throw new Error("Supabase credentials not configured on worker");
  }

  const res = await fetch(
    `${SUPABASE_URL}/storage/v1/object/videos/${filePath}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SUPABASE_KEY}`,
        "Content-Type": contentType,
        "x-upsert": "true",
      },
      body: buffer,
    }
  );

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase upload failed: ${err}`);
  }

  return `${SUPABASE_URL}/storage/v1/object/public/videos/${filePath}`;
}
