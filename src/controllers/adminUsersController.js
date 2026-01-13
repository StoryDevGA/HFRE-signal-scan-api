const { Analytics, Submission } = require("../models");

async function deleteUserData(req, res) {
  const email = String(req.params.email || "").trim().toLowerCase();
  if (!email) {
    return res.status(400).json({ error: "Email is required." });
  }

  try {
    const submissions = await Submission.find({
      "inputs.email": email,
    }).select("_id");
    const submissionIds = submissions.map((item) => item._id);

    await Analytics.deleteMany({ submissionId: { $in: submissionIds } });
    const result = await Submission.deleteMany({
      "inputs.email": email,
    });

    return res.status(200).json({ deletedSubmissions: result.deletedCount });
  } catch (error) {
    return res.status(500).json({ error: "Failed to delete user data." });
  }
}

module.exports = { deleteUserData };
