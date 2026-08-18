# GeoStrata WebGIS

Ứng dụng tra cứu lỗ khoan khảo sát địa chất trên nền bản đồ và vẽ mặt cắt địa tầng
theo mẫu hồ sơ khảo sát.

Kiến trúc ba tầng tách rời, chạy toàn bộ ở máy local bằng Docker:

```
┌─────────────┐      ┌──────────────┐      ┌──────────────────┐
│  frontend/  │─────▶│  backend/    │─────▶│  db (PostGIS)    │
│  React +    │ HTTP │  Python      │ SQL  │  PostgreSQL 16   │
│  Leaflet    │      │  FastAPI     │      │  + PostGIS 3.4   │
│  nginx :80  │      │  uvicorn     │      │  :5432           │
└─────────────┘      └──────────────┘      └──────────────────┘
                            │
                            ▼ nạp lúc khởi động
                     ┌──────────────┐
                     │  data/*.json │  dữ liệu nguồn, tách khỏi code
                     └──────────────┘
```

---

## Chạy nhanh

Yêu cầu: **Docker Desktop** đang chạy.

```bash
cp .env.example .env        # tuỳ chọn, có thể bỏ qua để dùng giá trị mặc định
docker compose up -d --build
```

Lần đầu mất khoảng 2-3 phút để tải image và build. Sau đó:

| Dịch vụ           | Địa chỉ                              |
| ----------------- | ------------------------------------ |
| Giao diện web     | http://localhost:8080                |
| API + Swagger UI  | http://localhost:8000/api/docs       |
| PostgreSQL        | `localhost:5433` (user/pass: `geostrata`) |
| Adminer (tuỳ chọn)| http://localhost:8081                |

### Tài khoản mặc định

| Tài khoản    | Mật khẩu       | Vai trò    | Làm được gì                              |
| ------------ | -------------- | ---------- | ---------------------------------------- |
| `admin`      | `admin123`     | Quản trị   | Toàn quyền + quản lý tài khoản + xoá dữ liệu |
| `quanly`     | `quanly123`    | Quản lý    | Tra cứu + thêm / sửa lỗ khoan            |
| `nguoidung`  | `nguoidung123` | Người dùng | Chỉ tra cứu và xem mặt cắt               |

Sửa danh sách này trong [`data/users.json`](data/users.json) **trước khi khởi động lần
đầu**, hoặc đổi mật khẩu ngay sau khi đăng nhập. Tài khoản chỉ được tạo khi bảng
`users` còn rỗng, nên seed lại dữ liệu khảo sát không ghi đè mật khẩu đã đổi.

Cổng CSDL đặt **5433** để không đụng PostgreSQL có sẵn trên máy.
Bật Adminer khi cần xem CSDL bằng trình duyệt:

```bash
docker compose --profile tools up -d adminer
```

Dừng lại:

```bash
docker compose down       # giữ dữ liệu
docker compose down -v    # xoá luôn dữ liệu, lần sau tạo lại từ đầu
```

Nếu có `make`, mọi lệnh đều có sẵn shortcut — chạy `make help` để xem danh sách.

---

## Cấu trúc thư mục

```
.
├── data/                      # DỮ LIỆU NGUỒN — sửa ở đây, không sửa code
│   ├── soil_types.json        #   danh mục loại đất: tên, mô tả, màu, ký hiệu
│   ├── projects.json          #   công trình + tham số lưới khoan, độ sâu, địa tầng
│   └── users.json             #   tài khoản khởi tạo lần đầu
│
├── db/
│   ├── init/                  # PostgreSQL tự chạy khi volume còn rỗng
│   │   ├── 01_extensions.sql  #   CREATE EXTENSION postgis
│   │   └── 02_schema.sql      #   bảng, ràng buộc, trigger, chỉ mục, view
│   └── migrations/            # backend áp lúc khởi động, idempotent
│       ├── 001_auth.sql       #   users, sessions, cột audit trên boreholes
│       ├── 002_projects_...   #   hồ sơ công trình, ranh giới, hố khoan đơn lẻ
│       └── 003_user_profiles  #   liên hệ, chức danh, đơn vị, ảnh đại diện
│
├── backend/                   # API Python
│   ├── app/
│   │   ├── main.py            #   khởi tạo FastAPI, CORS, xử lý lỗi
│   │   ├── config.py          #   cấu hình từ biến môi trường
│   │   ├── database.py        #   engine + session
│   │   ├── models.py          #   ORM SQLAlchemy + cấp bậc vai trò
│   │   ├── schemas.py         #   Pydantic — hợp đồng dữ liệu với frontend
│   │   ├── repository.py      #   TẦNG TRUY CẬP DỮ LIỆU (chỗ duy nhất có SQL)
│   │   ├── security.py        #   băm mật khẩu bcrypt, sinh token phiên
│   │   ├── images.py          #   nhận diện ảnh theo chữ ký byte, giới hạn cỡ
│   │   ├── auth.py            #   dependency xác thực và phân quyền
│   │   ├── migrate.py         #   chạy db/migrations
│   │   ├── routers/           #   endpoint HTTP
│   │   └── seed/generator.py  #   sinh dữ liệu tất định
│   └── tests/                 #   pytest: sinh dữ liệu, bảo mật, phân quyền
│
└── frontend/                  # Giao diện React
    └── src/
        ├── api.ts             #   lớp gọi API duy nhất, tự đính token
        ├── types.ts           #   kiểu phản chiếu schema backend
        ├── auth/              #   AuthContext: trạng thái đăng nhập
        └── components/        #   MapView, CrossSection, Avatar, PasswordInput,
                               #   LoginPage, ProfilePanel, UserManagement,
                               #   BoreholeEditor, ProjectManagement
```

