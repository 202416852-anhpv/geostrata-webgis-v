/**
 * Ảnh đại diện, tự lùi về chữ cái đầu khi tài khoản chưa có ảnh.
 *
 * Endpoint ảnh yêu cầu đăng nhập nên không đặt thẳng vào `<img src>` được —
 * thẻ img không gửi header Authorization. Ở đây tải bằng fetch rồi dựng blob URL,
 * có cache theo (id, thời điểm cập nhật) để không tải lại ảnh đã có.
 */

import { useEffect, useState } from "react";
import { getToken } from "../api";
import type { User } from "../types";

type AvatarSize = "sm" | "md" | "lg";

const SIZE_PX: Record<AvatarSize, number> = { sm: 30, md: 40, lg: 96 };

/** Bảng màu cho ảnh chữ cái — đủ tương phản với chữ trắng. */
const FALLBACK_COLORS = [
  "#0056b3",
  "#c0392b",
  "#1e7e34",
  "#b8860b",
  "#7048e8",
  "#0b7285",
  "#d6336c",
  "#5f3dc4",
];

/** Chữ cái đầu của họ và tên, tối đa 2 ký tự. */
export function initialsOf(user: Pick<User, "full_name" | "username">): string {
  const source = user.full_name?.trim() || user.username;
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  // Tên người Việt viết họ trước, chữ cuối mới là tên gọi -> lấy chữ đầu + chữ cuối.
  return (words[0][0] + words.at(-1)![0]).toUpperCase();
}

/** Cùng một tài khoản luôn ra cùng một màu, không cần lưu gì thêm. */
function colorOf(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return FALLBACK_COLORS[hash % FALLBACK_COLORS.length];
}

// Giữ blob URL đã tạo để không tải lại ảnh mỗi lần component mount.
const blobCache = new Map<string, string>();

function cacheKey(user: Pick<User, "id" | "avatar_updated_at">): string {
  return `${user.id}:${user.avatar_updated_at ?? ""}`;
}

function useAvatarUrl(user: Pick<User, "id" | "has_avatar" | "avatar_updated_at">): string | null {
  const [url, setUrl] = useState<string | null>(() =>
    user.has_avatar ? (blobCache.get(cacheKey(user)) ?? null) : null,
  );

  useEffect(() => {
    if (!user.has_avatar) {
      setUrl(null);
      return;
    }
    const key = cacheKey(user);
    const cached = blobCache.get(key);
    if (cached) {
      setUrl(cached);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    (async () => {
      try {
        const token = getToken();
        const response = await fetch(`/api/users/${user.id}/avatar`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          signal: controller.signal,
        });
        if (!response.ok) return;
        const objectUrl = URL.createObjectURL(await response.blob());
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        blobCache.set(key, objectUrl);
        setUrl(objectUrl);
      } catch {
        // Không tải được ảnh thì hiển thị chữ cái đầu, không báo lỗi ồn ào.
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [user.id, user.has_avatar, user.avatar_updated_at]);

  return url;
}

/** Xoá cache khi người dùng vừa đổi ảnh, để lần render sau tải bản mới. */
export function invalidateAvatarCache(userId: number): void {
  for (const [key, url] of blobCache) {
    if (key.startsWith(`${userId}:`)) {
      URL.revokeObjectURL(url);
      blobCache.delete(key);
    }
  }
}

interface AvatarProps {
  user: Pick<User, "id" | "username" | "full_name" | "has_avatar" | "avatar_updated_at">;
  size?: AvatarSize;
}

export default function Avatar({ user, size = "md" }: AvatarProps) {
  const url = useAvatarUrl(user);
  const px = SIZE_PX[size];
  const style = { width: px, height: px, fontSize: Math.round(px * 0.4) };

  if (url) {
    return (
      <img
        className="avatar"
        style={style}
        src={url}
        alt={`Ảnh đại diện của ${user.full_name}`}
        loading="lazy"
      />
    );
  }

  return (
    <span
      className="avatar avatar-initials"
      style={{ ...style, background: colorOf(user.username) }}
      aria-hidden="true"
      title={user.full_name}
    >
      {initialsOf(user)}
    </span>
  );
}
