import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./supabase-config.js";

// -------------------------------
// Runtime guards (reduce "blank page" failures)
// -------------------------------
if (!window.supabase?.createClient) {
  throw new Error(
    "Supabase JS SDK not loaded. Ensure <script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2\"></script> is included before app.js."
  );
}

function looksUnconfigured(v) {
  return !v || /YOUR_PROJECT_REF|YOUR_SUPABASE_ANON_KEY/i.test(String(v));
}

if (looksUnconfigured(SUPABASE_URL) || looksUnconfigured(SUPABASE_ANON_KEY)) {
  // Show a helpful message on-screen (instead of failing silently)
  const msg =
    "Supabase is not configured yet. Please update supabase-config.js with your SUPABASE_URL and SUPABASE_ANON_KEY.";
  console.error(msg);
  alert(msg);
}

const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);


// -------------------------------
// Storage + Notifications
// -------------------------------
const STORAGE_BUCKET = "cbit-interviews"; // Supabase Storage bucket name
const NOTIFY_FUNCTION_CANDIDATES = ["notify-careers", "cbit-send-interview-email"];


// -------------------------------
// Interview configuration
// -------------------------------
const CONFIG = {
    role: "Developer (API • Integration • AI)",
  mode: "video", // fixed for this project
  // No re-records allowed - one take only
  aiVoiceEnabled: true,
  aiVoiceRate: 1.50,
  aiVoicePitch: 1.0,
  // Follow-ups: choose 1 random follow-up per main question
  followupsPerQuestion: 1,
  // Recording format
  preferredMimeTypes: [
    // Safari/iOS often prefers MP4 (when MediaRecorder is available)
    "video/mp4",
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
  ],
};

// -------------------------------
// Question bank (your provided questions + follow-ups)
// Random order of main questions; one random follow-up each
// -------------------------------
const QUESTIONS = [
  {
    id: "q1-api-design",
    text: "If you were to design a REST API for a Complaint Management System, what endpoints would you create and why?",
    followups: [
      "How would you handle API versioning if breaking changes are introduced?",
      "How would you choose between PUT vs PATCH for updates?",
      "What status codes would you return for common cases (success, validation error, unauthorized, not found)?",
      "How would you design pagination, filtering, and sorting for the list endpoint?",
    ],
  },
  {
    id: "q2-integration-reliability",
    text: "You need to integrate a third-party payment API into your system. What steps would you take to ensure secure and reliable integration?",
    followups: [
      "What would you do if the third-party API is temporarily down but your users are still submitting requests?",
      "How do you handle rate limits (429) and timeouts in a production integration?",
      "How would you validate and secure webhooks from the payment provider?",
      "What would you log to troubleshoot failed payments without storing sensitive data?",
    ],
  },
  {
    id: "q3-db-security",
    text: "How would you prevent unauthorized users from accessing other users’ data when building an API connected to a database?",
    followups: [
      "Why is relying only on frontend validation dangerous?",
      "Where do you enforce authorization: in the API layer, the database (RLS), or both? Why?",
      "How would you structure roles/permissions for admin vs normal user?",
      "How would you handle multi-tenant data separation (company A vs company B)?",
    ],
  },
  {
    id: "q4-openai-security-rbac",
    text: "If you are integrating an API such as OpenAI into your app, how would you handle things like: (1) Preventing spam and misuse, and (2) Role-based access control (RBAC)?",
    followups: [
      "How would you prevent a user from bypassing your frontend limits using Postman or direct API calls?",
      "What rate limits or quotas would you apply per user, per role, and per IP?",
      "How would you protect your API key and keep AI calls server-side?",
      "How would you track and control cost per user (tokens/requests)?",
    ],
  },
  {
    id: "q5-moderation-ugc",
    text: "If you were building an app which contained user-generated content, how would you automate moderation to make sure nothing inappropriate is posted?",
    followups: [
      "What would you do when the moderation system is unsure (low confidence), and how would you handle false positives/false negatives?",
      "Would you use pre-moderation (block before publish) or post-moderation (remove after)? Why?",
      "How would you prevent users from bypassing moderation (obfuscated text, spaced letters, text inside images)?",
      "What logs/audit trail would you keep for admin review and appeals?",
    ],
  },
];


