/* =========================================================================
   ЯДРО: хранилище, модель данных, утилиты
   ========================================================================= */
const KEY = 'finapp_v2';

const ACC_TYPES = {
  debit:   {label:'Дебетовая карта', short:'дебетовая', icon:'▭', bg:'#ecebe7', asset:true},
  cash:    {label:'Наличные',        short:'наличные',  icon:'≡', bg:'#eaeee9', asset:true},
  deposit: {label:'Вклад / накопительный', short:'вклад', icon:'◫', bg:'#e9ebee', asset:true},
  credit_card:{label:'Кредитная карта', short:'кредитная', icon:'▤', bg:'#f0e8e5', asset:false},
  loan:    {label:'Кредит / ипотека',  short:'кредит',   icon:'⌂', bg:'#f0ece2', asset:false},
  installment:{label:'Рассрочка / сплит', short:'рассрочка', icon:'⊞', bg:'#ece9e4', asset:false},
  debt:    {label:'Прочий долг',       short:'долг',     icon:'§', bg:'#eceaee', asset:false}
};

/* Десять основных валют. Курс — сколько рублей за единицу. */
const CURRENCIES = {
  RUB: {sym:'₽',   name:'Рубль'},
  USD: {sym:'$',   name:'Доллар США'},
  EUR: {sym:'€',   name:'Евро'},
  CNY: {sym:'CN¥', name:'Китайский юань'},
  GBP: {sym:'£',   name:'Фунт стерлингов'},
  CHF: {sym:'CHF', name:'Швейцарский франк'},
  JPY: {sym:'¥',   name:'Японская иена'},
  KZT: {sym:'₸',   name:'Казахстанский тенге'},
  TRY: {sym:'₺',   name:'Турецкая лира'},
  AED: {sym:'AED', name:'Дирхам ОАЭ'}
};
const BASE = 'RUB';

/* Приглушённая палитра категорий: тона одной насыщенности, без кислотных цветов */
const PALETTE = ['#4a4844','#6f7a6c','#9b8564','#9b6b5e','#6d6a7d','#5f7378','#8a7080','#77806a',
                 '#a08268','#5c5f6b','#6b7d75','#8f6a66','#7a6c86','#63737f','#93855f','#78766f'];

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

const DEFAULT = {
  version: 2,
  accounts: [],
  transactions: [],
  categories: [
    // расходы — обязательные
    {id:'c_mortgage', name:'Ипотека',            kind:'expense', mandatory:true},
    {id:'c_loan',     name:'Платежи по кредитам',kind:'expense', mandatory:true},
    {id:'c_utility',  name:'ЖКХ',                kind:'expense', mandatory:true},
    {id:'c_food',     name:'Продукты',           kind:'expense', mandatory:true},
    {id:'c_transport',name:'Транспорт',          kind:'expense', mandatory:true},
    {id:'c_health',   name:'Здоровье и аптека',  kind:'expense', mandatory:true},
    {id:'c_comm',     name:'Связь и интернет',   kind:'expense', mandatory:true},
    {id:'c_tax',      name:'Налоги',             kind:'expense', mandatory:true},
    {id:'c_pets',     name:'Питомцы',            kind:'expense', mandatory:true},
    {id:'c_children', name:'Дети и образование', kind:'expense', mandatory:true},
    // расходы — необязательные
    {id:'c_cafe',     name:'Кафе и рестораны',   kind:'expense', mandatory:false},
    {id:'c_shopping', name:'Покупки и одежда',   kind:'expense', mandatory:false},
    {id:'c_beauty',   name:'Красота и уход',     kind:'expense', mandatory:false},
    {id:'c_fun',      name:'Развлечения',        kind:'expense', mandatory:false},
    {id:'c_subs',     name:'Подписки и сервисы', kind:'expense', mandatory:false},
    {id:'c_travel',   name:'Путешествия',        kind:'expense', mandatory:false},
    {id:'c_gifts',    name:'Подарки',            kind:'expense', mandatory:false},
    {id:'c_home',     name:'Дом и техника',      kind:'expense', mandatory:false},
    {id:'c_other_e',  name:'Прочие расходы',     kind:'expense', mandatory:false},
    // доходы
    {id:'c_salary',   name:'Зарплата',           kind:'income', mandatory:true},
    {id:'c_freelance',name:'Подработка / клиенты',kind:'income', mandatory:true},
    {id:'c_interest', name:'Проценты по вкладам',kind:'income', mandatory:true},
    {id:'c_sale',     name:'Продажи',            kind:'income', mandatory:false},
    {id:'c_refund',   name:'Возвраты и кэшбэк',  kind:'income', mandatory:false},
    {id:'c_other_i',  name:'Прочие поступления', kind:'income', mandatory:false}
  ],
  rules: [
    {id:'r1', match:'пятероч',   categoryId:'c_food'},
    {id:'r2', match:'магнит',    categoryId:'c_food'},
    {id:'r3', match:'перекрест', categoryId:'c_food'},
    {id:'r4', match:'лента',     categoryId:'c_food'},
    {id:'r5', match:'вкусвилл',  categoryId:'c_food'},
    {id:'r6', match:'яндекс.такси',categoryId:'c_transport'},
    {id:'r7', match:'озон',      categoryId:'c_shopping'},
    {id:'r8', match:'wildberries',categoryId:'c_shopping'},
    {id:'r9', match:'аптек',     categoryId:'c_health'},
    {id:'r10',match:'жкх',       categoryId:'c_utility'},
    {id:'r11',match:'зарплат',   categoryId:'c_salary'}
  ],
  recurring: [],
  profile: { name: '', avatar: '' },   // имя и фото пользователя
  planOverrides: {},                   // ручные правки плановых платежей
  settings: {
    minBuffer: 10000,
    /* Ориентировочные курсы — проверьте и поправьте в настройках.
       Приложение считает итоги, переводя всё в рубли. */
    rates: { RUB:1, USD:80, EUR:93, CNY:11, GBP:108, CHF:99, JPY:0.55, KZT:0.16, TRY:2.0, AED:22 },
    ratesUpdated: null
  }
};

var S = load();   // доступно в консоли браузера для отладки

function load(){
  try{
    const raw = localStorage.getItem(KEY);
    if(!raw){ const d = JSON.parse(JSON.stringify(DEFAULT)); localStorage.setItem(KEY, JSON.stringify(d)); return d; }
    const p = JSON.parse(raw);
    const merged = Object.assign({}, JSON.parse(JSON.stringify(DEFAULT)), p);
    ['accounts','transactions','categories','rules','recurring'].forEach(k=>{ if(!Array.isArray(merged[k])) merged[k]=[]; });
    return merged;
  }catch(e){
    console.error('Ошибка чтения данных', e);
    return JSON.parse(JSON.stringify(DEFAULT));
  }
}
function save(){
  try{
    localStorage.setItem(KEY, JSON.stringify(S));
    // помечаем данные изменёнными и отправляем в облако, если оно подключено
    if(typeof syncScheduleUpload === 'function') syncScheduleUpload();
  }
  catch(e){ toast('Не удалось сохранить: хранилище переполнено'); }
}

