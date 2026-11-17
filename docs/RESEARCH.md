# Проверка HTTP-ссылок: решения для MVP

Исследовано 7 ноября 2026. Ниже — первичные источники и принятые решения, а не обещание, что любой сайт разрешит проверку.

1. [Chrome: Cross-origin network requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests). Запросы из content script ограничены origin страницы; расширение с host permissions может обращаться к другим origin из background. Поэтому DOM собирается инъекцией, а сетевой код находится в background. Внешние страницы не могут передавать произвольные URL обработчику сообщений: он принимает команды только от страниц расширения, собирая адреса самостоятельно.
2. [MDN: HEAD](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Methods/HEAD). HEAD проверяет HTTP-ответ без загрузки тела. Не все серверы реализуют его корректно; в MVP GET fallback для 400, 403, 404, 405, 410, 501 — практическая эвристика, а не требование HTTP. После получения GET-заголовков поток тела отменяется.
3. [MDN: 405](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/405). Метод может быть запрещён при существующем ресурсе: HEAD 405 не считается достаточным доказательством битой ссылки.
4. [MDN: 429](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429). Rate limit не равен отсутствующему ресурсу. MVP показывает его отдельно и не запускает немедленный retry. Будущее улучшение — очередь с Retry-After и ограничением по origin.
5. [MDN: HTTP status codes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status). Коды ошибок сохраняются без подмены. 401/403 — restricted; 404/410 — missing; 5xx — server error, который может быть временным. Успешный HTTP status не доказывает отсутствие soft 404 или CAPTCHA.
6. [Chrome: service worker lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle). Worker может завершиться; глобальные переменные не обеспечивают сохранность состояния. Прогресс сохраняется в session storage. Popup не владеет запросами. Потерянный скан обнаруживается при следующем запросе состояния.
7. [WXT: frontend frameworks](https://wxt.dev/guide/essentials/frontend-frameworks.html). Используется официальный Svelte module. [Tailwind: Vite integration](https://tailwindcss.com/docs/installation/using-vite) — подключение через Vite plugin и CSS import.

## Алгоритм

DOM → разрешение относительных URL → исключение не-HTTP и URL с credentials → удаление fragment → дедупликация → очередь из четырёх работников → HEAD / условный GET → классификация → сохранение → подсветка подтверждённых ошибок.

Redirect обрабатывается Fetch с `redirect: follow`, в результатах сохраняется конечный URL. Исходная принадлежность internal/external определяется до перенаправления. Дубликаты и разные fragment одного адреса дают один HTTP-запрос. Cookies, referrer и сторонний backend не используются.

## Что ещё требует проверки в настоящем браузере

Различия поведения серверов на HEAD/GET, popup clipboard, ограничения Firefox на инъекции, работа host permissions, браузерная сериализация функций и поведение Svelte UI. Для Firefox подготовлены `scripts/firefox-fixture.mjs` и сценарий `docs/FIREFOX.md`; успешного запуска собранного дополнения в текущей песочнице нет.


## Переход на Firefox

- [WXT: Targeting different browsers](https://wxt.dev/guide/essentials/target-different-browsers): команды явно задают Firefox и MV3; Firefox по умолчанию в WXT использует MV2.
- [MDN: background](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background): Firefox использует фоновый документ со scripts, а не Chrome service_worker. Manifest генерирует WXT; отдельный скрипт после сборки проверяет результат.
- [Mozilla: built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/): minimum Firefox 140, стабильный Gecko ID и `websiteContent` в required data categories. Это декларация отправки URL из страницы на сайты назначения для проверки, без аналитики и backend. `none` не выбран, поскольку сетевые проверки действительно передают адреса за пределы браузера.
- [MDN: host_permissions](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/host_permissions): пользователь может отозвать доступ. Popup запрашивает его непосредственно по нажатию Scan, background проверяет наличие до начала сбора и запросов.


## Дополнительные проверки содержимого — 8 ноября 2026

Просмотрены первичные источники:

- [Google: soft 404](https://developers.google.com/search/docs/crawling-indexing/troubleshoot-crawling-errors): успешный HTTP-код может сопровождать страницу ошибки или пустое содержимое. Практическое применение в LinkGuard — анализ заголовков и короткого основного текста, а затем браузерная проверка сомнительного HTML. Это эвристика, а не воспроизведение алгоритма Google.
- [MDN: Content-Type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Type): тип содержимого задаёт способ интерпретации ответа. LinkGuard теперь отдельно обрабатывает HTML, text/plain, application/json и application/*+json. Для неизвестных форматов не заявляет проверку валидности.
- [RFC 8259, раздел 8.1](https://www.rfc-editor.org/rfc/rfc8259.html#section-8.1): сетевой JSON использует UTF-8. Для JSON выполняется строгая декодировка и JSON.parse; HTML meta charset не влияет на JSON или обычный текст.
- [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html): application/problem+json описывает ошибку API. Такой ответ с HTTP 200 остаётся подозрительным; поле status внутри JSON не подменяет измеренный HTTP-код. Полная валидация схемы RFC не заявляется.
- [MDN: Content-Length](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Length) и [Content-Encoding](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Encoding): длина измеряется в байтах, при сжатии относится к закодированному представлению. LinkGuard сверяет длину только для несжатого ответа и ограничивает полученное декодированное тело независимо от заголовка.

Дополнительное решение проекта: HTML с Content-Disposition: attachment анализируется без автоматического открытия вкладки, чтобы браузерный этап не инициировал скачивание по уже известному заголовку. Изменение заголовков сервером между запросами этим не предотвращается. JSON и text/plain тоже не эскалируются в браузер.

Регрессионные примеры: короткая страница ошибки без h1; статья, обсуждающая 404; вход только по email; корректный JSON и скалярные JSON-значения; обрезанный JSON; problem+json; текст «OK»; пустой ответ; несоответствие длины; сжатый ответ; HTML-вложение. Проверены локально с подменой Fetch. Чтение документации через веб-поиск не является запуском расширения на внешних сайтах.

## Потоковая глубокая проверка и обход сайта (8 ноября)

- [MDN: webRequest.onHeadersReceived](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webRequest/onHeadersReceived): пассивное наблюдение статуса навигации. Используется только для собственных временных вкладок, без изменения заголовков.
- [MDN: tabs.create](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/create): cookieStoreId требует cookies permission. Разрешение нужно для исходного контейнера, cookie-значения не читаются.
- [Public Suffix List](https://publicsuffix.org/list/): граница регистрируемого домена, включая PRIVATE. В сборке локальный снимок 2025-03-28; обновление требует доступной сети.
- [RFC 9309](https://www.rfc-editor.org/rfc/rfc9309.html): группы, longest match, Allow при равенстве, wildcard, end-anchor, обработка недоступности robots.txt. Собственная реализация консервативно запрещает origin при 429/5xx/сети/превышении лимита.
- [MDN: background lifecycle](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Background_scripts): сохранённый прогресс не означает автоматическое возобновление прерванной очереди. Восстановленная запись помечается interrupted.

Наблюдение DOM и обработка известных шаблонов — эвристики. Регрессионный корпус не
является слепым испытанием на случайной выборке интернета и не даёт процент точности.
