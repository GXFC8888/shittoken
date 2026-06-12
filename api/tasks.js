// trigger redeploy
import { supabase } from "../lib/supabase.js";

export default async function handler(req, res) {
  try {
    const wallet = String(req.query.wallet || "").toLowerCase();

    const { data: tasks, error: taskError } = await supabase
      .from("tasks")
      .select("*")
      .eq("active", true)
      .order("id", { ascending: true });

    if (taskError) throw taskError;

    let progress = [];

    if (wallet && wallet.startsWith("0x")) {
      const { data, error } = await supabase
        .from("task_progress")
        .select("*")
        .eq("wallet_address", wallet);

      if (error) throw error;

      progress = data || [];
    }

    return res.status(200).json({
      success: true,
      tasks,
      progress
    });
  } catch (err) {
    console.error("Tasks error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to load tasks"
    });
  }
}
