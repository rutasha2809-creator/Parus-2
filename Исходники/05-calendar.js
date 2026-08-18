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

/* Ищем реальную операцию, которая закрывает плановое начисление.
   Совпадение по счёту, виду и категории, дата — в пределах нескольких дней:
   банк может провести платёж не день в день. */
/* MATCH_DAYS объявлен в 02-core.js — им пользуются и долги, и календарь */
function matchActual(rule, date, used){
  return S.transactions.find(t =>
    !used.has(t.id) &&
    t.type === rule.kind &&
    t.accountId === rule.accountId &&
    (!rule.categoryId || t.categoryId === rule.categoryId) &&
    Math.abs(daysBetween(t.date, date)) <= MATCH_DAYS
  ) || null;
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

  /* 1) регулярные платежи и доходы.
     Если на эту дату уже есть реальная операция по тому же счёту и категории —
     значит, платёж прошёл: плановую строку не показываем, иначе посчитаем дважды. */
  const usedTx = new Set();
  for(const r of S.recurring){
    if(r.active===false) continue;
    for(const e of expandRecurring(r, from, to)){
      const key = planKey('rec', r.id, e.date);
      const ov  = planOverride(key);

      /* ручная правка даты или суммы имеет приоритет */
      const date   = (ov && ov.date)   ? ov.date   : e.date;
      const amount = (ov && ov.amount != null) ? ov.amount : e.amount;
      if(date < from || date > to) continue;

      /* платёж найден среди реальных операций: строку НЕ убираем,
         помечаем «оплачено» и не считаем в сумме дня */
      const hit = matchActual(r, date, usedTx);
      if(hit) usedTx.add(hit.id);

      push({
        date, name: e.name, kind: e.kind, categoryId: e.categoryId,
        amount: toBase(amount, accCurrency(r.accountId)),
        recId: r.id, planKey: key, planned: true,
        done: !!hit, paidNote: hit ? 'оплачено' : null,
        edited: !!(ov && (ov.date || ov.amount != null))
      });
    }
  }
  // 2) обязательные платежи по долгам из графиков
  for(const p of futureDebtPayments(to))
    push({date:p.date, name:'Платёж: '+p.name, amount:p.amount, kind:'expense', debt:true,
          done: !!p.done, paidNote: p.paidNote || null});
  // 3) закрытие вкладов
  for(const a of S.accounts){
    /* Приход в день закрытия — только для запертых вкладов.
       Доступный вклад уже посчитан в остатке, иначе деньги удвоятся. */
    if(a.type==='deposit' && !depositIsLiquid(a) && a.endDate && a.endDate>=from && a.endDate<=to && !a.archived){
      push({date:a.endDate, name:'Закрытие вклада: '+a.name, amount:toBase(balance(a), accCurrency(a)), kind:'income', deposit:true});
    }
  }
  // 4) операции, уже внесённые вперёд (плановые)
  const liquidIds = new Set(liquidAccounts().map(a=>a.id));
  for(const t of S.transactions){
    /* Сегодняшние операции уже сидят в текущем остатке. Показываем их
       справочно, чтобы день не выглядел пустым, но в сумму не берём. */
    if(t.date === from){
      if(t.type === 'transfer'){
        if(liquidIds.has(t.accountId)){
          const dst = S.accounts.find(a=>a.id===t.toAccountId);
          const isDebt = !!(dst && ACC_TYPES[dst.type] && !ACC_TYPES[dst.type].asset);
          push({date:t.date, name:'Перевод: '+accName(t.toAccountId),
                amount: toBase(t.amount, accCurrency(t.accountId)), kind:'expense', done:true,
                debt: isDebt, transfer: !isDebt});
        }
        if(liquidIds.has(t.toAccountId))
          push({date:t.date, name:'Перевод с '+accName(t.accountId),
                amount: toBase(txAmountFor(t, t.toAccountId), accCurrency(t.toAccountId)), kind:'income', done:true,
                transfer: true});
      } else {
        push({date:t.date, name:(t.note||catName(t.categoryId)), amount:txBase(t), kind:t.type,
              categoryId:t.categoryId, done:true});
      }
      continue;
    }
    if(t.date < from || t.date > to) continue;

    if(t.type === 'transfer'){
      /* Перевод влияет на прогноз, только если задет счёт с живыми деньгами:
         перевод на кредитку — это уход средств, зачисление на карту — приход. */
      if(liquidIds.has(t.accountId)){
        /* перевод на кредит, кредитку или рассрочку — это платёж по долгу */
        const dst = S.accounts.find(a=>a.id===t.toAccountId);
        const isDebt = !!(dst && ACC_TYPES[dst.type] && !ACC_TYPES[dst.type].asset);
        push({date:t.date, name:'Перевод: '+accName(t.toAccountId),
              amount: toBase(t.amount, accCurrency(t.accountId)), kind:'expense', actual:true,
              debt: isDebt, transfer: !isDebt});
      }
      if(liquidIds.has(t.toAccountId)){
        push({date:t.date, name:'Перевод с '+accName(t.accountId),
              amount: toBase(txAmountFor(t, t.toAccountId), accCurrency(t.toAccountId)),
              kind:'income', actual:true, transfer: true});
      }
    } else {
      push({date:t.date, name:(t.note||catName(t.categoryId)), amount:txBase(t), kind:t.type,
            categoryId:t.categoryId, actual:true});
    }
  }

  let bal = totalLiquid();
  const out = [];
  for(let i=0; i<=days; i++){
    const date = addDays(from, i);
    const items = (events[date]||[]).sort((a,b)=> (a.kind===b.kind?0:(a.kind==='income'?-1:1)));
    const inc = items.filter(e=>e.kind==='income'  && !e.done).reduce((s,e)=>s+e.amount,0);
    const exp = items.filter(e=>e.kind==='expense' && !e.done).reduce((s,e)=>s+e.amount,0);
    const open = bal;
    bal = round2(bal + inc - exp);
    out.push({date, items, inc, exp, open, close: bal});
  }
  return out;
}

