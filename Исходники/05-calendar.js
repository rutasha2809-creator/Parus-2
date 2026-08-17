/* =========================================================================
   ПЛАТЁЖНЫЙ КАЛЕНДАРЬ: регулярные платежи + прогноз по дням
   ========================================================================= */

const FREQ = {
  monthly:  'Ежемесячно',
  weekly:   'Еженедельно',
  biweekly: 'Раз в 2 недели',
  quarterly:'Раз в квартал',
  yearly:   'Раз в год',
  once:     'Однократно'
};

function openRecurring(id){
  const r = id ? S.recurring.find(x=>x.id===id) : null;
  if(!S.accounts.length){ toast('Сначала добавьте счёт'); go('accounts'); return; }
  const accs = S.accounts.filter(a=>!a.archived && (ACC_TYPES[a.type].asset || a.type==='credit_card'));
  document.getElementById('ovRecBody').innerHTML = `
    <h3>${r?'Регулярный платёж':'Новый регулярный платёж'}</h3>
    <div class="seg sm" id="recSeg">
      <button data-t="expense" onclick="recKind('expense')">Расход</button>
      <button data-t="income"  onclick="recKind('income')">Доход</button>
    </div>
    <div class="f"><label>Название</label><input type="text" id="rcName" value="${r?esc(r.name):''}" placeholder="напр. Зарплата / ЖКХ / Подписка"></div>
    <div class="f2">
      <div class="f"><label>Сумма, ₽</label><input type="number" step="0.01" id="rcAmount" value="${r?r.amount:''}"></div>
      <div class="f"><label>Периодичность</label>
        <select id="rcFreq">${Object.entries(FREQ).map(([k,v])=>`<option value="${k}" ${r&&r.freq===k?'selected':''}>${v}</option>`).join('')}</select></div>
    </div>
    <div class="f2">
      <div class="f"><label>Первая дата</label><input type="date" id="rcStart" value="${r?r.startDate:today()}"></div>
      <div class="f"><label>Действует до</label><input type="date" id="rcEnd" value="${r&&r.endDate?r.endDate:''}"></div>
    </div>
    <div class="f"><label>Счёт</label>
      <select id="rcAcc">${accs.map(a=>`<option value="${a.id}" ${r&&r.accountId===a.id?'selected':''}>${esc(accLabel(a))}</option>`).join('')}</select></div>
    <div class="f"><label>Категория</label><select id="rcCat"></select></div>
    <label class="check"><input type="checkbox" id="rcWork" ${r&&r.shiftWeekend?'checked':''}>
      Переносить с выходных на ближайший будний день</label>
    <div class="btnrow">
      ${r?`<button class="btn btn-d" onclick="deleteRecurring('${r.id}')">Удалить</button>`:''}
      <button class="btn btn-p" onclick="saveRecurring(${r?"'"+r.id+"'":'null'})">Сохранить</button>
    </div>`;
  recKind(r ? r.kind : 'expense', r);
  openOv('ovRec');
}
let RECKIND = 'expense';
function recKind(k, r){
  RECKIND = k;
  document.querySelectorAll('#recSeg button').forEach(b=>b.classList.toggle('on', b.dataset.t===k));
  const sel = document.getElementById('rcCat');
  sel.innerHTML = S.categories.filter(c=>c.kind===k)
    .map(c=>`<option value="${c.id}">${esc(c.name)}${c.mandatory===false?' •':''}</option>`).join('');
  if(r && r.categoryId) sel.value = r.categoryId;
}
function saveRecurring(id){
  const name = document.getElementById('rcName').value.trim();
  const amount = parseFloat(document.getElementById('rcAmount').value);
  if(!name){ toast('Введите название'); return; }
  if(!amount || amount<=0){ toast('Введите сумму'); return; }
  const rec = {
    id: id||uid(), name, amount, kind: RECKIND,
    freq: document.getElementById('rcFreq').value,
    startDate: document.getElementById('rcStart').value || today(),
    endDate: document.getElementById('rcEnd').value || null,
    accountId: document.getElementById('rcAcc').value,
    categoryId: document.getElementById('rcCat').value,
    shiftWeekend: document.getElementById('rcWork').checked,
    active: true
  };
  if(id){ const i = S.recurring.findIndex(x=>x.id===id); S.recurring[i] = rec; }
  else S.recurring.push(rec);
  save(); closeOv('ovRec'); renderAll(); toast('Сохранено');
}
function deleteRecurring(id){
  S.recurring = S.recurring.filter(r=>r.id!==id);
  save(); closeOv('ovRec'); renderAll(); toast('Удалено');
}