/* ---------------- форматирование ---------------- */
function money(n, opts){
  opts = opts || {};
  if(n===null || n===undefined || isNaN(n)) return '—';
  const abs = Math.abs(n);
  const dec = opts.cents ? 2 : 0;
  let s = abs.toLocaleString('ru-RU',{minimumFractionDigits:dec, maximumFractionDigits:dec});
  const sign = n<0 ? '−' : (opts.plus ? '+' : '');
  const cur = opts.cur || BASE;
  const sym = (CURRENCIES[cur] || {}).sym || cur;
  return sign + s + ' ' + sym;
}

/* ---------------- валюты ---------------- */
function rates(){
  const r = (S.settings && S.settings.rates) || {};
  return Object.assign({RUB:1}, r);
}
function rateOf(cur){
  const r = rates()[cur || BASE];
  return (typeof r === 'number' && r > 0) ? r : 1;
}
function accCurrency(a){
  if(typeof a === 'string') a = acc(a);
  return (a && a.currency) || BASE;
}
/* Перевод суммы в рубли — итоги считаются в одной валюте */
function toBase(amount, cur){
  return round2((Number(amount)||0) * rateOf(cur));
}
/* Сумма операции в рублях: валюта берётся у счёта */
function txBase(t){
  return toBase(t.amount, accCurrency(t.accountId));
}
/* Проценты по-русски: 3.9 → «3,9» */
function pct(n){
  if(n==null || isNaN(n)) return '0';
  return String(Number(n)).replace('.', ',');
}
function moneyShort(n){
  const a = Math.abs(n);
  const sign = n<0 ? '−' : '';
  if(a>=1000000) return sign + (a/1000000).toFixed(a>=10000000?0:1).replace('.',',') + ' млн';
  if(a>=10000)   return sign + Math.round(a/1000) + ' тыс';
  return money(n);
}
function iso(d){
  if(typeof d === 'string') return d.slice(0,10);
  const p = n => String(n).padStart(2,'0');
  return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate());
}
function today(){ return iso(new Date()); }
function parseISO(s){ const [y,m,d] = s.slice(0,10).split('-').map(Number); return new Date(y, m-1, d); }
function addDays(s, n){ const d = parseISO(s); d.setDate(d.getDate()+n); return iso(d); }
function addMonths(s, n){
  const d = parseISO(s); const day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth()+n);
  const last = new Date(d.getFullYear(), d.getMonth()+1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
}
const MONTHS = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
const MONTHS_N = ['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const DOW = ['вс','пн','вт','ср','чт','пт','сб'];
function dateShort(s){ const d = parseISO(s); return d.getDate()+' '+MONTHS[d.getMonth()].slice(0,3); }
function dateLong(s){ const d = parseISO(s); return d.getDate()+' '+MONTHS[d.getMonth()]+' '+d.getFullYear(); }
function monthKey(s){ return s.slice(0,7); }
function monthLabel(k){ const [y,m] = k.split('-'); return MONTHS_N[+m-1]+' '+y; }
function isWeekend(s){ const w = parseISO(s).getDay(); return w===0 || w===6; }
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/* ---------------- ручные правки плановых платежей ----------------
   Плановые строки никогда не исчезают сами. Пользователь может сдвинуть
   дату или изменить сумму конкретного платежа — правка живёт здесь. */
function planKey(kind, refId, date){ return kind + ':' + refId + '|' + date; }

function planOverride(key){
  if(!S.planOverrides) S.planOverrides = {};
  return S.planOverrides[key] || null;
}
function setPlanOverride(key, patch){
  if(!S.planOverrides) S.planOverrides = {};
  S.planOverrides[key] = Object.assign({}, S.planOverrides[key], patch);
  save(); renderAll();
}
function clearPlanOverride(key){
  if(S.planOverrides) delete S.planOverrides[key];
  save(); renderAll();
  toast('Правка отменена');
}

/* ---------------- срок кредита ---------------- */
/* Сколько платежей укладывается между первым и последним включительно */
function monthsUntil(from, to){
  if(!from || !to) return null;
  const a = parseISO(from), b = parseISO(to);
  const n = (b.getFullYear()-a.getFullYear())*12 + (b.getMonth()-a.getMonth()) + 1;
  return n > 0 ? n : null;
}
/* Обратная задача: за сколько месяцев закроется долг при известном платеже */
function termFromPayment(principal, annualRate, payment){
  principal = Number(principal)||0; payment = Number(payment)||0;
  if(principal <= 0 || payment <= 0) return null;
  const i = (Number(annualRate)||0)/100/12;
  if(i === 0) return Math.ceil(principal/payment);
  if(payment <= principal*i) return null;           // платёж не покрывает проценты
  return Math.ceil(-Math.log(1 - principal*i/payment) / Math.log(1+i));
}
/* Дата закрытия для показа в форме */
function payoffDateOf(a){
  if(!a) return '';
  if(a.payoffDate) return a.payoffDate;
  if(a.termMonths && a.nextPaymentDate) return addMonths(a.nextPaymentDate, a.termMonths - 1);
  return '';
}

/* ---------------- справочники ---------------- */
function acc(id){ return S.accounts.find(a=>a.id===id); }
function accName(id){ const a = acc(id); return a ? a.name : '—'; }
/* Название с типом: в одном банке бывают и карта, и вклад, и кредитка */
function accLabel(a){
  if(typeof a === 'string') a = acc(a);
  if(!a) return '—';
  const t = ACC_TYPES[a.type];
  return a.name + (t ? ' · ' + t.short : '');
}
function cat(id){ return S.categories.find(c=>c.id===id); }
function catName(id){ const c = cat(id); return c ? c.name : 'Без категории'; }
function catMandatory(id){ const c = cat(id); return c ? c.mandatory !== false : true; }
function catColor(id){
  const i = S.categories.findIndex(c=>c.id===id);
  return PALETTE[(i<0?0:i) % PALETTE.length];
}
function assetAccounts(){ return S.accounts.filter(a=>!a.archived && ACC_TYPES[a.type] && ACC_TYPES[a.type].asset); }
function debtAccounts(){ return S.accounts.filter(a=>!a.archived && ACC_TYPES[a.type] && !ACC_TYPES[a.type].asset); }
/* счета, из которых реально можно платить сегодня (для календаря) */
/* Вклад доступен к снятию?
   Если пользователь отметил галочку — верим ей. Для старых записей без
   галочки считаем доступным всё, кроме вкладов с будущей датой окончания. */
function depositIsLiquid(a){
  if(!a) return true;                                  // новый вклад — по умолчанию доступен
  if(a.liquid != null) return !!a.liquid;
  return !(a.endDate && a.endDate > today());
}

/* Деньги, доступные к тратам сегодня.
   Карты и наличные — всегда. Накопительный счёт (вклад без даты окончания)
   тоже: с него можно снять в любой момент. А срочный вклад с датой закрытия
   заперт до срока — он не в остатке, зато в календаре появится приходом
   в день закрытия. */
function liquidAccounts(){
  return S.accounts.filter(a => !a.archived && (
    a.type==='debit' || a.type==='cash' ||
    (a.type==='deposit' && depositIsLiquid(a))
  ));
}

/* ---------------- балансы ---------------- */
/* Для активов: openingBalance + доходы − расходы (+ переводы)
   Для долгов:  openingBalance (сумма долга) + начисления − погашения          */
/* Сколько списано/зачислено по операции на конкретном счёте.
   У перевода две стороны и, возможно, разные валюты. */
function txAmountFor(t, accountId){
  if(t.type === 'transfer' && t.toAccountId === accountId)
    return (t.toAmount != null ? t.toAmount : t.amount);
  return t.amount;
}

/* Остаток на дату (по умолчанию — на сегодня).
   Операции, датированные будущим, в текущий остаток не входят:
   они появятся в прогнозе календаря и учтутся, когда наступит их день.
   Иначе они считались бы дважды — и в остатке, и как будущее событие. */
function balance(a, upto){
  const limit = upto || today();

  /* Кредит: остаток считается по амортизации — каждый платёж сначала гасит
     начисленные проценты и только остатком уменьшает тело долга.
     Иначе карточка долга расходилась бы с графиком погашения. */
  if(a.type==='loan') return loanBalance(a, limit);

  let b = Number(a.openingBalance) || 0;
  const isAsset = ACC_TYPES[a.type] && ACC_TYPES[a.type].asset;
  for(const t of S.transactions){
    if(t.date > limit) continue;              // будущее — не сейчас
    if(t.type==='transfer'){
      if(t.accountId===a.id)   b += isAsset ? -t.amount : +t.amount;
      if(t.toAccountId===a.id){
        const got = txAmountFor(t, a.id);
        b += isAsset ? +got : -got;
      }
    } else if(t.accountId===a.id){
      if(isAsset) b += (t.type==='income' ? t.amount : -t.amount);
      else        b += (t.type==='income' ? -t.amount : t.amount);
    }
  }
  return b;
}
/* Пояснение для долговых счетов:
   - перевод НА долговой счёт (toAccountId) = погашение → долг уменьшается
   - перевод С долгового счёта (accountId)  = трата в долг (снятие с кредитки) → долг растёт
   - расход, оплаченный с долгового счёта   = долг растёт
   - «доход» на долговой счёт (редко)       = уменьшение долга                       */

/* Итоги — всегда в рублях: счета могут быть в разных валютах */
function totalLiquid(){ return liquidAccounts().reduce((s,a)=>s+toBase(balance(a), accCurrency(a)),0); }
function totalAssets(){ return assetAccounts().reduce((s,a)=>s+toBase(balance(a), accCurrency(a)),0); }
function totalDebt(){ return debtAccounts().reduce((s,a)=>s+Math.max(0,toBase(balance(a), accCurrency(a))),0); }
function netWorth(){ return totalAssets() - totalDebt(); }

/* ---------------- периоды ---------------- */
function periodRange(code){
  const n = new Date(), y = n.getFullYear(), m = n.getMonth();
  const first = (yy,mm)=> iso(new Date(yy,mm,1));
  const last  = (yy,mm)=> iso(new Date(yy,mm+1,0));
  switch(code){
    case 'thismonth': return [first(y,m), last(y,m)];
    case 'lastmonth': return [first(y,m-1), last(y,m-1)];
    case '3m':  return [first(y,m-2), last(y,m)];
    case '6m':  return [first(y,m-5), last(y,m)];
    case 'year':return [first(y,0), last(y,11)];
    default:    return ['1900-01-01','2999-12-31'];
  }
}
function txInRange(from, to){
  return S.transactions.filter(t=> t.date>=from && t.date<=to);
}

/* ---------------- UI утилиты ---------------- */
let toastTimer;
function toast(msg){
  const el = document.getElementById('toast');
  el.textContent = msg; el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>el.classList.remove('on'), 2400);
}
function openOv(id){ document.getElementById(id).classList.add('on'); }
function closeOv(id){ document.getElementById(id).classList.remove('on'); }
document.querySelectorAll('.ov').forEach(ov=>{
  ov.addEventListener('click', e=>{ if(e.target===ov) ov.classList.remove('on'); });
});

