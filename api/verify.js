import { supabase } from "../lib/supabase.js";
import { getAppClient } from "../lib/x.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { wallet, taskId } = req.body || {};
    const walletAddress = String(wallet || "").toLowerCase();

    if (!walletAddress || !walletAddress.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid wallet" });
    }

    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId" });
    }

    const { data: user, error: userError } = await supabase
      .from("users")
      .select("*")
      .eq("wallet_address", walletAddress)
      .maybeSingle();

    if (userError) throw userError;

    if (!user || !user.x_user_id || !user.x_username) {
      return res.status(400).json({
        success: false,
        error: "Please connect X first"
      });
    }

    const { data: task, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("id", taskId)
      .eq("active", true)
      .maybeSingle();

    if (taskError) throw taskError;

    if (!task) {
      return res.status(404).json({
        success: false,
        error: "Task not found"
      });
    }

    const xClient = getAppClient();

    const query = `conversation_id:${task.tweet_id} from:${user.x_username} -is:retweet`;

    let foundComment = false;

    const search = await xClient.v2.search(query, {
      max_results: 10,
      "tweet.fields": ["author_id", "conversation_id", "created_at"]
    });

    for await (const tweet of search) {
      if (
        tweet.author_id === user.x_user_id &&
        tweet.conversation_id === task.tweet_id
      ) {
        foundComment = true;
        break;
      }
    }

    if (!foundComment) {
      return res.status(200).json({
        success: false,
        completed: false,
        message: "No comment found yet. Please comment on X and try again later."
      });
    }

    const { error: upsertError } = await supabase.from("task_progress").upsert(
      {
        task_id: task.id,
        wallet_address: walletAddress,
        x_user_id: user.x_user_id,
        x_username: user.x_username,
        commented: true,
        verified: true,
        claimable: true,
        verified_at: new Date().toISOString()
      },
      {
        onConflict: "task_id,wallet_address"
      }
    );

    if (upsertError) throw upsertError;

    return res.status(200).json({
      success: true,
      completed: true,
      claimable: true,
      message: "Mission verified. You can claim now."
    });
  } catch (err) {
    console.error("Verify error:", err);

    return res.status(500).json({
      success: false,
      error: "Verify failed",
      detail: err.message
    });
  }
}