/* Разворачиваем регулярный платёж в список дат */
function expandRecurring(r, from, to){
  const out = [];
  let d = r.startDate;
  if(d < from){
    // проматываем вперёд
    let guard = 0;
    while(d < from && guard < 2000){ d = nextRecDate(d, r.freq); guard++; }
  }
  let guard = 0;
  while(d <= to && guard < 800){
    if(r.endDate && d > r.endDate) break;
    let date = d;
    if(r.shiftWeekend){
      let w = parseISO(date).getDay();
      if(w===6) date = addDays(date, 2);
      else if(w===0) date = addDays(date, 1);
    }
    if(date >= from && date <= to) out.push({date, name:r.name, amount:r.amount, kind:r.kind, categoryId:r.categoryId, recId:r.id});
    if(r.freq==='once') break;
    d = nextRecDate(d, r.freq); guard++;
  }
  return out;
}
function nextRecDate(d, freq){
  switch(freq){
    case 'weekly':   return addDays(d, 7);
    case 'biweekly': return addDays(d, 14);
    case 'quarterly':return addMonths(d, 3);
    case 'yearly':   return addMonths(d, 12);
    case 'once':     return addDays(d, 99999);
    default:         return addMonths(d, 1);
  }
}

/* -------------------------------------------------------------------------
   Основной расчёт прогноза: день за днём
   ------------------------------------------------------------------------- */
function buildForecast(days){
  const from = today(), to = addDays(from, days);
  const events = {};
  const push = e => { (events[e.date] = events[e.date] || []).push(e); };

  // 1) регулярные платежи и доходы
  for(const r of S.recurring){
    if(r.active===false) continue;
    for(const e of expandRecurring(r, from, to)) push(Object.assign({}, e, {amount: toBase(e.amount, accCurrency(r.accountId))}));
  }
  // 2) обязательные платежи по долгам из графиков
  for(const p of futureDebtPayments(to)) push({date:p.date, name:'Платёж: '+p.name, amount:p.amount, kind:'expense', debt:true});
  // 3) закрытие вкладов
  for(const a of S.accounts){
    if(a.type==='deposit' && a.endDate && a.endDate>=from && a.endDate<=to && !a.archived){
      push({date:a.endDate, name:'Закрытие вклада: '+a.name, amount:toBase(balance(a), accCurrency(a)), kind:'income', deposit:true});
    }
  }
  // 4) уже внесённые будущие операции (запланированы задним числом на будущее)
  for(const t of S.transactions){
    if(t.date > from && t.date <= to && t.type!=='transfer'){
      push({date:t.date, name:(t.note||catName(t.categoryId)), amount:txBase(t), kind:t.type, actual:true});
    }
  }

  let bal = totalLiquid();
  const out = [];
  for(let i=0; i<=days; i++){
    const date = addDays(from, i);
    const items = (events[date]||[]).sort((a,b)=> (a.kind===b.kind?0:(a.kind==='income'?-1:1)));
    const inc = items.filter(e=>e.kind==='income').reduce((s,e)=>s+e.amount,0);
    const exp = items.filter(e=>e.kind==='expense').reduce((s,e)=>s+e.amount,0);
    const open = bal;
    bal = round2(bal + inc - exp);
    out.push({date, items, inc, exp, open, close: bal});
  }
  return out;
}

