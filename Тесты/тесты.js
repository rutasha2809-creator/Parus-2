/* =========================================================================
   ТЕСТЫ ПРИЛОЖЕНИЯ «ПАРУС»

   Зачем: каждая проверка здесь — это баг, который уже был найден и исправлен.
   Тесты не дают ему вернуться незамеченным при следующих правках.

   Как запустить: двойной клик по «ПРОВЕРИТЬ.bat» в этой же папке.
   ========================================================================= */

const fs = require('fs');
const path = require('path');

/* ---------------- простой движок проверок ---------------- */
let passed = 0, failed = 0;
const failures = [];
let currentGroup = '';

function group(name){
  currentGroup = name;
  console.log('\n' + name);
  console.log('─'.repeat(Math.min(name.length + 10, 60)));
}

function check(what, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if(ok){
    passed++;
    console.log('  ✓  ' + what);
  } else {
    failed++;
    failures.push({ group: currentGroup, what, actual, expected });
    console.log('  ✗  ' + what);
    console.log('       получили: ' + JSON.stringify(actual));
    console.log('       ожидали:  ' + JSON.stringify(expected));
  }
}

function checkTrue(what, actual){ check(what, !!actual, true); }

/* ---------------- загрузка приложения ---------------- */
function loadApp(){
  let JSDOM;
  try {
    JSDOM = require('jsdom').JSDOM;
  } catch(e){
    console.error('\nНе найдена библиотека jsdom.');
    console.error('Запустите в этой папке:  npm install jsdom\n');
    process.exit(2);
  }
  const file = path.join(__dirname, '..', 'index.html');
  if(!fs.existsSync(file)){
    console.error('\nНе найден index.html — сначала соберите приложение.\n');
    process.exit(2);
  }
  const html = fs.readFileSync(file, 'utf8');
  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://example.com/' });
  return dom.window;
}

/* Чистое состояние перед каждой группой тестов */
function reset(W, patch){
  W.S.accounts = [];
  W.S.transactions = [];
  W.S.recurring = [];
  W.S.rules = [];
  W.S.planOverrides = {};
  W.S.settings.minBuffer = 0;
  if(patch) Object.assign(W.S, patch);
  W.save();
}

/* =========================================================================
   ЗАПУСК
   ========================================================================= */
