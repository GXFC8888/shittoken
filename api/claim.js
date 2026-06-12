import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { wallet, taskId, txHash } = req.body || {};
    const walletAddress = String(wallet || "").toLowerCase();

    if (!walletAddress || !walletAddress.startsWith("0x")) {
      return res.status(400).json({ error: "Invalid wallet" });
    }

    if (!taskId) {
      return res.status(400).json({ error: "Missing taskId" });
    }

    const { data: progress, error: progressError } = await supabase
      .from("task_progress")
      .select("*")
      .eq("wallet_address", walletAddress)
      .eq("task_id", taskId)
      .maybeSingle();

    if (progressError) throw progressError;

    if (!progress) {
      return res.status(400).json({ error: "Task not verified" });
    }

    if (!progress.claimable) {
      return res.status(400).json({ error: "Not claimable yet" });
    }

    if (progress.claimed) {
      return res.status(400).json({ error: "Already claimed" });
    }

    const { error: updateError } = await supabase
      .from("task_progress")
      .update({
        claimed: true,
        tx_hash: txHash || null,
        claimed_at: new Date().toISOString()
      })
      .eq("id", progress.id);

    if (updateError) throw updateError;

    return res.status(200).json({
      success: true,
      message: "Claim recorded"
    });
  } catch (err) {
    console.error("Claim error:", err);

    return res.status(500).json({
      success: false,
      error: "Claim failed",
      detail: err.message
    });
  }
}
