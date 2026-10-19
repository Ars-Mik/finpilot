# FinPilot API — этап 02

Серверный модуль Node.js / Express / TypeScript + PostgreSQL. На этом этапе API работает независимо от React: старые операции пока остаются в `localStorage`.

## Запуск

Из корня `finpilot`:

```powershell
docker compose up -d postgres
cd server
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run dev
```

`http://127.0.0.1:3001/api/health` должен вернуть `{ "status": "ok" }`.

## Проверки

```powershell
npm run build
npm test
```

## API

| Метод | Путь | Назначение |
| --- | --- | --- |
| GET | /api/health | Liveness |
| GET | /api/transactions?page=1&limit=50&type=expense&month=2026-10&search=продукты | Список с фильтрами и пагинацией |
| GET | /api/transactions/:id | Получение операции |
| POST | /api/transactions | Создание |
| PATCH | /api/transactions/:id | Изменение |
| DELETE | /api/transactions/:id | Удаление |

Тело создания операции:

```json
{
  "title": "Продукты",
  "amountCents": 24550,
  "type": "expense",
  "category": "Продукты",
  "date": "2026-10-18"
}
```

Финансовые суммы передаются в целых копейках. Сервер отклоняет неизвестные поля, некорректные категории и несуществующие даты.

## Ограничения текущего этапа

- API рассчитан на локальную разработку; в нём **пока нет авторизации и изоляции пользователей**. Нельзя открывать доступ из интернета или использовать реальные финансовые данные.
- Миграции применяются по порядку, с блокировкой и проверкой SHA-256: уже применённые файлы менять нельзя; изменения схемы вносятся новыми файлами.
- Тесты маршрутов используют репозиторий в памяти. Реальную PostgreSQL-интеграцию проверяем вручную после миграции, затем добавим интеграционные тесты к БД.
- Следующим этапом подключим React к API, заменим `localStorage` и добавим состояния загрузки/ошибок.


## Git

После успешных проверок из корня проекта:

```powershell
git status
git add .gitignore docker-compose.yml README_BACKEND.md server
git commit -m "add backend api"
git push
```

До коммита убедитесь, что `server/.env` и `node_modules` не находятся в `git status --short`.
