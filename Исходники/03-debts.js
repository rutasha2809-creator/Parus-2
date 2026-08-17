/* =========================================================================
   КРЕДИТЫ И ГРАФИКИ ПОГАШЕНИЯ
   ========================================================================= */

/* Аннуитетный платёж: P·i / (1 − (1+i)^−n) */
function annuity(principal, annualRate, months){
  principal = Number(principal)||0; months = Number(months)||0;
  const i = (Number(annualRate)||0)/100/12;
  if(principal<=0 || months<=0) return 0;
  if(i===0) return round2(principal/months);
  return round2(principal * i / (1 - Math.pow(1+i, -months)));
}
function round2(n){ return Math.round(n*100)/100; }

/* Фактические платежи по долговому счёту: переводы НА него + «доходы» на него */
function actualPayments(accountId, upto){
  const limit = upto || today();
  return S.transactions.filter(t =>
      t.date <= limit && (
        (t.type==='transfer' && t.toAccountId===accountId) ||
        (t.type==='income'   && t.accountId===accountId))
    ).map(t=>({date:t.date, amount:txAmountFor(t, accountId), note:t.note||'', txId:t.id}))
     .sort((a,b)=>a.date.localeCompare(b.date));
}
/* Сколько внесено в счёт конкретной плановой строки графика.
   Частичное погашение уменьшает обязательство, а не отменяет его целиком:
   внесли 1 500 из 4 520 — платить остаётся 3 020, а не 4 520 и не ноль.
   `used` не даёт одному платежу закрыть сразу две плановые строки. */
function planPaidInfo(a, date, plannedAmount, used){
  const plan = Number(plannedAmount) || 0;
  let paid = 0;

  for(const p of actualPayments(a.id)){
    if(used && used.has(p.txId)) continue;
    if(Math.abs(daysBetween(p.date, date)) > MATCH_DAYS) continue;
    paid += p.amount;
    if(used) used.add(p.txId);
    if(paid >= plan - 0.01) break;      // строка закрыта, остальное — следующей
  }

  paid = round2(paid);
  const remaining = round2(Math.max(0, plan - paid));
  return {
    paid, remaining, planned: plan,
    status: paid <= 0.01 ? 'none' : (remaining <= 0.01 ? 'full' : 'part')
  };
}

/* Новые начисления по долгу: траты с этого счёта / переводы с него */
function actualCharges(accountId, upto){
  const limit = upto || today();
  return S.transactions.filter(t =>
      t.date <= limit && (
        (t.type==='transfer' && t.accountId===accountId) ||
        (t.type==='expense'  && t.accountId===accountId))
    ).map(t=>({date:t.date, amount:t.amount, note:t.note||''}))
     .sort((a,b)=>a.date.localeCompare(b.date));
}

/* -------------------------------------------------------------------------
   Остаток долга по кредиту с учётом начисления процентов.
   Каждый внесённый платёж сначала покрывает проценты за период,
   остаток идёт на погашение тела долга. Это тот же расчёт, что и в графике,
   поэтому карточка долга и таблица графика всегда показывают одно число.
   ------------------------------------------------------------------------- */
function loanBalance(a, upto){
  let bal = Number(a.openingBalance) || 0;
  const rate = (Number(a.rate)||0)/100/12;
  const pays = actualPayments(a.id, upto);
  for(const p of pays){
    const interest = round2(bal * rate);
    const principal = p.amount - interest;
    bal = round2(Math.max(0, bal - principal));
    if(bal === 0) break;
  }
  for(const c of actualCharges(a.id, upto)) bal = round2(bal + c.amount);
  return bal;
}

/* -------------------------------------------------------------------------
   Построение графика для КРЕДИТА.
   Учитывает фактически внесённые платежи: они гасят долг, а остаток графика
   пересчитывается от реального остатка. Переплата сверх графика сокращает срок.
   ------------------------------------------------------------------------- */