---

## Dữ liệu

Toàn bộ dữ liệu nằm trong `data/`, tách hẳn khỏi code. Muốn đổi vùng khảo sát,
số lỗ khoan, độ sâu hay danh mục đất thì sửa JSON rồi nạp lại:

```bash
docker compose exec backend python -m app.seed --force
```

Xem trước kết quả mà không ghi CSDL:

```bash
docker compose exec backend python -m app.seed --dry-run
```

Dữ liệu **tất định**: mỗi công trình có trường `seed`, cùng file đầu vào luôn cho
ra đúng cùng bộ lỗ khoan. Bộ mặc định gồm 3 công trình ở TP.HCM, tổng **161 lỗ
khoan** và **1045 lớp địa tầng**.

Lược đồ CSDL:

| Bảng               | Nội dung                                                     |
| ------------------ | ------------------------------------------------------------ |
| `projects`         | công trình: tên, năm xây dựng, quy mô, địa điểm, `boundary geography(Polygon,4326)` |
| `project_vertices` | các đỉnh ranh giới theo thứ tự điểm 1 → điểm n                |
| `soil_types`       | danh mục loại đất (màu, ký hiệu vẽ, thứ tự trầm tích)         |
| `boreholes`        | hố khoan; `geom geography(Point,4326)` + chỉ mục GiST, công ty khoan, `created_by` / `updated_by` |
| `borehole_layers`  | các lớp địa tầng theo chiều sâu                               |
| `users`            | tài khoản: mật khẩu băm bcrypt, liên hệ, chức danh, đơn vị, ảnh đại diện (bytea) |
| `sessions`         | phiên đăng nhập đang hoạt động (chỉ lưu SHA-256 của token)    |
| `schema_migrations`| các migration đã áp                                          |

### Ranh giới công trình

Nhập toạ độ các điểm theo thứ tự, hệ thống nối điểm 1 → điểm n rồi tự khép về
điểm 1 để dựng đa giác. Một **trigger** trong CSDL lo việc này, nên ranh giới luôn
khớp với danh sách đỉnh dù ghi dữ liệu bằng đường nào. Diện tích và chu vi lấy
trực tiếp từ PostGIS, không lưu trùng lặp.

Hai trường hợp ranh giới để trống (`boundary = NULL`), các điểm vẫn được lưu:

- Dưới 3 điểm — chưa đủ để thành đa giác.
- Đường bao **tự cắt nhau** — đa giác không hợp lệ. Giao diện báo lại để người
  nhập sắp xếp lại thứ tự điểm.

### Ba cách thêm hố khoan

| Kịch bản | Cách nhập | Trong CSDL |
| -------- | --------- | ---------- |
| **Hố khoan đơn lẻ** — chưa gắn công trình nào | Bỏ trống ô "Công trình" | `project_id = NULL`, `location_kind = 'point'` |
| **Công trình + danh sách hố khoan** | `POST /api/boreholes/bulk`, tạo công trình và hố khoan trong **một giao dịch** | `project_id` trỏ tới công trình vừa tạo |
| **Địa tầng cho cả công trình** — không rõ vị trí hố khoan | Chọn vị trí "Chưa rõ vị trí" | `location_kind = 'project_area'`, `lat`/`lng` NULL, bắt buộc có `project_id` |

Ràng buộc `boreholes_location_consistent` trong CSDL bảo đảm: khai có toạ độ thì
phải đủ cả `lat` lẫn `lng`; khai chưa rõ vị trí thì bắt buộc thuộc một công trình.
Hố khoan chưa rõ vị trí không hiện trên bản đồ (không có `geom`) nhưng vẫn tra
được trong danh sách hố khoan của công trình và vẫn dựng được bản vẽ mặt cắt.

