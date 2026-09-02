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
     Свой платёж за один месяц (график кредита / кредитки / рассрочки).
     Раньше сумму платежа авторасчёта нельзя было поменять для одного
     месяца — только принять график целиком. Если в этот раз получается
     внести меньше (например, минимум), долг должен погаситься частично
     и график продолжиться дальше, а не пропасть и не обнулиться.
     ====================================================================== */
  group('Свой платёж за месяц');

  // --- рассрочка ---
  reset(W, { accounts: [{
    id:'inst2', type:'installment', name:'Рассрочка 2', currency:'RUB',
    openingBalance: 45200, payment: 4520, freq:'monthly',
    nextPaymentDate: '2026-08-17'
  }]});
  W.setPlanOverride(W.planKey('debt','inst2','2026-08-17'), {amount: 2000});
  const instOv = W.installmentSchedule(W.acc('inst2'));
  check('рассрочка: сумма месяца заменена своей',   instOv[0] && instOv[0].payment, 2000);
  checkTrue('рассрочка: строка помечена своей',      instOv[0] && instOv[0].overridden);
  check('рассрочка: остаток уменьшился только на неё', instOv[0] && instOv[0].balance, 43200);
  check('рассрочка: следующий платёж вырос ровно на недостачу',
        instOv[1] && instOv[1].payment, 7040);   // 4520 (план) + 2520 (недоплата в августе)
  checkTrue('рассрочка: следующая строка не своя, а «с переносом»',
            instOv[1] && !instOv[1].overridden && instOv[1].bumped);
  check('рассрочка: платёж через один — снова обычный',
        instOv[2] && instOv[2].payment, 4520);

  W.clearPlanOverride(W.planKey('debt','inst2','2026-08-17'));
  const instBack = W.installmentSchedule(W.acc('inst2'));
  check('рассрочка: «вернуть как было» восстанавливает сумму', instBack[0] && instBack[0].payment, 4520);

  // --- кредит (аннуитет) ---
  reset(W, { accounts: [{
    id:'loan2', type:'loan', name:'Кредит 2', currency:'RUB',
    openingBalance: 100000, rate: 12, termMonths: 12,
    nextPaymentDate: '2026-08-14'
  }]});
  const loanFull = W.loanSchedule(W.acc('loan2'));
  W.setPlanOverride(W.planKey('debt','loan2','2026-08-14'), {amount: 2000});
  const loanOv = W.loanSchedule(W.acc('loan2'));
  check('кредит: сумма месяца — ровно введённая',    loanOv[0] && loanOv[0].payment, 2000);
  checkTrue('кредит: остаток больше, чем при обычном платеже',
            loanOv[0] && loanFull[0] && loanOv[0].balance > loanFull[0].balance);
  checkTrue('кредит: график стал длиннее — долг гасится дольше',
            loanOv.length >= loanFull.length);
  checkTrue('кредит: второй месяц вырос ровно на недостачу первого',
            loanOv[1] && loanFull[1] &&
            Math.abs(loanOv[1].payment - (loanFull[1].payment + (loanFull[0].payment - 2000))) < 0.01);
  checkTrue('кредит: второй месяц помечен «с переносом»', loanOv[1] && loanOv[1].bumped);
  checkTrue('кредит: третий месяц — снова обычный платёж',
            loanOv[2] && loanFull[2] && Math.abs(loanOv[2].payment - loanFull[2].payment) < 0.01);

  // --- кредитная карта (минимальный платёж) ---
  reset(W, { accounts: [{
    id:'card2', type:'credit_card', name:'Карта 2', currency:'RUB',
    openingBalance: 50000, rate: 25, minPercent: 5, paymentDay: 20
  }]});
  const cardFull = W.cardSchedule(W.acc('card2'));
  // 1 500 ₽: меньше обычного минимального платежа (2 500 = 5% от 50 000),
  // но покрывает проценты за месяц (≈1 041,67 ₽) — долг всё ещё гасится,
  // просто медленнее.
  W.setPlanOverride(W.planKey('debt','card2', cardFull[0].date), {amount: 1500});
  const cardOv = W.cardSchedule(W.acc('card2'));
  check('кредитка: свой минимальный платёж применился', cardOv[0] && cardOv[0].payment, 1500);
  checkTrue('кредитка: строка помечена своей',          cardOv[0] && cardOv[0].overridden);
  checkTrue('кредитка: из-за меньшего платежа долг закрывается дольше обычного',
            cardOv.length > cardFull.length);

  // а если своя сумма даже процентов не покрывает — честно показываем ошибку,
  // а не тихо уходим в бесконечный долг
  W.setPlanOverride(W.planKey('debt','card2', cardFull[0].date), {amount: 500});
  const cardTooLow = W.cardSchedule(W.acc('card2'));
  checkTrue('кредитка: платёж меньше процентов помечен ошибкой',
            cardTooLow[0] && cardTooLow[0].error === true);

  /* ======================================================================
     Свой платёж за месяц — теперь и в СВОЁМ графике (вставленном со
     скриншота или графика банка), не только в авторасчёте. Была замечена
     после публикации: кнопка «Изменить» не появлялась для банковского
     графика, потому что override применялся только к формуле аннуитета.
     ====================================================================== */
  group('Свой платёж — ручной график банка');

  reset(W, { accounts: [{
    id:'card3', type:'credit_card', name:'Карта 3', currency:'RUB',
    openingBalance: 200000, rate: 25, minPercent: 20,
    scheduleMode: 'manual',
    manualSchedule: [
      {date:'2026-09-14', amount:130454, interest:0},
      {date:'2026-10-15', amount:17254, interest:0},
      {date:'2026-11-14', amount:17062, interest:0}
    ]
  }]});
  const manFull = W.cardSchedule(W.acc('card3'));
  checkTrue('ручной график: строки банка на месте', manFull.length >= 3);
  checkTrue('ручной график: первые 3 строки — из списка банка, без правок',
            !manFull[0].overridden && !manFull[1].overridden && !manFull[2].overridden);
  checkTrue('ручной график: без правки строка не помечена своей', !manFull[1].overridden);

  W.setPlanOverride(W.planKey('debt','card3','2026-10-15'), {amount: 5000});
  const manOv = W.cardSchedule(W.acc('card3'));
  check('ручной график: сумма месяца заменена своей', manOv[1] && manOv[1].payment, 5000);
  checkTrue('ручной график: строка помечена своей',   manOv[1] && manOv[1].overridden);
  checkTrue('ручной график: остаток после неё больше, чем по банковскому графику',
            manOv[1] && manFull[1] && manOv[1].balance > manFull[1].balance);
  checkTrue('ручной график: строка до правки не тронута',
            manOv[0] && manFull[0] && manOv[0].payment === manFull[0].payment);
  checkTrue('ручной график: следующая строка выросла ровно на недостачу',
            manOv[2] && manFull[2] &&
            Math.abs(manOv[2].payment - (manFull[2].payment + (manFull[1].payment - 5000))) < 0.01 &&
            manOv[2].bumped === true);

  // тот же кредит, но не карта — для параллельной проверки loanSchedule
  reset(W, { accounts: [{
    id:'loan3', type:'loan', name:'Кредит 3', currency:'RUB',
    openingBalance: 100000, rate: 12,
    scheduleMode: 'manual',
    manualSchedule: [
      {date:'2026-09-14', amount:9000},
      {date:'2026-10-14', amount:9000}
    ]
  }]});
  W.setPlanOverride(W.planKey('debt','loan3','2026-09-14'), {amount: 3000});
  const loanManOv = W.loanSchedule(W.acc('loan3'));
  check('кредит (свой график): сумма месяца заменена своей', loanManOv[0] && loanManOv[0].payment, 3000);
  checkTrue('кредит (свой график): строка помечена своей',   loanManOv[0] && loanManOv[0].overridden);

  /* ======================================================================
     Свой график банка не должен «терять» деньги.
     Раньше: если где-то в графике внесли меньше нужного, оставшийся долг
     после последней строки банка просто исчезал — график заканчивался,
     а остаток так и не доходил до нуля. Теперь после списка банка график
     продолжается минимальным платежом по формуле, пока долг не закроется.
     ====================================================================== */
  group('Свой график банка продолжается до нуля');

  // --- реалистичный случай: недостача переходит в следующий платёж банка ---
  reset(W, { accounts: [{
    id:'sovcom', type:'credit_card', name:'Совком', currency:'RUB',
    openingBalance: 211106, rate: 0, minPercent: 20,
    scheduleMode: 'manual',
    manualSchedule: [
      {date:'2026-09-14', amount:130454},
      {date:'2026-10-15', amount:17254},
      {date:'2026-11-14', amount:17062},
      {date:'2026-12-15', amount:8605},
      {date:'2027-01-14', amount:6534},
      {date:'2027-02-14', amount:6534},
      {date:'2027-03-15', amount:6534},
      {date:'2027-04-14', amount:6534},
      {date:'2027-05-15', amount:5502},
      {date:'2027-06-14', amount:5355},
      {date:'2027-07-15', amount:737}
    ]
  }]});

  const beforeCut = W.cardSchedule(W.acc('sovcom'));
  checkTrue('без правок график сам доходит до нулевого остатка',
            beforeCut.length && beforeCut[beforeCut.length-1].balance === 0);

  W.setPlanOverride(W.planKey('debt','sovcom','2026-09-14'), {amount: 9877});
  const afterCut = W.cardSchedule(W.acc('sovcom'));
  check('сентябрь — ровно введённая сумма', afterCut[0] && afterCut[0].payment, 9877);
  check('октябрь вырос ровно на недостачу сентября (130454 − 9877)',
        afterCut[1] && afterCut[1].payment, 130454 - 9877 + 17254);
  checkTrue('октябрь помечен «с переносом»', afterCut[1] && afterCut[1].bumped);
  check('ноябрь — снова обычная сумма банка', afterCut[2] && afterCut[2].payment, 17062);
  checkTrue('после переноса график всё равно доходит до нулевого остатка',
            afterCut[afterCut.length-1] && afterCut[afterCut.length-1].balance === 0);

  // --- когда переносить уже некуда (это последняя строка банка) —
  //     страхует достройка графика минимальным платежом ---
  reset(W, { accounts: [{
    id:'tail1', type:'credit_card', name:'Тест хвоста', currency:'RUB',
    openingBalance: 10000, rate: 0, minPercent: 20,
    scheduleMode: 'manual',
    manualSchedule: [
      {date:'2026-09-14', amount:6000},
      {date:'2026-10-14', amount:4000}
    ]
  }]});
  const beforeTail = W.cardSchedule(W.acc('tail1'));
  check('без правок ровно 2 строки, долг закрыт', beforeTail.length, 2);

  W.setPlanOverride(W.planKey('debt','tail1','2026-10-14'), {amount: 1000});
  const afterTail = W.cardSchedule(W.acc('tail1'));
  checkTrue('после недоплаты последней строки появились новые строки',
            afterTail.length > beforeTail.length);
  checkTrue('новые строки помечены «по расчёту»',
            afterTail.slice(beforeTail.length).every(r => r.continued === true));
  checkTrue('и всё равно доходит до нулевого остатка',
            afterTail[afterTail.length-1] && afterTail[afterTail.length-1].balance === 0);

  group('Быстрое добавление долга');

  reset(W);
  W.openQuickDebt();
  W.document.getElementById('acName').value = 'Ozon — кроссовки';
  W.document.getElementById('acOpening').value = '12000';
  W.document.getElementById('acParts').value = '4';
  W.document.getElementById('acNextDate').value = '2026-09-15';
  W.saveAccount(null);
  const qdInst = W.S.accounts.find(a=>a.name==='Ozon — кроссовки');
  checkTrue('рассрочка создана', !!qdInst);
  check('тип счёта — installment', qdInst && qdInst.type, 'installment');
  check('сумма платежа посчитана сама (12000/4)', qdInst && qdInst.payment, 3000);
  check('число платежей сохранено', qdInst && qdInst.partsLeft, 4);

  W.quickDebtKind('debt');
  W.document.getElementById('acName').value = 'Долг Андрею';
  W.document.getElementById('acOpening').value = '5000';
  W.document.getElementById('acDueDate').value = '2026-12-01';
  W.saveAccount(null);
  const qdDebt = W.S.accounts.find(a=>a.name==='Долг Андрею');
  checkTrue('простой долг создан', !!qdDebt);
  check('тип счёта — debt', qdDebt && qdDebt.type, 'debt');
  check('срок возврата сохранён', qdDebt && qdDebt.dueDate, '2026-12-01');
  checkTrue('первая рассрочка не пострадала', W.S.accounts.length === 2);

  group('История платежей по долгу — можно исправить счёт списания');

  reset(W, { accounts: [
    { id:'debit1', type:'debit', name:'Карта верно', openingBalance: 100000 },
    { id:'debit2', type:'debit', name:'Карта неверно', openingBalance: 100000 },
    { id:'ozon', type:'installment', name:'Ozon', openingBalance: 12000, partsLeft: 4, freq:'monthly', nextPaymentDate:'2026-09-01', payment: 3000 }
  ]});

  // «Внести платёж» по ошибке указали не тот счёт списания
  W.quickPay('ozon');
  W.document.getElementById('qpAmount').value = '3000';
  W.document.getElementById('qpFrom').value = 'debit2';
  W.saveQuickPay('ozon');

  const debtHist = W.accTxList('ozon');
  checkTrue('платёж попал в историю операций счёта долга', debtHist.length === 1);
  check('счёт списания сохранён ошибочный', debtHist[0].accountId, 'debit2');

  // находим операцию через историю на карточке долга и правим счёт
  const txId = debtHist[0].id;
  W.openTx(txId);
  W.document.getElementById('txAccount').value = 'debit1';
  W.saveTx(txId);

  const fixed = W.S.transactions.find(t=>t.id===txId);
  check('счёт списания исправлен', fixed.accountId, 'debit1');
  check('сумма и получатель не пострадали', [fixed.amount, fixed.toAccountId], [3000, 'ozon']);

  group('Вклад «не учитывать в остатке денег» — резерв');

  reset(W, { accounts: [
    { id:'card', type:'debit', name:'Карта', openingBalance: 50000 },
    { id:'dep1', type:'deposit', name:'Подушка', openingBalance: 300000,
      liquid:false, excludeFromBalance:true, endDate: W.addDays(W.today(), 10) },
    { id:'dep2', type:'deposit', name:'На отпуск', openingBalance: 100000,
      liquid:true, excludeFromBalance:true }
  ]});

  check('в остатке «Сейчас» только обычная карта', W.totalLiquid(), 50000);
  check('оба резервных вклада исключены из liquidAccounts',
        W.liquidAccounts().map(a=>a.id), ['card']);
  check('в чистом капитале вклады по-прежнему считаются', W.netWorth(), 450000);

  const F = W.buildForecast(30);
  check('остаток на начало прогноза — без вкладов', F[0].open, 50000);
  check('остаток в конце горизонта — без вкладов, даже после даты окончания', F[F.length-1].close, 50000);
  const closingDay = F.find(d=>d.date===W.addDays(W.today(),10));
  checkTrue('в день окончания вклада приход не появляется (резерв)',
            !closingDay.items.some(i=>i.deposit));

  // обычный «запертый до даты» вклад (без резерва) — прежнее поведение сохранилось
  reset(W, { accounts: [
    { id:'card', type:'debit', name:'Карта', openingBalance: 50000 },
    { id:'dep3', type:'deposit', name:'Срочный вклад', openingBalance: 200000,
      liquid:false, endDate: W.addDays(W.today(), 5) }
  ]});
  check('обычный запертый вклад не в остатке сейчас', W.totalLiquid(), 50000);
  const F2 = W.buildForecast(30);
  const closeDay2 = F2.find(d=>d.date===W.addDays(W.today(),5));
  checkTrue('но в день закрытия деньги приходят как обычно', closeDay2.items.some(i=>i.deposit));

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
