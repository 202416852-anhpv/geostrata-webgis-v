import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Font tải từ node_modules chứ không qua CDN Google Fonts: app phải chạy được
// khi không có mạng, giống lý do CSS Leaflet cũng lấy từ node_modules.
import "@fontsource/fira-sans/300.css";
import "@fontsource/fira-sans/400.css";
import "@fontsource/fira-sans/500.css";
import "@fontsource/fira-sans/600.css";
import "@fontsource/fira-sans/700.css";
import "@fontsource/fira-code/400.css";
import "@fontsource/fira-code/500.css";

import "leaflet/dist/leaflet.css";
import "./index.css";

const container = document.getElementById("root");
if (!container) throw new Error("Không tìm thấy phần tử #root");

ReactDOM.createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
