import { execSync, exec } from "child_process";
import { writeFileSync, mkdirSync, existsSync, readFileSync, unlinkSync, readdirSync } from "fs";
import path from "path";
import { promisify } from "util";

const execAsync = promisify(exec);

const WORK_DIR = "/tmp/shortgen-renders";

export async function renderVideo(job) {
  const jobDir = path.join(WORK_DIR, job.videoId);
  mkdirSync(jobDir, { recursive: true });

  try {
    // Step 1: Download all assets
    console.log(`[${job.videoId}] Downloading assets...`);
    const sceneFiles = await downloadAssets(job, jobDir);

    // Step 2: Create per-scene videos (visual + audio + subtitles)
    console.log(`[${job.videoId}] Composing scenes...`);
    const sceneVideos = await composeScenes(job, jobDir, sceneFiles);

    // Step 3: Concatenate all scenes
    console.log(`[${job.videoId}] Concatenating scenes...`);
    const concatenatedPath = await concatenateScenes(jobDir, sceneVideos);

    // Step 4: Add background music
    console.log(`[${job.videoId}] Adding music...`);
    const finalPath = await addMusic(job, jobDir, concatenatedPath);

    // Step 5: Generate thumbnail
    console.log(`[${job.videoId}] Generating thumbnail...`);
    const thumbnailPath = await generateThumbnail(jobDir, finalPath);

    // Step 6: Get duration
    const duration = await getDuration(finalPath);

    // Step 7: Upload to storage (via callback URL the main app handles this)
    // For now, read the file and return as base64 or URL
    const outputBuffer = readFileSync(finalPath);
    const thumbnailBuffer = readFileSync(thumbnailPath);

    // Upload to a temporary hosting or return path
    // In production, upload to Supabase Storage directly or use presigned URLs
    const outputUrl = `file://${finalPath}`;
    const thumbnailUrl = `file://${thumbnailPath}`;

    return {
      outputUrl,
      thumbnailUrl,
      durationSeconds: Math.round(duration),
    };
  } finally {
    // Cleanup (keep for debugging, uncomment in production)
    // rmSync(jobDir, { recursive: true, force: true });
  }
}

async function downloadAssets(job, jobDir) {
  const assetsDir = path.join(jobDir, "assets");
  mkdirSync(assetsDir, { recursive: true });

  const files = [];

  for (let i = 0; i < job.scenes.length; i++) {
    const scene = job.scenes[i];
    const voicePath = path.join(assetsDir, `voice_${i}.wav`);
    const visualPath = path.join(assetsDir, `visual_${i}.mp4`);

    // Download voice
    if (scene.voiceUrl.startsWith("http")) {
      await downloadFile(scene.voiceUrl, voicePath);
    }

    // Download visual
    if (scene.visualUrl.startsWith("http")) {
      await downloadFile(scene.visualUrl, visualPath);
    }

    files.push({ voicePath, visualPath, narration: scene.narration, duration: scene.duration });
  }

  // Download music if present
  let musicPath = null;
  if (job.musicUrl) {
    musicPath = path.join(assetsDir, "music.wav");
    if (job.musicUrl.startsWith("http")) {
      await downloadFile(job.musicUrl, musicPath);
    }
  }

  return { scenes: files, musicPath };
}

async function downloadFile(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to download: ${url}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
}

async function composeScenes(job, jobDir, sceneFiles) {
  const scenesDir = path.join(jobDir, "scenes");
  mkdirSync(scenesDir, { recursive: true });

  const resolution = getResolution(job.resolution);
  const sceneVideos = [];

  for (let i = 0; i < sceneFiles.scenes.length; i++) {
    const scene = sceneFiles.scenes[i];
    const outputPath = path.join(scenesDir, `scene_${i}.mp4`);

    // Get audio duration for trimming
    let audioDuration = scene.duration;
    try {
      const { stdout } = await execAsync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${scene.voicePath}"`
      );
      audioDuration = parseFloat(stdout.trim()) || scene.duration;
    } catch { }

    // Build FFmpeg command
    // Visual (loop/trim to audio duration) + Voice + Subtitles
    const subtitleFilter = getSubtitleFilter(job.subtitleStyle, scene.narration);
    const zoomFilter = getZoomFilter(job.zoomEffect, audioDuration);

    const cmd = [
      "ffmpeg -y",
      `-i "${scene.visualPath}"`,
      `-i "${scene.voicePath}"`,
      `-filter_complex "[0:v]scale=${resolution},${zoomFilter}setpts=PTS-STARTPTS,${subtitleFilter}format=yuv420p[v]"`,
      `-map "[v]" -map 1:a`,
      `-c:v libx264 -preset fast -crf 23`,
      `-c:a aac -b:a 128k`,
      `-t ${audioDuration}`,
      `-r 30`,
      `"${outputPath}"`,
    ].join(" ");

    try {
      await execAsync(cmd, { timeout: 120000 });
    } catch (error) {
      // Fallback: simple composition without fancy filters
      const fallbackCmd = [
        "ffmpeg -y",
        `-loop 1 -i "${scene.visualPath}"`,
        `-i "${scene.voicePath}"`,
        `-c:v libx264 -preset fast -crf 23`,
        `-c:a aac -b:a 128k`,
        `-shortest -r 30`,
        `-vf "scale=${resolution}:force_original_aspect_ratio=decrease,pad=${resolution}:(ow-iw)/2:(oh-ih)/2:black"`,
        `"${outputPath}"`,
      ].join(" ");
      await execAsync(fallbackCmd, { timeout: 120000 });
    }

    sceneVideos.push(outputPath);
  }

  return sceneVideos;
}