function loanSchedule(a){
  const rows = [];
  const rate = (Number(a.rate)||0)/100/12;
  const pays = actualPayments(a.id);

  /* --- ручной график банка: показываем как есть, отмечаем оплаченные --- */
  if(a.scheduleMode==='manual' && Array.isArray(a.manualSchedule) && a.manualSchedule.length){
    let bal = Number(a.openingBalance)||0;
    const used = new Set();
    for(const r of [...a.manualSchedule].sort((x,y)=>x.date.localeCompare(y.date))){
      // ищем фактический платёж в пределах ±10 дней
      const hit = pays.find((p,idx)=> !used.has(idx) && Math.abs(daysBetween(p.date, r.date))<=10 && !used.has(idx));
      let paid = null;
      if(hit){ const idx = pays.indexOf(hit); if(!used.has(idx)){ used.add(idx); paid = hit; } }
      const amount = Number(r.amount)||0;
      const interest = r.interest!=null ? Number(r.interest) : round2(bal*rate);
      const principal = round2((paid ? paid.amount : amount) - interest);
      bal = round2(Math.max(0, bal - principal));
      rows.push({date:r.date, payment:amount, interest, principal, balance:bal,
                 paid: !!paid, paidAmount: paid?paid.amount:null, paidDate: paid?paid.date:null});
    }
    // платежи, не попавшие ни в одну строку графика (досрочные)
    pays.forEach((p,idx)=>{ if(!used.has(idx)) rows.push({date:p.date, payment:p.amount, interest:0,
      principal:p.amount, balance:null, paid:true, paidAmount:p.amount, extra:true, note:p.note}); });
    rows.sort((x,y)=>x.date.localeCompare(y.date));
    return rows;
  }

  /* --- автоматический аннуитет --- */
  let bal = Number(a.openingBalance)||0;
  let payment = Number(a.payment) || annuity(bal, a.rate, a.termMonths);
  if(!payment || payment<=0) return rows;

  // 1) сначала проводим фактические платежи
  for(const p of pays){
    const interest = round2(bal*rate);
    const principal = round2(p.amount - interest);
    bal = round2(Math.max(0, bal - principal));
    rows.push({date:p.date, payment:p.amount, interest, principal, balance:bal,
               paid:true, paidAmount:p.amount, note:p.note});
  }

  // 2) дальше — плановый график от текущего остатка
  let d = a.nextPaymentDate || today();
  if(pays.length){
    const lastPay = pays[pays.length-1].date;

    /* Последний платёж мог быть частичным. Тогда обязательство за этот период
       не закрыто, и переносить срок на месяц вперёд нельзя: остаток надо
       довнести. Отдельной строкой на ту же дату. */
    const inWindow = pays
      .filter(p => Math.abs(daysBetween(p.date, lastPay)) <= MATCH_DAYS)
      .reduce((s,p)=>s+p.amount, 0);
    if(inWindow < payment - 0.01){
      rows.push({date:lastPay, payment:round2(payment - inWindow), interest:0,
                 principal:round2(payment - inWindow), balance:bal,
                 paid:false, partial:true, planned:payment, paidPart:round2(inWindow)});
    }

    // следующий плановый — на месяц позже последнего платежа либо nextPaymentDate, что позже
    d = addMonths(lastPay, 1);
    if(a.nextPaymentDate && a.nextPaymentDate > d) d = a.nextPaymentDate;
  }
  let guard = 0;
  while(bal > 0.01 && guard < 600){
    const interest = round2(bal*rate);
    let pay = payment;
    if(pay <= interest && rate>0){ // платёж не покрывает проценты — некорректные данные
      rows.push({date:d, payment:pay, interest, principal:0, balance:bal, error:true});
      break;
    }
    let principal = round2(pay - interest);
    if(principal >= bal){ principal = bal; pay = round2(bal + interest); }
    bal = round2(bal - principal);
    rows.push({date:d, payment:pay, interest, principal, balance:bal, paid:false});
    d = addMonths(d, 1);
    guard++;
  }
  return rows;
}

function daysBetween(a,b){ return Math.round((parseISO(a)-parseISO(b))/86400000); }

/* Склонение: 1 день, 2 дня, 5 дней */
function plural(n, one, few, many){
  n = Math.abs(n) % 100;
  const n1 = n % 10;
  if(n > 10 && n < 20) return many;
  if(n1 > 1 && n1 < 5) return few;
  if(n1 === 1) return one;
  return many;
}

/* -------------------------------------------------------------------------
   КРЕДИТНАЯ КАРТА

   Льготный период: пока он не закончился, проценты не начисляются — но только
   если весь долг погашен до его окончания. Не успели — банк начисляет полную
   ставку, и минимальный платёж считается как процент от долга
   (но не меньше фиксированной суммы, если она задана).
   ------------------------------------------------------------------------- */

/* Дата окончания льготного периода (или null, если он не задан) */
function graceEnd(a){
  if(a.graceUntil) return a.graceUntil;
  if(a.gracePeriodDays) return addDays(today(), Number(a.gracePeriodDays));
  return null;
}
/* Сколько дней осталось: >0 — ещё действует, <=0 — истёк */
function graceDaysLeft(a){
  const g = graceEnd(a);
  return g ? daysBetween(g, today()) : null;
}
/* Минимальный платёж при заданном остатке */
function cardMinPayment(a, bal){
  const share = (a.minPercent!=null ? Number(a.minPercent) : 5)/100;
  const floor = Number(a.minPayment)||0;
  return round2(Math.max(bal*share, floor, 100));  // 100 ₽ — технический минимум, чтобы долг гасился
}

/* mode: 'min'  — платим минимальный платёж (проценты после льготного периода)
         'full' — гасим всё одной суммой до конца льготного периода            */
