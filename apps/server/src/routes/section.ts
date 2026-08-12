import { Router, Request, Response } from "express";
import { Borehole } from "@geostrata/shared";
import { generateBoreholes, generateSection } from "../generator.js";

export const sectionRouter = Router();

sectionRouter.get("/", (req: Request, res: Response) => {
  const id = String(req.query.id ?? "");
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: "Bắt buộc cung cấp lat và lng hợp lệ" });
  }

  const boreholes = generateBoreholes(lat, lng, 50);
  const selected: Borehole | undefined = id
    ? boreholes.find((b) => b.id === id)
    : boreholes[0];

  if (!selected) {
    return res.status(404).json({ error: "Không tìm thấy lỗ khoan" });
  }

  const section = generateSection(selected, { lat, lng });
  res.json(section);
});