let CUR = 'home';
function go(name){
  CUR = name;
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  const el = document.getElementById('s-'+name);
  if(el) el.classList.add('active');
  document.querySelectorAll('.nv').forEach(b=>b.classList.toggle('on', b.dataset.s===name));
  window.scrollTo(0,0);
  renderAll();
}

/* =========================================================================
   СЧЕТА
   ========================================================================= */
function openAccount(id){
  const a = id ? acc(id) : null;
  const t = a ? a.type : 'debit';
  document.getElementById('ovAccBody').innerHTML = `
    <h3>${a ? 'Счёт: '+esc(a.name) : 'Новый счёт'}</h3>
    <div class="f">
      <label>Тип счёта</label>
      <select id="acType" onchange="accTypeFields()" ${a?'disabled':''}>
        ${Object.entries(ACC_TYPES).map(([k,v])=>`<option value="${k}" ${k===t?'selected':''}>${v.icon} ${v.label}</option>`).join('')}
      </select>
    </div>
    <div class="f2">
      <div class="f">
        <label>Название</label>
        <input type="text" id="acName" value="${a?esc(a.name):''}" placeholder="Например: Сбер зарплатная">
      </div>
      <div class="f">
        <label>Валюта</label>
        <select id="acCurrency">
          ${Object.entries(CURRENCIES).map(([code,c])=>
            `<option value="${code}" ${((a&&a.currency)||BASE)===code?'selected':''}>${code} · ${c.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="acFields"></div>
    <div class="btnrow" style="margin-top:14px">
      ${a?`<button class="btn btn-d" onclick="deleteAccount('${a.id}')">Удалить</button>`:''}
      <button class="btn btn-p" onclick="saveAccount(${a?"'"+a.id+"'":'null'})">Сохранить</button>
    </div>`;
  accTypeFields(a);
  openOv('ovAcc');
}

function accTypeFields(a){
  const type = document.getElementById('acType').value;
  const v = k => (a && a[k]!=null) ? a[k] : '';
  const box = document.getElementById('acFields');
  let html = '';

  if(type==='debit' || type==='cash'){
    html = `<div class="f"><label>Текущий остаток, ₽</label>
      <input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}">
      <div class="hint">Сколько сейчас на счёте. Дальше остаток считается по операциям.</div></div>`;
  }
  else if(type==='deposit'){
    html = `<div class="f"><label>Сумма на вкладе, ₽</label><input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}"></div>
      <div class="f2">
        <div class="f"><label>Ставка, % годовых</label><input type="number" step="0.01" id="acRate" value="${v('rate')||0}"></div>
        <div class="f"><label>Дата окончания</label><input type="date" id="acEndDate" value="${v('endDate')||''}"></div>
      </div>
      <label class="check"><input type="checkbox" id="acCapital" ${a&&a.capitalization?'checked':''}> Капитализация процентов</label>
      <label class="check"><input type="checkbox" id="acLiquid" ${depositIsLiquid(a)?'checked':''}>
        Деньги можно снять в любой момент</label>
      <div class="hint" style="margin:-6px 0 12px">
        Отмечено — вклад считается доступными деньгами и входит в остаток «Сейчас» в календаре.
        Снято — деньги заперты до даты окончания и появятся в календаре приходом в этот день.
      </div>
      <div class="f"><label>Проценты выплачиваются на счёт</label>
        <select id="acLinkAcc"><option value="">— не указан —</option>
        ${liquidAccounts().map(x=>`<option value="${x.id}" ${a&&a.linkAccountId===x.id?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div>`;
  }
  else if(type==='credit_card'){
    html = `<div class="f2">
        <div class="f"><label>Текущий долг, ₽</label><input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}"></div>
        <div class="f"><label>Кредитный лимит, ₽</label><input type="number" step="0.01" id="acLimit" value="${v('limit')||0}"></div>
      </div>
      <div class="f2">
        <div class="f"><label>Ставка, % годовых</label><input type="number" step="0.01" id="acRate" value="${v('rate')||0}">
          <div class="hint">Действует после льготного периода</div></div>
        <div class="f"><label>День платежа</label><input type="number" min="1" max="31" id="acPayDay" value="${v('paymentDay')||25}"></div>
      </div>

      <div class="sec-title" style="margin:14px 0 6px">Минимальный платёж</div>
      <div class="f2">
        <div class="f"><label>Процент от долга, %</label>
          <input type="number" step="0.1" id="acMinPct" value="${a&&a.minPercent!=null?a.minPercent:5}" placeholder="3,9">
          <div class="hint">Например 3,9</div></div>
        <div class="f"><label>Но не менее, ₽</label>
          <input type="number" step="0.01" id="acMinPay" value="${v('minPayment')||''}" placeholder="напр. 500">
          <div class="hint">Нижняя граница платежа</div></div>
      </div>

      <div class="sec-title" style="margin:14px 0 6px">Льготный период</div>
      <div class="f2">
        <div class="f"><label>Длительность, дней</label>
          <input type="number" id="acGraceDays" value="${v('gracePeriodDays')||''}" placeholder="напр. 55">
        </div>
        <div class="f"><label>Действует до</label>
          <input type="date" id="acGraceUntil" value="${v('graceUntil')||''}">
        </div>
      </div>
      <div class="hint" style="margin:-6px 0 12px">
        Пока льготный период не закончился, проценты не начисляются — если погасить весь долг до этой даты.
        Не успели — начисляется полная ставка, а платить придётся не менее указанного процента от долга.
        Достаточно заполнить любое одно поле: по количеству дней дата посчитается от сегодняшней.
      </div>`;
  }
  else if(type==='loan'){
    html = `<div class="f2">
        <div class="f"><label>Остаток долга, ₽</label><input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}"></div>
        <div class="f"><label>Ставка, % годовых</label><input type="number" step="0.01" id="acRate" value="${v('rate')||0}"></div>
      </div>
      <div class="f2">
        <div class="f"><label>Дата закрытия кредита</label>
          <input type="date" id="acPayoffDate" value="${payoffDateOf(a)}">
          <div class="hint">Когда внесёте последний платёж</div></div>
        <div class="f"><label>День платежа</label><input type="number" min="1" max="31" id="acPayDay" value="${v('paymentDay')||1}"></div>
      </div>
      <div class="f"><label>Дата ближайшего платежа</label><input type="date" id="acNextDate" value="${v('nextPaymentDate')||today()}"></div>
      <div class="f"><label>Ежемесячный платёж, ₽</label><input type="number" step="0.01" id="acPayment" value="${v('payment')||''}">
        <div class="hint">Достаточно заполнить что-то одно: дату закрытия или платёж — второе посчитается само.</div></div>
      <div class="f"><label>Источник графика</label>
        <select id="acSchedMode">
          <option value="auto" ${v('scheduleMode')!=='manual'?'selected':''}>Рассчитывать автоматически</option>
          <option value="manual" ${v('scheduleMode')==='manual'?'selected':''}>Использовать график банка (введу вручную)</option>
        </select></div>`;
  }
  else if(type==='installment'){
    html = `<div class="f2">
        <div class="f"><label>Остаток долга, ₽</label><input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}"></div>
        <div class="f"><label>Осталось платежей</label><input type="number" min="1" id="acParts" value="${v('partsLeft')||''}" placeholder="напр. 4"></div>
      </div>
      <div class="f2">
        <div class="f"><label>Периодичность</label>
          <select id="acFreq">
            <option value="biweekly" ${v('freq')==='biweekly'?'selected':''}>Раз в 2 недели</option>
            <option value="monthly" ${v('freq')!=='biweekly'?'selected':''}>Ежемесячно</option>
          </select></div>
        <div class="f"><label>Дата ближайшего платежа</label>
          <input type="date" id="acNextDate" value="${v('nextPaymentDate')||today()}"></div>
      </div>
      <div class="f"><label>Размер платежа, ₽</label>
        <input type="number" step="0.01" id="acPayment" value="${v('payment')||''}">
        <div class="hint">Оставьте пустым — поделю остаток на число платежей поровну.</div></div>
      <div class="hint" style="margin:-4px 0 12px">
        Рассрочка обычно без процентов: платежи равные, переплаты нет.
        Если банк берёт комиссию, впишите её в размер платежа.
      </div>`;
  }
  else if(type==='debt'){
    html = `<div class="f"><label>Сумма долга, ₽</label><input type="number" step="0.01" id="acOpening" value="${v('openingBalance')||0}"></div>
      <div class="f"><label>Срок возврата</label><input type="date" id="acDueDate" value="${v('dueDate')||''}"></div>`;
  }
  html += `<div class="f"><label>Заметка</label><input type="text" id="acNote" value="${v('note')?esc(a.note):''}" placeholder="необязательно"></div>`;
  box.innerHTML = html;
}

