# FinPilot — счета и переводы (этап 07)

## Что меняется

- Новый модуль `accounts` на Node.js/Express/PostgreSQL.
- `002_accounts_and_transfers.sql`: таблицы счетов и переводов, привязка существующих операций к `Основной счёт`.
- REST API: `GET/POST /api/accounts`, `GET/POST /api/transfers`.
- Страница `/accounts`: счета, остатки, создание счета, перевод и история последних 30 переводов.
- В форме создания и изменения операции можно выбрать счёт.
- Баланс на главной учитывает начальные остатки счетов. Переводы не относятся к доходам или расходам и не изменяют общий баланс.

## Сохранность данных

Миграция `002` назначает всем существующим операциям основной счет с начальным остатком 0. Дата, название, категория, сумма и идентификатор операций не меняются. Текущие суммы доходов и расходов остаются прежними.

**Сначала сделай дамп БД до миграции**:

```powershell
cd C:\Users\ars04\Desktop\finpilot
New-Item -ItemType Directory -Force .\backups | Out-Null
docker compose exec -T postgres pg_dump -U finpilot -d finpilot -Fc > .\backups\finpilot_before_accounts.dump
```

PowerShell 7 корректно перенаправляет бинарный поток. В **Windows PowerShell 5.1** используй команду через `cmd /c`, иначе бинарный дамп может быть повреждён:

```powershell
cmd /c "docker compose exec -T postgres pg_dump -U finpilot -d finpilot -Fc > backups\finpilot_before_accounts.dump"
```

Если используешь резервное копирование по своему скрипту, достаточно имеющегося проверенного бэкапа. **Не добавляй дампы или `.env` в Git.**

## Установка

```powershell
cd C:\Users\ars04\Desktop\finpilot
Expand-Archive -Path "$env:USERPROFILE\Downloads\finpilot_accounts_07.zip" -DestinationPath . -Force

docker compose up -d postgres
cd server
npm run db:migrate
npm run build
npm test
npm audit
npm run dev
```

В другом терминале:

```powershell
cd C:\Users\ars04\Desktop\finpilot\client
npm run build
npm run lint
npm run dev
```

После миграции сервер необходимо **перезапустить**, чтобы он использовал актуальный код. Оставляй только один frontend dev-сервер, иначе Vite переключится на 5174, а настройка CORS API ожидает `http://localhost:5173`.

## Проверка API

```powershell
Invoke-RestMethod http://127.0.0.1:3001/api/accounts | ConvertTo-Json -Depth 5
Invoke-RestMethod http://127.0.0.1:3001/api/transfers | ConvertTo-Json -Depth 5
```

В браузере открой `/accounts`: создай счет «Наличные» с начальным балансом 5000 ₽; переведи 1000 ₽ с него на «Основной счёт»; обнови страницу. Остаток наличных должен уменьшиться на 1000 ₽, основного счета — увеличиться, а суммарный остаток не должен измениться. Затем создай расход на счете «Наличные» и проверь после F5. Также проверь, что существующие операции сохранились.

### Особенности MVP

- Пока поддерживается **только RUB**, нет мультивалютных конвертаций.
- Остатки могут быть отрицательными: приложение фиксирует реальные события, запрет овердрафта пока не реализован.
- Переводы неизменяемы в этой версии (нет удаления и редактирования); каждая запись перевода является единственным атомарным изменением в бухгалтерском представлении.
- Один PostgreSQL instance без пользовательских пространств: **API нельзя публиковать в интернет до реализации аутентификации и изоляции пользователей**.
- Нет idempotency-key для повторных запросов перевода: не отправляй POST повторно, если предыдущий запрос мог завершиться успешно, но сеть оборвалась. Добавим этот механизм до production.
- После архивирования счета и фильтрации по счету доработаем аналитику.

## Коммит после проверок

```powershell
cd C:\Users\ars04\Desktop\finpilot
git status
git add .gitignore client/src server/src server/migrations server/tests README_ACCOUNTS_07.md QA_STAGE07.md
git diff --cached --stat
git commit -m "add accounts and transfers"
git push
```
