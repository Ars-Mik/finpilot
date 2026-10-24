# FinPilot — этап 14: изолированный гостевой деморежим

База исходников: commit `da7083f` от 20.10.2026. Изменение не является финальным разрешением на публичный релиз.

## Архитектура

- При первом запросе `GET /api/session` сервер создаёт гостевое рабочее пространство и заполняет его демонстрационными счетами, операциями, лимитами и регулярными правилами.
- Случайный 256-битный токен передаётся в HttpOnly cookie (в production — с флагами Secure, SameSite=Lax и префиксом `__Host-`). В БД находится только SHA-256 хеш токена. Срок сессии — 7 дней.
- PostgreSQL Row-Level Security (включая `FORCE ROW LEVEL SECURITY`) ограничивает видимость всех пяти финансовых таблиц рабочим пространством запроса. Workspace задаётся только сервером через `set_config(..., true)` внутри DB-транзакции. Соединения из пула не могут унаследовать чужой workspace.
- Web API работает только с **непривилегированным** PostgreSQL-пользователем `finpilot_app`. Административный `finpilot` нужен лишь для миграций/техобслуживания. Без отдельной роли защита **не работает**: `POSTGRES_USER` в Docker обычно является суперпользователем PostgreSQL и обходит RLS.
- Изменяющие запросы требуют `X-FinPilot-CSRF`, полученный из `GET /api/session`; CORS разрешает строго заданный `CLIENT_ORIGIN`, cookies передаются с `credentials: include`.
- `POST /api/demo/reset` выполняет удаление и повторное заполнение **только своей** гостевой области в одной транзакции. Сервис не удаляет чужие данные.
- Текущие локальные операции, счета, бюджеты, переводы и расписания переносятся в workspace типа `legacy`, остаются в БД, но **не отображаются в гостевом интерфейсе** после миграции.
- Vite проксирует `/api` в `http://127.0.0.1:3001`. Для production нужен **единый HTTPS origin** для frontend и API (reverse proxy).

## Подготовка (Windows PowerShell)

Перед обновлением остановите Node/Vite и сохраните рабочий дамп:

```powershell
cd C:\Users\ars04\Desktop\finpilot
docker compose up -d postgres
New-Item -ItemType Directory -Force .\backups | Out-Null
cmd /c "docker compose exec -T postgres pg_dump -U finpilot -d finpilot -Fc > backups\finpilot_before_guest_14.dump"
cmd /c "docker compose exec -T postgres pg_restore -l < backups\finpilot_before_guest_14.dump > NUL"
$LASTEXITCODE
```

Ненулевой размер файла и код `0` обязательны. Не применяйте миграцию без копии.

Распакуйте обновление в корень проекта. В существующий `server/.env` **добавьте** (не заменяя остальное):

```dotenv
APP_DATABASE_URL=postgresql://finpilot_app:finpilot_app_dev_password@127.0.0.1:5435/finpilot
SESSION_SECRET=finpilot-local-development-only-secret-change
```

Значение `DATABASE_URL` оставьте административным (`finpilot`) — его использует только `npm run db:migrate` и `npm run db:cleanup-guests`. Пользователь `finpilot_app` и его пароль будут созданы миграционной командой. Если локальная PostgreSQL не на порту `5435`, укажите собственный порт в обоих URL.

Порядок команд:

```powershell
cd C:\Users\ars04\Desktop\finpilot\server
npm run db:migrate
npm run build
npm test
npm audit
npm run dev
```

Второй терминал:

```powershell
cd C:\Users\ars04\Desktop\finpilot\client
npm run build
npm run lint
npx playwright test --workers=1
npm run dev
```

При запуске с PostgreSQL для интеграционных тестов:

```powershell
cd C:\Users\ars04\Desktop\finpilot\server
$env:INTEGRATION_DATABASE_URL = (Get-Content .env | Select-String '^APP_DATABASE_URL=').ToString().Split('=', 2)[1]
npm test
Remove-Item Env:INTEGRATION_DATABASE_URL
```

**Важно:** интеграционный тест создаёт и изменяет гостевые workspaces. Используйте отдельную **тестовую** БД для полноценной проверки, а не production. В GitHub Actions настроена изолированная тестовая PostgreSQL с ролью `finpilot_app`.

## Ручная проверка

1. Откройте `http://localhost:5173` и проверьте наличие готовых демоданных.
2. Откройте другое окно инкогнито (отдельный cookie jar) и сравните ID счетов: они должны быть разными.
3. Создайте расход в первом окне. Во втором он не должен появиться ни в транзакциях, ни в аналитике, бюджетах или прогнозе.
4. Сбросьте демоданные в первом окне. Второе окно должно остаться без изменений.
5. Операции из старой базы сохранены. Проверяйте их только через административное подключение или резервный дамп, а не через гостевой интерфейс.
6. Проверьте ответ `401` на `/api/transactions` без cookie и `403` на POST без CSRF.
7. Проверьте в `.github/actions` успешность GitHub Actions с настоящим тестовым PostgreSQL.

## Эксплуатация / ещё не реализовано

- В production установить **уникальные сильные** пароли БД и `SESSION_SECRET`; не публиковать `.env`. Прямой доступ к PostgreSQL извне запрещён.
- Задачу `npm run db:cleanup-guests` запускать отдельно с административной конфигурацией по расписанию (например, ежечасно); она удаляет истёкшие гостевые пространства и их данные.
- Ограничение создания сессий пока реализовано **в памяти процесса** (10 новых сессий с IP в час). Для нескольких API-инстансов и публичного деплоя потребуется распределённый rate limiter, настройка trust proxy и ограничения размера БД.
- Для production ещё нужны полноценная авторизация, аудит безопасности, проверка CSRF/HTTPS, защита от злоупотреблений, мониторинг и восстановительные тесты.
- Текущая конфигурация предназначена для локальной проверки деморежима, не для обработки реальных финансовых данных.