function saveAccount(id){
  const g = i => { const e = document.getElementById(i); return e ? e.value : ''; };
  const gn = i => { const e = document.getElementById(i); return e && e.value!=='' ? parseFloat(e.value) : null; };
  const gb = i => { const e = document.getElementById(i); return e ? e.checked : false; };

  const name = g('acName').trim();
  if(!name){ toast('Укажите название счёта'); return; }
  const type = g('acType');

  let a = id ? acc(id) : {id:uid(), type, archived:false};
  a.name = name;
  a.currency = g('acCurrency') || BASE;
  a.openingBalance = gn('acOpening') || 0;
  a.note = g('acNote');

  if(type==='deposit'){
    a.rate = gn('acRate'); a.endDate = g('acEndDate');
    a.capitalization = gb('acCapital'); a.linkAccountId = g('acLinkAcc');
    a.liquid = gb('acLiquid');       // доступен ли к снятию прямо сейчас
  }
  if(type==='credit_card'){
    a.limit = gn('acLimit'); a.rate = gn('acRate');
    a.paymentDay = gn('acPayDay') || 25;
    a.minPayment = gn('acMinPay');                    // нижняя граница платежа, ₽
    a.minPercent = gn('acMinPct');                    // процент от долга
    if(a.minPercent==null) a.minPercent = 5;
    a.gracePeriodDays = gn('acGraceDays');
    a.graceUntil = g('acGraceUntil') || null;
    // если указали только длительность — считаем дату окончания от сегодняшнего дня
    if(!a.graceUntil && a.gracePeriodDays) a.graceUntil = addDays(today(), a.gracePeriodDays);
  }
  if(type==='loan'){
    a.rate = gn('acRate');
    a.paymentDay = gn('acPayDay') || 1;
    a.nextPaymentDate = g('acNextDate') || today();
    a.payoffDate = g('acPayoffDate') || null;
    a.payment = gn('acPayment');
    a.scheduleMode = g('acSchedMode');
    if(!a.manualSchedule) a.manualSchedule = [];

    // срок в месяцах выводим из даты закрытия — она понятнее пользователю
    a.termMonths = a.payoffDate ? monthsUntil(a.nextPaymentDate, a.payoffDate) : null;

    // что не заполнили — посчитаем: платёж из срока или срок из платежа
    if(!a.payment && a.rate!=null && a.termMonths) {
      a.payment = annuity(a.openingBalance, a.rate, a.termMonths);
    } else if(a.payment && !a.termMonths) {
      a.termMonths = termFromPayment(a.openingBalance, a.rate, a.payment);
      if(a.termMonths) a.payoffDate = addMonths(a.nextPaymentDate, a.termMonths - 1);
    }
  }
  if(type==='installment'){
    a.partsLeft = gn('acParts');
    a.freq = g('acFreq') || 'monthly';
    a.nextPaymentDate = g('acNextDate') || today();
    a.payment = gn('acPayment');
    // без процентов: чего не хватает — досчитаем
    if(!a.payment && a.partsLeft) a.payment = round2(a.openingBalance / a.partsLeft);
    if(!a.partsLeft && a.payment) a.partsLeft = Math.ceil(a.openingBalance / a.payment);
  }
  if(type==='debt'){ a.dueDate = g('acDueDate'); }

  if(!id) S.accounts.push(a);
  save(); closeOv('ovAcc'); renderAll();
  toast(id ? 'Счёт обновлён' : 'Счёт добавлен');
}