/* ---------------- рендер календаря ---------------- */
let calChart = null, calPie = null;
let anFcChart = null, anFcPie = null;
var AN_FC_VIEW = 'chart';

/* Какие месяцы раскрыты. Живёт вне рендера, иначе после любой правки
   всё схлопывалось бы обратно. По умолчанию свёрнуты все. */
var CAL_OPEN = new Set();
function toggleMonth(key){
  if(CAL_OPEN.has(key)) CAL_OPEN.delete(key); else CAL_OPEN.add(key);
  renderCalendar();
}

/* Дни прогноза, сгруппированные в месяцы */
function forecastMonths(F){
  const out = [], byKey = {};
  for(const d of F){
    const key = d.date.slice(0,7);
    let m = byKey[key];
    if(!m){
      const dt = parseISO(d.date);
      /* MONTHS — родительный падеж («17 августа»), для заголовка нужен именительный */
      m = byKey[key] = { key, label: MONTHS_N[dt.getMonth()] + ' ' + dt.getFullYear(),
        short: MONTHS_N[dt.getMonth()].slice(0,3), days: [],
        inc:0, exp:0, debt:0, moves:0, close:0, min:Infinity };
      out.push(m);
    }
    m.days.push(d);
    m.inc += d.inc; m.exp += d.exp;
    for(const e of d.items){
      /* Сегодняшние фактические операции (done, но без planned/paidNote)
         включаем в итоги месяца — иначе таблица и график не покажут,
         что сегодня были платежи. Внутренние переводы (transfer) пропускаем. */
      const todayActual = e.done && !e.planned && !e.paidNote;
      if(e.done && !todayActual) continue;
      if(e.transfer) continue;
      m.moves++;
      if(e.kind==='expense' && e.debt) m.debt += e.amount;
      if(todayActual){
        if(e.kind === 'income') m.inc += e.amount;
        else m.exp += e.amount;
      }
    }
    m.close = d.close;
    if(d.close < m.min) m.min = d.close;
  }
  for(const m of out){
    m.inc = round2(m.inc); m.exp = round2(m.exp); m.debt = round2(m.debt);
    m.other = round2(m.exp - m.debt);
  }
  return out;
}

/* ---------------- сводная таблица прогноза ----------------
   Повторяет формат исходного Excel: статьи в строках, периоды в колонках,
   последняя колонка — итог за весь горизонт. */
var CAL_VIEW = 'chart';
function calSetView(v){
  CAL_VIEW = v;
  document.querySelectorAll('#calView button').forEach((b,i)=>
    b.classList.toggle('on', (i===0) === (v==='chart')));
  document.getElementById('calChartWrap').style.display = v==='chart' ? 'block' : 'none';
  document.getElementById('calTableWrap').style.display = v==='table' ? 'block' : 'none';
  document.getElementById('calGranWrap').style.display  = v==='table' ? 'grid'  : 'none';
  renderCalendar();
}
function anFcSetView(v){
  AN_FC_VIEW = v;
  document.querySelectorAll('#anFcView button').forEach((b,i)=>
    b.classList.toggle('on', (i===0) === (v==='chart')));
  document.getElementById('anFcChartWrap').style.display = v==='chart' ? 'block' : 'none';
  document.getElementById('anFcTableWrap').style.display = v==='table' ? 'block' : 'none';
  renderAnalytics();
}

