/**
 * Дымовой e2e-тест web-gradebook.
 *
 * Требуется запущенный dev/preview сервер и установленный Chromium-браузер:
 *   npm run dev                 # в отдельном терминале
 *   npm run test:e2e
 */
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://127.0.0.1:5173/web-gradebook/';
const SHOTS = '.verify/e2e';
mkdirSync(SHOTS, { recursive: true });

const failures = [];
const consoleErrors = [];

async function launchBrowser() {
  for (const channel of ['chrome', 'msedge']) {
    try {
      return await chromium.launch({ channel, headless: true });
    } catch {
      /* пробуем следующий */
    }
  }
  return await chromium.launch({ headless: true });
}

const browser = await launchBrowser();
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: 'ru-RU',
  timezoneId: 'Europe/Moscow',
  acceptDownloads: true,
});
const page = await context.newPage();
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});
page.on('pageerror', (error) => consoleErrors.push(error.message));

const check = (name, condition, detail = '') => {
  if (condition) {
    console.log(`PASS ${name}`);
    return;
  }
  failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
};

const shot = async (name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
const text = (value) => page.getByText(value, { exact: false }).first();

try {
  // 1. Пустое состояние и демо-данные
  await page.goto(BASE);
  await page.waitForTimeout(800);
  check('пустой журнал', (await page.getByText('Журнал пуст').count()) === 1);

  await page.getByText('Посмотреть на демо-данных').click();
  await text('Базы данных').waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  check('демо: оба предмета', (await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).count()) >= 1);
  await shot('01-subjects');

  // Группы как отдельная сущность
  await page.getByRole('link', { name: 'Группы' }).click();
  await page.waitForTimeout(700);
  check('группы: список', (await page.getByText('ПИ-21').count()) >= 1);
  await shot('01b-groups');
  await page.getByRole('button').filter({ hasText: 'ПИ-21' }).first().click();
  await page.waitForTimeout(700);
  check('группа: предметы и студенты', (await page.getByText('Предметы').count()) >= 1);
  await page.getByRole('button', { name: 'Зачислить на предмет' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('dialog').getByRole('button', { name: 'Зачислить' }).last().click();
  await page.waitForTimeout(1000);
  check('группа: зачислена на второй предмет', (await page.getByText(/2 предмета/).count()) >= 1);
  await shot('01c-group');

  await page.getByRole('button').filter({ hasText: 'Абрамова Ирина' }).first().click();
  await page.waitForTimeout(700);
  check('студент: профиль по предметам', (await page.getByText('Работы').count()) >= 1);
  check('студент: работы по видам', (await page.getByText('Лабораторные').count()) >= 1);
  check('студент: без дублей работ', (await page.getByText('Лабораторная 1', { exact: true }).count()) === 1);
  await shot('01d-student-profile');
  await page.getByRole('link', { name: 'Группы' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('link', { name: 'Предметы' }).click();
  await page.waitForTimeout(600);

  // 2. Предмет: переключение групп бейджами, даты занятий, прямой вход в сессию
  await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).first().click();
  await text('Лабораторная 1').waitFor();
  check('журнал: занятие', (await page.getByText('Лабораторная 1').count()) >= 1);
  check('группа — бейдж', (await page.getByRole('button', { name: /ПИ-21/ }).count()) >= 1);
  check('даты у занятий', (await page.getByText(/пт, 23 окт/).count()) >= 1);
  await shot('02-journal');

  await page.getByRole('tab', { name: 'Таблица' }).click();
  await page.waitForTimeout(700);
  check('таблица: студенты и занятия', (await page.locator('tbody tr').count()) >= 10);
  check('таблица: колонки с датами', (await page.locator('thead th').count()) >= 4);
  const tableInput = page.locator('input[aria-label^="Балл:"]').first();
  await tableInput.fill('77');
  await tableInput.blur();
  await page.waitForTimeout(700);
  check('таблица: балл сохраняется', (await tableInput.inputValue()) === '77');
  check('таблица: явка в клетке', (await page.locator('button[aria-label^="Посещаемость:"]').count()) > 0);
  await shot('02b-table');

  await page.getByRole('tab', { name: 'Студенты' }).click();
  await page.waitForTimeout(600);
  check('список студентов', (await page.getByText(/22 студент/).count()) >= 1);
  check('подгруппы цветом', (await page.getByText('Подгруппа 1').count()) >= 1);
  await shot('03-students');

  // 3. Прямой вход в сессию из журнала
  await page.getByRole('tab', { name: 'Журнал' }).click();
  await page.waitForTimeout(400);
  await page.getByRole('button').filter({ hasText: 'пт, 23 окт' }).first().click();
  await page.waitForTimeout(700);
  check('экран выставления', (await page.locator('input[placeholder="—"]').count()) > 0);
  check('вся группа в сессии', (await page.getByText('Подгруппа 2').count()) >= 1);
  check('другая подгруппа: явка и баллы', (await page.getByText('другая подгруппа').count()) >= 1);
  check('кнопка «Отметить всех» доступна', (await page.getByRole('button', { name: 'Отметить всех' }).count()) === 1);
  check('кнопки «Максимум всем» нет на экране', (await page.getByRole('button', { name: 'Максимум всем' }).count()) === 0);

  const input = page.locator('input[placeholder="—"]').first();
  const studentAria = await input.getAttribute('aria-label');
  await input.fill('91');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  const gradeClass = (await input.getAttribute('class')) ?? '';
  check('оценка: цвет по шкале', gradeClass.includes('text-grade5'));
  await shot('04-grading');

  await input.fill('150');
  await page.keyboard.press('Tab');
  await page.waitForTimeout(900);
  check('валидация максимума', (await input.inputValue()) === '100');

  // «Отметить всех» + отмена
  await page.getByRole('button', { name: 'Отметить всех' }).click();
  await page.waitForTimeout(700);
  check('после «Отметить всех» есть отмена', (await page.getByRole('button', { name: 'Отменить' }).count()) === 1);
  await page.getByRole('button', { name: 'Отменить' }).click();
  await page.waitForTimeout(600);

  // 4. Перезагрузка: оценка сохраняется
  const expectedAria = studentAria ?? 'Балл:';
  await page.reload();
  await page.waitForTimeout(1600);
  const restored = page.locator(`input[aria-label="${expectedAria}"]`).first();
  const restoredValue = (await restored.count()) ? await restored.inputValue() : null;
  check('оценка сохраняется после reload', restoredValue === '100', `получено ${restoredValue}`);

  // 5. Нижняя навигация на детальных экранах
  await page.goto(`${BASE}#/`);
  await page.waitForTimeout(1000);
  await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Студенты' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button').filter({ hasText: 'Абрамова Ирина' }).first().click();
  await page.waitForTimeout(700);
  check('навигация видна у студента', (await page.getByRole('link', { name: 'Статистика' }).count()) === 1);
  await shot('05-student');

  // 6. Лекция: только посещаемость, без баллов
  await page.getByRole('link', { name: 'Предметы' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).first().click();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: /Лекция/ }).click();
  await page.waitForTimeout(500);
  check('лекция: подпись «только посещаемость»', (await page.getByText('только посещаемость').count()) >= 1);
  await page.getByRole('button').filter({ hasText: /ср, 21 окт/ }).first().click();
  await page.waitForTimeout(700);
  check('лекция: нет полей баллов', (await page.locator('input[placeholder="—"]').count()) === 0);
  check('лекция: «Отметить всех»', (await page.getByRole('button', { name: 'Отметить всех' }).count()) >= 1);
  await shot('06-lecture');

  // 7. Статистика и данные: экспорт
  await page.getByRole('link', { name: 'Статистика' }).click();
  await page.waitForTimeout(900);
  check('статистика: рейтинг', (await page.getByText('Рейтинг группы').count()) >= 1);
  await shot('07-stats');

  await page.goto(`${BASE}#/data`);
  await page.waitForTimeout(700);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Скачать бэкап JSON' }).click(),
  ]);
  const backupPath = '.verify/e2e-backup.json';
  await download.saveAs(backupPath);
  const backup = JSON.parse(readFileSync(backupPath, 'utf8'));
  check('экспорт: формат', backup.format === 'web-gradebook-backup' && backup.version === 2);
  check('экспорт: данные', backup.data.subjects.length === 2 && backup.data.students.length === 42);

  // 8. Импорт расписания: пример вставкой JSON
  await page.getByRole('button', { name: 'Вставить JSON' }).first().click();
  await page.waitForTimeout(400);
  check('расписание: форма вставки', (await page.getByText('JSON расписания').count()) === 1);
  await page.locator('textarea').last().fill(JSON.stringify([
    { dates: ['07.09', '14.09'], group: 'ИС-21', type: 'лек', subject: 'Новый курс' },
    { dates: ['09.09', '16.09', '23.09', '30.09'], group: 'ИС-21, ИС-22', type: 'л.р.', subject: 'Новый курс' },
  ]));
  await page.getByRole('button', { name: 'Проверить и продолжить' }).click();
  await page.waitForTimeout(600);
  check('расписание: предпросмотр', (await page.getByText('Импорт расписания').count()) === 1);
  check('расписание: все группы в предпросмотре', (await page.getByText('ИС-22').count()) >= 1);
  await page.getByRole('button', { name: 'Импортировать', exact: true }).click();
  await page.waitForTimeout(2500);
  check('расписание: импорт', (await page.getByText(/Расписание: предметов/).count()) >= 1);
  await page.getByRole('link', { name: 'Предметы' }).click();
  await page.waitForTimeout(800);
  check('расписание: новый предмет', (await page.getByRole('button').filter({ hasText: 'Новый курс' }).count()) >= 1);
  await page.getByRole('button').filter({ hasText: 'Новый курс' }).first().click();
  await page.waitForTimeout(700);
  check('расписание: группы видны', (await page.getByRole('button', { name: /ИС-22/ }).count()) >= 1);
  check('расписание: лабы объединены', (await page.getByText('Лабораторная 3').count()) === 0);
  check('расписание: у лабы две сессии', (await page.getByText('2 сессии').count()) >= 1);
  await shot('08-schedule-subject');

  // 9. Импорт студентов по группам и подгруппам
  await page.goto(`${BASE}#/data`);
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Вставить JSON' }).last().click();
  await page.waitForTimeout(400);
  await page.locator('textarea').last().fill(JSON.stringify({
    subjects: ['Веб-разработка', 'Базы данных'],
    groups: [
      { name: 'ПИ-21', students: [
        { name: 'Абрамова Ирина', subgroup: 2 },
        { name: 'Импортов Тест', subgroup: 1 },
      ] },
    ],
  }));
  await page.getByRole('button', { name: 'Проверить и продолжить' }).click();
  await page.waitForTimeout(600);
  check('студенты: предпросмотр', (await page.getByText('Импорт студентов').count()) === 1);
  await page.getByRole('button', { name: 'Импортировать студентов' }).click();
  await page.waitForTimeout(1800);
  check('студенты: импорт', (await page.getByText(/Группы: .*студентов/).count()) >= 1);
  await page.getByRole('link', { name: 'Предметы' }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: 'Студенты' }).click();
  await page.waitForTimeout(600);
  check('студенты: новый в группе', (await page.getByText('Импортов Тест').count()) >= 1);
  check('студенты: подгруппа обновлена', (await page.getByText('Подгруппа 2').count()) >= 1);

  await page.getByRole('link', { name: 'Предметы' }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button').filter({ hasText: 'Базы данных' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: 'Студенты' }).click();
  await page.waitForTimeout(600);
  check('студенты: зачислены в два предмета', (await page.getByText('Импортов Тест').count()) >= 1);

  // 10. Пример бэкапа
  await page.goto(`${BASE}#/data`);
  await page.waitForTimeout(600);
  check('пример бэкапа: кнопка', (await page.getByRole('button', { name: 'Скачать пример бэкапа' }).count()) === 1);
  await page.locator('input[type=file]').first().setInputFiles('public/examples/backup.json');
  await page.waitForTimeout(700);
  check('пример бэкапа: читается', (await page.getByText('Режим импорта').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 10. Тема
  await page.getByRole('link', { name: 'Настройки' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('tab', { name: 'Тёмная' }).click();
  await page.waitForTimeout(400);
  await page.reload();
  await page.waitForTimeout(1100);
  const theme = await page.evaluate(() => document.documentElement.dataset.theme);
  check('тёмная тема сохраняется', theme === 'dark', `получено ${theme}`);
  await shot('09-settings-dark');

  // 11. Оверфлоу на 320
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`${BASE}#/`);
  await page.waitForTimeout(800);
  await page.getByRole('button').filter({ hasText: 'Веб-разработка' }).first().click();
  await page.waitForTimeout(600);
  await page.getByRole('tab', { name: 'Таблица' }).click();
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  check('таблица на 320 без скролла страницы', overflow <= 0, `overflow=${overflow}`);
} catch (error) {
  failures.push(`исключение: ${error.message}`);
  await shot('FAIL');
}

check('нет ошибок в консоли', consoleErrors.length === 0, consoleErrors.join(' | '));
await browser.close();

if (failures.length) {
  console.error(`\nПровалено проверок: ${failures.length}`);
  for (const failure of failures) console.error(` - ${failure}`);
  process.exit(1);
}
console.log('\nВсе проверки пройдены.');