function deleteAccount(id){
  const n = S.transactions.filter(t=>t.accountId===id||t.toAccountId===id).length;
  if(!confirm(n ? `У счёта ${n} операц. Они тоже будут удалены. Продолжить?` : 'Удалить счёт?')) return;
  S.accounts = S.accounts.filter(a=>a.id!==id);
  S.transactions = S.transactions.filter(t=>t.accountId!==id && t.toAccountId!==id);
  S.recurring = S.recurring.filter(r=>r.accountId!==id);
  save(); closeOv('ovAcc'); renderAll(); toast('Счёт удалён');
}

function renderAccounts(){
  const box = document.getElementById('accGroups');
  if(S.accounts.length===0){
    box.innerHTML = `<div class="card"><div class="empty"><span class="big">▦</span>
      Пока нет ни одного счёта.<br>Добавьте карты, наличные, вклады и кредиты — приложение начнёт считать баланс и строить календарь.</div></div>`;
    return;
  }
  const groups = [
    ['Свои деньги', ['debit','cash','deposit']],
    ['Обязательства', ['credit_card','installment','loan','debt']]
  ];
  box.innerHTML = groups.map(([title, types])=>{
    const list = S.accounts.filter(a=>types.includes(a.type) && !a.archived);
    if(!list.length) return '';
    const sum = list.reduce((s,a)=>s+toBase(balance(a), accCurrency(a)),0);
    return `<div class="sec-title">${title} · <span style="text-transform:none;letter-spacing:0">${money(sum)}</span></div>
      <div class="card">${list.map(accRow).join('')}</div>`;
  }).join('');
}

function accRow(a){
  const T = ACC_TYPES[a.type]; const b = balance(a);
  const isAsset = T.asset;
  let sub = T.label;
  if(a.type==='credit_card' && a.limit) sub += ` · доступно ${money(Math.max(0,a.limit-b))}`;
  if(a.type==='loan' && a.payment) sub += ` · платёж ${money(a.payment)}`;
  if(a.type==='loan'){ const pd = payoffDateOf(a); if(pd) sub += ` · до ${dateShort(pd)} ${parseISO(pd).getFullYear()}`; }
  if(a.type==='deposit'){
    if(a.rate) sub += ` · ${pct(a.rate)}% годовых`;
    sub += depositIsLiquid(a) ? ' · доступен' : ` · заперт до ${a.endDate?dateShort(a.endDate):'срока'}`;
  }
  if(a.type==='installment'){
    const left = installmentPartsLeft(a);
    if(left) sub += ` · ${left} ${plural(left,'платёж','платежа','платежей')} по ${money(a.payment||0)}`;
  }
  if(a.type==='debt' && a.dueDate) sub += ` · до ${dateShort(a.dueDate)}`;
  const cur = accCurrency(a);
  const inBase = cur !== BASE ? `<div style="font-size:11px;color:var(--muted);font-weight:500">${money(toBase(b,cur))}</div>` : '';
  return `<div class="acc" onclick="openAccount('${a.id}')">
    <div class="ico" style="background:${T.bg}">${T.icon}</div>
    <div class="l"><div class="nm">${esc(a.name)}</div><div class="sb">${sub}</div></div>
    <div class="bal ${isAsset ? (b<0?'neg':'') : 'neg'}">${money(b,{cur})}${inBase}</div>
  </div>`;
}

/* =========================================================================
   ОПЕРАЦИИ
   ========================================================================= */
