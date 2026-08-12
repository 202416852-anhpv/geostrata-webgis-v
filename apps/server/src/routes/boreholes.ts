import { Router, Request, Response } from "express";
import { generateBoreholes } from "../generator.js";

export const boreholesRouter = Router();

boreholesRouter.get("/", (req: Request, res: Response) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const radius = Number(req.query.radius ?? 50);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res
      .status(400)
      .json({ error: "Bắt buộc cung cấp lat và lng hợp lệ" });
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    return res.status(400).json({ error: "radius phải là số dương" });
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: "Tọa độ không hợp lệ" });
  }

  const boreholes = generateBoreholes(lat, lng, radius);

  res.json({ lat, lng, radius, count: boreholes.length, boreholes });
});