function cardSchedule(a, mode){
  mode = mode || 'min';
  const rows = [];
  let bal = balance(a);
  if(bal<=0) return rows;

  const rate = (Number(a.rate)||0)/100/12;
  const gEnd = graceEnd(a);

  /* Загружен график банка — считаем по нему, свои формулы не навязываем */
  if(a.scheduleMode === 'manual' && Array.isArray(a.manualSchedule) && a.manualSchedule.length){
    const pays = actualPayments(a.id);
    const used = new Set();
    let left = bal;
    for(const r of [...a.manualSchedule].sort((x,y)=>x.date.localeCompare(y.date))){
      let paid = null;
      pays.forEach((p,idx)=>{
        if(!paid && !used.has(idx) && Math.abs(daysBetween(p.date, r.date)) <= 10){ used.add(idx); paid = p; }
      });
      const amount = Number(r.amount)||0;
      const interest = r.interest!=null ? Number(r.interest) : 0;
      const principal = round2((paid ? paid.amount : amount) - interest);
      left = round2(Math.max(0, left - principal));
      rows.push({date:r.date, payment:amount, interest, principal, balance:left,
                 paid: !!paid, paidAmount: paid?paid.amount:null});
    }
    pays.forEach((p,idx)=>{ if(!used.has(idx)) rows.push({date:p.date, payment:p.amount, interest:0,
      principal:p.amount, balance:null, paid:true, paidAmount:p.amount, extra:true}); });
    rows.sort((x,y)=>x.date.localeCompare(y.date));
    return rows;
  }

  if(mode==='full'){
    const d = (gEnd && gEnd>=today()) ? gEnd : nextDayOfMonth(a.paymentDay || 25);
    return [{date:d, payment:bal, interest:0, principal:bal, balance:0, grace:!!(gEnd && gEnd>=today()), full:true}];
  }

  let d = nextDayOfMonth(a.paymentDay || 25);
  const LIMIT = 720;              // 60 лет — дальше считать бессмысленно
  let guard = 0;
  while(bal>0.01 && guard<LIMIT){
    // проценты не начисляются, пока платёж приходится на льготный период
    const inGrace = !!(gEnd && d <= gEnd);
    const interest = inGrace ? 0 : round2(bal*rate);
    let pay = cardMinPayment(a, bal);

    if(pay <= interest){
      rows.push({date:d, payment:pay, interest, principal:0, balance:bal, error:true});
      break;
    }
    let principal = round2(pay - interest);
    if(principal >= bal){ principal = bal; pay = round2(bal + interest); }
    bal = round2(bal - principal);
    rows.push({date:d, payment:pay, interest, principal, balance:bal, paid:false, grace:inGrace});
    d = addMonths(d,1); guard++;
  }
  // долг так и не погашен за 60 лет — минимальный платёж почти целиком уходит в проценты
  if(bal > 0.01 && rows.length) rows[rows.length-1].truncated = true;
  return rows;
}

/* «40 месяцев» → «3 года 4 месяца» */
function formatTerm(months){
  months = Math.round(months);
  if(months < 24) return months + ' ' + plural(months,'месяц','месяца','месяцев');
  const y = Math.floor(months/12), m = months%12;
  let s = y + ' ' + plural(y,'год','года','лет');
  if(m) s += ' ' + m + ' ' + plural(m,'месяц','месяца','месяцев');
  return s;
}
function nextDayOfMonth(day){
  const n = new Date();
  let d = new Date(n.getFullYear(), n.getMonth(), Math.min(day, new Date(n.getFullYear(), n.getMonth()+1, 0).getDate()));
  if(iso(d) < today()) d = parseISO(addMonths(iso(d),1));
  return iso(d);
}

/* -------------------------------------------------------------------------
   РАССРОЧКА / СПЛИТ
   Обычно без процентов: равные платежи через равные промежутки.
   Считаем от текущего остатка, поэтому досрочные взносы сокращают график.
   ------------------------------------------------------------------------- */

/* Сколько платежей осталось при текущем остатке */
function installmentPartsLeft(a){
  const bal = balance(a);
  if(bal <= 0) return 0;
  const pay = Number(a.payment) || 0;
  if(pay > 0) return Math.ceil(round2(bal) / pay);
  return Number(a.partsLeft) || 0;
}

function installmentSchedule(a){
  const rows = [];
  let bal = balance(a);
  if(bal <= 0) return rows;

  let pay = Number(a.payment) || 0;
  if(pay <= 0){
    const n = Number(a.partsLeft) || 0;
    if(n <= 0) return rows;
    pay = round2(bal / n);
  }

  let d = a.nextPaymentDate || today();
  if(d < today()) d = today();
  let guard = 0;
  while(bal > 0.01 && guard < 240){
    const amount = Math.min(pay, bal);
    bal = round2(bal - amount);
    rows.push({date:d, payment:amount, interest:0, principal:amount, balance:bal, paid:false});
    d = (a.freq === 'biweekly') ? addDays(d, 14) : addMonths(d, 1);
    guard++;
  }
  return rows;
}

/* Единая точка: будущие обязательные платежи по всем долгам, от сегодня.
   Если платёж по этому долгу уже внесён сегодня, сегодняшнюю плановую строку
   пропускаем — иначе прогноз спишет деньги второй раз. */
function futureDebtPayments(untilDate){
  const out = [];
  const T = today();

  for(const a of debtAccounts()){
    if(balance(a) <= 0) continue;

    let sched = [];
    if(a.type==='loan') sched = loanSchedule(a).filter(r=>!r.paid && !r.error);
    else if(a.type==='credit_card') sched = cardSchedule(a).filter(r=>!r.error);
    else if(a.type==='installment') sched = installmentSchedule(a);
    else if(a.type==='debt' && a.dueDate) sched = [{date:a.dueDate, payment:balance(a)}];

    const used = new Set();
    for(const r of sched){
      if(r.date < T || r.date > untilDate) continue;

      /* Частичный платёж уменьшает обязательство. Строка-остаток по кредиту
         уже посчитана в графике — её повторно не зачитываем. */
      const info = r.partial ? null : planPaidInfo(a, r.date, r.payment, used);
      const cur = accCurrency(a);

      if(info && info.status === 'full'){
        /* Закрыт полностью: строку показываем, но в сумму дня не берём —
           деньги уже ушли отдельной операцией. Исчезать ничего не должно. */
        out.push({date:r.date, name:a.name, amount:toBase(r.payment, cur),
                  accountId:a.id, kind:'debt', done:true, paidNote:'оплачено'});
        continue;
      }
      const left = info ? info.remaining : r.payment;
      out.push({date:r.date, name: a.name + ((info && info.status==='part') || r.partial ? ' — остаток' : ''),
                amount: toBase(left, cur), accountId:a.id, kind:'debt'});
    }
  }
  return out;
}

