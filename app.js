
// CBIT Interview System - Updated app.js
// Storage bucket: interview-recordings
// Sends notification via Supabase Edge Function (notify-careers or cbit-send-interview-email)

import { SUPABASE_URL, SUPABASE_ANON_KEY, CAREERS_EMAIL } from "./supabase-config.js";

if (!window.supabase?.createClient) {
  throw new Error(
    'Supabase JS SDK not loaded. Ensure CDN script for @supabase/supabase-js v2 is included before app.js.'
  );
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const STORAGE_BUCKET = "interview-recordings";
const STORAGE_PREFIX = "cbit-interviews";
const NOTIFY_FUNCTION_CANDIDATES = ["notify-careers", "cbit-send-interview-email"];

const CONFIG = {
  role: "Developer (API • Integration • AI)",
  mode: "video",
  preferredMimeTypes: [
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
};

function safeName(s) {
  return (s || "").trim().slice(0, 120);
}

function safeEmail(s) {
  return (s || "").trim().slice(0, 254);
}

function pickMimeType() {
  for (const t of CONFIG.preferredMimeTypes) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

let stream = null;
let mediaRecorder = null;
let chunks = [];
let startedAt = 0;

async function initMedia() {
  if (stream) return stream;
  stream = await navigator.mediaDevices.getUserMedia({
    audio: true,
    video: { width: 1280, height: 720 },
  });
  return stream;
}

function startRecording() {
  const mimeType = pickMimeType();
  mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  chunks = [];
  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };
  startedAt = Date.now();
  mediaRecorder.start(250);
}

function stopRecording() {
  return new Promise((resolve) => {
    mediaRecorder.onstop = () => {
      const durationSeconds = Math.max(
        1,
        Math.round((Date.now() - startedAt) / 1000)
      );
      const mimeType = mediaRecorder.mimeType || "video/webm";
      const blob = new Blob(chunks, { type: mimeType });
      resolve({ blob, durationSeconds, mimeType });
    };
    mediaRecorder.stop();
  });
}

async function submitInterview(blob, durationSeconds, mimeType) {
  const name = safeName(document.getElementById("fullName").value);
  const email = safeEmail(document.getElementById("email").value);

  const { data: interview, error: interviewErr } = await supabase
    .from("cbit_interviews")
    .insert({
      candidate_name: name,
      candidate_email: email || null,
      role: CONFIG.role,
      mode: CONFIG.mode,
      status: "uploading",
      total_questions: 1,
    })
    .select()
    .single();

  if (interviewErr) throw interviewErr;

  const interviewId = interview.id;

  const ext = mimeType.includes("mp4") ? "mp4" : "webm";
  const path = `${STORAGE_PREFIX}/${interviewId}/answer.${ext}`;

  const { error: uploadErr } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, blob, { contentType: mimeType });

  if (uploadErr) throw uploadErr;

  await supabase.from("cbit_interview_answers").insert({
    interview_id: interviewId,
    question_index: 1,
    question_text: "Main Interview Answer",
    followup_text: "",
    storage_path: path,
    duration_seconds: durationSeconds,
    mime_type: mimeType,
  });

  // Trigger email notification
  for (const fnName of NOTIFY_FUNCTION_CANDIDATES) {
    try {
      await supabase.functions.invoke(fnName, {
        body: { interview_id: interviewId, to_email: CAREERS_EMAIL },
      });
      break;
    } catch (e) {
      console.warn("Notification failed for function:", fnName);
    }
  }

  await supabase
    .from("cbit_interviews")
    .update({ status: "submitted" })
    .eq("id", interviewId);

  alert("Interview submitted successfully.");
}

// Example usage binding
document.getElementById("startRecording")?.addEventListener("click", async () => {
  await initMedia();
  startRecording();
});

document.getElementById("stopRecording")?.addEventListener("click", async () => {
  const clip = await stopRecording();
  await submitInterview(clip.blob, clip.durationSeconds, clip.mimeType);
});