// -------------------------------
// UI elements
// -------------------------------
const els = {
  status: document.getElementById("statusText"),

  // steps
  welcome: document.getElementById("step-welcome"),
  practice: document.getElementById("step-practice"),
  interview: document.getElementById("step-interview"),
  submit: document.getElementById("step-submit"),
  done: document.getElementById("step-done"),

  // inputs
  consent: document.getElementById("consent"),
  fullName: document.getElementById("fullName"),
  email: document.getElementById("email"),
  startBtn: document.getElementById("startBtn"),

  // camera
  preview: document.getElementById("preview"),

  // practice
  practiceRecordBtn: document.getElementById("practiceRecordBtn"),
  practiceStopBtn: document.getElementById("practiceStopBtn"),
  practiceContinueBtn: document.getElementById("practiceContinueBtn"),
  practicePlaybackWrap: document.getElementById("practicePlaybackWrap"),
  practicePlayback: document.getElementById("practicePlayback"),
  aiTextPractice: document.getElementById("aiTextPractice"),
  practiceQuestion: document.getElementById("practiceQuestion"),

  // interview Qs
  qBadge: document.getElementById("qBadge"),
  qProgress: document.getElementById("qProgress"),
  question: document.getElementById("question"),
  followup: document.getElementById("followup"),
  aiText: document.getElementById("aiText"),
  hintText: document.getElementById("hintText"),

  // interview controls
  recordBtn: document.getElementById("recordBtn"),
  stopBtn: document.getElementById("stopBtn"),
  nextBtn: document.getElementById("nextBtn"),
  playbackWrap: document.getElementById("playbackWrap"),
  playback: document.getElementById("playback"),
  playbackMeta: document.getElementById("playbackMeta"),

  // upload progress
  uploadBar: document.getElementById("uploadBar"),
  uploadStatus: document.getElementById("uploadStatus"),
};

function setStatus(text) {
  els.status.textContent = text;
}

function showStep(stepEl) {
  for (const el of [els.welcome, els.practice, els.interview, els.submit, els.done]) {
    el.classList.add("hidden");
  }
  stepEl.classList.remove("hidden");
}

// -------------------------------
// Basic helpers
// -------------------------------
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pickRandom(arr, n) {
  const s = shuffle(arr);
  return s.slice(0, Math.max(0, Math.min(n, s.length)));
}

function nowIso() {
  return new Date().toISOString();
}

function safeName(s) {
  return (s || "").trim().replace(/\s+/g, " ").slice(0, 120);
}

function safeEmail(s) {
  const v = (s || "").trim().slice(0, 254);
  return v;
}

function isProbablyEmail(s) {
  // Simple sanity check (not RFC-perfect; prevents obvious bad input)
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || "").trim());
}

// -------------------------------
// AI voice (Web Speech API) - built-in browser TTS
// -------------------------------
function speak(text) {
  if (!CONFIG.aiVoiceEnabled) return;
  if (!("speechSynthesis" in window)) return;

  // Cancel any ongoing speech
  window.speechSynthesis.cancel();

  function doSpeak() {
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = CONFIG.aiVoiceRate;
    utter.pitch = CONFIG.aiVoicePitch;

    // Prefer an English voice if available
    const voices = window.speechSynthesis.getVoices?.() || [];
    const preferred = voices.find(v => /en/i.test(v.lang)) || voices[0];
    if (preferred) utter.voice = preferred;

    window.speechSynthesis.speak(utter);
  }

  // Some browsers load voices asynchronously — wait if not ready yet
  const voices = window.speechSynthesis.getVoices?.() || [];
  if (voices.length > 0) {
    doSpeak();
  } else {
    window.speechSynthesis.onvoiceschanged = () => {
      window.speechSynthesis.onvoiceschanged = null;
      doSpeak();
    };
  }
}

// Warm up voice list on page load
if ("speechSynthesis" in window) {
  window.speechSynthesis.getVoices?.();
}

// -------------------------------
// Media recording
// -------------------------------
function pickMimeType() {
  for (const t of CONFIG.preferredMimeTypes) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return "";
}