/* ---------------- рендер экрана «Долги» ---------------- */
/* Ячейка «След. платёж»: главное — когда платить, сумма подписью.
   Просроченный платёж остаётся ближайшим и подсвечивается. */
function nextPayCell(r){
  if(!r) return `<div class="stat"><div class="n" style="font-size:14px">—</div>
    <div class="l">След. платёж</div></div>`;

  const T = today();
  const dt = parseISO(r.date), ty = parseISO(T);
  const year = dt.getFullYear() !== ty.getFullYear() ? ' ' + dt.getFullYear() : '';
  const late = r.date < T, now = r.date === T;
  const part = r.paidPart > 0 && r.remaining != null && r.remaining < r.planned - 0.01;
  const when = part ? 'осталось внести' : late ? 'просрочен' : now ? 'сегодня' : 'След. платёж';
  const sum  = r.remaining != null ? r.remaining : r.payment;

  return `<div class="stat"><div class="n${late||now?' neg':''}" style="font-size:14px">${dateShort(r.date)}${year}</div>
    <div class="l">${when} · ${money(sum)}</div>
    ${part ? `<div class="l" style="margin-top:0">внесено ${money(r.paidPart)} из ${money(r.planned)}</div>` : ''}</div>`;
}

function renderDebts(){
  const list = debtAccounts();
  const box = document.getElementById('debtList');

  const total = list.reduce((s,a)=>s+Math.max(0,balance(a)),0);
  document.getElementById('dTotal').textContent = moneyShort(total);

  const horizon = addDays(today(), 31);
  const monthly = futureDebtPayments(horizon).reduce((s,p)=>s+p.amount,0);
  document.getElementById('dMonthly').textContent = moneyShort(monthly);

  if(!list.length){
    box.innerHTML = `<div class="card"><div class="empty"><span class="big">✓</span>
      Долговых счетов нет.<br>Добавьте кредит, ипотеку или кредитную карту на вкладке «Счета», чтобы видеть график погашения.</div></div>`;
    return;
  }

  box.innerHTML = list.map(a=>{
    const bal = balance(a);
    const start = Number(a.openingBalance)||0;
    const paidOff = Math.max(0, start - bal);
    const pct = start>0 ? Math.min(100, paidOff/start*100) : 0;

    let sched = [];
    if(a.type==='loan') sched = loanSchedule(a);
    else if(a.type==='credit_card') sched = cardSchedule(a);
    else if(a.type==='installment') sched = installmentSchedule(a);

    const future = sched.filter(r=>!r.paid && !r.error);
    /* Ближайшая строка — с учётом того, что часть уже могла быть внесена */
    let nextPay = future[0];
    if(nextPay){
      const info = nextPay.partial
        ? { paid: nextPay.paidPart||0, remaining: nextPay.payment, planned: nextPay.planned||nextPay.payment }
        : planPaidInfo(a, nextPay.date, nextPay.payment, new Set());
      nextPay = Object.assign({}, nextPay,
        { paidPart: info.paid, remaining: info.remaining, planned: info.planned || nextPay.payment });
    }
    const totalInterest = future.reduce((s,r)=>s+(r.interest||0),0);
    const neverPaid = sched.some(r=>r.truncated);
    const payoffDate = future.length ? future[future.length-1].date : (a.dueDate||null);

    let meta = '';
    if(a.type==='installment'){
      const left = installmentPartsLeft(a);
      const last = sched.length ? sched[sched.length-1].date : null;
      meta = `<div class="grid3" style="margin:10px 0">
        ${nextPayCell(nextPay)}
        <div class="stat"><div class="n" style="font-size:14px">${left||'—'}</div><div class="l">Осталось платежей</div></div>
        <div class="stat"><div class="n" style="font-size:14px">${last?dateShort(last)+' '+parseISO(last).getFullYear():'—'}</div><div class="l">Закрытие</div></div>
      </div>
      <div style="font-size:12px;color:var(--muted)">
        ${a.freq==='biweekly'?'Раз в 2 недели':'Ежемесячно'} · без процентов</div>`;
    }
    else if(a.type==='loan' || a.type==='credit_card'){
      meta = `<div class="grid3" style="margin:10px 0">
        ${nextPayCell(nextPay)}
        <div class="stat"><div class="n" style="font-size:14px">${neverPaid?'—':(payoffDate?dateShort(payoffDate)+' '+parseISO(payoffDate).getFullYear():'—')}</div><div class="l">Закрытие</div></div>
        <div class="stat"><div class="n" style="font-size:14px">${neverPaid?'—':(totalInterest>0?moneyShort(totalInterest):'—')}</div><div class="l">Переплата</div></div>
      </div>`;
    }
    if(a.type==='credit_card'){
      /* Льготный период: статус и обратный отсчёт */
      const left = graceDaysLeft(a);
      const gEnd = graceEnd(a);
      if(gEnd){
        if(left > 0){
          const full = cardSchedule(a,'full')[0];
          const minSched = cardSchedule(a,'min').filter(r=>!r.error);
          const minInterest = minSched.reduce((s,r)=>s+(r.interest||0),0);
          const cls = left<=10 ? 'warn' : '';
          meta += `<div class="note ${cls}" style="margin-top:10px">
            <b>Льготный период: осталось ${left} ${plural(left,'день','дня','дней')}</b> — до ${dateLong(gEnd)}.<br>
            Погасите <b>${money(full.payment)}</b> до этой даты — процентов не будет.
            ${minInterest>0?`Если платить только минимальный платёж, переплата составит около <b>${money(minInterest)}</b>.`:''}
          </div>`;
        } else {
          meta += `<div class="note err" style="margin-top:10px">
            <b>Льготный период истёк</b> ${dateLong(gEnd)}.
            Начисляется полная ставка${a.rate?' '+pct(a.rate)+'% годовых':''}, минимальный платёж —
            ${pct(a.minPercent!=null?a.minPercent:5)}% от долга${a.minPayment?', но не менее '+money(a.minPayment):''}.
          </div>`;
        }
      }
      if(a.limit){
        const use = a.limit>0 ? bal/a.limit*100 : 0;
        meta += `<div style="font-size:12px;color:var(--muted);margin-top:6px">Использовано ${use.toFixed(0)}% лимита · доступно ${money(Math.max(0,a.limit-bal))}</div>`;
      }
    }
    if(a.type==='debt'){
      meta = `<div style="font-size:12.5px;color:var(--muted);margin:8px 0">
        ${a.dueDate ? 'Срок возврата: <b>'+dateLong(a.dueDate)+'</b>' : 'Срок не указан'}</div>`;
    }

    const T = ACC_TYPES[a.type];
    const barCls = pct>66?'g':pct>33?'a':'r';
    return `<div class="card">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div class="acc" style="padding:0;border:none;flex:1">
          <div class="ico" style="background:${T.bg}">${T.icon}</div>
          <div class="l"><div class="nm">${esc(a.name)}</div><div class="sb">${T.label}${a.rate?' · '+a.rate+'%':''}</div></div>
          <div class="bal neg">${money(bal)}</div>
        </div>
      </div>
      <div class="bar ${barCls}"><i style="width:${pct}%"></i></div>
      <div style="display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted)">
        <span>Погашено ${money(paidOff)} (${pct.toFixed(0)}%)</span><span>Изначально ${money(start)}</span>
      </div>
      ${meta}
      <div class="btnrow" style="margin-top:10px">
        <button class="btn btn-p btn-sm" onclick="quickPay('${a.id}')">Внести платёж</button>
        ${(a.type==='loan'||a.type==='credit_card'||a.type==='installment')?`<button class="btn btn-s btn-sm" onclick="showSchedule('${a.id}')">График</button>`:''}
        <button class="btn btn-s btn-sm" onclick="openAccount('${a.id}')">Настроить</button>
      </div>
    </div>`;
  }).join('');
}