/* Ключ и подпись периода, к которому относится дата */
function periodOf(date, gran){
  const d = parseISO(date);
  if(gran === 'year')    return { key: date.slice(0,4), label: date.slice(0,4) };
  if(gran === 'quarter'){
    const q = Math.floor(d.getMonth()/3) + 1;
    return { key: d.getFullYear()+'-Q'+q, label: q+' кв. '+d.getFullYear() };
  }
  return { key: date.slice(0,7), label: MONTHS_N[d.getMonth()].slice(0,3)+' '+d.getFullYear() };
}

/* Данные для таблицы: колонки-периоды и строки-статьи */
function forecastTable(F, gran){
  const cols = [], byKey = {};
  const inc = {}, debt = {}, exp = {};      // статья -> {ключ периода -> сумма}
  const add = (bag, name, key, v) => {
    const row = bag[name] || (bag[name] = {});
    row[key] = round2((row[key]||0) + v);
  };
  /* Сегодняшние фактические операции уже сидят в totalLiquid(), но в таблице
     их тоже надо показать. Считаем поправку, чтобы скорректировать «Остаток
     на начало» и сохранить правильный «Остаток на конец». */
  let adjInc = 0, adjExp = 0;

  for(const d of F){
    const p = periodOf(d.date, gran);
    let c = byKey[p.key];
    if(!c){ c = byKey[p.key] = { key:p.key, label:p.label, open:d.open, close:d.close, inc:0, debt:0, other:0 };
            cols.push(c); }
    c.close = d.close;
    c.inc += d.inc; c.other += 0;

    for(const e of d.items){
      /* Сегодняшние фактические операции (done, но не план и не «оплачено»)
         включаем — иначе платежи сегодня не видны в таблице.
         Переводы между своими счетами (transfer:true) пропускаем —
         это не доход и не расход, а перемещение денег. */
      const todayActual = e.done && !e.planned && !e.paidNote;
      if(e.done && !todayActual) continue;
      if(e.transfer) continue;
      if(e.kind === 'income'){
        add(inc, e.name, p.key, e.amount);
        if(todayActual){ c.inc += e.amount; adjInc += e.amount; }
      }
      else if(e.debt){
        add(debt, e.name.replace(/^Платёж:\s*/,'').replace(/^Перевод:\s*/,'').replace(/\s*—\s*остаток$/,''), p.key, e.amount);
        c.debt += e.amount;
        if(todayActual) adjExp += e.amount;
      }
      else {
        add(exp, e.categoryId ? catName(e.categoryId) : e.name, p.key, e.amount);
        c.other += e.amount;
        if(todayActual) adjExp += e.amount;
      }
    }
  }
  /* Корректируем остаток на начало: сегодняшние операции уже учтены в балансе,
     но теперь мы их включили в доходы/расходы — сдвигаем open назад. */
  if(cols.length) cols[0].open = round2(cols[0].open - adjInc + adjExp);
  for(const c of cols){ c.inc = round2(c.inc); c.debt = round2(c.debt); c.other = round2(c.other); }

  const sortRows = bag => Object.entries(bag)
    .map(([name, vals]) => ({ name, vals, total: round2(Object.values(vals).reduce((s,v)=>s+v,0)) }))
    .sort((a,b)=> b.total - a.total);

  return { cols, income: sortRows(inc), debts: sortRows(debt), other: sortRows(exp) };
}

