import { supabase } from "../lib/supabase.js";

const WALLET_ADDRESS_PATTERN = /^0x[a-f0-9]{40}$/i;
const CONFIGURED_OFFICIAL_X_USERNAME = String(
  process.env.X_OFFICIAL_USERNAME || "GXFCLJ"
)
  .trim()
  .replace(/^@+/, "");
const OFFICIAL_X_USERNAME = /^[A-Za-z0-9_]{1,15}$/.test(
  CONFIGURED_OFFICIAL_X_USERNAME
)
  ? CONFIGURED_OFFICIAL_X_USERNAME
  : "Securityaler";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        success: false,
        error: "Method not allowed"
      });
    }

    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    const wallet = String(req.query.wallet || "").trim().toLowerCase();

    if (wallet && !WALLET_ADDRESS_PATTERN.test(wallet)) {
      return res.status(400).json({
        success: false,
        error: "Invalid wallet"
      });
    }

    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("active", true)
      .order("id", { ascending: false })
      .limit(1);

    if (taskError) {
      throw taskError;
    }

    const latestTask = tasks && tasks.length > 0 ? tasks[0] : null;

    let progress = [];
    let xAccount = null;

    if (wallet) {
      const { data: userData, error: userError } = await supabase
        .from("users")
        .select("x_user_id, x_username")
        .eq("wallet_address", wallet)
        .maybeSingle();

      if (userError) {
        throw userError;
      }

      xAccount = userData || null;

      if (latestTask) {
        const { data: progressData, error: progressError } = await supabase
          .from("task_progress")
          .select("*")
          .eq("wallet_address", wallet)
          .eq("task_id", latestTask.id);

        if (progressError) {
          throw progressError;
        }

        progress = progressData || [];
      }
    }

    return res.status(200).json({
      success: true,
      tasks: latestTask ? [latestTask] : [],
      progress,
      latestTaskId: latestTask ? latestTask.id : null,
      latestTweetId: latestTask ? String(latestTask.tweet_id) : null,
      officialXUsername: OFFICIAL_X_USERNAME,
      xConnected: Boolean(xAccount && xAccount.x_user_id),
      xUsername: xAccount ? xAccount.x_username : null
    });
  } catch (err) {
    console.error("Tasks error:", err);

    return res.status(500).json({
      success: false,
      error: "Failed to load tasks"
    });
  }
}