/* Быстрое внесение платежа = перевод с ликвидного счёта на долговой */
function quickPay(debtId, presetAmount, presetDate){
  const a = acc(debtId);
  const froms = liquidAccounts();
  if(!froms.length){ toast('Сначала добавьте карту или наличные'); return; }

  let suggested = presetAmount != null ? presetAmount : '';
  if(presetAmount != null){ /* сумма пришла из напоминания */ }
  else if(a.type==='loan'){
    const s = loanSchedule(a).filter(r=>!r.paid && !r.error);
    if(s.length) suggested = s[0].payment;
  } else if(a.type==='credit_card'){
    const s = cardSchedule(a);
    if(s.length) suggested = s[0].payment;
  } else if(a.type==='installment'){
    const s = installmentSchedule(a);
    if(s.length) suggested = s[0].payment;
  }

  document.getElementById('ovTxBody').innerHTML = `
    <h3>Платёж: ${esc(a.name)}</h3>
    <div class="note">Текущий долг ${money(balance(a))}. Платёж уменьшит долг и спишется с выбранного счёта.</div>
    <div class="f2">
      <div class="f"><label>Дата</label><input type="date" id="qpDate" value="${presetDate && presetDate <= today() ? presetDate : today()}"></div>
      <div class="f"><label>Сумма, ₽</label><input type="number" step="0.01" id="qpAmount" value="${suggested}"></div>
    </div>
    <div class="f"><label>Откуда списать</label>
      <select id="qpFrom">${froms.map(x=>`<option value="${x.id}">${esc(accLabel(x))} — ${money(balance(x))}</option>`).join('')}</select></div>
    <div class="f"><label>Комментарий</label><input type="text" id="qpNote" placeholder="напр. досрочное погашение"></div>
    <button class="btn btn-p btn-blk" onclick="saveQuickPay('${debtId}')">Внести платёж</button>`;
  openOv('ovTx');
}
function saveQuickPay(debtId){
  const amount = parseFloat(document.getElementById('qpAmount').value);
  if(!amount || amount<=0){ toast('Введите сумму'); return; }
  S.transactions.push({
    id: uid(), date: document.getElementById('qpDate').value || today(),
    type:'transfer', accountId: document.getElementById('qpFrom').value,
    toAccountId: debtId, amount, note: document.getElementById('qpNote').value.trim() || 'Платёж по долгу',
    source:'manual'
  });
  save(); closeOv('ovTx'); renderAll(); toast('Платёж учтён, график пересчитан');
}

