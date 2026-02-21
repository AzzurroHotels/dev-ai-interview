// supabase/functions/notify-careers/index.ts
// Triggered after each interview submission.
// Fetches interview + answers, generates signed video URLs, sends email via Resend.

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function mustGetEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const interview_id = body?.interview_id;

    if (!interview_id) {
      return new Response(JSON.stringify({ error: "Missing interview_id" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = mustGetEnv("SUPABASE_URL");
    const SERVICE_KEY = mustGetEnv("SERVICE_ROLE_KEY");
    const RESEND_API_KEY = mustGetEnv("RESEND_API_KEY");

    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { persistSession: false },
    });

    // Fetch interview record
    const { data: interview, error: iErr } = await admin
      .from("cbit_interviews")
      .select("*")
      .eq("id", interview_id)
      .single();

    if (iErr) throw new Error(iErr.message);

    // Fetch all answers
    const { data: answers, error: aErr } = await admin
      .from("cbit_interview_answers")
      .select("*")
      .eq("interview_id", interview_id)
      .order("question_index", { ascending: true });

    if (aErr) throw new Error(aErr.message);

    // Generate signed URLs (valid for 7 days)
    const expiresIn = 60 * 60 * 24 * 7;
    const clips = [];

    for (const ans of answers ?? []) {
      const { data: signed, error: sErr } = await admin.storage
        .from("cbit-interviews")
        .createSignedUrl(ans.storage_path, expiresIn);

      if (sErr) throw new Error(sErr.message);

      clips.push({
        label: ans.question_index === 0 ? "Practice Recording" : `Question ${ans.question_index}`,
        question_text: ans.question_text,
        followup_text: ans.followup_text,
        signed_url: signed.signedUrl,
        duration_seconds: ans.duration_seconds,
      });
    }

    // Build email HTML
    const clipsHtml = clips.map((c) => `
      <div style="margin-bottom:24px; padding:16px; background:#f9f9f9; border-left:4px solid #0066cc; border-radius:4px;">
        <p style="margin:0 0 6px 0; font-weight:bold; color:#0066cc;">${c.label}</p>
        <p style="margin:0 0 6px 0; color:#333;">${c.question_text}</p>
        ${c.followup_text ? `<p style="margin:0 0 6px 0; color:#666; font-style:italic;">Follow-up: ${c.followup_text}</p>` : ""}
        <p style="margin:0 0 8px 0; color:#999; font-size:13px;">Duration: ~${c.duration_seconds}s</p>
        <a href="${c.signed_url}" style="display:inline-block; padding:8px 16px; background:#0066cc; color:white; text-decoration:none; border-radius:4px; font-size:14px;">▶ Watch Recording</a>
        <p style="margin:6px 0 0 0; color:#999; font-size:11px;">Link expires in 7 days</p>
      </div>
    `).join("");

    const emailHtml = `
      <div style="font-family:sans-serif; max-width:640px; margin:0 auto; color:#333;">
        <div style="background:#0066cc; padding:24px; border-radius:8px 8px 0 0;">
          <h1 style="margin:0; color:white; font-size:22px;">New Interview Submission</h1>
          <p style="margin:6px 0 0 0; color:#cce0ff;">CBIT AI Interview Portal</p>
        </div>

        <div style="padding:24px; background:white; border:1px solid #e0e0e0;">
          <h2 style="margin:0 0 16px 0; font-size:18px;">Candidate Details</h2>
          <table style="width:100%; border-collapse:collapse; margin-bottom:24px;">
            <tr><td style="padding:8px; color:#666; width:140px;">Name</td><td style="padding:8px; font-weight:bold;">${interview.candidate_name}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px; color:#666;">Email</td><td style="padding:8px;">${interview.candidate_email || "Not provided"}</td></tr>
            <tr><td style="padding:8px; color:#666;">Role</td><td style="padding:8px;">${interview.role}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px; color:#666;">Submitted</td><td style="padding:8px;">${new Date(interview.created_at).toLocaleString("en-AU", { timeZone: "Australia/Sydney" })}</td></tr>
            <tr><td style="padding:8px; color:#666;">Tab Switches</td><td style="padding:8px;">${interview.visibility_hidden_count}</td></tr>
            <tr style="background:#f9f9f9;"><td style="padding:8px; color:#666;">Practice Re-records</td><td style="padding:8px;">${interview.practice_rerecords}</td></tr>
          </table>

          <h2 style="margin:0 0 16px 0; font-size:18px;">Recordings</h2>
          ${clipsHtml}
        </div>

        <div style="padding:16px; background:#f0f0f0; border-radius:0 0 8px 8px; text-align:center;">
          <p style="margin:0; color:#999; font-size:12px;">Sent by CBIT AI Interview Portal • careers@interview.azzurrohotels.com</p>
        </div>
      </div>
    `;

    // Send via Resend
    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "CBIT Interviews <careers@interview.azzurrohotels.com>",
        to: ["careers@azzurrohotels.com"],
        subject: `New Interview: ${interview.candidate_name} — ${interview.role}`,
        html: emailHtml,
      }),
    });

    if (!resendRes.ok) {
      const err = await resendRes.text();
      throw new Error(`Resend error: ${err}`);
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e?.message || e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