function openTx(id){
  const t = id ? S.transactions.find(x=>x.id===id) : null;
  if(S.accounts.length===0){
    toast('Сначала добавьте хотя бы один счёт'); go('accounts'); return;
  }
  document.getElementById('ovTxBody').innerHTML = `
    <h3>${t ? 'Операция' : 'Новая операция'}</h3>
    <div class="seg" id="txSeg">
      <button data-t="expense" onclick="txKind('expense')">Расход</button>
      <button data-t="income"  onclick="txKind('income')">Доход</button>
      <button data-t="transfer"onclick="txKind('transfer')">Перевод</button>
    </div>
    <div class="f2">
      <div class="f"><label>Дата</label><input type="date" id="txDate" value="${t?t.date:today()}"></div>
      <div class="f"><label>Сумма, ₽</label><input type="number" step="0.01" inputmode="decimal" id="txAmount" value="${t?t.amount:''}" placeholder="0"></div>
    </div>
    <div class="f"><label id="txAccLabel">Счёт</label><select id="txAccount"></select></div>
    <div class="f" id="txToWrap" style="display:none"><label>Куда</label><select id="txTo" onchange="txCurrencyCheck()"></select>
      <div class="hint" id="txToHint"></div></div>
    <div class="f" id="txToAmountWrap" style="display:none">
      <label id="txToAmountLabel">Сумма зачисления</label>
      <input type="number" step="0.01" id="txToAmount" placeholder="0">
      <div class="hint">Счета в разных валютах — укажите, сколько пришло на второй счёт.</div>
    </div>
    <div class="f" id="txCatWrap"><label>Категория</label><select id="txCategory"></select></div>
    <div class="f"><label>Описание</label><input type="text" id="txNote" value="${t?esc(t.note||''):''}" placeholder="необязательно"></div>

    <label class="check" id="txRepeatWrap">
      <input type="checkbox" id="txRepeat" onchange="txRepeatToggle()">
      Регулярный платёж — повторять дальше
    </label>
    <div id="txRepeatBox" style="display:none">
      <div class="f2">
        <div class="f"><label>Как часто</label>
          <select id="txRepeatFreq">
            <option value="monthly">Ежемесячно</option>
            <option value="biweekly">Раз в 2 недели</option>
            <option value="weekly">Еженедельно</option>
            <option value="quarterly">Раз в квартал</option>
            <option value="yearly">Раз в год</option>
          </select></div>
        <div class="f"><label>Повторять до</label>
          <input type="date" id="txRepeatUntil">
          <div class="hint">Пусто — бессрочно</div></div>
      </div>
      <label class="check"><input type="checkbox" id="txRepeatShift">
        Переносить с выходных на будний день</label>
      <div class="hint" id="txRepeatHint" style="margin:-6px 0 12px"></div>
    </div>
    <div class="btnrow" style="margin-top:6px">
      ${t?`<button class="btn btn-d" onclick="deleteTx('${t.id}')">Удалить</button>`:''}
      <button class="btn btn-p" onclick="saveTx(${t?"'"+t.id+"'":'null'})">Сохранить</button>
    </div>`;
  txKind(t ? t.type : 'expense', t);
  const amtEl = document.getElementById('txAmount');
  if(amtEl) amtEl.addEventListener('input', txCurrencyCheck);
  const dEl = document.getElementById('txDate');
  if(dEl) dEl.addEventListener('change', txRepeatToggle);
  const fEl = document.getElementById('txRepeatFreq');
  if(fEl) fEl.addEventListener('change', txRepeatToggle);
  const toAmtEl = document.getElementById('txToAmount');
  if(toAmtEl) toAmtEl.addEventListener('input', ()=>{ toAmtEl.dataset.touched = '1'; });
  const accEl = document.getElementById('txAccount');
  if(accEl) accEl.addEventListener('change', txCurrencyCheck);
  if(t && t.toAmount != null){
    const f = document.getElementById('txToAmount');
    if(f){ f.value = t.toAmount; f.dataset.touched = '1'; }
  }
  openOv('ovTx');
}

/* Показать настройки повторения и подсказать, с какой даты оно начнётся */
function txRepeatToggle(){
  const on = document.getElementById('txRepeat').checked;
  const box = document.getElementById('txRepeatBox');
  box.style.display = on ? 'block' : 'none';
  if(!on) return;

  const d = document.getElementById('txDate').value || today();
  const freq = document.getElementById('txRepeatFreq').value;
  const next = nextRecDate(d, freq);
  const hint = document.getElementById('txRepeatHint');
  if(hint) hint.textContent =
    `Эта операция уже записана на ${dateLong(d)}. Повторы начнутся со следующего раза — ${dateLong(next)}.`;
}

/* Открыть окно операции сразу на переводе между своими счетами */
function openTransfer(){
  if(S.accounts.filter(a=>!a.archived).length < 2){
    toast('Нужно минимум два счёта'); go('accounts'); return;
  }
  openTx();
  txKind('transfer');
}

let TXKIND = 'expense';
function txKind(k, t){
  TXKIND = k;
  document.querySelectorAll('#txSeg button').forEach(b=>b.classList.toggle('on', b.dataset.t===k));
  const accSel = document.getElementById('txAccount');
  const toSel  = document.getElementById('txTo');
  const opts = list => list.map(a=>`<option value="${a.id}">${esc(accLabel(a))}</option>`).join('');

  if(k==='transfer'){
    document.getElementById('txAccLabel').textContent = 'Откуда';
    accSel.innerHTML = opts(S.accounts.filter(a=>!a.archived));
    toSel.innerHTML  = opts(S.accounts.filter(a=>!a.archived));
    document.getElementById('txToWrap').style.display = 'block';
    document.getElementById('txCatWrap').style.display = 'none';
    document.getElementById('txToHint').textContent =
      'Перевод на кредит или кредитку = погашение долга. Перевод с кредитки на карту = снятие в долг.';
    const rw = document.getElementById('txRepeatWrap');
    const rb = document.getElementById('txRepeatBox');
    if(rw) rw.style.display = 'none';
    if(rb) rb.style.display = 'none';
  } else {
    const rw = document.getElementById('txRepeatWrap');
    if(rw) rw.style.display = 'flex';
    document.getElementById('txAccLabel').textContent = k==='income' ? 'Куда зачислено' : 'Чем оплачено';
    accSel.innerHTML = opts(S.accounts.filter(a=>!a.archived && (ACC_TYPES[a.type].asset || a.type==='credit_card')));
    document.getElementById('txToWrap').style.display = 'none';
    document.getElementById('txCatWrap').style.display = 'block';
    const cats = S.categories.filter(c=>c.kind===k);
    document.getElementById('txCategory').innerHTML =
      cats.map(c=>`<option value="${c.id}">${esc(c.name)}${c.mandatory===false?' •':''}</option>`).join('');
  }
  if(t){
    if(t.accountId) accSel.value = t.accountId;
    if(t.toAccountId && toSel) toSel.value = t.toAccountId;
    const cs = document.getElementById('txCategory');
    if(t.categoryId && cs) cs.value = t.categoryId;
  }
  txCurrencyCheck();
}

/* Показываем второе поле суммы, только если валюты сторон различаются */
function txCurrencyCheck(){
  const wrap = document.getElementById('txToAmountWrap');
  if(!wrap) return;
  if(TXKIND !== 'transfer'){ wrap.style.display = 'none'; return; }

  const from = document.getElementById('txAccount').value;
  const to   = document.getElementById('txTo').value;
  const cf = accCurrency(from), ct = accCurrency(to);

  if(cf === ct){ wrap.style.display = 'none'; return; }

  wrap.style.display = 'block';
  document.getElementById('txToAmountLabel').textContent =
    `Сумма зачисления, ${(CURRENCIES[ct]||{}).sym || ct}`;

  // подставляем пересчёт по текущему курсу — можно поправить руками
  const amt = parseFloat(document.getElementById('txAmount').value);
  const field = document.getElementById('txToAmount');
  if(amt > 0 && !field.dataset.touched){
    field.value = round2(toBase(amt, cf) / rateOf(ct));
  }
  const label = document.getElementById('txAccLabel');
  if(label) label.textContent = `Откуда, ${(CURRENCIES[cf]||{}).sym || cf}`;
}