/* ---------------- окно графика ---------------- */
function showSchedule(id){
  const a = acc(id);
  const rows = a.type==='loan' ? loanSchedule(a)
             : a.type==='installment' ? installmentSchedule(a)
             : cardSchedule(a);
  const paidCount = rows.filter(r=>r.paid).length;
  const totalPay = rows.reduce((s,r)=>s+(r.payment||0),0);
  const totalInt = rows.reduce((s,r)=>s+(r.interest||0),0);

  const manualBlock = (a.type==='loan' || a.type==='credit_card') ? `
    <div class="sec-title" style="margin-top:18px">Свой график погашения</div>
    <div class="note">Если банк присылает точный график — внесите его, и расчёт пойдёт по нему.
      Можно вписать строки вручную или распознать скриншот из приложения банка.</div>

    <div class="btnrow" style="margin-bottom:10px">
      <button class="btn btn-s btn-sm" onclick="pickScheduleImage('${id}')">Распознать скриншот</button>
      ${a.scheduleMode==='manual'?`<button class="btn btn-s btn-sm" onclick="switchToAuto('${id}')">Вернуться к авторасчёту</button>`:''}
    </div>
    <div id="ocrStatus"></div>

    <div class="f"><label>Строки графика: дата, сумма, проценты (проценты необязательны)</label>
      <textarea id="schedPaste" rows="6" placeholder="05.09.2026;79315&#10;05.10.2026;79315;9200">${
        (a.scheduleMode==='manual' && Array.isArray(a.manualSchedule))
          ? a.manualSchedule.map(r=>`${r.date};${r.amount}${r.interest!=null?';'+r.interest:''}`).join('\n')
          : ''}</textarea>
      <div class="hint">Разделитель — точка с запятой. Даты в любом привычном виде.</div></div>
    <button class="btn btn-p btn-sm btn-blk" onclick="applyManualSchedule('${id}')">Сохранить график</button>` : '';

  /* Для кредитки — сравнение двух сценариев */
  let graceBlock = '';
  if(a.type==='credit_card'){
    const gEnd = graceEnd(a), left = graceDaysLeft(a);
    const full = cardSchedule(a,'full')[0];
    if(gEnd && left > 0 && full){
      graceBlock = `
        <div class="note ok" style="margin-bottom:12px">
          <b>Вариант 1 — погасить в льготный период.</b><br>
          Внести ${money(full.payment)} до ${dateLong(gEnd)} (осталось ${left} ${plural(left,'день','дня','дней')}).
          Проценты — <b>0 ₽</b>.
        </div>
        <div class="note ${(rows.some(r=>r.truncated) || rows.length>120)?'err':'warn'}" style="margin-bottom:12px">
          <b>Вариант 2 — платить минимальный платёж.</b><br>
          По ${pct(a.minPercent!=null?a.minPercent:5)}% от долга${a.minPayment?' (но не менее '+money(a.minPayment)+')':''}.
          ${rows.some(r=>r.truncated)
            ? `За 60 лет долг так и не закроется: почти весь платёж уходит на проценты.
               Минимальный платёж ${pct(a.minPercent)}% не перекрывает ставку ${pct(a.rate)}% годовых.`
            : `Долг закроется за <b>${formatTerm(rows.length)}</b>, переплата <b>${money(totalInt)}</b>.` +
              (rows.length>120
                ? ` Это ловушка минимального платежа: он лишь немного превышает проценты,
                    поэтому долг тает крайне медленно, а переплата в ${(totalInt/Math.max(1,balance(a))).toFixed(1).replace('.',',')} раза
                    превысит сам долг. Вносите больше минимума, когда возможно.`
                : '')}
        </div>`;
    } else if(gEnd){
      graceBlock = `<div class="note err" style="margin-bottom:12px">
        <b>Льготный период истёк ${dateLong(gEnd)}.</b> Проценты начисляются по ставке
        ${pct(a.rate||0)}% годовых. Минимальный платёж — ${pct(a.minPercent!=null?a.minPercent:5)}% от долга${a.minPayment?', но не менее '+money(a.minPayment):''}.
        ${rows.some(r=>r.truncated)
          ? 'Платить только минимальный платёж бессмысленно: он почти целиком уходит на проценты, долг не уменьшается. Нужно вносить больше.'
          : `Долг закроется за <b>${formatTerm(rows.length)}</b>, переплата составит <b>${money(totalInt)}</b>.`}
      </div>`;
    }
  }

  const modeNote = a.type==='installment'
    ? `<div class="note">Рассрочка без процентов: ${a.freq==='biweekly'?'платёж раз в 2 недели':'платёж раз в месяц'}.
        Внесёте больше — график сократится сам.</div>`
    : a.type==='credit_card'
    ? `<div class="note">Минимальный платёж: <b>${pct(a.minPercent!=null?a.minPercent:5)}%</b> от долга${a.minPayment?`, но не менее <b>${money(a.minPayment)}</b>`:''}.
        Строки внутри льготного периода отмечены — по ним проценты не начисляются.</div>`
    : `<div class="note">Режим: <b>${a.scheduleMode==='manual'?'график банка':'автоматический аннуитет'}</b>.
        Внесённые платежи подсвечены, остаток графика пересчитан от реального долга.</div>`;

  document.getElementById('ovSchedBody').innerHTML = `
    <h3>График: ${esc(a.name)}</h3>
    <div class="grid3" style="margin-bottom:12px">
      <div class="stat"><div class="n" style="font-size:14px">${rows.length}</div><div class="l">Платежей всего</div></div>
      <div class="stat"><div class="n pos" style="font-size:14px">${paidCount}</div><div class="l">Уже внесено</div></div>
      <div class="stat"><div class="n" style="font-size:14px">${moneyShort(totalInt)}</div><div class="l">Проценты</div></div>
    </div>
    ${graceBlock}
    ${modeNote}
    <div class="scrollx scrolly">
      <table class="tbl">
        <thead><tr><th>Дата</th><th class="r">Платёж</th><th class="r">Проценты</th><th class="r">Тело долга</th><th class="r">Остаток</th><th></th></tr></thead>
        <tbody>${rows.map(schedRow).join('')}</tbody>
      </table>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Всего к выплате: <b>${money(totalPay)}</b></div>
    ${manualBlock}`;
  openOv('ovSched');
}
function schedRow(r){
  const cls = r.paid ? 'paid' : (r.date<=addDays(today(),7) && r.date>=today() ? 'today' : '');
  const mark = r.error ? '<span class="chip bad">платёж меньше процентов</span>'
             : r.extra ? '<span class="chip info">досрочно</span>'
             : r.paid  ? '<span class="chip ok">внесён</span>'
             : r.grace ? '<span class="chip ok">льготный</span>' : '';
  return `<tr class="${cls}">
    <td>${dateShort(r.date)} ${parseISO(r.date).getFullYear()}</td>
    <td class="r">${money(r.paidAmount!=null?r.paidAmount:r.payment)}</td>
    <td class="r mut">${r.interest?money(r.interest):'—'}</td>
    <td class="r">${r.principal?money(r.principal):'—'}</td>
    <td class="r">${r.balance!=null?money(r.balance):'—'}</td>
    <td>${mark}</td></tr>`;
}
function applyManualSchedule(id){
  const txt = document.getElementById('schedPaste').value.trim();
  if(!txt){ toast('Вставьте строки графика'); return; }
  const rows = [];
  for(const line of txt.split(/\r?\n/)){
    if(!line.trim()) continue;
    const parts = line.split(/[;\t|]/).map(s=>s.trim());
    const d = parseAnyDate(parts[0]);
    const amt = parseAnyNumber(parts[1]);
    if(!d || amt===null) continue;
    const int = parts[2] ? parseAnyNumber(parts[2]) : null;
    rows.push({date:d, amount:Math.abs(amt), interest: int!=null?Math.abs(int):null});
  }
  if(!rows.length){ toast('Не удалось разобрать ни одной строки'); return; }
  const a = acc(id);
  a.manualSchedule = rows; a.scheduleMode = 'manual';
  save(); showSchedule(id); renderAll();
  toast(`Загружено строк графика: ${rows.length}`);
}
function switchToAuto(id){
  const a = acc(id); a.scheduleMode = 'auto';
  save(); showSchedule(id); renderAll(); toast('Переключено на авторасчёт');
}