function renderCalTable(F){
  const gran   = (document.getElementById('calGran')||{}).value   || 'month';
  const detail = (document.getElementById('calDetail')||{}).value || 'full';
  const T = forecastTable(F, gran);
  const el = document.getElementById('calTable');
  if(!el) return;

  if(!T.cols.length){ el.innerHTML = '<tbody><tr><td>Нет данных за период.</td></tr></tbody>'; return; }

  const n = v => !v ? '<span class="z">—</span>' : Math.round(v).toLocaleString('ru-RU');
  const sum = f => round2(T.cols.reduce((s,c)=>s+f(c),0));

  const head = `<thead><tr><th>Статья, ₽</th>
    ${T.cols.map(c=>`<th>${esc(c.label)}</th>`).join('')}<th>Итого</th></tr></thead>`;

  const line = (cls, name, vals, total, color) => `<tr class="${cls}">
    <td>${esc(name)}</td>
    ${T.cols.map(c=>`<td ${color?`style="color:${color}"`:''}>${n(vals[c.key])}</td>`).join('')}
    <td class="tot" ${color?`style="color:${color}"`:''}>${n(total)}</td></tr>`;

  const colLine = (cls, name, f, color) => `<tr class="${cls}">
    <td>${esc(name)}</td>
    ${T.cols.map(c=>`<td ${color?`style="color:${color}"`:''}>${n(f(c))}</td>`).join('')}
    <td class="tot" ${color?`style="color:${color}"`:''}>${n(sum(f))}</td></tr>`;

  let body = '';
  // остаток на начало — берётся из первой колонки, суммировать его нельзя
  body += `<tr class="edge"><td>Остаток на начало</td>
    ${T.cols.map(c=>`<td>${n(c.open)}</td>`).join('')}
    <td class="tot">${n(T.cols[0].open)}</td></tr>`;

  body += colLine('grp', 'ДОХОДЫ', c=>c.inc, 'var(--green)');
  if(detail === 'full') body += T.income.map(r=>line('sub', r.name, r.vals, r.total)).join('');

  body += colLine('grp', 'РАСХОДЫ', c=>c.debt + c.other);
  body += colLine('sub', 'Платежи по долгам', c=>c.debt, 'var(--red)');
  if(detail === 'full') body += T.debts.map(r=>line('sub', '· '+r.name, r.vals, r.total, 'var(--red)')).join('');
  body += colLine('sub', 'Прочие расходы', c=>c.other);
  if(detail === 'full') body += T.other.map(r=>line('sub', '· '+r.name, r.vals, r.total)).join('');

  body += colLine('grp', 'Итого за период', c=>round2(c.inc - c.debt - c.other));
  body += `<tr class="edge"><td>Остаток на конец</td>
    ${T.cols.map(c=>`<td ${c.close<0?'style="color:var(--red)"':''}>${n(c.close)}</td>`).join('')}
    <td class="tot" ${T.cols[T.cols.length-1].close<0?'style="color:var(--red)"':''}>${n(T.cols[T.cols.length-1].close)}</td></tr>`;

  el.innerHTML = head + '<tbody>' + body + '</tbody>';
}

/* Цвет суммы: доход зелёный, долг красный, обычный расход чёрный */
function itemCls(e){
  if(e.kind === 'income') return 'a-inc';
  return e.debt ? 'a-debt' : 'a-exp';
}

/* Расходы прогноза в разрезе категорий (для круговой диаграммы) */
function forecastCatShare(F){
  const by = {}; let total = 0;
  for(const d of F) for(const e of d.items){
    const todayActual = e.done && !e.planned && !e.paidNote;
    if(e.kind !== 'expense' || (e.done && !todayActual) || e.transfer) continue;
    const key = e.debt ? '__debt' : (e.categoryId || '__none');
    by[key] = (by[key]||0) + e.amount;
    total += e.amount;
  }
  const rows = Object.entries(by).sort((a,b)=>b[1]-a[1]).map(([id,v])=>({
    id, v,
    name:  id==='__debt' ? 'Платежи по долгам' : id==='__none' ? 'Без категории' : catName(id),
    color: id==='__debt' ? '#c62828'          : id==='__none' ? '#b6b3ac'       : catColor(id),
    opt:   id!=='__debt' && id!=='__none' && !catMandatory(id)
  }));
  return { rows, total: round2(total) };
}

