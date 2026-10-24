# QA — этап 14

- [ ] Backup PostgreSQL создаётся и `pg_restore -l` возвращает код 0
- [ ] Миграция `005_guest_workspaces.sql` успешна
- [ ] `finpilot_app` существует и НЕ имеет `SUPERUSER` и `BYPASSRLS`
- [ ] TypeScript сборки обоих модулей успешны
- [ ] Все unit API тесты проходят
- [ ] Реальный PostgreSQL integration test: два гостя, чужие UUID, CSRF, сброс
- [ ] Playwright tests проходят с добавленным кейсом демо-сброса
- [ ] Проверка `npm audit` и Oxlint
- [ ] Ранее записанные операции доступны через административный backup
- [ ] Два разных браузера не видят данные друг друга
- [ ] GitHub Actions зелёный после коммита
