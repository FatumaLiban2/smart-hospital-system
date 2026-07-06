// Server-only: sends transactional email via Resend's REST API. Never throws —
// callers get back { ok: false, error } so a delivery failure never blocks the
// Firestore writes (payment/notification records) that triggered the send.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const sendEmailInput = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  text: z.string().min(1),
});

export const sendEmail = createServerFn({ method: "POST" })
  .validator((input: unknown) => sendEmailInput.parse(input))
  .handler(async ({ data }): Promise<{ ok: boolean; id?: string; error?: string }> => {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[email] RESEND_API_KEY not configured — skipping send");
      return { ok: false, error: "RESEND_API_KEY not configured" };
    }
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Smart Hospital System <onboarding@resend.dev>",
          to: [data.to],
          subject: data.subject,
          text: data.text,
        }),
      });
      if (!res.ok) {
        const body = await res.text();
        console.error("[email] Resend error", res.status, body);
        return { ok: false, error: `Resend responded ${res.status}` };
      }
      const json = (await res.json()) as { id?: string };
      return { ok: true, id: json.id };
    } catch (err: unknown) {
      console.error("[email] send failed", err);
      return { ok: false, error: (err as Error).message ?? "send failed" };
    }
  });