/* ---------------- рендер календаря ---------------- */
let calChart = null;
function renderCalendar(){
  const days = parseInt(document.getElementById('calHorizon').value, 10);
  const buf  = parseFloat(document.getElementById('calMinBuf').value) || 0;
  S.settings.minBuffer = buf; save();

  const F = buildForecast(days);
  const closes = F.map(d=>d.close);
  const minVal = Math.min(...closes);
  const minDay = F[closes.indexOf(minVal)];

  document.getElementById('calStart').textContent = moneyShort(totalLiquid());
  const mn = document.getElementById('calMin');
  mn.textContent = moneyShort(minVal);
  mn.className = 'n ' + (minVal < 0 ? 'neg' : minVal < buf ? '' : 'pos');
  if(minVal>=0 && minVal<buf) mn.style.color = 'var(--amber)'; else mn.style.color = '';
  const en = document.getElementById('calEnd');
  en.textContent = moneyShort(F[F.length-1].close);
  en.className = 'n ' + (F[F.length-1].close<0?'neg':'pos');

  // предупреждение о кассовом разрыве
  const gaps = F.filter(d=>d.close<0);
  const lows = F.filter(d=>d.close>=0 && d.close<buf);
  const noteBox = document.getElementById('calGapNote');
  if(gaps.length){
    const first = gaps[0];
    const need = Math.abs(minVal) + buf;
    noteBox.innerHTML = `<div class="note err">
      <b>Кассовый разрыв.</b> Первый минус — ${dateLong(first.date)} (${money(first.close)}).
      Дней в минусе: ${gaps.length}. Чтобы пройти период, не хватает примерно <b>${money(need)}</b>.
      Посмотрите на вкладке «Анализ», какие необязательные расходы можно сдвинуть.</div>`;
  } else if(lows.length){
    noteBox.innerHTML = `<div class="note warn">
      <b>Тонко, но без минуса.</b> ${lows.length} дн. остаток опускается ниже вашей подушки ${money(buf)}.
      Минимум — ${money(minVal)} ${dateLong(minDay.date)}.</div>`;
  } else {
    noteBox.innerHTML = `<div class="note ok">
      <b>Разрывов нет.</b> На горизонте ${days} дн. остаток не опускается ниже ${money(minVal)}.</div>`;
  }

  // график
  const ctx = document.getElementById('calChart');
  if(calChart) calChart.destroy();
  if(window.Chart){
    const step = Math.max(1, Math.floor(F.length/120));
    const pts = F.filter((_,i)=> i%step===0);
    calChart = new Chart(ctx, {
      type:'line',
      data:{ labels: pts.map(d=>dateShort(d.date)),
        datasets:[
          {label:'Остаток', data: pts.map(d=>d.close), borderColor:'#4a4844', backgroundColor:'rgba(74,72,68,.07)',
           fill:true, tension:.25, pointRadius:0, borderWidth:2},
          {label:'Подушка', data: pts.map(()=>buf), borderColor:'#9b8564', borderDash:[5,4], pointRadius:0, borderWidth:1.5, fill:false},
          {label:'Ноль', data: pts.map(()=>0), borderColor:'#9b6b5e', borderDash:[3,3], pointRadius:0, borderWidth:1, fill:false}
        ]},
      options:{ responsive:true, maintainAspectRatio:false,
        plugins:{ legend:{display:false},
          tooltip:{callbacks:{label: c=> c.dataset.label+': '+money(c.parsed.y)}}},
        scales:{ y:{ ticks:{callback:v=>moneyShort(v), font:{size:10}}, grid:{color:'#eeece8'} },
                 x:{ ticks:{maxTicksLimit:8, font:{size:10}}, grid:{display:false} } } }
    });
  }

  // регулярные платежи
  const rbox = document.getElementById('recList');
  if(!S.recurring.length){
    rbox.innerHTML = `<div class="empty"><span class="big">▤</span>
      Регулярных платежей ещё нет.<br>Добавьте зарплату, ЖКХ, подписки — и календарь начнёт прогнозировать остаток.</div>`;
  } else {
    const sorted = [...S.recurring].sort((a,b)=> a.kind===b.kind ? b.amount-a.amount : (a.kind==='income'?-1:1));
    rbox.innerHTML = sorted.map(r=>`
      <div class="row" onclick="openRecurring('${r.id}')" style="cursor:pointer">
        <div class="l"><div class="t">${esc(r.name)} ${r.kind==='expense'&&!catMandatory(r.categoryId)?'<span class="chip opt">необяз</span>':''}</div>
          <div class="s">${FREQ[r.freq]} · с ${dateShort(r.startDate)}${r.endDate?' до '+dateShort(r.endDate):''} · ${esc(accName(r.accountId))}</div></div>
        <div class="v ${r.kind==='income'?'pos':'neg'}">${r.kind==='income'?'+':'−'}${money(r.amount)}</div>
      </div>`).join('');
  }

  // по дням
  const dbox = document.getElementById('calDays');
  const shown = F.filter(d=> d.items.length>0 || d.close<buf).slice(0, 120);
  if(!shown.length){
    dbox.innerHTML = `<div class="empty">На горизонте нет запланированных движений.</div>`;
  } else {
    dbox.innerHTML = shown.map(d=>{
      const cls = d.close<0 ? 'gap' : (d.close<buf ? 'low' : '') ;
      const dt = parseISO(d.date);
      const items = d.items.length ? d.items.map(e=>`
          <div class="it"><span class="nm">${esc(e.name)}</span>
            <span class="${e.kind==='income'?'pos':'neg'}">${e.kind==='income'?'+':'−'}${money(e.amount)}</span></div>`).join('')
        : `<div class="none">нет операций</div>`;
      return `<div class="day ${cls} ${isWeekend(d.date)?'wknd':''}">
        <div class="dnum"><b>${dt.getDate()}</b><span>${DOW[dt.getDay()]} ${MONTHS[dt.getMonth()].slice(0,3)}</span></div>
        <div class="items">${items}</div>
        <div class="cls"><b class="${d.close<0?'neg':''}">${moneyShort(d.close)}</b><span>остаток</span></div>
      </div>`;
    }).join('');
  }
}

