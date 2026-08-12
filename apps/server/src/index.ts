import cors from "cors";
import express from "express";
import { boreholesRouter } from "./routes/boreholes.js";
import { sectionRouter } from "./routes/section.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

app.use("/api/boreholes", boreholesRouter);
app.use("/api/section", sectionRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`[server] GeoStrata API listening on http://localhost:${PORT}`);
});