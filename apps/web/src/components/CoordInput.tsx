import { useState } from "react";

interface CoordInputProps {
  onSearch: (lat: number, lng: number) => void;
  loading: boolean;
}

export default function CoordInput({ onSearch, loading }: CoordInputProps) {
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const la = Number(lat);
    const ln = Number(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    onSearch(la, ln);
  };

  return (
    <form className="coord-form" onSubmit={handleSubmit}>
      <input
        type="number"
        step="any"
        placeholder="Vĩ độ (lat)"
        value={lat}
        onChange={(e) => setLat(e.target.value)}
      />
      <input
        type="number"
        step="any"
        placeholder="Kinh độ (lng)"
        value={lng}
        onChange={(e) => setLng(e.target.value)}
      />
      <button type="submit" disabled={loading}>
        {loading ? "Đang tìm..." : "Tìm"}
      </button>
    </form>
  );
}