Mã hố khoan duy nhất **trong phạm vi công trình**. Nhóm hố khoan đơn lẻ có chỉ mục
riêng (`boreholes_standalone_code_key`) vì trong SQL hai giá trị NULL không bằng
nhau, nên ràng buộc `UNIQUE (project_id, code)` không phủ được nhóm này.

Lược đồ được tạo theo hai đường:

- [`db/init/`](db/init/) — PostgreSQL tự chạy, **chỉ một lần khi volume còn rỗng**.
- [`db/migrations/`](db/migrations/) — backend áp lúc khởi động, idempotent và có
  ghi nhận trong `schema_migrations`. Nhờ đó nâng cấp CSDL đang có dữ liệu không
  cần xoá volume. Chạy tay: `docker compose exec backend python -m app.migrate --status`.

`geom` được **trigger** tự đồng bộ từ `lat`/`lng`, nên không thể lệch dù ghi dữ
liệu bằng đường nào. Tìm kiếm theo bán kính dùng `ST_DWithin` trên chỉ mục GiST,
khoảng cách lấy trực tiếp từ `ST_Distance` (đơn vị mét).

---

## Phân quyền

Ba vai trò xếp theo cấp bậc — admin làm được mọi việc của manager, manager làm
được mọi việc của user.

| Chức năng                          | user | manager | admin |
| ---------------------------------- | :--: | :-----: | :---: |
| Tra cứu lỗ khoan, xem mặt cắt      |  ✓   |    ✓    |   ✓   |
| Đổi mật khẩu của chính mình        |  ✓   |    ✓    |   ✓   |
| Thêm / sửa lỗ khoan và địa tầng    |      |    ✓    |   ✓   |
| Xoá lỗ khoan                       |      |         |   ✓   |
| Tạo tài khoản, đổi vai trò, khoá   |      |         |   ✓   |

Cách xác thực: đăng nhập trả về một **token ngẫu nhiên lưu phía server**, không
phải JWT. Chọn như vậy vì đăng xuất, khoá tài khoản hay hạ quyền phải có hiệu lực
**ngay ở request kế tiếp** — với JWT thì token cũ vẫn dùng được tới khi hết hạn.
CSDL chỉ lưu SHA-256 của token, nên rò rỉ CSDL cũng không mạo danh được phiên.

Các chốt an toàn để hệ thống không tự khoá chính nó:

1. Admin không thể tự đổi vai trò, tự khoá hay tự xoá tài khoản mình. Đây là chốt
   thực sự chặn được việc mất admin cuối cùng.
2. Đổi vai trò, khoá tài khoản hoặc đặt lại mật khẩu sẽ **huỷ toàn bộ phiên** của
   người đó ngay lập tức.
3. Thêm một lớp kiểm tra "admin hoạt động cuối cùng" trong
   [`routers/users.py`](backend/app/routers/users.py). Lớp này chỉ là phòng vệ dự
   phòng: vì người gọi luôn là một admin đang hoạt động và khác đối tượng bị tác
   động, số admin còn lại luôn ≥ 1 nên nó không bao giờ kích hoạt chừng nào chốt 1
   còn nguyên.

Token được lưu ở `localStorage` của trình duyệt và gửi kèm qua header
`Authorization: Bearer`. Cách này đơn giản nhưng token đọc được bằng JavaScript;
nếu triển khai ra Internet nên chuyển sang cookie `httpOnly` kèm chống CSRF.

### Tự đăng ký

Bật sẵn, tắt bằng `ALLOW_SELF_REGISTRATION=false` trong `.env`. Tài khoản tự đăng
ký **luôn** nhận vai trò `user` (chỉ tra cứu) — backend gán cứng, client gửi kèm
`role` cũng bị bỏ qua. Admin nâng quyền sau khi xác minh.

Đăng nhập chấp nhận cả tên đăng nhập lẫn email. Email lưu chữ thường và có chỉ mục
duy nhất theo `lower(email)`, nên `A@x.com` và `a@x.com` không cùng tồn tại được.

### Ảnh đại diện

Lưu thẳng trong CSDL (`users.avatar` kiểu bytea) thay vì ghi ra đĩa: sao lưu chỉ
cần một `pg_dump`, không phải quản lý thêm volume. Giới hạn mặc định 500 KB
(`MAX_AVATAR_BYTES`), nhận PNG / JPEG / WebP / GIF.