/* =========================================================================
   АНАЛИТИКА
   ========================================================================= */
let anTrend = null, anPie = null;

function renderAnalytics(){
  const [from,to] = periodRange(document.getElementById('anPeriod').value);
  const kind = document.getElementById('anKind').value;
  const list = txInRange(from,to).filter(t=>t.type===kind);

  const req = list.filter(t=> catMandatory(t.categoryId)).reduce((s,t)=>s+txBase(t),0);
  const opt = list.filter(t=> !catMandatory(t.categoryId)).reduce((s,t)=>s+txBase(t),0);
  const total = req + opt;

  document.getElementById('anReq').textContent = moneyShort(req);
  document.getElementById('anOpt').textContent = moneyShort(opt);

  const pct = total>0 ? opt/total*100 : 0;
  const monthsSpan = Math.max(1, monthsBetween(from,to));
  const noteBox = document.getElementById('anOptNote');
  if(kind==='expense'){
    if(total===0) noteBox.innerHTML = `<div class="empty">Расходов за период нет.</div>`;
    else if(pct >= 30) noteBox.innerHTML = `<div class="note warn">
      Необязательные траты — <b>${pct.toFixed(0)}%</b> расходов, это ${money(opt)} за период
      (≈ ${money(opt/monthsSpan)} в месяц). Сокращение даже наполовину освободит около
      <b>${money(opt/monthsSpan/2)}</b> в месяц на погашение долгов.</div>`;
    else noteBox.innerHTML = `<div class="note ok">
      Необязательные траты — <b>${pct.toFixed(0)}%</b> расходов (${money(opt)}). Структура достаточно жёсткая:
      основная экономия возможна только за счёт обязательных статей или роста доходов.</div>`;
  } else {
    noteBox.innerHTML = `<div class="note">Для доходов отметка «необязательные» означает нерегулярные поступления —
      на них не стоит рассчитывать в календаре.</div>`;
  }

  // по категориям
  const byCat = {};
  for(const t of list){
    const k = t.categoryId || 'none';
    byCat[k] = (byCat[k]||0) + txBase(t);
  }
  const cats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]);
  document.getElementById('anCatTitle').textContent = (kind==='expense'?'Расходы':'Доходы') + ' по категориям · ' + moneyShort(total);
  document.getElementById('anCats').innerHTML = cats.length ? cats.map(([id,v])=>{
    const p = total>0 ? v/total*100 : 0;
    const optChip = kind==='expense' && !catMandatory(id) ? ' <span class="chip opt">необяз</span>' : '';
    return `<div class="catrow">
      <span class="dot" style="background:${catColor(id)}"></span>
      <span class="nm">${esc(catName(id))}${optChip}<div class="bar" style="margin:4px 0 0;height:4px"><i style="width:${p}%;background:${catColor(id)}"></i></div></span>
      <span class="amt">${money(v)}</span><span class="pct">${p.toFixed(0)}%</span>
    </div>`;
  }).join('') : `<div class="empty">Нет данных за период.</div>`;

  // круговая диаграмма
  if(window.Chart){
    const pieCtx = document.getElementById('anPieChart');
    if(anPie) anPie.destroy();
    if(cats.length){
      const top = cats.slice(0,10);
      const restSum = cats.slice(10).reduce((s,c)=>s+c[1],0);
      const labels = top.map(c=>catName(c[0])).concat(restSum>0?['Прочее']:[]);
      const data = top.map(c=>c[1]).concat(restSum>0?[restSum]:[]);
      const colors = top.map(c=>catColor(c[0])).concat(restSum>0?['#b8b5ae']:[]);
      anPie = new Chart(pieCtx, {
        type:'doughnut',
        data:{labels, datasets:[{data, backgroundColor:colors, borderWidth:2, borderColor:'#fff'}]},
        options:{responsive:true, maintainAspectRatio:false, cutout:'58%',
          plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}, padding:8}},
            tooltip:{callbacks:{label:c=>c.label+': '+money(c.parsed)+' ('+(c.parsed/total*100).toFixed(0)+'%)'}}}}
      });
    }

    // тренд по месяцам
    const trendCtx = document.getElementById('anTrendChart');
    if(anTrend) anTrend.destroy();
    const months = {};
    for(const t of txInRange(from,to)){
      if(t.type==='transfer') continue;
      const k = monthKey(t.date);
      months[k] = months[k] || {inc:0, exp:0, opt:0};
      const v = txBase(t);
      if(t.type==='income') months[k].inc += v;
      else { months[k].exp += v; if(!catMandatory(t.categoryId)) months[k].opt += v; }
    }
    const mk = Object.keys(months).sort();
    if(mk.length){
      anTrend = new Chart(trendCtx, {
        type:'bar',
        data:{ labels: mk.map(k=>monthLabel(k).replace(/ \d{4}/, m=>' '+m.trim().slice(2))),
          datasets:[
            {label:'Доходы', data:mk.map(k=>months[k].inc), backgroundColor:'#6f7a6c', borderRadius:4},
            {label:'Расходы', data:mk.map(k=>months[k].exp), backgroundColor:'#9b6b5e', borderRadius:4},
            {label:'из них необяз.', data:mk.map(k=>months[k].opt), backgroundColor:'#c2ab84', borderRadius:4}
          ]},
        options:{responsive:true, maintainAspectRatio:false,
          plugins:{legend:{position:'bottom', labels:{boxWidth:10, font:{size:11}, padding:8}},
            tooltip:{callbacks:{label:c=>c.dataset.label+': '+money(c.parsed.y)}}},
          scales:{y:{ticks:{callback:v=>moneyShort(v), font:{size:10}}, grid:{color:'#eeece8'}},
                  x:{grid:{display:false}, ticks:{font:{size:10}}}}}
      });
    }
  }

  // крупнейшие необязательные траты
  const topOpt = txInRange(from,to)
    .filter(t=>t.type==='expense' && !catMandatory(t.categoryId))
    .sort((a,b)=>b.amount-a.amount).slice(0,12);
  document.getElementById('anTopOptional').innerHTML = topOpt.length
    ? topOpt.map(t=>`<div class="row" onclick="openTx('${t.id}')" style="cursor:pointer">
        <div class="l"><div class="t">${esc(t.note || catName(t.categoryId))}</div>
          <div class="s">${dateLong(t.date)} · ${esc(catName(t.categoryId))}</div></div>
        <div class="v neg">−${money(t.amount,{cur:accCurrency(t.accountId)})}</div></div>`).join('')
    : `<div class="empty">Необязательных трат за период не найдено.</div>`;
}
function monthsBetween(a,b){
  const d1 = parseISO(a), d2 = parseISO(b);
  return (d2.getFullYear()-d1.getFullYear())*12 + (d2.getMonth()-d1.getMonth()) + 1;
}