function saveTx(id){
  const amount = parseFloat(document.getElementById('txAmount').value);
  if(!amount || amount<=0){ toast('Введите сумму'); return; }
  const date = document.getElementById('txDate').value || today();
  const accountId = document.getElementById('txAccount').value;
  const note = document.getElementById('txNote').value.trim();

  const rec = {
    id: id || uid(), date, type: TXKIND, accountId, amount,
    note, source: 'manual'
  };
  if(TXKIND==='transfer'){
    rec.toAccountId = document.getElementById('txTo').value;
    if(rec.toAccountId === accountId){ toast('Выберите разные счета'); return; }
    // разные валюты — сумма зачисления своя
    if(accCurrency(accountId) !== accCurrency(rec.toAccountId)){
      const ta = parseFloat(document.getElementById('txToAmount').value);
      if(!ta || ta <= 0){ toast('Укажите сумму зачисления'); return; }
      rec.toAmount = ta;
    } else {
      rec.toAmount = null;
    }
  } else {
    rec.categoryId = document.getElementById('txCategory').value;
  }

  if(id){
    const i = S.transactions.findIndex(t=>t.id===id);
    S.transactions[i] = Object.assign(S.transactions[i], rec);
  } else {
    S.transactions.push(rec);
  }

  /* Отмечена галочка «регулярный» — заводим повторяющееся начисление.
     Первый повтор ставим на следующий период: сама операция уже записана,
     иначе она посчиталась бы в календаре дважды. */
  let repeated = null;
  const repEl = document.getElementById('txRepeat');
  if(!id && repEl && repEl.checked && TXKIND !== 'transfer'){
    const freq = document.getElementById('txRepeatFreq').value;
    const until = document.getElementById('txRepeatUntil').value || null;
    const startDate = nextRecDate(date, freq);
    if(!until || startDate <= until){
      repeated = {
        id: uid(),
        name: note || catName(rec.categoryId),
        amount, kind: TXKIND, freq,
        startDate, endDate: until,
        accountId, categoryId: rec.categoryId,
        shiftWeekend: document.getElementById('txRepeatShift').checked,
        active: true,
        fromTxId: rec.id
      };
      S.recurring.push(repeated);
    }
  }

  save(); closeOv('ovTx'); renderAll();
  toast(id ? 'Операция обновлена'
           : (repeated ? 'Добавлено, повтор с ' + dateLong(repeated.startDate) : 'Операция добавлена'));
}

function deleteTx(id){
  if(!confirm('Удалить операцию?')) return;
  S.transactions = S.transactions.filter(t=>t.id!==id);
  save(); closeOv('ovTx'); renderAll(); toast('Удалено');
}

function renderTx(){
  const [from,to] = periodRange(document.getElementById('fltPeriod').value);
  const accF = document.getElementById('fltAccount').value;
  const q = document.getElementById('fltSearch').value.trim().toLowerCase();

  let list = txInRange(from,to);
  if(accF) list = list.filter(t=>t.accountId===accF || t.toAccountId===accF);
  if(q) list = list.filter(t =>
    (t.note||'').toLowerCase().includes(q) || catName(t.categoryId).toLowerCase().includes(q));
  list.sort((a,b)=> b.date.localeCompare(a.date) || (b.id>a.id?1:-1));

  const inc = list.filter(t=>t.type==='income').reduce((s,t)=>s+txBase(t),0);
  const exp = list.filter(t=>t.type==='expense').reduce((s,t)=>s+txBase(t),0);
  document.getElementById('txInc').textContent = moneyShort(inc);
  document.getElementById('txExp').textContent = moneyShort(exp);
  const net = document.getElementById('txNet');
  net.textContent = moneyShort(inc-exp);
  net.className = 'n ' + (inc-exp>=0?'pos':'neg');
  document.getElementById('txCount').textContent = 'Операции · ' + list.length;

  const box = document.getElementById('txList');
  if(!list.length){ box.innerHTML = `<div class="empty"><span class="big">☰</span>Операций за этот период нет.</div>`; return; }

  let html = '', lastDate = '';
  for(const t of list.slice(0,400)){
    if(t.date!==lastDate){
      lastDate = t.date;
      html += `<div style="font-size:11.5px;color:var(--muted);font-weight:650;padding:10px 0 3px">${dateLong(t.date)}, ${DOW[parseISO(t.date).getDay()]}</div>`;
    }
    html += txRow(t);
  }
  if(list.length>400) html += `<div class="empty">Показаны первые 400 операций из ${list.length}. Уточните фильтр.</div>`;
  box.innerHTML = html;
}

function txRow(t){
  let title, sign, cls, sub;
  if(t.type==='transfer'){
    title = 'Перевод'; sign=''; cls='mut';
    sub = accLabel(t.accountId)+' → '+accLabel(t.toAccountId);
  } else {
    title = catName(t.categoryId);
    sign = t.type==='income' ? '+' : '−';
    cls = t.type==='income' ? 'pos' : 'neg';
    sub = accName(t.accountId);
  }
  if(t.note) sub = esc(t.note) + ' · ' + sub;
  const optChip = (t.type==='expense' && !catMandatory(t.categoryId)) ? ' <span class="chip opt">необяз</span>' : '';
  /* Будущая дата — операция ещё не влияет на текущий остаток, только на прогноз */
  const planChip = t.date > today() ? ' <span class="chip info">план</span>' : '';
  return `<div class="row" onclick="openTx('${t.id}')" style="cursor:pointer">
    <div class="l"><div class="t">${esc(title)}${optChip}${planChip}</div><div class="s">${sub}</div></div>
    <div class="v ${cls}">${sign}${money(t.amount,{cur:accCurrency(t.accountId)})}${
      t.type==='transfer' && t.toAmount != null
        ? ` → ${money(t.toAmount,{cur:accCurrency(t.toAccountId)})}` : ''}</div>
  </div>`;
}

