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
        ${c.followup_text ? `<p style="margin:0 0 6p