/* =========================================================================
   РАСПОЗНАВАНИЕ СКРИНШОТА ГРАФИКА
   Библиотека распознавания загружается только когда она понадобилась,
   чтобы не замедлять запуск приложения.
   ========================================================================= */

var OCR_TARGET = null;

function pickScheduleImage(accountId){
  OCR_TARGET = accountId;
  document.getElementById('schedImageInput').click();
}

function ocrSay(html){
  const el = document.getElementById('ocrStatus');
  if(el) el.innerHTML = html;
}

/* Подгружаем библиотеку по требованию */
function loadOcrEngine(){
  if(window.Tesseract) return Promise.resolve();
  return new Promise((resolve, reject)=>{
    const sc = document.createElement('script');
    sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.min.js';
    sc.onload = resolve;
    sc.onerror = () => reject(new Error('не удалось загрузить модуль распознавания'));
    document.head.appendChild(sc);
  });
}

document.getElementById('schedImageInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file || !OCR_TARGET) return;

  ocrSay('<div class="note">Загружаю модуль распознавания… Первый раз это занимает до минуты.</div>');
  try{
    await loadOcrEngine();
    ocrSay('<div class="note">Распознаю текст на изображении…</div>');

    const res = await Tesseract.recognize(file, 'rus+eng', {
      logger: m => {
        if(m.status === 'recognizing text'){
          ocrSay(`<div class="note">Распознаю: ${Math.round((m.progress||0)*100)}%</div>`);
        }
      }
    });

    const lines = (res.data.text || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    const found = extractScheduleRows(lines);

    if(!found.length){
      ocrSay(`<div class="note warn">Не нашла строк вида «дата — сумма».
        Попробуйте скриншот покрупнее или впишите строки вручную.</div>`);
      return;
    }

    const box = document.getElementById('schedPaste');
    if(box){
      const text = found.map(r=>`${r.date};${r.amount}`).join('\n');
      box.value = box.value.trim() ? box.value.trim() + '\n' + text : text;
    }
    ocrSay(`<div class="note ok">Распознано строк: <b>${found.length}</b>.
      Проверьте их в поле ниже и нажмите «Сохранить график».</div>`);
    toast('Распознано строк: ' + found.length);

  }catch(err){
    console.error('OCR', err);
    ocrSay(`<div class="note err">Не получилось распознать: ${esc(err.message||String(err))}.
      Впишите строки вручную — это надёжнее.</div>`);
  }
});

/* Достаём из текста пары «дата — сумма» */
function extractScheduleRows(lines){
  const out = [];
  const dateRe = /(\d{1,2}[.\-\/\s]\d{1,2}[.\-\/\s]\d{2,4}|\d{1,2}\s+[а-яё]{3,}\.?\s*\d{0,4})/i;
  for(const line of lines){
    const dm = line.match(dateRe);
    if(!dm) continue;
    const date = parseAnyDate(dm[1].replace(/\s+/g,' ').trim());
    if(!date) continue;

    const rest = line.slice(line.indexOf(dm[1]) + dm[1].length);
    const nums = [];
    const re = /(\d[\d\s ]*(?:[.,]\d{1,2})?)/g;
    let m;
    while((m = re.exec(rest)) !== null){
      const v = parseAnyNumber(m[1]);
      if(v !== null && Math.abs(v) >= 10) nums.push(Math.abs(v));
    }
    if(!nums.length) continue;
    out.push({date, amount: nums[0]});
  }
  return out;
}