function renderCalendar(){
  const days = parseInt(document.getElementById('calHorizon').value, 10);
  const buf  = parseFloat(document.getElementById('calMinBuf').value) || 0;
  S.settings.minBuffer = buf; save();

  const F = buildForecast(days);
  const closes = F.map(d=>d.close);
  const minVal = Math.min(...closes);
  const minDay = F[closes.indexOf(minVal)];

  document.getElementById('calStart').textContent = moneyShort(totalLiquid());
  /* Расшифровка: из чего сложился остаток «Сейчас» */
  const startNote = document.getElementById('calStartNote');
  if(startNote){
    const parts = liquidAccounts().map(a=>`${esc(a.name)} ${money(toBase(balance(a), accCurrency(a)))}`);
    const locked = S.accounts.filter(a=>!a.archived && a.type==='deposit' && !depositIsLiquid(a));
    startNote.innerHTML = parts.length
      ? `<div style="font-size:11.5px;color:var(--muted);margin-top:8px;line-height:1.5">
           Учтено: ${parts.join(' · ')}
           ${locked.length ? `<br>Не учтено (заперто до срока): ${locked.map(a=>esc(a.name)).join(', ')}` : ''}
         </div>`
      : '';
  }
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

  const MO = forecastMonths(F);

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

  /* Прогноз по месяцам: свёрнутые блоки, внутри — дни */
  const dbox = document.getElementById('calDays');
  if(!MO.length){
    dbox.innerHTML = `<div class="empty">На горизонте нет запланированных движений.</div>`;
    return;
  }
  const scale = Math.max(1, ...MO.map(m=>Math.max(m.inc, m.exp)));

  dbox.innerHTML = MO.map(m=>{
    const open = CAL_OPEN.has(m.key);
    const cls  = (m.min < 0 ? 'gap' : m.min < buf ? 'low' : '') + (open ? ' open' : '');

    const days = m.days.filter(d=> d.items.length>0 || d.close<buf);
    const body = days.length
      ? days.map(d=>renderDay(d, buf)).join('')
      : `<div class="empty" style="padding:16px">В этом месяце движений нет.</div>`;

    const sub = [
      m.moves ? m.moves + ' ' + plural(m.moves,'операция','операции','операций') : 'без движений',
      m.debt  ? 'долги ' + moneyShort(m.debt) : null,
      m.min < 0 ? 'уходит в минус' : (m.min < buf ? 'ниже подушки' : null)
    ].filter(Boolean).join(' · ');

    return `<div class="mon ${cls}">
      <button class="mon-h" onclick="toggleMonth('${m.key}')">
        <span class="arw">▶</span>
        <span class="mname">
          <b>${m.label}</b>
          <em>${sub}</em>
        </span>
        <span class="msum">
          <span class="a-inc">+${moneyShort(m.inc)}</span><br>
          <span class="a-exp">−${moneyShort(m.exp)}</span>
        </span>
        <span class="mclose"><b class="${m.close<0?'neg':''}">${moneyShort(m.close)}</b><em>остаток</em></span>
      </button>
      <div class="mon-b">${body}</div>
    </div>`;
  }).join('');
}

