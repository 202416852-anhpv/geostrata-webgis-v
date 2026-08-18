FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Cài dependency trước để Docker cache lại lớp này khi chỉ đổi source.
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/entrypoint.sh ./entrypoint.sh
COPY backend/pyproject.toml ./pyproject.toml
COPY backend/tests ./tests

# data/ và db/ nằm ngoài backend/ nên build context phải là gốc repo (xem docker-compose.yml).
COPY data ./data
COPY db/migrations ./db/migrations

RUN chmod +x ./entrypoint.sh && \
    adduser --disabled-password --gecos "" --uid 10001 appuser && \
    chown -R appuser:appuser /app
USER appuser

EXPOSE 8000
ENTRYPOINT ["./entrypoint.sh"]
