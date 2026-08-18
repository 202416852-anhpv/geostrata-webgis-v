COMPOSE     := docker compose
COMPOSE_DEV := docker compose -f docker-compose.yml -f docker-compose.dev.yml

.DEFAULT_GOAL := help
.PHONY: help up down build logs ps restart dev seed reseed psql shell-backend test lint clean nuke

help: ## Liệt kê các lệnh
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'

up: ## Khởi động toàn bộ hệ thống (build nếu cần)
	$(COMPOSE) up -d --build
	@echo ""
	@echo "  Giao dien : http://localhost:8080"
	@echo "  API docs  : http://localhost:8000/api/docs"
	@echo "  CSDL      : localhost:5433"

down: ## Dừng và xoá container (giữ nguyên dữ liệu)
	$(COMPOSE) down

build: ## Build lại image
	$(COMPOSE) build

logs: ## Xem log realtime
	$(COMPOSE) logs -f --tail=100

ps: ## Trạng thái các service
	$(COMPOSE) ps

restart: ## Khởi động lại backend
	$(COMPOSE) restart backend

dev: ## Chạy chế độ phát triển (hot reload, giao diện ở cổng 5173)
	$(COMPOSE_DEV) up --build

tools: ## Bật thêm Adminer để xem CSDL qua trình duyệt (cổng 8081)
	$(COMPOSE) --profile tools up -d adminer

seed: ## Nạp dữ liệu mẫu nếu CSDL còn rỗng
	$(COMPOSE) exec backend python -m app.seed

reseed: ## Xoá dữ liệu cũ và nạp lại từ data/*.json
	$(COMPOSE) exec backend python -m app.seed --force

psql: ## Mở psql trong container CSDL
	$(COMPOSE) exec db psql -U geostrata -d geostrata

shell-backend: ## Mở shell trong container backend
	$(COMPOSE) exec backend sh

test: ## Chạy test của backend
	cd backend && python -m pytest -q

lint: ## Kiểm tra code backend bằng ruff
	cd backend && python -m ruff check app tests

clean: ## Dừng và xoá container + image đã build
	$(COMPOSE) down --rmi local

nuke: ## Xoá sạch kể cả dữ liệu CSDL (schema sẽ chạy lại từ đầu)
	$(COMPOSE) down -v --rmi local