(async () => {
  const W = loadApp();
  await new Promise(r => setTimeout(r, 400));   // дать скриптам стартовать
  const D = W.document;
  const T = W.today();

  /* ======================================================================
     Разбор дат из выписок.
     Было: английские месяцы не читались вообще — иностранные выписки
     не импортировались. И 05/08 молча считалось 5 августа даже для
     американских банков, где это 8 мая.
     ====================================================================== */
  group('Даты в выписках');

  W.IMP_DATE_ORDER = 'dmy';
  check('ISO 2026-08-05',          W.parseAnyDate('2026-08-05'),     '2026-08-05');
  check('ISO через слэш',          W.parseAnyDate('2026/08/05'),     '2026-08-05');
  check('русский формат 05.08.2026', W.parseAnyDate('05.08.2026'),   '2026-08-05');
  check('русский месяц словом',    W.parseAnyDate('5 августа 2026'), '2026-08-05');
  check('английский: 5 Aug 2026',  W.parseAnyDate('5 Aug 2026'),     '2026-08-05');
  check('английский: Aug 5, 2026', W.parseAnyDate('Aug 5, 2026'),    '2026-08-05');
  check('английский полный',       W.parseAnyDate('August 5, 2026'), '2026-08-05');
  check('английский через дефис',  W.parseAnyDate('05-Aug-2026'),    '2026-08-05');
  check('двузначный год',          W.parseAnyDate('15 Dec 26'),      '2026-12-15');
  check('день больше 12 — однозначно', W.parseAnyDate('31/12/2026'), '2026-12-31');
  check('месяц больше 12 — разворот',  W.parseAnyDate('12/31/2026'), '2026-12-31');
  check('европейский порядок 05/08',   W.parseAnyDate('05/08/2026'), '2026-08-05');

  W.IMP_DATE_ORDER = 'mdy';
  check('американский порядок 05/08',  W.parseAnyDate('05/08/2026'), '2026-05-08');
  W.IMP_DATE_ORDER = 'dmy';

  check('мусор не превращается в дату', W.parseAnyDate('не дата'), null);

  /* ======================================================================
     Разбор сумм. Форматы разных стран и валют.
     ====================================================================== */
  group('Суммы в выписках');

  check('русский формат 1 234,56',   W.parseAnyNumber('1 234,56'),   1234.56);
  check('английский формат 1,234.56', W.parseAnyNumber('1,234.56'),  1234.56);
  check('европейский 1.234,56',      W.parseAnyNumber('€1.234,56'),  1234.56);
  check('скобки означают минус',     W.parseAnyNumber('(1,234.56)'), -1234.56);
  check('минус впереди',             W.parseAnyNumber('-1 234,56'),  -1234.56);
  check('символ рубля',              W.parseAnyNumber('1 234,56 ₽'), 1234.56);
  check('символ доллара с минусом',  W.parseAnyNumber('-$50.00'),    -50);
  check('швейцарский апостроф',      W.parseAnyNumber("1'234.56"),   1234.56);
  check('код валюты в строке',       W.parseAnyNumber('1234,56 USD'),1234.56);
  check('пустая строка — не ноль',   W.parseAnyNumber(''),           null);

  /* ======================================================================
     График рассрочки.
     Было: если дата платежа уже прошла в этом месяце, приложение
     подставляло сегодняшнее число — и весь график съезжал.
     ====================================================================== */
  group('График рассрочки');

  reset(W, { accounts: [{
    id:'inst1', type:'installment', name:'Рассрочка', currency:'RUB',
    openingBalance: 45200, payment: 4520, freq:'monthly',
    nextPaymentDate: '2026-08-17'
  }]});

  const sched = W.installmentSchedule(W.acc('inst1'));
  check('первый платёж — в указанную дату', sched[0] && sched[0].date, '2026-08-17');
  check('второй — ровно через месяц',       sched[1] && sched[1].date, '2026-09-17');
  check('третий — тоже 17 числа',           sched[2] && sched[2].date, '2026-10-17');
  check('число месяца не съезжает',
        sched.slice(0,5).every(r => r.date.endsWith('-17')), true);
  check('сумма платежа сохранена',          sched[0] && sched[0].payment, 4520);
  check('долг гасится полностью',
        sched[sched.length-1] && sched[sched.length-1].balance < 0.01, true);

  /* ======================================================================
     Минимальный остаток.
     Было: поле не читало сохранённое значение и при каждой загрузке
     возвращалось к выдуманным 10 000, стирая выбор пользователя.
     ====================================================================== */
  group('Минимальный остаток');

  reset(W, { accounts: [{id:'a1',type:'debit',name:'Карта',currency:'RUB',openingBalance:5000}] });
  W.go('calendar');
  const bufEl = D.getElementById('calMinBuf');

  check('по умолчанию не задан', bufEl.value, '');
  check('в настройках ноль, а не выдуманное число', W.S.settings.minBuffer, 0);

  bufEl.value = '20000';
  W.renderCalendar();
  check('заданное значение сохраняется', W.S.settings.minBuffer, 20000);

  W.renderCalendar();
  check('перерисовка не стирает значение', bufEl.value, '20000');

  bufEl.value = '';                 // имитируем перезагрузку страницы
  W.renderCalendar();
  check('после перезагрузки значение вернулось', String(bufEl.value), '20000');

  checkTrue('при остатке ниже заданного есть предупреждение',
            D.getElementById('calGapNote').textContent.includes('Тонко'));
  checkTrue('слова «подушка» в интерфейсе нет',
            !D.getElementById('calGapNote').textContent.includes('подушк'));

  /* ======================================================================
     Категории, провоцирующие двойной учёт.
     Было: «Платежи по кредитам» и «Ипотека» приводили к тому, что
     платёж считался и как расход, и как плановый платёж из графика.
     ====================================================================== */
  group('Категории без двойного учёта');

  check('категории «Платежи по кредитам» нет',
        W.S.categories.some(c => c.id === 'c_loan'), false);
  check('категории «Ипотека» нет',
        W.S.categories.some(c => c.id === 'c_mortgage'), false);
  checkTrue('обычные категории на месте',
        W.S.categories.some(c => c.id === 'c_food') &&
        W.S.categories.some(c => c.id === 'c_utility'));

  reset(W, { accounts: [
    {id:'card', type:'debit', name:'Карта', currency:'RUB', openingBalance:100000},
    {id:'ln', type:'loan', name:'Кредит', currency:'RUB',
     openingBalance:200000, rate:12, payment:10000, nextPaymentDate:T}
  ]});
  const shareRows = W.forecastCatShare(W.buildForecast(90)).rows.map(r => r.name);
  check('в прогнозе одна строка про долги, без дублей',
        shareRows.filter(n => /кредит|долг|ипотек/i.test(n)).length, 1);

  /* ======================================================================
     Текущий месяц в прогнозе.
     Было: август показывал только доходы с сегодняшнего дня,
     фактические поступления за прошедшие дни месяца терялись.
     ====================================================================== */
  group('Прогноз учитывает начало месяца');

  const monthStart = T.slice(0,8) + '01';
  const yesterday  = W.addDays(T, -1);
  const skipPastTest = monthStart >= T;   // сегодня 1-е число — проверять нечего

  if(skipPastTest){
    console.log('  ·  пропущено: сегодня первое число месяца');
  } else {
    reset(W, {
      accounts: [{id:'a1',type:'debit',name:'Карта',currency:'RUB',openingBalance:100000}],
      transactions: [
        {id:'past1', date: monthStart, type:'income',  accountId:'a1', categoryId:'c_salary', amount:70000},
        {id:'past2', date: yesterday,  type:'expense', accountId:'a1', categoryId:'c_food',   amount:5000}
      ]
    });
    const mo = W.forecastMonths(W.buildForecast(90));
    checkTrue('доход с начала месяца попал в прогноз', mo[0] && mo[0].inc >= 70000);
    checkTrue('расход с начала месяца попал в прогноз', mo[0] && mo[0].exp >= 5000);
  }

  /* ======================================================================
     Онбординг: шаги гаснут по мере заполнения и исчезают в конце.
     ====================================================================== */
  group('Подсказка «С чего начать»');

  reset(W);
  W.go('home');
  const card  = () => D.getElementById('cardOnboard');
  const doneN = () => D.getElementById('onboardSteps').querySelectorAll('.stp.done').length;

  check('на пустом приложении видна', card().style.display, 'block');
  check('всего шагов', D.getElementById('onboardSteps').querySelectorAll('.stp').length, 4);
  check('выполненных пока нет', doneN(), 0);

  W.S.accounts = [{id:'a1',type:'debit',name:'Карта',currency:'RUB',openingBalance:50000}];
  W.save(); W.renderHome();
  check('после добавления счёта — один шаг закрыт', doneN(), 1);

  W.S.recurring = [{id:'r1',name:'Зарплата',kind:'income',amount:80000,freq:'monthly',
                    startDate:T,accountId:'a1',categoryId:'c_salary'}];
  W.save(); W.renderHome();
  check('после регулярного платежа — два шага', doneN(), 2);

  W.S.transactions = [{id:'t1',date:T,type:'expense',accountId:'a1',categoryId:'c_food',amount:1200}];
  W.save(); W.renderHome();
  check('когда всё заполнено — подсказка исчезает', card().style.display, 'none');

  W.S.transactions = [];
  W.save(); W.renderHome();
  check('если данные удалили — подсказка вернулась', card().style.display, 'block');

  /* ======================================================================
     Объединённая страница счетов: раскрытие и быстрый ввод.
     ====================================================================== */
  group('Счета с операциями внутри');

  reset(W, {
    accounts: [{id:'a1',type:'debit',name:'Тестовая карта',currency:'RUB',openingBalance:10000}],
    transactions: [
      {id:'t1',date:T,type:'expense',accountId:'a1',categoryId:'c_food',amount:300,note:'Пятёрочка'}
    ]
  });
  W.go('accounts');
  W.ACC_OPEN.clear();
  W.renderAccounts();

  const accHtml = () => D.getElementById('accGroups').innerHTML;
  checkTrue('счёт показан в списке', accHtml().includes('Тестовая карта'));
  checkTrue('по умолчанию свёрнут',  !accHtml().includes('class="acx open"'));

  W.toggleAccOpen('a1');
  checkTrue('раскрывается по клику',        accHtml().includes('class="acx open"'));
  checkTrue('внутри видны операции счёта',  accHtml().includes('Пятёрочка'));
  checkTrue('есть кнопка добавить операцию', accHtml().includes('+ Операция'));
  checkTrue('есть кнопка загрузить выписку', accHtml().includes('Загрузить выписку'));

  W.openTx(null, 'a1');
  check('счёт подставляется в новую операцию',
        D.getElementById('txAccount').value, 'a1');
  W.closeOv('ovTx');

  W.startImportFor('a1');
  check('импорт запоминает, с какого счёта открыт', W.IMP_PRESET_ACCOUNT, 'a1');
  checkTrue('переход на экран импорта состоялся',
            D.getElementById('s-import').classList.contains('active'));

  /* ======================================================================
     Переводы между счетами не искажают аналитику.
     ====================================================================== */
  group('Переводы не считаются расходом');

  reset(W, {
    accounts: [
      {id:'a1',type:'debit',name:'Карта',   currency:'RUB',openingBalance:50000},
      {id:'a2',type:'cash', name:'Наличные',currency:'RUB',openingBalance:0}
    ],
    transactions: [
      {id:'tr1',date:T,type:'transfer',accountId:'a1',toAccountId:'a2',amount:10000}
    ]
  });
  check('деньги ушли с карты',       W.balance(W.acc('a1')), 40000);
  check('деньги пришли в наличные',  W.balance(W.acc('a2')), 10000);
  check('общий остаток не изменился', W.totalLiquid(), 50000);

  const moT = W.forecastMonths(W.buildForecast(30));
  check('перевод не попал в расходы месяца', moT[0] && moT[0].exp, 0);
  check('перевод не попал в доходы месяца',  moT[0] && moT[0].inc, 0);

  /* ======================================================================
     Правила «описание → категория».
     Раньше работали только при импорте. Теперь и при ручном вводе.
     ====================================================================== */
  group('Правила подстановки категорий');

  reset(W, {
    accounts: [{id:'a1',type:'debit',name:'Карта',currency:'RUB',openingBalance:50000}],
    rules: [{ id:'r1', match:'пятероч', categoryId:'c_food' }]
  });

  check('правило срабатывает по части слова',
        W.guessCategory('Пятёрочка у дома', 'expense'), 'c_food');
  check('регистр не важен',
        W.guessCategory('ПЯТЕРОЧ №123', 'expense'), 'c_food');
  /* Банки в выписках пишут «ПЯТЕРОЧКА» без ё, человек — «Пятёрочка».
     Без этого правило молча не срабатывало бы на половине операций. */
  check('«ё» и «е» считаются одинаковыми',
        W.guessCategory('ПЯТЕРОЧКА №5', 'expense'), 'c_food');
  check('и в обратную сторону тоже',
        W.guessCategory('пятёрочка', 'expense'), 'c_food');
  check('лишние пробелы не мешают',
        W.guessCategory('  Пятёрочка   у   дома  ', 'expense'), 'c_food');
  check('чужое описание — категория по умолчанию',
        W.guessCategory('Аптека', 'expense'), 'c_other_e');
  check('правило расхода не лезет в доходы',
        W.guessCategory('Пятёрочка', 'income'), 'c_other_i');

  W.openTx(null, 'a1');
  const noteEl = D.getElementById('txNote');
  const catEl  = D.getElementById('txCategory');
  noteEl.value = 'Пятёрочка';
  W.txApplyRule();
  check('при ручном вводе категория подставилась', catEl.value, 'c_food');

  /* Осознанный выбор пользователя правило перебивать не должно */
  catEl.value = 'c_fun';
  catEl.dataset.touched = '1';
  noteEl.value = 'Пятёрочка снова';
  W.txApplyRule();
  check('ручной выбор категории не перебивается', catEl.value, 'c_fun');
  W.closeOv('ovTx');

  /* При правке существующей операции её категория сохраняется */
  reset(W, {
    accounts: [{id:'a1',type:'debit',name:'Карта',currency:'RUB',openingBalance:50000}],
    rules: [{ id:'r1', match:'пятероч', categoryId:'c_food' }],
    transactions: [{id:'t1',date:T,type:'expense',accountId:'a1',
                    categoryId:'c_fun',amount:500,note:'Пятёрочка'}]
  });
  W.openTx('t1');
  check('у сохранённой операции категория не меняется',
        D.getElementById('txCategory').value, 'c_fun');
  W.closeOv('ovTx');

  /* ======================================================================
     История капитала за 12 месяцев.
     ====================================================================== */
  group('История капитала');

  reset(W);
  check('без данных история пустая', W.capitalHistory(12).length, 0);

  /* Копим три месяца: счёт плюс доходы, долг гасится */
  const m0 = T.slice(0,8) + '01';
  const back = (n) => {
    const d = W.parseISO(m0);
    d.setMonth(d.getMonth() - n);
    return W.iso(d);
  };
  reset(W, {
    accounts: [
      {id:'a1', type:'debit', name:'Карта', currency:'RUB', openingBalance:0},
      {id:'d1', type:'debt',  name:'Долг другу', currency:'RUB', openingBalance:30000}
    ],
    transactions: [
      {id:'i1', date: back(3), type:'income',  accountId:'a1', categoryId:'c_salary', amount:50000},
      {id:'i2', date: back(2), type:'income',  accountId:'a1', categoryId:'c_salary', amount:50000},
      {id:'e1', date: back(2), type:'expense', accountId:'a1', categoryId:'c_food',   amount:20000},
      {id:'i3', date: back(1), type:'income',  accountId:'a1', categoryId:'c_salary', amount:50000}
    ]
  });

  const hist = W.capitalHistory(12);
  checkTrue('история построилась', hist.length >= 3);
  checkTrue('месяцы идут по возрастанию',
            hist.every((h,i) => i === 0 || h.date > hist[i-1].date));
  checkTrue('в каждой точке есть активы, долги и итог',
            hist.every(h => typeof h.assets === 'number' &&
                            typeof h.debt === 'number' &&
                            typeof h.net === 'number'));
  check('чистый капитал = активы минус долги',
        hist.every(h => Math.abs(h.net - (h.assets - h.debt)) < 0.01), true);
  checkTrue('капитал вырос за период', hist[hist.length-1].net > hist[0].net);
  check('долг учтён со знаком минус в капитале',
        hist[hist.length-1].net, W.round2(hist[hist.length-1].assets - 30000));

  check('остаток на прошлую дату не включает будущие операции',
        W.netWorthAt(back(3)) < W.netWorthAt(back(1)), true);

  /* ======================================================================
     ИТОГ
     ====================================================================== */
  console.log('\n' + '═'.repeat(60));
  if(failed === 0){
    console.log('ВСЁ ХОРОШО.  Проверок пройдено: ' + passed);
    console.log('═'.repeat(60) + '\n');
    process.exit(0);
  } else {
    console.log('ЕСТЬ ПРОБЛЕМЫ.  Пройдено: ' + passed + ',  не прошло: ' + failed);
    console.log('═'.repeat(60));
    console.log('\nЧто именно сломалось:');
    for(const f of failures){
      console.log('\n  • ' + f.group + ' → ' + f.what);
      console.log('    получили: ' + JSON.stringify(f.actual));
      console.log('    ожидали:  ' + JSON.stringify(f.expected));
    }
    console.log('');
    process.exit(1);
  }
})().catch(e => {
  console.error('\nТесты не смогли отработать:');
  console.error(e);
  process.exit(3);
});