/* =========================================================================
   НАПОМИНАНИЯ О ПЛАТЕЖАХ ПО ДОЛГАМ
   Смотрим и вперёд, и назад: просроченный платёж выпадал из прогноза
   и о нём никто не напоминал.
   ========================================================================= */

function debtReminders(daysAhead){
  const ahead = daysAhead == null ? 7 : daysAhead;
  const T = today();
  const limit = addDays(T, ahead);
  const out = [];

  for(const a of debtAccounts()){
    if(balance(a) <= 0) continue;

    let sched = [];
    if(a.type==='loan')             sched = loanSchedule(a).filter(r=>!r.paid && !r.error);
    else if(a.type==='credit_card') sched = cardSchedule(a).filter(r=>!r.error);
    else if(a.type==='installment') sched = installmentSchedule(a);
    else if(a.type==='debt' && a.dueDate) sched = [{date:a.dueDate, payment:balance(a)}];

    const used = new Set();
    for(const r of sched){
      const key = planKey('debt', a.id, r.date);
      const ov  = planOverride(key);
      const date   = (ov && ov.date) ? ov.date : r.date;
      const amount = (ov && ov.amount != null) ? ov.amount : r.payment;
      if(date > limit) continue;

      /* Платежи в счёт этой строки. Строку НЕ убираем — пользователь должен
         видеть, что именно было запланировано. Частичное погашение уменьшает
         сумму к внесению, но не закрывает обязательство. */
      const info = r.partial
        ? { paid: r.paidPart || 0, remaining: amount, planned: r.planned || amount, status:'part' }
        : planPaidInfo(a, date, amount, used);

      const late = daysBetween(T, date);            // >0 — сколько дней просрочено
      const base = date < T ? 'overdue' : (date === T ? 'today' : 'soon');

      out.push({
        accountId: a.id,
        name: a.name,
        type: a.type,
        date,
        amount: info.status === 'full' ? amount : info.remaining,   // сколько внести
        planned: amount,                                            // сколько было по плану
        paidPart: info.paid,
        planKey: key,
        currency: accCurrency(a),
        paid: info.status === 'full',
        paidAmount: info.status === 'full' ? info.paid : null,
        edited: !!(ov && (ov.date || ov.amount != null)),
        status: info.status === 'full' ? 'paid' : (info.status === 'part' ? 'partial' : base),
        baseStatus: base,
        daysLate: late
      });
    }
  }
  out.sort((x,y)=>x.date.localeCompare(y.date));
  return out;
}

function renderDebtReminders(){
  const card = document.getElementById('cardDebtDue');
  const box  = document.getElementById('debtDue');
  if(!box || !card) return;

  const list = debtReminders(7);
  if(!list.length){ card.style.display = 'none'; return; }
  card.style.display = 'block';

  const overdue = list.filter(x=>x.baseStatus==='overdue' && !x.paid).length;
  const head = document.getElementById('debtDueHead');
  if(head) head.textContent = overdue
    ? `Платежи по долгам · просрочено ${overdue}`
    : 'Платежи по долгам';

  box.innerHTML = list.map(x=>{
    const late = x.baseStatus === 'overdue'
      ? `<span class="chip bad">просрочен на ${x.daysLate} ${plural(x.daysLate,'день','дня','дней')}</span>`
      : x.baseStatus === 'today'
        ? '<span class="chip opt">сегодня</span>'
        : `<span class="chip req">через ${Math.abs(x.daysLate)} ${plural(Math.abs(x.daysLate),'день','дня','дней')}</span>`;

    const chip = x.status==='paid'
        ? '<span class="chip ok">оплачено</span>'
      : x.status==='partial'
        ? '<span class="chip info">частично</span> ' + late
        : late;
    const editMark = x.edited ? ' <span class="chip info">изменён</span>' : '';

    /* Оплаченный платёж остаётся в списке — исчезать ничего не должно.
       Разница между планом и фактом видна сразу. */
    const factNote = x.status==='partial'
      ? `<div class="s">Внесено ${money(x.paidPart,{cur:x.currency})} из ${money(x.planned,{cur:x.currency})} — осталось ${money(x.amount,{cur:x.currency})}</div>`
      : (x.paid && Math.abs(x.paidAmount - x.planned) > 0.5)
        ? `<div class="s">По плану ${money(x.planned,{cur:x.currency})}, фактически ${money(x.paidAmount,{cur:x.currency})}</div>`
        : '';

    /* «Изменить» правит план целиком, «Внести» подставляет остаток к доплате */
    const actions = x.paid
      ? `<button class="btn btn-s btn-sm" onclick="editPlanned('${x.planKey}','${x.date}',${x.planned})">Изменить</button>`
      : `<button class="btn btn-s btn-sm" onclick="editPlanned('${x.planKey}','${x.date}',${x.planned})">Изменить</button>
         <button class="btn btn-p btn-sm" onclick="quickPay('${x.accountId}', ${x.amount}, '${x.date}')">Внести</button>`;

    return `<div class="row" ${x.paid?'style="opacity:.6"':''}>
      <div class="l">
        <div class="t">${esc(x.name)} ${chip}${editMark}</div>
        <div class="s">${dateLong(x.date)} · ${ACC_TYPES[x.type].label}</div>
        ${factNote}
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        <div class="v neg">${money(x.amount,{cur:x.currency})}</div>
        ${actions}
      </div>
    </div>`;
  }).join('');
}
