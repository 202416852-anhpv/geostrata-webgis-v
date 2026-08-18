#!/bin/sh
# Khởi động backend: chờ CSDL -> chạy migration -> nạp dữ liệu nếu rỗng -> chạy API.
set -e

echo "[entrypoint] Chờ CSDL..."
python -m app.wait_for_db

echo "[entrypoint] Áp migration..."
python -m app.migrate

if [ "${SEED_ON_STARTUP:-true}" = "true" ]; then
    echo "[entrypoint] Kiểm tra và nạp dữ liệu mẫu..."
    python -m app.seed
fi

echo "[entrypoint] Khởi động API trên cổng ${PORT:-8000}"
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" "$@"