async function concatenateScenes(jobDir, sceneVideos) {
  const listPath = path.join(jobDir, "concat_list.txt");
  const outputPath = path.join(jobDir, "concatenated.mp4");

  const listContent = sceneVideos.map((p) => `file '${p}'`).join("\n");
  writeFileSync(listPath, listContent);

  await execAsync(
    `ffmpeg -y -f concat -safe 0 -i "${listPath}" -c copy "${outputPath}"`,
    { timeout: 120000 }
  );

  return outputPath;
}

async function addMusic(job, jobDir, videoPath) {
  if (!job.musicUrl) return videoPath;

  const outputPath = path.join(jobDir, "final.mp4");
  const musicVolume = (job.musicVolume || 20) / 100;

  const assetsDir = path.join(jobDir, "assets");
  const musicPath = path.join(assetsDir, "music.wav");

  if (!existsSync(musicPath)) return videoPath;

  await execAsync(
    `ffmpeg -y -i "${videoPath}" -i "${musicPath}" -filter_complex "[1:a]volume=${musicVolume}[music];[0:a][music]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -b:a 128k "${outputPath}"`,
    { timeout: 120000 }
  );

  return outputPath;
}

async function generateThumbnail(jobDir, videoPath) {
  const thumbnailPath = path.join(jobDir, "thumbnail.jpg");

  await execAsync(
    `ffmpeg -y -i "${videoPath}" -ss 00:00:01 -vframes 1 -q:v 2 "${thumbnailPath}"`,
    { timeout: 30000 }
  );

  return thumbnailPath;
}

async function getDuration(videoPath) {
  const { stdout } = await execAsync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${videoPath}"`
  );
  return parseFloat(stdout.trim()) || 0;
}

function getResolution(res) {
  switch (res) {
    case "4k": return "2160:3840";
    case "1080": return "1080:1920";
    case "720": return "720:1280";
    default: return "1080:1920";
  }
}

function getSubtitleFilter(style, text) {
  const escaped = text.replace(/'/g, "\\'").replace(/"/g, '\\"');
  const baseFont = "fontsize=42:fontcolor=white:borderw=3:bordercolor=black";

  switch (style) {
    case "hormozi":
      return `drawtext=text='${escaped}':${baseFont}:fontsize=52:x=(w-text_w)/2:y=h*0.75:box=1:boxcolor=black@0.6:boxborderw=10,`;
    case "classic":
      return `drawtext=text='${escaped}':${baseFont}:x=(w-text_w)/2:y=h*0.85,`;
    case "minimal":
      return `drawtext=text='${escaped}':fontsize=36:fontcolor=white@0.9:x=(w-text_w)/2:y=h*0.80,`;
    case "karaoke":
      return `drawtext=text='${escaped}':${baseFont}:fontsize=48:x=(w-text_w)/2:y=h*0.75:fontcolor=yellow,`;
    default:
      return `drawtext=text='${escaped}':${baseFont}:x=(w-text_w)/2:y=h*0.80,`;
  }
}

function getZoomFilter(effect, duration) {
  switch (effect) {
    case "ken-burns":
      return `zoompan=z='min(zoom+0.001,1.15)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(duration * 30)}:s=1080x1920:fps=30,`;
    case "slow-zoom":
      return `zoompan=z='min(zoom+0.0005,1.08)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${Math.round(duration * 30)}:s=1080x1920:fps=30,`;
    default:
      return "";
  }
}