Định dạng nhận diện bằng **chữ ký byte đầu tệp**, không tin `Content-Type` client
khai — đổi đuôi tệp PHP thành `.png` vẫn bị từ chối.

Cột `avatar` khai báo `deferred=True` trong ORM nên truy vấn danh sách tài khoản
không kéo ảnh của mọi người vào bộ nhớ. Endpoint ảnh yêu cầu đăng nhập, vì vậy
frontend tải qua `fetch` rồi dựng blob URL thay vì đặt thẳng vào `<img src>`
(thẻ `img` không gửi được header `Authorization`). Tài khoản chưa có ảnh hiển thị
chữ cái đầu trên nền màu sinh từ tên đăng nhập.

## API

Tài liệu tương tác đầy đủ tại http://localhost:8000/api/docs

| Method | Đường dẫn                            | Quyền tối thiểu | Mô tả                          |
| ------ | ------------------------------------ | --------------- | ------------------------------ |
| GET    | `/api/health`                        | công khai       | trạng thái dịch vụ             |
| GET    | `/api/config`                        | công khai       | tham số nghiệp vụ cho frontend |
| GET    | `/api/auth/registration`             | công khai       | có cho tự đăng ký hay không    |
| POST   | `/api/auth/register`                 | công khai       | tự đăng ký, trả token luôn     |
| POST   | `/api/auth/login`                    | công khai       | đăng nhập bằng tên hoặc email  |
| POST   | `/api/auth/logout`                   | đã đăng nhập    | huỷ phiên hiện tại             |
| GET    | `/api/auth/me`                       | đã đăng nhập    | thông tin tài khoản            |
| PUT    | `/api/auth/me`                       | đã đăng nhập    | tự sửa hồ sơ cá nhân           |
| POST   | `/api/auth/change-password`          | đã đăng nhập    | tự đổi mật khẩu                |
| POST   | `/api/auth/me/avatar`                | đã đăng nhập    | tải lên ảnh đại diện           |
| DELETE | `/api/auth/me/avatar`                | đã đăng nhập    | xoá ảnh đại diện               |
| GET    | `/api/users/{id}/avatar`             | user            | ảnh đại diện (nhị phân)        |
| GET    | `/api/soil-types`                    | user            | danh mục loại đất              |
| GET    | `/api/projects`                      | user            | danh sách công trình           |
| GET    | `/api/projects/{id}`                 | user            | chi tiết + ranh giới + diện tích |
| GET    | `/api/projects/{id}/boreholes`       | user            | hố khoan của công trình        |
| POST   | `/api/projects`                      | manager         | thêm công trình                |
| PUT    | `/api/projects/{id}`                 | manager         | sửa hồ sơ và ranh giới         |
| DELETE | `/api/projects/{id}`                 | admin           | xoá công trình + hố khoan bên trong |
| GET    | `/api/boreholes?lat=&lng=&radius_m=` | user            | tìm hố khoan quanh một toạ độ  |
| GET    | `/api/boreholes/{id}`                | user            | chi tiết một hố khoan          |
| GET    | `/api/boreholes/{id}/section`        | user            | mặt cắt địa chất               |
| POST   | `/api/boreholes`                     | manager         | thêm một hố khoan              |
| POST   | `/api/boreholes/bulk`                | manager         | thêm nhiều hố khoan, kèm tạo công trình |
| PUT    | `/api/boreholes/{id}`                | manager         | sửa hố khoan và địa tầng       |
| DELETE | `/api/boreholes/{id}`                | admin           | xoá hố khoan                   |
| GET    | `/api/users`                         | admin           | danh sách tài khoản            |
| POST   | `/api/users`                         | admin           | tạo tài khoản                  |
| PATCH  | `/api/users/{id}`                    | admin           | đổi vai trò, khoá, đặt mật khẩu|
| DELETE | `/api/users/{id}`                    | admin           | xoá tài khoản                  |

```bash
# Đăng nhập và lấy token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"quanly","password":"quanly123"}' | jq -r .access_token)

# Tra cứu
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8000/api/boreholes?lat=10.7769&lng=106.6953&radius_m=150"

# Thêm lỗ khoan (địa tầng phải liền mạch từ 0 m tới đáy)
curl -X POST http://localhost:8000/api/boreholes \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "project_code": "TTDH-CN", "code": "HK-99",
    "lat": 10.7769, "lng": 106.6953, "depth_m": 30,
    "layers": [
      {"soil_code": "fill",       "top_depth_m": 0,   "bottom_depth_m": 4.5},
      {"soil_code": "clay_stiff", "top_depth_m": 4.5, "bottom_depth_m": 18},
      {"soil_code": "sand_fine",  "top_depth_m": 18,  "bottom_depth_m": 30}
    ]
  }'
```

