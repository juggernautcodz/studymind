import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import path from "path";
import OpenAI from "openai";

const execFileAsync = promisify(execFile);

const MAX_DOWNLOAD_TIMEOUT_MS = 120_000;
const MAX_FFMPEG_TIMEOUT_MS = 60_000;
const MAX_AUDIO_SIZE_MB = 25;
const MAX_AUDIO_DURATION_SECONDS = 1800;
const LOG_PREFIX = "[VideoProcessor]";

interface ProcessingResult {
  text: string;
}

interface ProcessingError {
  status: number;
  message: string;
}

function isProcessingError(
  result: ProcessingResult | ProcessingError,
): result is ProcessingError {
  return "status" in result;
}

function resolveYtdlpBinary(): string {
  const localBin = path.resolve(process.cwd(), ".pythonlibs/bin/yt-dlp");
  if (fs.existsSync(localBin)) return localBin;
  return "yt-dlp";
}

function isYtdlpAvailable(bin: string): boolean {
  try {
    const { execFileSync } = require("child_process");
    execFileSync(bin, ["--version"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

async function downloadAudio(
  url: string,
  outputDir: string,
  filePrefix: string,
): Promise<string | ProcessingError> {
  const ytdlpBin = resolveYtdlpBinary();
  if (!isYtdlpAvailable(ytdlpBin)) {
    return {
      status: 503,
      message:
        "Video URL processing is not available. The required tool (yt-dlp) is not installed.",
    };
  }

  const outputTemplate = path.join(outputDir, `${filePrefix}.%(ext)s`);
  const expectedWavPath = path.join(outputDir, `${filePrefix}.wav`);

  console.log(`${LOG_PREFIX} Downloading audio from URL (using ${ytdlpBin})`);

  try {
    const { stdout, stderr } = await execFileAsync(
      ytdlpBin,
      [
        "--no-playlist",
        "--extract-audio",
        "--audio-format",
        "wav",
        "--audio-quality",
        "0",
        "--no-check-certificates",
        "-o",
        outputTemplate,
        url,
      ],
      {
        timeout: MAX_DOWNLOAD_TIMEOUT_MS,
        maxBuffer: 50 * 1024 * 1024,
      },
    );

    const combinedOutput = `${stdout}\n${stderr}`;
    console.log(
      `${LOG_PREFIX} yt-dlp completed: ${combinedOutput.slice(-300)}`,
    );
  } catch (err: any) {
    const errOutput = err?.stdout || err?.stderr || err?.message || "";
    console.error(`${LOG_PREFIX} yt-dlp failed: ${errOutput.slice(-800)}`);
    return classifyDownloadError(errOutput);
  }

  if (!fs.existsSync(expectedWavPath)) {
    const converted = await convertToWav(
      outputDir,
      filePrefix,
      expectedWavPath,
    );
    if (!converted) {
      return {
        status: 400,
        message:
          "Failed to download audio. Make sure the URL is correct and the video is publicly accessible.",
      };
    }
  }

  return expectedWavPath;
}

function classifyDownloadError(output: string): ProcessingError {
  if (
    output.includes("is not a valid URL") ||
    output.includes("Unsupported URL")
  ) {
    return {
      status: 400,
      message:
        "This URL is not supported. Please provide a YouTube or other supported video link.",
    };
  }
  if (
    output.includes("Video unavailable") ||
    output.includes("Private video") ||
    output.includes("removed")
  ) {
    return {
      status: 400,
      message: "This video is unavailable, private, or has been removed.",
    };
  }
  if (
    output.includes("Sign in to confirm") ||
    output.includes("age-restricted") ||
    output.includes("age gate")
  ) {
    return {
      status: 400,
      message:
        "This video requires sign-in or age verification and cannot be processed.",
    };
  }
  if (output.includes("timed out") || output.includes("Timeout")) {
    return {
      status: 408,
      message: "Video download timed out. Try a shorter video.",
    };
  }
  return {
    status: 400,
    message:
      "Failed to process the video URL. Make sure it's a valid, publicly accessible video link.",
  };
}

async function convertToWav(
  dir: string,
  filePrefix: string,
  targetPath: string,
): Promise<boolean> {
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(filePrefix));
  if (candidates.length === 0) return false;

  const srcPath = path.join(dir, candidates[0]);
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        srcPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        targetPath,
        "-y",
      ],
      { timeout: MAX_FFMPEG_TIMEOUT_MS },
    );
    return true;
  } catch {
    try {
      fs.renameSync(srcPath, targetPath);
      return true;
    } catch {
      return false;
    }
  }
}