/* Одна строка дня внутри раскрытого месяца */
function renderDay(d, buf){
  const cls = d.close<0 ? 'gap' : (d.close<buf ? 'low' : '');
  const dt  = parseISO(d.date);
  const items = d.items.length ? d.items.map(e=>{
      const marks =
        (e.paidNote ? ' <span class="chip ok">оплачено</span>' : '') +
        (e.done && !e.paidNote ? ' <span class="chip req">проведено</span>' : '') +
        (e.edited ? ' <span class="chip info">изменён</span>' : '');
      const actions = (e.planned && !e.done)
        ? ` <button class="chip info" style="border:none;cursor:pointer"
              onclick="confirmPlanned('${e.recId}','${d.date}')">внести</button>
           <button class="chip req" style="border:none;cursor:pointer"
              onclick="editPlanned('${e.planKey}','${d.date}',${e.amount})">изменить</button>` : '';
      return `<div class="it" ${e.done?'style="opacity:.55"':''}>
        <span class="nm">${esc(e.name)}${marks}${actions}</span>
        <span class="${itemCls(e)}">${e.kind==='income'?'+':'−'}${money(e.amount)}</span></div>`;
    }).join('')
    : `<div class="none">нет операций</div>`;
  return `<div class="day ${cls} ${isWeekend(d.date)?'wknd':''}">
    <div class="dnum"><b>${dt.getDate()}</b><span>${DOW[dt.getDay()]}</span></div>
    <div class="items">${items}</div>
    <div class="cls"><b class="${d.close<0?'neg':''}">${moneyShort(d.close)}</b><span>остаток</span></div>
  </div>`;
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
            {label:'Доходы', data:mk.map(k=>months[k].inc), backgroundColor:'#2e7d32', borderRadius:4},
            {label:'Расходы', data:mk.map(k=>months[k].exp), backgroundColor:'#c62828', borderRadius:4},
            {label:'из них необяз.', data:mk.map(k=>months[k].opt), backgroundColor:'#ef9a9a', borderRadius:4}
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

  /* ====== Секция ПРОГНОЗ (перенесена из Календаря) ====== */
  const fcDays = parseInt((document.getElementById('anFcHorizon')||{}).value||'90', 10);
  const fcF = buildForecast(fcDays);
  const fcMO = forecastMonths(fcF);

  // График столбиков
  if(anFcChart) anFcChart.destroy(); anFcChart = null;
  if(window.Chart && AN_FC_VIEW === 'chart'){
    anFcChart = new Chart(document.getElementById('anFcChart'), {
      data:{ labels: fcMO.map(m=>m.short),
        datasets:[
          {type:'bar', label:'Доходы', data: fcMO.map(m=>m.inc),
           backgroundColor:'#2e7d32', borderRadius:3, stack:'bars', order:3},
          {type:'bar', label:'Расходы', data: fcMO.map(m=>-(m.debt+m.other)),
           backgroundColor:'#c62828', borderRadius:3, stack:'bars', order:3},
          {type:'line', label:'Остаток', data: fcMO.map(m=>m.close),
           borderColor:'#2f2e2b', backgroundColor:'#2f2e2b', borderWidth:2,
           tension:.25, pointRadius:3, pointBackgroundColor:'#fff', stack:'line', order:0}
        ]},
      options:{ responsive:true, maintainAspectRatio:false,
        interaction:{mode:'index', intersect:false},
        plugins:{
          legend:{display:true, position:'bottom',
            labels:{boxWidth:9, boxHeight:9, font:{size:10.5}, padding:11, usePointStyle:true, pointStyle:'rectRounded'}},
          tooltip:{callbacks:{label: c=> c.dataset.label + ': ' +
            (c.dataset.type==='line' ? money(c.parsed.y) : money(Math.abs(c.parsed.y)))}}},
        scales:{
          y:{ stacked:true, ticks:{callback:v=>moneyShort(v), font:{size:10}},
              grid:{color: c => c.tick.value === 0 ? '#b9b5ad' : '#eeece8'} },
          x:{ stacked:true, ticks:{font:{size:10}}, grid:{display:false} } } }
    });
  }

  // Таблица
  if(AN_FC_VIEW === 'table'){
    const gran = (document.getElementById('anFcGran')||{}).value || 'month';
    const detail = (document.getElementById('anFcDetail')||{}).value || 'full';
    const T = forecastTable(fcF, gran);
    const tbl = document.getElementById('anFcTable');
    // рендер таблицы — используем ту же логику, что renderCalTable
    const short = detail === 'short';
    let h = '<thead><tr><th></th>' + T.cols.map(c=>'<th>'+c.label+'</th>').join('') + '</tr></thead><tbody>';
    h += '<tr class="sep"><td><b>Остаток на начало</b></td>' + T.cols.map(c=>'<td>'+money(c.open)+'</td>').join('') + '</tr>';
    if(!short) for(const r of T.income) h += '<tr><td>'+esc(r.name)+'</td>'+T.cols.map(c=>'<td>'+(r.vals[c.key]?money(r.vals[c.key]):'')+'</td>').join('')+'</tr>';
    h += '<tr class="sep"><td><b>Доходы</b></td>' + T.cols.map(c=>'<td><b>'+money(c.inc)+'</b></td>').join('') + '</tr>';
    if(!short) for(const r of T.debts) h += '<tr><td>'+esc(r.name)+'</td>'+T.cols.map(c=>'<td>'+(r.vals[c.key]?money(r.vals[c.key]):'')+'</td>').join('')+'</tr>';
    h += '<tr class="sep"><td><b>Платежи по долгам</b></td>' + T.cols.map(c=>'<td><b>'+money(c.debt)+'</b></td>').join('') + '</tr>';
    if(!short) for(const r of T.other) h += '<tr><td>'+esc(r.name)+'</td>'+T.cols.map(c=>'<td>'+(r.vals[c.key]?money(r.vals[c.key]):'')+'</td>').join('')+'</tr>';
    h += '<tr class="sep"><td><b>Прочие расходы</b></td>' + T.cols.map(c=>'<td><b>'+money(c.other)+'</b></td>').join('') + '</tr>';
    h += '<tr class="total"><td><b>Остаток на конец</b></td>' + T.cols.map(c=>{
      const cls = c.close<0?'neg':'';
      return '<td><b class="'+cls+'">'+money(c.close)+'</b></td>';
    }).join('') + '</tr>';
    h += '</tbody>';
    tbl.innerHTML = h;
  }

  // Пирог прогнозных расходов
  const fcShare = forecastCatShare(fcF);
  document.getElementById('anFcPieTotal').textContent = fcShare.total ? moneyShort(fcShare.total) : '';
  if(anFcPie) anFcPie.destroy(); anFcPie = null;
  const fcPieList = document.getElementById('anFcPieList');
  if(!fcShare.rows.length){
    fcPieList.innerHTML = `<div class="empty">Расходов в прогнозе нет.</div>`;
  } else {
    if(window.Chart){
      anFcPie = new Chart(document.getElementById('anFcPie'), {
        type:'doughnut',
        data:{ labels: fcShare.rows.map(r=>r.name),
          datasets:[{ data: fcShare.rows.map(r=>r.v), backgroundColor: fcShare.rows.map(r=>r.color),
                      borderColor:'#fff', borderWidth:2 }]},
        options:{ responsive:true, maintainAspectRatio:false, cutout:'58%',
          plugins:{ legend:{display:false},
            tooltip:{callbacks:{label: c=> c.label+': '+money(c.parsed)
              + ' · ' + (fcShare.total ? (c.parsed/fcShare.total*100).toFixed(0) : 0) + '%'}}}}
      });
    }
    fcPieList.innerHTML = fcShare.rows.map(r=>{
      const p = fcShare.total>0 ? r.v/fcShare.total*100 : 0;
      return `<div class="catrow">
        <span class="dot" style="background:${r.color}"></span>
        <span class="nm">${esc(r.name)}${r.opt?' <span class="chip opt">необяз</span>':''}
          <div class="bar" style="margin:4px 0 0;height:4px"><i style="width:${p}%;background:${r.color}"></i></div></span>
        <span class="amt">${money(r.v)}</span><span class="pct">${p.toFixed(0)}%</span>
      </div>`;
    }).join('');
  }

  /* ====== Секция ВЫВОДЫ И РЕКОМЕНДАЦИИ ====== */
  const insights = [];

  // 1. Баланс доходов и расходов за период
  if(total > 0 && kind === 'expense'){
    const incTotal = txInRange(from,to).filter(t=>t.type==='income').reduce((s,t)=>s+txBase(t),0);
    const balance_ = incTotal - total;
    if(balance_ < 0){
      insights.push({icon:'⚠', cls:'err',
        text:`<b>Расходы превышают доходы</b> на ${money(Math.abs(balance_))} за период. Доходы ${money(incTotal)}, расходы ${money(total)}. Вы тратите больше, чем зарабатываете — это сокращает накопления.`});
    } else if(balance_ > 0 && balance_ < incTotal * 0.1){
      insights.push({icon:'⚡', cls:'warn',
        text:`<b>Остаток минимальный:</b> ${money(balance_)} из ${money(incTotal)} дохода (${(balance_/incTotal*100).toFixed(0)}%). Небольшой непредвиденный расход может привести к дефициту.`});
    } else if(balance_ > 0){
      insights.push({icon:'✓', cls:'ok',
        text:`<b>Доходы покрывают расходы</b> с запасом ${money(balance_)} (${(balance_/incTotal*100).toFixed(0)}% от дохода).`});
    }
  }

  // 2. Тренд расходов (если есть данные за 2+ месяца)
  if(kind === 'expense'){
    const byM = {};
    for(const t of txInRange(from,to).filter(t=>t.type==='expense')){
      const k = monthKey(t.date);
      byM[k] = (byM[k]||0) + txBase(t);
    }
    const mKeys = Object.keys(byM).sort();
    if(mKeys.length >= 3){
      const first3 = mKeys.slice(0, Math.ceil(mKeys.length/2));
      const last3 = mKeys.slice(Math.ceil(mKeys.length/2));
      const avgFirst = first3.reduce((s,k)=>s+byM[k],0)/first3.length;
      const avgLast = last3.reduce((s,k)=>s+byM[k],0)/last3.length;
      if(avgFirst > 0){
        const change = ((avgLast - avgFirst)/avgFirst*100);
        if(change > 10){
          insights.push({icon:'📈', cls:'warn',
            text:`<b>Расходы растут:</b> в среднем ${money(avgFirst)}/мес в первой половине периода → ${money(avgLast)}/мес во второй (+${change.toFixed(0)}%).`});
        } else if(change < -10){
          insights.push({icon:'📉', cls:'ok',
            text:`<b>Расходы снижаются:</b> ${money(avgFirst)}/мес → ${money(avgLast)}/мес (${change.toFixed(0)}%). Хорошая динамика.`});
        } else {
          insights.push({icon:'📊', cls:'ok',
            text:`<b>Расходы стабильны:</b> ~${money(avgLast)}/мес, отклонение ${change > 0 ? '+' : ''}${change.toFixed(0)}%.`});
        }
      }
    }
  }

  // 3. Где сократить — топ необязательных категорий
  if(kind === 'expense' && opt > 0){
    const optByCat = {};
    for(const t of list.filter(t=> !catMandatory(t.categoryId))){
      const k = t.categoryId || 'none';
      optByCat[k] = (optByCat[k]||0) + txBase(t);
    }
    const topCats = Object.entries(optByCat).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const detail_ = topCats.map(([id,v])=> `${catName(id)} — ${money(v)}`).join(', ');
    insights.push({icon:'✂', cls:'warn',
      text:`<b>Топ необязательных категорий:</b> ${detail_}. Итого ${money(opt)} (${pct.toFixed(0)}% расходов). Сокращение вдвое высвободит ~${money(opt/2)} за период.`});
  }

  // 4. Рекомендация по кассовому разрыву
  const fcGap = fcF.find(d=>d.close<0);
  if(fcGap && opt > 0){
    const need = Math.abs(Math.min(...fcF.map(d=>d.close)));
    if(opt/monthsSpan >= need){
      insights.push({icon:'💡', cls:'err',
        text:`<b>Кассовый разрыв ${dateLong(fcGap.date)}</b> можно предотвратить: необязательные траты ~${money(opt/monthsSpan)}/мес, а не хватает ${money(need)}. Перенесите или сократите необязательные расходы перед этой датой.`});
    } else {
      insights.push({icon:'💡', cls:'err',
        text:`<b>Кассовый разрыв ${dateLong(fcGap.date)}.</b> Не хватает ${money(need)}. Одного сокращения необязательных трат (${money(opt/monthsSpan)}/мес) недостаточно — нужны дополнительные поступления или перенос обязательных платежей.`});
    }
  }

  const insBox = document.getElementById('anInsightsList');
  if(insights.length){
    insBox.innerHTML = insights.map(i=>`<div class="note ${i.cls}" style="margin-bottom:10px">
      <span style="font-size:16px;margin-right:6px">${i.icon}</span>${i.text}</div>`).join('');
  } else {
    insBox.innerHTML = `<div class="empty">Добавьте операции — и здесь появятся выводы и рекомендации.</div>`;
  }
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

  if(typeof renderDebtReminders === 'function') renderDebtReminders();

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
  for(let i=0;i<F.length && up.length<6;i++)
    for(const e of F[i].items)
      /* платежи по долгам показаны отдельной карточкой с кнопкой «Внести» */
      if(!e.done && !e.debt && up.length<6) up.push(Object.assign({}, e, {date:F[i].date}));
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


/* =========================================================================
   ПОДТВЕРЖДЕНИЕ ПЛАНОВОГО ПЛАТЕЖА
   Открывает окно операции с уже заполненными полями: остаётся проверить
   сумму (банк мог списать иначе) и сохранить.
   ========================================================================= */
function confirmPlanned(recId, date){
  const r = S.recurring.find(x => x.id === recId);
  if(!r){ toast('Правило не найдено'); return; }

  openTx();
  txKind(r.kind);
  const set = (id, v) => { const el = document.getElementById(id); if(el) el.value = v; };
  set('txDate', date);
  set('txAmount', r.amount);
  set('txAccount', r.accountId);
  set('txCategory', r.categoryId);
  set('txNote', r.name);

  const box = document.getElementById('txRepeatBox');
  if(box) box.style.display = 'none';
  const rep = document.getElementById('txRepeat');
  if(rep) rep.checked = false;      // повтор уже есть, второй не нужен

  toast('Проверьте сумму и сохраните');
}


/* =========================================================================
   РУЧНАЯ ПРАВКА ПЛАНОВОГО ПЛАТЕЖА
   Строка из плана никогда не пропадает сама — её можно только сдвинуть
   по дате или изменить сумму. Здесь это и делается.
   ========================================================================= */
function editPlanned(key, date, amount){
  const ov = planOverride(key);
  document.getElementById('ovSchedBody').innerHTML = `
    <h3>Правка планового платежа</h3>
    <div class="note">Меняется только этот платёж. Само правило и остальные
      повторы останутся как есть.</div>
    <div class="f2">
      <div class="f"><label>Дата</label>
        <input type="date" id="poDate" value="${(ov && ov.date) || date}"></div>
      <div class="f"><label>Сумма, ₽</label>
        <input type="number" step="0.01" id="poAmount" value="${(ov && ov.amount != null) ? ov.amount : Math.round(amount)}"></div>
    </div>
    <div class="btnrow">
      ${ov ? `<button class="btn btn-s" onclick="clearPlanOverride('${key}'); closeOv('ovSched')">Вернуть как было</button>` : ''}
      <button class="btn btn-p" onclick="savePlanEdit('${key}')">Сохранить</button>
    </div>`;
  openOv('ovSched');
}

function savePlanEdit(key){
  const d = document.getElementById('poDate').value;
  const a = parseFloat(document.getElementById('poAmount').value);
  if(!d){ toast('Укажите дату'); return; }
  if(!a || a <= 0){ toast('Укажите сумму'); return; }
  setPlanOverride(key, {date: d, amount: a});
  closeOv('ovSched');
  toast('Платёж изменён');
}
