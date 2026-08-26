/**
 * Phiên "chọn trên bản đồ".
 *
 * Biểu mẫu nằm trong hộp thoại phủ kín bản đồ, nên muốn chỉ trỏ trên bản đồ thì
 * phải tạm ẩn hộp thoại đi. Ở đây chỉ ẩn bằng CSS chứ KHÔNG tháo component, để
 * mọi thứ người dùng đã gõ dở vẫn còn nguyên khi quay lại.
 *
 * Kết quả trả về luôn là danh sách đỉnh, bất kể vẽ bằng chế độ nào — hình chữ
 * nhật và hình tròn đều được quy về đa giác trước khi gửi cho biểu mẫu.
 */

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Vertex } from "../types";
import { circleVertices, distanceM, rectangleVertices } from "./geo";

export type PickMode = "point" | "polygon" | "rectangle" | "circle";

export const MODE_LABEL: Record<PickMode, string> = {
  point: "Một điểm",
  polygon: "Từng điểm",
  rectangle: "Hình chữ nhật",
  circle: "Hình tròn",
};

export const MODE_HINT: Record<PickMode, string> = {
  point: "Nhấp lên bản đồ để đặt vị trí. Nhấp lại để dời.",
  polygon: "Nhấp lần lượt từng đỉnh của ranh giới. Cần ít nhất 3 điểm.",
  rectangle: "Nhấp một góc, rồi nhấp góc đối diện.",
  circle: "Nhấp tâm, rồi nhấp ra mép để chọn bán kính.",
};

interface Session {
  label: string;
  modes: PickMode[];
  mode: PickMode;
  /** Điểm người dùng đã nhấp; ý nghĩa tuỳ theo chế độ. */
  points: Vertex[];
  /** Vị trí con trỏ, dùng để xem trước hình khi mới nhấp một điểm. */
  hover: Vertex | null;
}

interface MapPickApi {
  session: Session | null;
  isPicking: boolean;
  start: (options: { label: string; modes: PickMode[]; initial?: Vertex[] }) => Promise<Vertex[] | null>;
  setMode: (mode: PickMode) => void;
  addPoint: (point: Vertex) => void;
  setHover: (point: Vertex | null) => void;
  undo: () => void;
  clear: () => void;
  finish: () => void;
  cancel: () => void;
}

const MapPickContext = createContext<MapPickApi | null>(null);

/** Quy mọi chế độ vẽ về một danh sách đỉnh. */
export function sessionVertices(session: Session | null): Vertex[] {
  if (!session) return [];
  const { mode, points, hover } = session;

  if (mode === "point") return points.slice(-1);
  if (mode === "polygon") return points;

  // Chữ nhật và tròn cần đúng hai điểm; khi mới có một thì lấy vị trí con trỏ
  // làm điểm thứ hai để xem trước hình đang vẽ.
  const second = points[1] ?? hover;
  if (points.length === 0 || !second) return [];
  if (mode === "rectangle") return rectangleVertices(points[0], second);
  return circleVertices(points[0], distanceM(points[0], second));
}

/** Đã đủ dữ liệu để bấm Xong chưa. */
export function sessionComplete(session: Session | null): boolean {
  if (!session) return false;
  if (session.mode === "point") return session.points.length >= 1;
  if (session.mode === "polygon") return session.points.length >= 3;
  return session.points.length >= 2;
}

export function MapPickProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const resolver = useRef<((value: Vertex[] | null) => void) | null>(null);

  const start = useCallback(
    (options: { label: string; modes: PickMode[]; initial?: Vertex[] }) => {
      const initial = options.initial ?? [];
      const mode = options.modes[0];
      setSession({
        label: options.label,
        modes: options.modes,
        mode,
        // Chỉ giữ lại đỉnh cũ ở chế độ vẽ từng điểm; chữ nhật và tròn dựng lại từ đầu.
        points: mode === "polygon" || mode === "point" ? initial : [],
        hover: null,
      });
      return new Promise<Vertex[] | null>((resolve) => {
        resolver.current = resolve;
      });
    },
    [],
  );

  const settle = useCallback((value: Vertex[] | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setSession(null);
  }, []);

  const api = useMemo<MapPickApi>(
    () => ({
      session,
      isPicking: session !== null,
      start,
      setMode: (mode) =>
        setSession((current) =>
          current ? { ...current, mode, points: [], hover: null } : current,
        ),
      addPoint: (point) =>
        setSession((current) => {
          if (!current) return current;
          if (current.mode === "point") return { ...current, points: [point] };
          // Chữ nhật và tròn chỉ nhận hai điểm; nhấp tiếp là vẽ lại từ đầu.
          if (current.mode !== "polygon" && current.points.length >= 2) {
            return { ...current, points: [point] };
          }
          return { ...current, points: [...current.points, point] };
        }),
      setHover: (point) => setSession((current) => (current ? { ...current, hover: point } : current)),
      undo: () =>
        setSession((current) =>
          current ? { ...current, points: current.points.slice(0, -1) } : current,
        ),
      clear: () => setSession((current) => (current ? { ...current, points: [], hover: null } : current)),
      finish: () => settle(sessionVertices(session)),
      cancel: () => settle(null),
    }),
    [session, start, settle],
  );

  return <MapPickContext.Provider value={api}>{children}</MapPickContext.Provider>;
}

export function useMapPick(): MapPickApi {
  const context = useContext(MapPickContext);
  if (context === null) throw new Error("useMapPick phải nằm trong <MapPickProvider>");
  return context;
}