async function trimIfOversized(audioPath: string): Promise<void> {
  const stats = fs.statSync(audioPath);
  const sizeMB = stats.size / (1024 * 1024);
  console.log(`${LOG_PREFIX} Audio size: ${sizeMB.toFixed(1)}MB`);

  if (sizeMB <= MAX_AUDIO_SIZE_MB) return;

  const trimmedPath = `${audioPath}.trimmed.wav`;
  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-i",
        audioPath,
        "-t",
        String(MAX_AUDIO_DURATION_SECONDS),
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        trimmedPath,
        "-y",
      ],
      { timeout: MAX_FFMPEG_TIMEOUT_MS },
    );

    fs.unlinkSync(audioPath);
    fs.renameSync(trimmedPath, audioPath);
    console.log(
      `${LOG_PREFIX} Audio trimmed to ${MAX_AUDIO_DURATION_SECONDS / 60} minutes`,
    );
  } catch {
    console.warn(
      `${LOG_PREFIX} Could not trim audio, proceeding with original`,
    );
    try {
      fs.unlinkSync(trimmedPath);
    } catch {}
  }
}

async function transcribeAudio(
  audioPath: string,
  openai: OpenAI,
): Promise<string | ProcessingError> {
  const audioBuffer = fs.readFileSync(audioPath);
  const audioFile = new File([audioBuffer], "audio.wav", { type: "audio/wav" });

  console.log(`${LOG_PREFIX} Starting transcription...`);
  try {
    const transcription = await openai.audio.transcriptions.create({
      model: "whisper-1",
      file: audioFile,
    });
    const text = transcription.text || "";
    console.log(`${LOG_PREFIX} Transcription complete: ${text.length} chars`);
    return text;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Transcription failed:`, err?.message);
    return {
      status: 503,
      message:
        "AI transcription service is temporarily unavailable. The video was downloaded successfully but could not be transcribed. Please try again in a few minutes.",
    };
  }
}

async function summarizeTranscript(
  transcript: string,
  openai: OpenAI,
): Promise<string> {
  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "Summarize this video transcription into clear, well-organized study notes. Include:\n1. A brief overview\n2. Key points and main ideas (with bullet points)\n3. Important details and examples\n4. Main takeaways\n\nFormat with markdown headers and bullet points for easy reading.",
        },
        { role: "user", content: transcript },
      ],
      max_tokens: 2000,
    });

    const summary = response.choices[0]?.message?.content || "";
    return `## Video Summary\n\n${summary}\n\n---\n\n## Full Transcript\n\n${transcript}`;
  } catch (err: any) {
    console.error(`${LOG_PREFIX} Summarization failed:`, err?.message);
    return `## Full Transcript\n\n${transcript}`;
  }
}

function cleanupTempFiles(dir: string, filePrefix: string): void {
  try {
    const files = fs.readdirSync(dir).filter((f) => f.startsWith(filePrefix));
    for (const f of files) {
      try {
        fs.unlinkSync(path.join(dir, f));
      } catch {}
    }
  } catch {}
}

export async function processVideoUrl(
  videoUrl: string,
  openai: OpenAI | null,
): Promise<ProcessingResult | ProcessingError> {
  const filePrefix = `url_audio_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const tmpDir = "/tmp";

  try {
    const downloadResult = await downloadAudio(videoUrl, tmpDir, filePrefix);
    if (typeof downloadResult !== "string") return downloadResult;

    const audioPath = downloadResult;
    await trimIfOversized(audioPath);

    if (!openai) {
      return { status: 503, message: "AI service is not configured." };
    }

    const transcription = await transcribeAudio(audioPath, openai);
    if (typeof transcription !== "string") return transcription;

    if (!transcription.trim()) {
      return {
        status: 422,
        message:
          "Could not extract any content from the video. The video may not have audio or speech.",
      };
    }

    const finalText = await summarizeTranscript(transcription, openai);
    return { text: finalText };
  } finally {
    cleanupTempFiles(tmpDir, filePrefix);
  }
}

export { isProcessingError };