async function getCameraStream() {
  return await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

function hasRecordingSupport() {
  return typeof window.MediaRecorder !== "undefined";
}

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let num = bytes;
  while (num >= 1024 && i < units.length - 1) {
    num /= 1024;
    i++;
  }
  return `${num.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

class ClipRecorder {
  constructor(stream) {
    this.stream = stream;
    this.recorder = null;
    this.chunks = [];
    this.startedAt = null;
    this.stoppedAt = null;
    this.mimeType = pickMimeType();
  }

  start() {
    this.chunks = [];
    this.startedAt = performance.now();

    this.recorder = new MediaRecorder(this.stream, this.mimeType ? { mimeType: this.mimeType } : undefined);
    this.recorder.onerror = (e) => {
      console.error("MediaRecorder error", e);
    };
    this.recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) this.chunks.push(e.data);
    };
    this.recorder.start(200); // collect chunks periodically
  }

  stop() {
    return new Promise((resolve, reject) => {
      if (!this.recorder) return reject(new Error("Recorder not started"));
      this.recorder.onstop = () => {
        this.stoppedAt = performance.now();
        const blob = new Blob(this.chunks, { type: this.recorder.mimeType || "video/webm" });
        const durationSeconds = Math.max(1, Math.round((this.stoppedAt - this.startedAt) / 1000));
        resolve({ blob, durationSeconds, mimeType: this.recorder.mimeType || "video/webm" });
      };
      this.recorder.stop();
    });
  }
}

// -------------------------------
// Interview state
// -------------------------------
let stream = null;

let practiceClip = null; // { blob, durationSeconds, mimeType }
let practiceRerecords = 0;

let interviewPlan = []; // [{question, followupText, index}]
let currentIdx = 0;

let currentClip = null; // { blob, durationSeconds, mimeType }
let recordedClips = []; // for upload [{question_id, question_text, followup_text, blob, duration_seconds, mime_type}]
let recorder = null; // active ClipRecorder during interview

let visibilityHiddenCount = 0;
document.addEventListener("visibilitychange", () => {
  if (document.hidden) visibilityHiddenCount += 1;
});

// -------------------------------
// UI wiring
// -------------------------------
els.startBtn.addEventListener("click", async () => {
  // Validate
  if (!els.consent.checked) {
    alert("Consent is required to proceed.");
    return;
  }
  const name = safeName(els.fullName.value);
  if (!name) {
    alert("Please enter your full name.");
    return;
  }
  const email = safeEmail(els.email.value);
  if (email && !isProbablyEmail(email)) {
    alert("Please enter a valid email address (or leave it blank).");
    return;
  }

  // Confirmation prompt
  const confirmed = confirm(
    "⚠️ Important Notice\n\n" +
    "• This interview is being recorded.\n\n" +
    "• Switching tabs or minimising this window during the interview will be logged and may result in automatic disqualification.\n\n" +
    "Please keep this tab active and in focus for the entire duration.\n\n" +
    "Press OK to confirm you understand and wish to proceed."
  );
  if (!confirmed) return;

  // Camera
  try {
    setStatus("Requesting camera…");
    stream = await getCameraStream();
    els.preview.srcObject = stream;
    setStatus("Camera ready");
  } catch (e) {
    console.error(e);
    setStatus("Camera blocked");
    alert("Camera/Mic permission is required for this interview.");
    return;
  }

  // Recording support
  if (!hasRecordingSupport()) {
    setStatus("Recording unsupported");
    alert(
      "Your browser does not support in-browser recording (MediaRecorder). Please use the latest Chrome or Edge on desktop, or the latest Chrome on Android.\n\nIf you're on iPhone/iPad, update iOS and try again, or use a desktop browser."
    );
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch {}
    stream = null;
    return;
  }

  // Move to practice
  showStep(els.practice);
  speak("Let’s do a quick practice. This is not scored. Please say your name and today’s date, then give a short professional introduction like you’re starting a developer interview (your role, main stack, and what you’ve built recently).");
});

// Practice controls
let practiceRecorder = null;
els.practiceRecordBtn.addEventListener("click", () => {
  if (!stream) return;

  // Track re-records (starting a new recording when one already exists)
  if (practiceClip) practiceRerecords += 1;

  practiceRecorder = new ClipRecorder(stream);
  practiceRecorder.start();

  els.practiceRecordBtn.disabled = true;
  els.practiceStopBtn.disabled = false;

  els.practiceContinueBtn.disabled = true;

  setStatus("Recording practice…");
});

els.practiceStopBtn.addEventListener("click", async () => {
  if (!practiceRecorder) return;
  let clip;
  try {
    clip = await practiceRecorder.stop();
  } catch (e) {
    console.error(e);
    setStatus("Practice stop failed");
    alert("Recording failed. Please try again.");
    els.practiceRecordBtn.disabled = false;
    els.practiceStopBtn.disabled = true;
  
    els.practiceContinueBtn.disabled = true;
    return;
  }

  practiceClip = clip;

  // Revoke any previous object URL to avoid memory leak
  if (els.practicePlayback.src && els.practicePlayback.src.startsWith("blob:")) {
    URL.revokeObjectURL(els.practicePlayback.src);
  }
  const url = URL.createObjectURL(clip.blob);
  els.practicePlayback.src = url;
  els.practicePlaybackWrap.classList.remove("hidden");

  els.practiceStopBtn.disabled = true;
  els.practiceRecordBtn.disabled = false;
  els.practiceContinueBtn.disabled = false;

  setStatus("Practice recorded");
});

// Practice retry button removed - no retakes allowed

els.practiceContinueBtn.addEventListener("click", () => {
  // Build interview plan: shuffle main questions; pick 1 follow-up each
  const mains = shuffle(QUESTIONS);
  interviewPlan = mains.map((q, i) => {
    const followup = pickRandom(q.followups, CONFIG.followupsPerQuestion)[0] || null;
    return { index: i, question: q, followupText: followup };
  });
  currentIdx = 0;
  recordedClips = [];

  showStep(els.interview);
  loadQuestion();
});

function loadQuestion() {
  const total = interviewPlan.length;
  const item = interviewPlan[currentIdx];

  els.qBadge.textContent = `Question ${currentIdx + 1}`;
  els.qProgress.textContent = `${currentIdx + 1} of ${total}`;
  els.question.textContent = item.question.text;

  if (item.followupText) {
    els.followup.textContent = item.followupText;
    els.followup.classList.remove("hidden");
  } else {
    els.followup.classList.add("hidden");
  }

  // Reset controls
  currentClip = null;
  els.playbackWrap.classList.add("hidden");
  els.playback.removeAttribute("src");
  els.playbackMeta.textContent = "";
  els.hintText.textContent = "Recording has started. Answer clearly and professionally.";

  // Auto-start recording
  recorder = new ClipRecorder(stream);
  recorder.start();

  els.recordBtn.disabled = true;
  els.recordBtn.classList.add("hidden");
  els.stopBtn.disabled = false;

  els.nextBtn.disabled = true;

  setStatus("Recording…");

  // AI voice reads the question + follow-up (developer interview tone)
  const voiceText = item.followupText
    ? `Question ${currentIdx + 1}. ${item.question.text} Follow-up: ${item.followupText}`
    : `Question ${currentIdx + 1}. ${item.question.text}`;

  els.aiText.textContent = `"${voiceText}"`;
  speak(voiceText);
}

// Interview recording controls

els.stopBtn.addEventListener("click", async () => {
  if (!recorder) return;
  let clip;
  try {
    clip = await recorder.stop();
  } catch (e) {
    console.error(e);
    setStatus("Stop failed");
    alert("Recording failed. Please try again.");
    els.recordBtn.disabled = false;
    els.stopBtn.disabled = true;
  
    els.nextBtn.disabled = true;
    return;
  }

  currentClip = clip;

  // Revoke any previous object URL to avoid memory leak
  if (els.playback.src && els.playback.src.startsWith("blob:")) {
    URL.revokeObjectURL(els.playback.src);
  }
  const url = URL.createObjectURL(clip.blob);
  els.playback.src = url;
  els.playbackWrap.classList.remove("hidden");
  els.playbackMeta.textContent = `Duration: ~${clip.durationSeconds}s • Size: ${formatBytes(clip.blob.size)}`;

  els.stopBtn.disabled = true;
  els.nextBtn.disabled = false;

  setStatus("Recorded");
});

// Retry button removed - no retakes allowed

els.nextBtn.addEventListener("click", () => {
  if (!currentClip) {
    alert("Please stop the recording before continuing.");
    return;
  }

  const item = interviewPlan[currentIdx];
  recordedClips.push({
    question_id: item.question.id,
    question_text: item.question.text,
    followup_text: item.followupText,
    blob: currentClip.blob,
    duration_seconds: currentClip.durationSeconds,
    mime_type: currentClip.mimeType,
  });

  // Next or submit
  currentIdx += 1;
  if (currentIdx < interviewPlan.length) {
    loadQuestion();
  } else {
    // Done answering
    submitInterview().catch((e) => {
      console.error(e);
      alert("Submission failed. Please try again or contact support.");
      setStatus("Submission failed");
      showStep(els.interview);
    });
  }
});

// -------------------------------
// Submit: create DB records, upload clips to Storage, then email careers@
// -------------------------------

async function submitInterview() {
  showStep(els.submit);
  setStatus("Uploading…");

  let interviewId = null;

  const candidateName = safeName(els.fullName.value);
  const candidateEmail = safeEmail(els.email.value);

  // IMPORTANT:
  // Your current Supabase table (cbit_interviews) may only have:
  // candidate_name, candidate_email, role
  // So we insert ONLY those fields (works with both minimal + full schema).
  const { data: interview, error: interviewErr } = await supabase
    .from("cbit_interviews")
    .insert({
      candidate_name: candidateName,
      candidate_email: candidateEmail || null,
      role: CONFIG.role,
      total_questions: interviewPlan.length,
      visibility_hidden_count: visibilityHiddenCount,
      practice_rerecords: practiceRerecords,
    })
    .select()
    .single();

  if (interviewErr) throw interviewErr;

  interviewId = interview.id;

  try {
    // 1) Upload practice clip (optional) + save as answer row (question_index = 0)
    if (practiceClip) {
      const ext = practiceClip.mimeType.includes("mp4") ? "mp4" : "webm";
      const practicePath = `cbit-interviews/${interviewId}/practice.${ext}`;

      els.uploadStatus.textContent = "Uploading practice recording…";

      const { error: practiceUpErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(practicePath, practiceClip.blob, {
          contentType: practiceClip.mimeType,
          upsert: false,
        });

      if (practiceUpErr) throw practiceUpErr;

      const { error: practiceAnsErr } = await supabase
        .from("cbit_interview_answers")
        .insert({
          interview_id: interviewId,
          question_index: 0,
          question_text: "Practice recording",
          followup_text: null,
          storage_path: practicePath,
          duration_seconds: practiceClip.durationSeconds,
          mime_type: practiceClip.mimeType,
        });

      if (practiceAnsErr) throw practiceAnsErr;
    }

    // 2) Upload each interview clip + insert answer row
    const totalUploads = recordedClips.length;
    let completed = 0;

    for (let i = 0; i < recordedClips.length; i++) {
      const c = recordedClips[i];
      const ext = c.mime_type.includes("mp4") ? "mp4" : "webm";

      const path = `cbit-interviews/${interviewId}/q${String(i + 1).padStart(
        2,
        "0"
      )}_${c.question_id}.${ext}`;

      els.uploadStatus.textContent = `Uploading ${i + 1} of ${totalUploads}…`;

      const { error: upErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, c.blob, { contentType: c.mime_type, upsert: false });

      if (upErr) throw upErr;

      const { error: ansErr } = await supabase.from("cbit_interview_answers").insert({
        interview_id: interviewId,
        question_index: i + 1,
        question_text: c.question_text,
        followup_text: c.followup_text || null,
        storage_path: path,
        duration_seconds: c.duration_seconds,
        mime_type: c.mime_type,
      });

      if (ansErr) throw ansErr;

      completed += 1;
      const pct = Math.round((completed / totalUploads) * 100);
      els.uploadBar.style.width = `${pct}%`;
    }

    // 3) Try to notify careers via Edge Function (optional).
    // This will NOT break submission if the function is not deployed yet.
    els.uploadStatus.textContent = "Sending notification…";
    let notified = false;

    for (const fnName of NOTIFY_FUNCTION_CANDIDATES) {
      try {
        const { error } = await supabase.functions.invoke(fnName, {
          body: { interview_id: interviewId },
        });
        if (!error) {
          notified = true;
          break;
        }
      } catch (_) {}
    }

    if (!notified) {
      // Not fatal — recordings are already uploaded.
      els.uploadStatus.textContent = "Submitted (email pending)";
    } else {
      els.uploadStatus.textContent = "Submitted (email sent)";
    }

    // 4) Optional status update (ignore failure if column doesn't exist)
    try {
      await supabase.from("cbit_interviews").update({ status: "submitted" }).eq("id", interviewId);
    } catch (_) {}

    els.uploadBar.style.width = "100%";
    setStatus("Submitted");
    showStep(els.done);
  } catch (e) {
    // Best-effort update
    try {
      await supabase.from("cbit_interviews").update({ status: "failed" }).eq("id", interviewId);
    } catch (_) {}

    throw e;
  } finally {
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch (_) {}
  }
}

