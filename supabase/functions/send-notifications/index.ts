import webpush from "npm:web-push@3.6.7";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

webpush.setVapidDetails(
  Deno.env.get("VAPID_SUBJECT") || "mailto:zozdle@example.com",
  Deno.env.get("VAPID_PUBLIC")!,
  Deno.env.get("VAPID_PRIVATE")!,
);

const pad = (n: number) => String(n).padStart(2, "0");

function nowInTz(tz: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hour12: false,
    }).formatToParts(new Date()).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const hh = parts.hour === "24" ? "00" : parts.hour;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${hh}:${parts.minute}` };
}

Deno.serve(async () => {
  const [{ data: prefs }, { data: subs }] = await Promise.all([
    sb.from("notify_prefs").select("user_id, notify_new, notify_before, tz")
      .or("notify_new.eq.true,notify_before.eq.true"),
    sb.from("push_subscriptions").select("*"),
  ]);

  const byUser: Record<string, any[]> = {};
  (subs || []).forEach((s) => (byUser[s.user_id] ||= []).push(s));

  let sent = 0;
  for (const pref of prefs || []) {
    const userSubs = byUser[pref.user_id];
    if (!userSubs?.length) continue;
    const now = nowInTz(pref.tz || "UTC");
    const notes: { key: string; title: string; body: string }[] = [];

    if (pref.notify_new && now.hm === "00:00") {
      notes.push({
        key: `new:${now.date}`,
        title: "New Zozdle is live",
        body: "Today's word is ready — keep your streak going.",
      });
    }

    if (pref.notify_before && now.hm === "23:00") {
      const { data: play } = await sb.from("plays")
        .select("finished").eq("user_id", pref.user_id)
        .eq("puzzle_date", now.date).eq("finished", true).maybeSingle();
      if (!play) {
        notes.push({
          key: `before:${now.date}`,
          title: "1 hour left",
          body: "You haven't played today's Zozdle yet — don't lose your streak.",
        });
      }
    }

    for (const n of notes) {
      const { error } = await sb.from("notifications_sent")
        .insert({ user_id: pref.user_id, key: n.key });
      if (error) continue;
      const payload = JSON.stringify({ title: n.title, body: n.body, url: "." });
      for (const s of userSubs) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          sent++;
        } catch (err: any) {
          if (err?.statusCode === 404 || err?.statusCode === 410) {
            await sb.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { "Content-Type": "application/json" },
  });
});
