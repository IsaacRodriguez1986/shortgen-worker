import { execSync } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync } from "fs";
import path from "path";

const WORK_DIR = "/tmp/viratronik-renders";

// ── Clean narration for subtitles (remove acting cues from TTS) ────────

function cleanNarrationForSubtitles(narration) {
  return narration
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/\.{3,}/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Subtitle generation (drawtext) ─────────────

function escapeDrawtext(text) {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "ʼ")
    .replace(/:/g, "\\:")
    .replace(/%/g, "%%")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/"/g, '\\"');
}

function buildSubtitleFilter(narration, duration, style) {
  const cleanText = cleanNarrationForSubtitles(narration);
  if (!cleanText || !cleanText.trim()) return "";

  const words = cleanText.trim().split(/\s+/);
  if (words.length === 0) return "";

  const padding = 0.2;
  const effectiveDur = Math.max(duration - padding * 2, 0.5);
  const timePerWord = effectiveDur / words.length;

  const styles = {
    hormozi:    { size: 68, color: "white", shadow: 4, border: 3, borderColor: "black", box: false, boxColor: "", groupSize: 3, upper: true },
    classic:    { size: 56, color: "white", shadow: 0, border: 0, borderColor: "black", box: true, boxColor: "black@0.55", groupSize: 4, upper: false },
    minimal:    { size: 44, color: "white@0.85", shadow: 2, border: 1, borderColor: "black", box: false, boxColor: "", groupSize: 5, upper: false },
    karaoke:    { size: 64, color: "white", shadow: 3, border: 3, borderColor: "black", box: false, boxColor: "", groupSize: 2, upper: true },
    neon:       { size: 64, color: "0x00FF88", shadow: 6, border: 2, borderColor: "0x00FF88@0.5", box: false, boxColor: "", groupSize: 3, upper: true },
    outline:    { size: 72, color: "black@0.0", shadow: 0, border: 4, borderColor: "white", box: false, boxColor: "", groupSize: 3, upper: true },
    typewriter: { size: 52, color: "0x00FF00", shadow: 2, border: 1, borderColor: "black", box: true, boxColor: "black@0.8", groupSize: 6, upper: false },
    bounce:     { size: 72, color: "yellow", shadow: 5, border: 3, borderColor: "black", box: false, boxColor: "", groupSize: 2, upper: true },
    split:      { size: 68, color: "white", shadow: 4, border: 3, borderColor: "black", box: false, boxColor: "", groupSize: 3, upper: true },
    gradient:   { size: 66, color: "0xA855F7", shadow: 4, border: 2, borderColor: "black", box: false, boxColor: "", groupSize: 3, upper: true },
  };
  const s = styles[style] || styles.hormozi;

  const groups = [];
  for (let g = 0; g < words.length; g += s.groupSize) {
    const groupWords = words.slice(g, g + s.groupSize);
    const text = s.upper ? groupWords.join(" ").toUpperCase() : groupWords.join(" ");
    groups.push({
      text,
      start: padding + g * timePerWord,
      end: padding + Math.min(g + s.groupSize, words.length) * timePerWord,
    });
  }

  const filters = groups.map((g, idx) => {
    const escaped = escapeDrawtext(g.text);
    let yExpr = "h-350";
    if (style === "bounce") {
      const bounce = idx % 2 === 0 ? -10 : 10;
      yExpr = `h-350+${bounce}`;
    }

    // Neon: double layer for glow
    if (style === "neon") {
      const glow = `drawtext=text='${escaped}'` +
        `:enable='between(t,${g.start.toFixed(3)},${g.end.toFixed(3)})'` +
        `:fontsize=${s.size}:fontcolor=0x00FF88@0.3` +
        `:x=(w-text_w)/2:y=${yExpr}` +
        `:borderw=8:bordercolor=0x00FF88@0.2`;
      const main = `drawtext=text='${escaped}'` +
        `:enable='between(t,${g.start.toFixed(3)},${g.end.toFixed(3)})'` +
        `:fontsize=${s.size}:fontcolor=${s.color}` +
        `:x=(w-text_w)/2:y=${yExpr}` +
        `:borderw=${s.border}:bordercolor=${s.borderColor}` +
        `:shadowcolor=black@0.7:shadowx=${s.shadow}:shadowy=${s.shadow}`;
      return `${glow},${main}`;
    }

    // Split: first word in accent color
    if (style === "split") {
      const splitWords = g.text.split(" ");
      if (splitWords.length > 1) {
        const keyword = escapeDrawtext(splitWords[0]);
        const rest = escapeDrawtext(splitWords.slice(1).join(" "));
        const enable = `enable='between(t,${g.start.toFixed(3)},${g.end.toFixed(3)})'`;
        const f1 = `drawtext=text='${keyword} ${rest}':${enable}:fontsize=${s.size}:fontcolor=white:x=(w-text_w)/2:y=${yExpr}:borderw=${s.border}:bordercolor=${s.borderColor}:shadowcolor=black@0.7:shadowx=${s.shadow}:shadowy=${s.shadow}`;
        const f2 = `drawtext=text='${keyword}':${enable}:fontsize=${s.size}:fontcolor=0xA855F7:x=(w-text_w)/2:y=${yExpr}:borderw=${s.border}:bordercolor=${s.borderColor}:shadowcolor=black@0.7:shadowx=${s.shadow}:shadowy=${s.shadow}`;
        return `${f1},${f2}`;
      }
    }

    let f = `drawtext=text='${escaped}'` +
      `:enable='between(t,${g.start.toFixed(3)},${g.end.toFixed(3)})'` +
      `:fontsize=${s.size}:fontcolor=${s.color}` +
      `:x=(w-text_w)/2:y=${yExpr}` +
      `:borderw=${s.border}:bordercolor=${s.borderColor}`;
    if (s.shadow > 0) f += `:shadowcolor=black@0.7:shadowx=${s.shadow}:shadowy=${s.shadow}`;
    if (s.box) f += `:box=1:boxcolor=${s.boxColor || "black@0.55"}:boxborderw=14`;
    return f;
  });

  return "," + filters.join(",");
}