/* =========================================================================
   ГЛАВНЫЙ ЭКРАН
   ========================================================================= */
function renderHome(){
  const liq = totalLiquid(), debt = totalDebt();
  document.getElementById('hNet').textContent = moneyShort(netWorth());
  document.getElementById('kLiquid').textContent = moneyShort(liq);
  document.getElementById('kLiquid').className = 'n ' + (liq<0?'neg':'pos');
  document.getElementById('kDebt').textContent = moneyShort(debt);

  const n = new Date();
  const [f,t] = periodRange('thismonth');
  const m = txInRange(f,t);
  const inc = m.filter(x=>x.type==='income').reduce((s,x)=>s+txBase(x),0);
  const exp = m.filter(x=>x.type==='expense').reduce((s,x)=>s+txBase(x),0);
  const req = m.filter(x=>x.type==='expense' && catMandatory(x.categoryId)).reduce((s,x)=>s+txBase(x),0);
  const opt = exp - req;

  document.getElementById('hSub').textContent = MONTHS_N[n.getMonth()] + ' ' + n.getFullYear();
  document.getElementById('kInc').textContent = moneyShort(inc);
  document.getElementById('kExp').textContent = moneyShort(exp);
  const kn = document.getElementById('kNet');
  kn.textContent = moneyShort(inc-exp);
  kn.className = 'n ' + (inc-exp>=0?'pos':'neg');

  const pct = exp>0 ? opt/exp*100 : 0;
  document.getElementById('kOptBar').style.width = pct+'%';
  document.getElementById('kOptPct').textContent = exp>0 ? pct.toFixed(0)+'% необязательных' : '—';
  document.getElementById('kReqSum').textContent = moneyShort(req);
  document.getElementById('kOptSum').textContent = moneyShort(opt);

  // предупреждения
  const alerts = [];
  const F = buildForecast(60);
  const buf = S.settings.minBuffer || 0;
  const gap = F.find(d=>d.close<0);
  if(gap) alerts.push({t:'Кассовый разрыв '+dateLong(gap.date), s:'Прогнозный остаток '+money(gap.close), cls:'bad', go:'calendar'});
  else {
    const low = F.find(d=>d.close<buf);
    if(low) alerts.push({t:'Остаток ниже подушки '+dateShort(low.date), s:money(low.close)+' при подушке '+money(buf), cls:'opt', go:'calendar'});
  }
  for(const a of debtAccounts()){
    if(a.type==='credit_card'){
      /* Льготный период заканчивается — самое дорогое, что можно пропустить */
      const left = graceDaysLeft(a);
      if(left !== null && balance(a) > 0){
        if(left > 0 && left <= 14){
          alerts.push({t:'Льготный период истекает: '+a.name,
            s:`Осталось ${left} ${plural(left,'день','дня','дней')}. Погасите ${money(balance(a))}, чтобы не платить проценты`,
            cls:'bad', go:'debts'});
        } else if(left <= 0){
          alerts.push({t:'Льготный период истёк: '+a.name,
            s:`Начисляются проценты по ставке ${a.rate||0}% годовых`, cls:'bad', go:'debts'});
        }
      }
      if(a.limit){
        const use = balance(a)/a.limit*100;
        if(use>80) alerts.push({t:'Кредитка почти исчерпана: '+a.name, s:'Использовано '+use.toFixed(0)+'% лимита', cls:'bad', go:'debts'});
      }
    }
    if(a.type==='debt' && a.dueDate && a.dueDate <= addDays(today(),90) && balance(a)>0)
      alerts.push({t:'Приближается срок: '+a.name, s:money(balance(a))+' до '+dateLong(a.dueDate), cls:'opt', go:'debts'});
  }
  /* Вход — самое важное предупреждение: без него данные живут только здесь */
  if(typeof sbUser !== 'undefined' && !sbUser && typeof syncCfg === 'function' && syncCfg()){
    alerts.unshift({t:'Войдите в аккаунт', s:'Данные сохранятся и откроются на телефоне. Регистрация не нужна — имя и почта', cls:'opt', act:'openAccountSheet()'});
  }
  if(!S.accounts.length) alerts.push({t:'Добавьте счета', s:'Карты, наличные, вклады и кредиты — база для всех расчётов', cls:'info', go:'accounts'});
  else if(!S.recurring.length) alerts.push({t:'Добавьте регулярные платежи', s:'Без них календарь не может прогнозировать остаток', cls:'info', go:'calendar'});

  const ac = document.getElementById('cardAlerts');
  if(alerts.length){
    ac.style.display = 'block';
    document.getElementById('alerts').innerHTML = alerts.map(a=>`
      <div class="row" onclick="${a.act ? a.act : `go('${a.go}')`}" style="cursor:pointer">
        <div class="l"><div class="t">${esc(a.t)} <span class="chip ${a.cls}">${a.cls==='bad'?'важно':a.cls==='opt'?'внимание':'совет'}</span></div>
          <div class="s">${esc(a.s)}</div></div><div class="v mut">›</div></div>`).join('');
  } else ac.style.display = 'none';

  // ближайшие платежи
  const up = [];
  for(let i=0;i<F.length && up.length<6;i++) for(const e of F[i].items) if(up.length<6) up.push(Object.assign({}, e, {date:F[i].date}));
  document.getElementById('upcoming').innerHTML = up.length
    ? up.map(e=>`<div class="row"><div class="l"><div class="t">${esc(e.name)}</div>
        <div class="s">${dateLong(e.date)}, ${DOW[parseISO(e.date).getDay()]}</div></div>
        <div class="v ${e.kind==='income'?'pos':'neg'}">${e.kind==='income'?'+':'−'}${money(e.amount)}</div></div>`).join('')
    : `<div class="empty">Запланированных платежей нет. Добавьте регулярные платежи в календаре.</div>`;

  // счета
  document.getElementById('homeAccounts').innerHTML = S.accounts.length
    ? S.accounts.filter(a=>!a.archived).slice(0,5).map(accRow).join('')
    : `<div class="empty"><span class="big">▦</span>Счетов пока нет.<br>
       <button class="btn btn-p btn-sm" style="margin-top:8px" onclick="event.stopPropagation();go('accounts')">Добавить счёт</button></div>`;

  // последние операции
  const recent = [...S.transactions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,6);
  document.getElementById('homeTx').innerHTML = recent.length
    ? recent.map(txRow).join('')
    : `<div class="empty"><span class="big">☰</span>Операций пока нет.<br>
       Добавьте вручную кнопкой «+» или загрузите выписку.</div>`;
}

/* =========================================================================
   ОБЩИЙ РЕНДЕР + СТАРТ
   ========================================================================= */
function renderAll(){
  try{
    // фильтр счетов на вкладке операций
    const fa = document.getElementById('fltAccount');
    const cur = fa.value;
    fa.innerHTML = `<option value="">Все счета</option>` +
      S.accounts.filter(a=>!a.archived).map(a=>`<option value="${a.id}">${esc(accLabel(a))}</option>`).join('');
    if(cur) fa.value = cur;

    renderHome();
    renderAccounts();
    renderTx();
    renderDebts();
    renderCategories();
    renderRules();
    if(typeof renderRates === 'function') renderRates();
    if(typeof renderAvatar === 'function') renderAvatar();
    if(typeof renderSync === 'function') renderSync();
    if(CUR==='calendar') renderCalendar();
    if(CUR==='analytics') renderAnalytics();
  }catch(e){
    console.error('Ошибка отрисовки:', e);
  }
}

/* демо-данные для первого запуска не создаём: пользователь заполняет сам */
renderAll();
