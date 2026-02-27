import { assetService } from "../services/assetService.js";

export const assetController = {
  /**
   * GET /api/assets
   * Returns all facilities with live availability data.
   */
  async getAssets(req, res) {
    const { userName, userType } = req.query;

    try {
      const assets = await assetService.getAllAssets(userName, userType);
      return res.status(200).json(assets);
    } catch (error) {
      console.error("Fetch Assets Error:", error);
      return res.status(500).json({
        error: "Failed to retrieve live asset data. Please try again later.",
      });
    }
  },
};