---

## Chế độ phát triển

Hot reload cho cả hai phía:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Giao diện dev chạy ở http://localhost:5173 (Vite), backend tự nạp lại khi sửa file
trong `backend/app/`.

Chạy tách rời không qua Docker (cần một PostgreSQL+PostGIS sẵn có):

```bash
# Backend
cd backend
python -m venv .venv && .venv/Scripts/activate     # Linux/macOS: source .venv/bin/activate
pip install -r requirements-dev.txt
export DATABASE_URL="postgresql+psycopg2://geostrata:geostrata@localhost:5433/geostrata"
python -m app.seed
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

Kiểm thử và lint:

```bash
cd backend && python -m pytest      # 71 test: sinh dữ liệu, bảo mật, phân quyền
cd backend && python -m ruff check app tests
cd frontend && npm run build        # gồm cả typecheck
```

---

## Những lỗi đã sửa so với bản Node cũ

| # | Lỗi cũ | Cách sửa |
| - | ------ | -------- |
| 1 | `fetchSection` gửi toạ độ **của lỗ khoan** thay vì tâm tìm kiếm, server sinh lại một bộ dữ liệu khác rồi tìm theo id → mặt cắt thuộc về một lỗ khoan khác, độ sâu hiển thị lệch với danh sách | Dữ liệu lưu trong CSDL. `GET /api/boreholes/{id}/section` đọc đúng bản ghi đó, không sinh lại gì cả |
| 2 | Sinh 240 điểm trong bán kính 2.5R rồi lọc còn R → chỉ giữ ~16%, luôn ít hơn `count = 60` | Lỗ khoan nằm trên lưới khảo sát, số lượng đúng bằng `rows × cols`. Có test khẳng định |
| 3 | Bán kính hard-code ở hai nơi (`App.tsx` và `section.ts`), lệch nhau là hỏng | Khai báo một chỗ trong `.env`, frontend đọc qua `GET /api/config`. Bán kính cũng thành ô nhập trên giao diện |
| 4 | Chống trùng lớp chỉ bốc lại **một lần**, vẫn lọt lớp trùng loại đất | Chọn loại đất theo thứ tự trầm tích tăng dần → không thể trùng, lại đúng quy luật địa chất |
| 5 | Địa tầng có thể dừng trước đáy, chừa khoảng trắng trên bản vẽ | Bề dày được chuẩn hoá để tổng đúng bằng chiều sâu; lớp cuối luôn chạm đáy. Có test |
| 6 | Thuộc tính SVG viết kiểu HTML (`stroke-width`, `font-size`) → React cảnh báo; ký hiệu địa chất nhồi qua `dangerouslySetInnerHTML` | Toàn bộ ký hiệu viết bằng JSX trong `components/patterns.tsx`, dùng camelCase, không còn chèn HTML thô |
| 7 | CSS Leaflet tải từ CDN unpkg → mất mạng là vỡ layout | `import "leaflet/dist/leaflet.css"` từ node_modules |
| 8 | Màu lớp lấy theo **chỉ số vòng lặp**, không khớp loại đất | Màu là thuộc tính của loại đất trong bảng `soil_types` |
| 9 | `RecenterView` ép zoom về 17 sau mỗi lần đổi tâm, phá thao tác phóng to | Giữ nguyên mức zoom người dùng đang xem |

Ngoài ra: huỷ request cũ bằng `AbortController` khi bấm liên tiếp, đóng bản vẽ
bằng phím Esc, hiển thị mực nước ngầm trên mặt cắt, và mã lớp theo đúng quy ước
hồ sơ địa chất (lớp đất đắp mang mã `k`, các lớp còn lại đánh số từ 1).

---

## Xử lý sự cố

**`docker compose up` báo cổng đã bị chiếm** — sửa `DB_PORT`, `BACKEND_PORT` hoặc
`FRONTEND_PORT` trong `.env`.

**Backend khởi động lại liên tục** — xem log bằng `docker compose logs backend`.
Thường do CSDL chưa sẵn sàng; entrypoint đã chờ tối đa 60 giây trước khi bỏ cuộc.

**Sửa `db/init/*.sql` mà không thấy tác dụng** — các script này chỉ chạy khi volume
còn rỗng. Chạy `docker compose down -v` rồi `docker compose up -d` để tạo lại.

**Bản đồ trắng** — trình duyệt cần truy cập được `tile.openstreetmap.org`. Không có
mạng thì bản đồ nền trống nhưng lỗ khoan và mặt cắt vẫn hoạt động bình thường.