function exportCSV(){
  const rows = [['Дата','Тип','Счёт','Категория','Сумма','Описание']];
  const sorted = [...S.transactions].sort((a,b)=>a.date.localeCompare(b.date));
  for(const t of sorted){
    rows.push([
      t.date,
      t.type==='income'?'Доход':t.type==='expense'?'Расход':'Перевод',
      accName(t.accountId) + (t.type==='transfer' ? ' → '+accName(t.toAccountId) : ''),
      t.type==='transfer' ? '' : catName(t.categoryId),
      String(t.amount).replace('.',','),
      (t.note||'')
    ]);
  }
  const csv = '﻿' + rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(';')).join('\n');
  download(csv, 'operacii_'+today()+'.csv', 'text/csv;charset=utf-8');
}
function download(content, filename, mime){
  const blob = new Blob([content], {type: mime||'application/octet-stream'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 1500);
}

/* =========================================================================
   КАТЕГОРИИ
   ========================================================================= */
let CATTAB = 'expense';
function setCatTab(k){
  CATTAB = k;
  document.querySelectorAll('#catTabs button').forEach(b=>b.classList.toggle('on', b.dataset.k===k));
  renderCategories();
}
function renderCategories(){
  const list = S.categories.filter(c=>c.kind===CATTAB);
  document.getElementById('catList').innerHTML = list.map(c=>`
    <div class="row">
      <div class="l" onclick="openCategory('${c.id}')" style="cursor:pointer">
        <div class="t"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${catColor(c.id)};margin-right:6px"></span>${esc(c.name)}</div>
        <div class="s">${c.mandatory===false?'можно сократить':'обязательная'}</div>
      </div>
      <label class="check" style="margin:0" title="Необязательная">
        <input type="checkbox" ${c.mandatory===false?'checked':''} onchange="toggleMandatory('${c.id}', this.checked)">
        <span style="font-size:12px;color:var(--muted)">необяз.</span>
      </label>
    </div>`).join('');
}
function toggleMandatory(id, optional){
  const c = cat(id); if(!c) return;
  c.mandatory = !optional; save(); renderAll();
}
function openCategory(id){
  const c = id ? cat(id) : null;
  document.getElementById('ovCatBody').innerHTML = `
    <h3>${c?'Категория':'Новая категория'}</h3>
    <div class="f"><label>Название</label><input type="text" id="ctName" value="${c?esc(c.name):''}"></div>
    <div class="f"><label>Тип</label>
      <select id="ctKind" ${c?'disabled':''}>
        <option value="expense" ${(!c||c.kind==='expense')?'selected':''}>Расход</option>
        <option value="income"  ${c&&c.kind==='income'?'selected':''}>Доход</option>
      </select></div>
    <label class="check"><input type="checkbox" id="ctOpt" ${c&&c.mandatory===false?'checked':''}>
      Необязательная — можно сократить</label>
    <div class="btnrow">
      ${c?`<button class="btn btn-d" onclick="deleteCategory('${c.id}')">Удалить</button>`:''}
      <button class="btn btn-p" onclick="saveCategory(${c?"'"+c.id+"'":'null'})">Сохранить</button>
    </div>`;
  openOv('ovCat');
}
function saveCategory(id){
  const name = document.getElementById('ctName').value.trim();
  if(!name){ toast('Введите название'); return; }
  const kind = document.getElementById('ctKind').value;
  const mandatory = !document.getElementById('ctOpt').checked;
  if(id){ const c = cat(id); c.name = name; c.mandatory = mandatory; }
  else S.categories.push({id:uid(), name, kind, mandatory});
  save(); closeOv('ovCat'); setCatTab(kind); renderAll(); toast('Сохранено');
}
function deleteCategory(id){
  const n = S.transactions.filter(t=>t.categoryId===id).length;
  if(n){ toast(`Нельзя удалить: используется в ${n} операц.`); return; }
  S.categories = S.categories.filter(c=>c.id!==id);
  S.rules = S.rules.filter(r=>r.categoryId!==id);
  save(); closeOv('ovCat'); renderAll(); toast('Удалено');
}

/* =========================================================================
   РЕЗЕРВНАЯ КОПИЯ
   ========================================================================= */
function backupData(){
  download(JSON.stringify(S,null,2), 'finansy_backup_'+today()+'.json', 'application/json');
  toast('Копия сохранена');
}
document.getElementById('restoreInput').addEventListener('change', e=>{
  const f = e.target.files[0]; if(!f) return;
  const r = new FileReader();
  r.onload = () => {
    try{
      const d = JSON.parse(r.result);
      if(!d || !Array.isArray(d.accounts)) throw new Error('bad');
      if(!confirm('Текущие данные будут заменены. Продолжить?')) return;
      S = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), d);
      save(); renderAll(); toast('Данные восстановлены');
    }catch(err){ toast('Не удалось прочитать файл копии'); }
  };
  r.readAsText(f);
  e.target.value = '';
});
function wipeData(){
  if(!confirm('Удалить ВСЕ данные без возможности восстановления?')) return;
  if(!confirm('Точно? Сделайте резервную копию, если ещё не сделали.')) return;
  localStorage.removeItem(KEY);
  S = load(); renderAll(); toast('Данные очищены');
}


/* =========================================================================
   КУРСЫ ВАЛЮТ
   ========================================================================= */
function renderRates(){
  const box = document.getElementById('ratesBody');
  if(!box) return;
  const r = rates();
  const upd = S.settings && S.settings.ratesUpdated;

  box.innerHTML = Object.entries(CURRENCIES)
    .filter(([code]) => code !== BASE)
    .map(([code,c])=>`
      <div class="row">
        <div class="l"><div class="t">${code} · ${esc(c.name)}</div>
          <div class="s">1 ${c.sym} = столько рублей</div></div>
        <input type="number" step="0.0001" style="width:110px;padding:7px;border:1px solid var(--line);
          border-radius:8px;background:#faf9f7;text-align:right"
          value="${r[code] != null ? r[code] : ''}" onchange="saveRate('${code}', this.value)">
      </div>`).join('') +
    `<div style="font-size:12px;color:var(--muted);margin-top:10px">
       ${upd ? 'Обновлено: ' + dateLong(upd.slice(0,10)) : 'Курсы заданы примерно — проверьте перед расчётами.'}
     </div>`;
}

function saveRate(code, value){
  const v = parseFloat(String(value).replace(',','.'));
  if(!S.settings.rates) S.settings.rates = {};
  if(!isFinite(v) || v <= 0){ toast('Курс должен быть больше нуля'); renderRates(); return; }
  S.settings.rates[code] = v;
  save(); renderAll();
  toast(code + ': курс сохранён');
}

/* Свежие курсы из открытого источника. Не получилось — правим вручную. */
async function fetchRates(){
  toast('Запрашиваю курсы…');
  try{
    const res = await fetch('https://open.er-api.com/v6/latest/RUB');
    if(!res.ok) throw new Error('источник недоступен');
    const data = await res.json();
    if(!data || !data.rates) throw new Error('пустой ответ');

    if(!S.settings.rates) S.settings.rates = {};
    let n = 0;
    for(const code of Object.keys(CURRENCIES)){
      if(code === BASE) continue;
      const perRub = data.rates[code];          // сколько валюты за 1 рубль
      if(perRub && perRub > 0){
        S.settings.rates[code] = round2(1 / perRub);   // сколько рублей за единицу
        n++;
      }
    }
    S.settings.rates.RUB = 1;
    S.settings.ratesUpdated = new Date().toISOString();
    save(); renderAll();
    toast(`Обновлено курсов: ${n}`);
  }catch(e){
    console.error('rates', e);
    toast('Не удалось получить курсы — впишите вручную');
  }
}
