# FinPilot

Веб-приложение для учёта личных финансов и анализа денежных потоков.

## Состояние проекта

**Frontend (React + TypeScript + Vite):** обзор финансов, список операций, добавление и удаление, поиск, фильтры и пагинация. Текущая версия frontend использует `localStorage` и демонстрационные данные.

**Backend (Node.js + Express + TypeScript + PostgreSQL):** отдельное REST API для операций, валидация входных данных, миграции БД и автоматические тесты маршрутов. Подключение frontend к серверу — следующий этап.

## Требования

- Node.js 22.12+ и npm
- Docker Desktop с работающим Docker Engine (для локального PostgreSQL)

## Frontend

```bash
cd client
npm install
npm run dev
```

Проверки: `npm run build`, `npm run lint`.

## Backend

Из корня репозитория:

```powershell
docker compose up -d postgres
cd server
Copy-Item .env.example .env
npm install
npm run db:migrate
npm run build
npm test
npm run dev
```

API: `http://127.0.0.1:3001/api/health`

Документация API: [README_BACKEND.md](README_BACKEND.md).

## Структура

```text
client/                  React, TypeScript, Vite
server/src/              Express API и PostgreSQL-репозиторий
server/migrations/       Версионируемые SQL-миграции
server/tests/            Тесты HTTP-маршрутов
docker-compose.yml        Локальная PostgreSQL
```

## Безопасность

API пока не имеет авторизации и разделения данных пользователей. Он предназначен **только для локальной разработки**. Не публикуйте сервер в интернете и не используйте настоящие финансовые данные. `.env` исключён из Git, в репозитории находится только пример `.env.example` с учебными настройками.

## Далее

Подключение frontend к API, тесты PostgreSQL-интеграции, бюджеты, регулярные платежи, финансовые сценарии и автоматизация публикации.