// ── Detect if buffer is a video file ────────────

function detectIfVideo(buf, url) {
  if (buf.length > 8) {
    if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) return true;
    if (buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3) return true;
  }
  if (url.includes(".mp4") || url.includes(".webm") || url.includes(".mov")) return true;
  if (url.includes("pexels.com/video")) return true;
  return false;
}

// ── Main render function ────────────

export async function renderVideo(job) {
  const jobDir = path.join(WORK_DIR, job.videoId);
  mkdirSync(jobDir, { recursive: true });

  try {
    // Step 1: Download all assets
    console.log(`[${job.videoId}] Downloading ${job.scenes.length} scenes...`);
    const sceneFiles = [];

    for (let i = 0; i < job.scenes.length; i++) {
      const scene = job.scenes[i];

      if (!scene.voiceUrl || !scene.voiceUrl.startsWith("http")) {
        console.warn(`[${job.videoId}] Scene ${i}: no voice URL, skipping`);
        continue;
      }

      // Download voice
      const voicePath = path.join(jobDir, `voice_${i}.wav`);
      await streamDownload(scene.voiceUrl, voicePath);

      // Download visual
      let visualPath;
      let isVideo = false;

      if (scene.visualUrl && scene.visualUrl.startsWith("http")) {
        const buf = await streamDownloadBuffer(scene.visualUrl);
        isVideo = detectIfVideo(buf, scene.visualUrl);
        const ext = isVideo ? "mp4" : "png";
        visualPath = path.join(jobDir, `visual_${i}.${ext}`);
        writeFileSync(visualPath, buf);
        console.log(`[${job.videoId}] Visual ${i}: ${isVideo ? "video" : "image"} (${(buf.length / 1024).toFixed(0)}KB)`);
      } else {
        // Black frame fallback
        visualPath = path.join(jobDir, `visual_${i}.png`);
        execSync(`ffmpeg -y -f lavfi -i color=c=black:s=1080x1920 -frames:v 1 "${visualPath}"`, { timeout: 5000, stdio: "pipe" });
      }

      sceneFiles.push({ voicePath, visualPath, isVideo, narration: scene.narration || "" });
    }

    if (sceneFiles.length === 0) throw new Error("No scenes downloaded successfully");

    // Step 2: Create per-scene clips — ALL normalized to same format
    console.log(`[${job.videoId}] Composing ${sceneFiles.length} clips...`);
    const clips = [];
    const subtitleStyle = job.subtitleStyle || "hormozi";

    for (let i = 0; i < sceneFiles.length; i++) {
      const { voicePath, visualPath, isVideo, narration } = sceneFiles[i];
      const clipPath = path.join(jobDir, `clip_${i}.mp4`);

      // Get audio duration
      let audioDuration = 5;
      try {
        audioDuration = parseFloat(execSync(
          `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${voicePath}"`,
          { timeout: 10000, stdio: "pipe" }
        ).toString().trim()) || 5;
      } catch {}

      // Build subtitle filter (cleaned from acting cues)
      const subsFilter = buildSubtitleFilter(narration, audioDuration, subtitleStyle);
      const scaleFilter = "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1";

      console.log(`[${job.videoId}] Scene ${i}: ${audioDuration.toFixed(1)}s, ${isVideo ? "video" : "image"}, subs: ${subsFilter ? "yes" : "no"}`);

      try {
        if (isVideo) {
          // Video: use filter_complex, map voice audio (ignore video's audio), normalize format
          execSync(
            `ffmpeg -y -stream_loop -1 -i "${visualPath}" -i "${voicePath}" ` +
            `-filter_complex "[0:v]${scaleFilter}${subsFilter}[vout]" ` +
            `-map "[vout]" -map 1:a ` +
            `-c:v libx264 -preset fast -crf 23 -r 30 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 128k -ar 44100 -ac 2 ` +
            `-t ${audioDuration} "${clipPath}"`,
            { timeout: 180000, stdio: "pipe" }
          );
        } else {
          // Image: loop, same normalization
          execSync(
            `ffmpeg -y -loop 1 -i "${visualPath}" -i "${voicePath}" ` +
            `-filter_complex "[0:v]${scaleFilter}${subsFilter}[vout]" ` +
            `-map "[vout]" -map 1:a ` +
            `-c:v libx264 -tune stillimage -preset fast -crf 23 -r 30 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 128k -ar 44100 -ac 2 ` +
            `-t ${audioDuration} "${clipPath}"`,
            { timeout: 180000, stdio: "pipe" }
          );
        }

        if (existsSync(clipPath)) {
          clips.push(clipPath);
          console.log(`[${job.videoId}] Clip ${i}: OK`);
        }
      } catch (err) {
        const errMsg = err.stderr?.toString().slice(-500) || err.message;
        console.error(`[${job.videoId}] Clip ${i} FAILED:`, errMsg);

        // Fallback: black video + voice audio only
        try {
          execSync(
            `ffmpeg -y -f lavfi -i color=c=black:s=1080x1920:r=30:d=${audioDuration} -i "${voicePath}" ` +
            `-c:v libx264 -preset fast -crf 23 -r 30 -pix_fmt yuv420p ` +
            `-c:a aac -b:a 128k -ar 44100 -ac 2 ` +
            `-t ${audioDuration} "${clipPath}"`,
            { timeout: 60000, stdio: "pipe" }
          );
          if (existsSync(clipPath)) {
            clips.push(clipPath);
            console.warn(`[${job.videoId}] Clip ${i}: black fallback OK`);
          }
        } catch {
          console.error(`[${job.videoId}] Clip ${i}: even fallback failed, skipping`);
        }
      }
    }

    if (clips.length === 0) throw new Error("No clips generated");

    // Step 3: Concatenate — all clips are normalized so -c copy should work
    console.log(`[${job.videoId}] Concatenating ${clips.length} clips...`);
    const concatFile = path.join(jobDir, "list.txt");
    writeFileSync(concatFile, clips.map(p => `file '${p}'`).join("\n"));

    const outputPath = path.join(jobDir, "output.mp4");
    if (clips.length === 1) {
      execSync(`cp "${clips[0]}" "${outputPath}"`, { stdio: "pipe" });
    } else {
      try {
        execSync(
          `ffmpeg -y -f concat -safe 0 -i "${concatFile}" -c copy "${outputPath}"`,
          { timeout: 120000, stdio: "pipe" }
        );
      } catch {
        // Fallback: re-encode during concat
        console.warn(`[${job.videoId}] Concat copy failed, re-encoding...`);
        execSync(
          `ffmpeg -y -f concat -safe 0 -i "${concatFile}" ` +
          `-c:v libx264 -preset fast -crf 23 -r 30 -pix_fmt yuv420p ` +
          `-c:a aac -b:a 128k -ar 44100 -ac 2 "${outputPath}"`,
          { timeout: 180000, stdio: "pipe" }
        );
      }
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
          `ffmpeg -y -i "${outputPath}" -i "${musicPath}" ` +
          `-filter_complex "[1:a]volume=${vol}[m];[0:a][m]amix=inputs=2:duration=first[a]" ` +
          `-map 0:v -map "[a]" -c:v copy -c:a aac -b:a 128k "${withMusic}"`,
          { timeout: 120000, stdio: "pipe" }
        );
        finalPath = withMusic;
      } catch (e) {
        console.warn(`[${job.videoId}] Music mixing failed:`, e.message);
      }
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
    console.log(`[${job.videoId}] Uploading to Supabase (${(readFileSync(finalPath).length / (1024 * 1024)).toFixed(1)}MB)...`);
    const videoBuffer = readFileSync(finalPath);
    const outputUrl = await uploadToSupabase(`renders/${job.videoId}/final.mp4`, videoBuffer, "video/mp4");

    let thumbnailUrl = null;
    if (existsSync(thumbPath)) {
      const tb = readFileSync(thumbPath);
      thumbnailUrl = await uploadToSupabase(`renders/${job.videoId}/thumb.jpg`, tb, "image/jpeg");
    }

    // Cleanup
    try { execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" }); } catch {}

    console.log(`[${job.videoId}] DONE — ${duration}s, ${(videoBuffer.length / (1024 * 1024)).toFixed(1)}MB`);
    return { outputUrl, thumbnailUrl, durationSeconds: duration };
  } catch (err) {
    try { execSync(`rm -rf "${jobDir}"`, { stdio: "pipe" }); } catch {}
    throw err;
  }
}

async function streamDownload(url, dest) {
  const buf = await streamDownloadBuffer(url);
  writeFileSync(dest, buf);
  return buf.length;
}

async function streamDownloadBuffer(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw new Error(`Download ${res.status}: ${url.slice(0, 60)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100) throw new Error(`Download too small (${buf.length}b): ${url.slice(0, 60)}`);
  return buf;
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

// Worker v2.0 — 2026-04-07T20:43:24Z
