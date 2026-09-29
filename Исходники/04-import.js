/* =========================================================================
   ИМПОРТ ВЫПИСОК: CSV / XLSX / PDF / текст
   ========================================================================= */

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

var IMP_MY_PHONE = '';
var IMP = null;   // текущий разбираемый импорт  // {raw: [][], headers: [], map:{date,desc,amount,debit,credit}, rows:[], mode}

/* Счёт, с которого открыли «Загрузить выписку» из его развёрнутой строки —
   при первом показе списка счетов в импорте подставляем именно его. */
var IMP_PRESET_ACCOUNT = null;
function startImportFor(accountId){
  IMP_PRESET_ACCOUNT = accountId;
  go('import');
}

/* ---------------- разбор дат и чисел ---------------- */
function parseAnyDate(v){
  if(v==null) return null;
  if(v instanceof Date && !isNaN(v)) return iso(v);
  if(typeof v === 'number'){                      // серийная дата Excel
    if(v > 20000 && v < 60000){
      const d = new Date(Date.UTC(1899,11,30) + v*86400000);
      if(!isNaN(d)) return iso(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
    return null;
  }
  let s = String(v).trim();
  if(!s) return null;
  s = s.replace(/\s*(г\.|года)\s*$/i,'').trim();

  let m = s.match(/^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})/);         // 2026-08-05, 2026/08/05
  if(m) return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;

  /* Месяцы словом: русские и английские.
     Английские нужны для выписок иностранных банков — там почти всегда
     «5 Aug 2026» или «Aug 5, 2026», а не цифрами. */
  const MN = {
    'янв':1,'фев':2,'мар':3,'апр':4,'мая':5,'май':5,'июн':6,'июл':7,
    'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12,
    'jan':1,'feb':2,'mar':3,'apr':4,'may':5,'jun':6,'jul':7,
    'aug':8,'sep':9,'oct':10,'nov':11,'dec':12
  };
  const mk = (y, mo, d) => {
    y = y || String(new Date().getFullYear());
    if(String(y).length===2) y = (+y > 60 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  };

  // 5 августа 2026 · 5 Aug 2026 · 05-Aug-2026
  m = s.match(/^(\d{1,2})[\s\-.]+([a-zа-яё]{3,})\.?[\s\-.,]*(\d{2,4})?/i);
  if(m){
    const k = m[2].toLowerCase().slice(0,3);
    if(MN[k]) return mk(m[3], MN[k], m[1]);
  }
  // Aug 5, 2026 · August 5 2026
  m = s.match(/^([a-zа-яё]{3,})\.?[\s\-.]+(\d{1,2})[\s\-.,]*(\d{2,4})?/i);
  if(m){
    const k = m[1].toLowerCase().slice(0,3);
    if(MN[k]) return mk(m[3], MN[k], m[2]);
  }

  // Только цифры: 05.08.2026 · 05/08/2026 · 08-05-2026
  m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);
  if(m){
    let [_,a,b,y] = m;
    if(y.length===2) y = (+y > 60 ? '19' : '20') + y;
    /* Порядок день/месяц зависит от страны: 05/08 — это 5 августа в Европе
       и 8 мая в США. Если первое число больше 12, порядок однозначен.
       Иначе следуем настройке (по умолчанию — день первым, как в России). */
    let d = +a, mo = +b;
    if(d <= 12 && mo <= 12 && IMP_DATE_ORDER === 'mdy'){ d = +b; mo = +a; }
    else if(d > 12 && mo > 12) return null;
    else if(mo > 12){ d = +b; mo = +a; }
    if(mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return mk(y, mo, d);
  }
  return null;
}

/* Порядок дня и месяца в числовых датах: 'dmy' — 05/08 = 5 августа (Европа,
   Россия), 'mdy' — 05/08 = 8 мая (США). Переключается в интерфейсе импорта. */
var IMP_DATE_ORDER = 'dmy';

function parseAnyNumber(v){
  if(v==null || v==='') return null;
  if(typeof v === 'number') return isFinite(v) ? v : null;
  let s = String(v).trim();
  if(!s) return null;
  const neg = /^\(.*\)$/.test(s) || /^-/.test(s) || /^−/.test(s);
  s = s.replace(/руб\.?|коп\.?|RUB|USD|EUR/gi,'')
       .replace(/[()₽$€\s  ]/g,'')
       .replace(/^[−\-+]/,'');
  // 1 234,56 → 1234.56 ; 1,234.56 → 1234.56
  if(s.includes(',') && s.includes('.')){
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g,'').replace(',','.') : s.replace(/,/g,'');
  } else if(s.includes(',')){
    const after = s.split(',').pop();
    s = after.length<=2 ? s.replace(',','.') : s.replace(/,/g,'');
  }
  s = s.replace(/[^\d.]/g,'');
  if(!s || s==='.') return null;
  const n = parseFloat(s);
  if(!isFinite(n)) return null;
  return neg ? -n : n;
}

/* ---------------- загрузка файла ---------------- */
const dropEl = document.getElementById('drop');
const fileEl = document.getElementById('fileInput');
fileEl.addEventListener('change', e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=''; });
['dragenter','dragover'].forEach(ev=> dropEl.addEventListener(ev, e=>{e.preventDefault(); dropEl.classList.add('over');}));
['dragleave','drop'].forEach(ev=> dropEl.addEventListener(ev, e=>{e.preventDefault(); dropEl.classList.remove('over');}));
dropEl.addEventListener('drop', e=>{ const f = e.dataTransfer.files[0]; if(f) handleFile(f); });

async function handleFile(file){
  const name = file.name.toLowerCase();
  toast('Читаю файл…');
  try{
    if(name.endsWith('.pdf'))                     await readPDF(file);
    else if(name.endsWith('.csv')||name.endsWith('.txt')) await readCSV(file);
    else                                          await readXLSX(file);
  }catch(e){
    console.error(e);
    toast('Не удалось прочитать файл: ' + (e.message||e));
  }
}

function readXLSX(file){
  if(!window.XLSX) return Promise.reject(new Error('Модуль чтения Excel не загрузился. Проверьте интернет-соединение или сохраните выписку в CSV.'));
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = () => {
      try{
        const wb = XLSX.read(new Uint8Array(r.result), {type:'array', cellDates:true});
        const ws = wb.Sheets[wb.SheetNames[0]];
        const raw = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:''});
        startMapping(raw.filter(r=>r.some(c=>c!=='' && c!=null)));
        res();
      }catch(e){ rej(e); }
    };
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function readCSV(file){
  return new Promise((res,rej)=>{
    const r = new FileReader();
    r.onload = () => {
      try{
        let text = r.result;
        if(text.charCodeAt(0)===0xFEFF) text = text.slice(1);
        const delim = detectDelimiter(text);
        const raw = csvParse(text, delim).filter(r=>r.some(c=>String(c).trim()!==''));
        startMapping(raw);
        res();
      }catch(e){ rej(e); }
    };
    r.onerror = rej;
    r.readAsText(file, 'utf-8');
  });
}
function detectDelimiter(text){
  const head = text.split(/\r?\n/).slice(0,6).join('\n');
  const counts = {';': (head.match(/;/g)||[]).length, ',': (head.match(/,/g)||[]).length, '\t': (head.match(/\t/g)||[]).length};
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0][0];
}
function csvParse(text, delim){
  const rows = []; let row = [], cell = '', q = false;
  for(let i=0;i<text.length;i++){
    const c = text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){ cell+='"'; i++; } else q=false; }
      else cell += c;
    } else {
      if(c==='"') q = true;
      else if(c===delim){ row.push(cell); cell=''; }
      else if(c==='\n'){ row.push(cell); rows.push(row); row=[]; cell=''; }
      else if(c==='\r'){ /* skip */ }
      else cell += c;
    }
  }
  if(cell!=='' || row.length){ row.push(cell); rows.push(row); }
  return rows;
}

async function readPDF(file){
  if(!window.pdfjsLib) throw new Error('Модуль чтения PDF не загрузился. Проверьте интернет-соединение.');
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data:buf}).promise;
  const lines = [];
  for(let p=1; p<=pdf.numPages; p++){
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    // группируем элементы по вертикальной координате в строки
    const byY = {};
    for(const it of tc.items){
      const y = Math.round(it.transform[5]);
      (byY[y] = byY[y] || []).push({x: it.transform[4], s: it.str});
    }
    Object.keys(byY).map(Number).sort((a,b)=>b-a).forEach(y=>{
      const line = byY[y].sort((a,b)=>a.x-b.x).map(o=>o.s).join(' ').replace(/\s+/g,' ').trim();
      if(line) lines.push(line);
    });
  }
  if(!lines.length) throw new Error('В PDF не найден текстовый слой (возможно, это скан). Попробуйте выгрузить выписку в CSV или Excel.');
  parseTextLines(lines, 'PDF');
}

/* ---------------- разбор текстовых строк (PDF / вставка) ---------------- */
function parseTextLines(lines, sourceLabel){
  const parsed = [];
  const dateRe = /(\d{1,2}[.\-\/]\d{1,2}[.\-\/]\d{2,4}|\d{4}-\d{2}-\d{2})/;
  const amtRe  = /([−\-+]?\s?\d[\d\s  ]*(?:[.,]\d{2})?)\s*(?:₽|руб|RUB)?/gi;

  for(const line of lines){
    const dm = line.match(dateRe);
    if(!dm) continue;
    const date = parseAnyDate(dm[1]);
    if(!date) continue;

    let rest = line.slice(line.indexOf(dm[1]) + dm[1].length);
    // все числа-кандидаты в строке
    const nums = [];
    let m; amtRe.lastIndex = 0;
    while((m = amtRe.exec(rest)) !== null){
      const raw = m[1];
      if(!/\d/.test(raw)) continue;
      const cleaned = raw.replace(/[\s  ]/g,'');
      if(cleaned.replace(/[^\d]/g,'').length < 2) continue;   // отбрасываем одиночные цифры
      const val = parseAnyNumber(raw);
      if(val!==null && Math.abs(val)>=1) nums.push({val, raw, idx:m.index});
    }
    if(!nums.length) continue;

    // сумма операции — обычно первое денежное число; последнее часто остаток по счёту
    const chosen = nums[0];
    const negative = /[−\-]\s?\d/.test(chosen.raw) || /списан|покупк|оплат|снятие|перевод от вас/i.test(rest);
    const desc = rest.slice(0, chosen.idx).replace(/[|;]+/g,' ').replace(/\s+/g,' ').trim()
              || rest.replace(/[\d\s.,₽−\-+]/g,' ').replace(/\s+/g,' ').trim();

    parsed.push({
      date,
      desc: desc.slice(0,120),
      amount: Math.abs(chosen.val),
      kind: (chosen.val<0 || negative) ? 'expense' : 'income'
    });
  }
  if(!parsed.length){
    toast('Не удалось распознать операции. Попробуйте формат CSV/Excel.');
    return;
  }
  IMP = {mode:'text', source:sourceLabel, rows: prepRows(parsed)};
  document.getElementById('impMapCard').style.display = 'none';
  showPreview();
}

function parsePasted(){
  const txt = document.getElementById('pasteArea').value.trim();
  if(!txt){ toast('Вставьте текст операций'); return; }
  parseTextLines(txt.split(/\r?\n/), 'текст');
}

/* ---------------- маппинг колонок для таблиц ---------------- */
function startMapping(raw){
  if(!IMP_MY_PHONE && S.settings.myPhone) IMP_MY_PHONE = S.settings.myPhone;
  if(!raw || raw.length<2){ toast('В файле нет данных'); return; }

  // находим строку заголовков — первую, где есть похожие на «дата» и «сумма»
  let hIdx = 0;
  const kw = /дата|date|сумма|amount|описан|назначен|операц|приход|расход|дебет|кредит|payment/i;
  for(let i=0; i<Math.min(raw.length, 25); i++){
    const hits = raw[i].filter(c=> kw.test(String(c))).length;
    if(hits >= 2){ hIdx = i; break; }
  }
  const headers = raw[hIdx].map((h,i)=> String(h).trim() || 'Колонка '+(i+1));
  let body = raw.slice(hIdx+1);

  /* Выписки по кредитной карте (Совкомбанк и др.) делят сумму на две колонки:
     «Собственные средства» и «Средства банка». Вторая строка шапки — подписи
     этих колонок. Без неё покупки в кредит терялись: читалась только первая. */
  let ownCol = -1, bankCol = -1;
  if(body.length){
    const sub = body[0].map(c=>String(c||'').toLowerCase());
    const o = sub.findIndex(c=>/собственн/.test(c));
    const b = sub.findIndex(c=>/средства банка|заемные|заёмные|кредитные средства/.test(c));
    if(o>=0 && b>=0){
      ownCol = o; bankCol = b;
      headers[o] = 'Собственные средства';
      headers[b] = 'Средства банка';
      body = body.slice(1);
    }
  }

  IMP = {mode:'table', raw: body, headers, map:{}, isCard: bankCol>=0};
  autoDetectColumns();
  if(bankCol>=0){ IMP.map.amount = ownCol; IMP.map.bank = bankCol; IMP.map.debit = -1; IMP.map.credit = -1; }
  else IMP.map.bank = -1;
  renderMapping();
}

function autoDetectColumns(){
  const H = IMP.headers.map(h=>h.toLowerCase());
  const find = re => H.findIndex(h=>re.test(h));
  const m = IMP.map;
  m.date   = find(/дата\s*(операц|провед|транз)?|date|дата$/);
  if(m.date<0) m.date = find(/дата/);
  m.desc   = find(/описан|назначен|коммент|детал|контраг|мерчант|получат|наименован|description|purpose/);
  m.amount = find(/сумма\s*(в валюте счета|операции)?$|amount|сумма/);
  m.debit  = find(/расход|списан|дебет|debit|withdraw/);
  m.credit = find(/приход|поступл|зачисл|кредит|credit|deposit/);

  // если явных колонок нет — определяем по содержимому
  const sample = IMP.raw.slice(0, 40);
  if(m.date<0){
    for(let c=0;c<IMP.headers.length;c++){
      const ok = sample.filter(r=>parseAnyDate(r[c])).length;
      if(ok >= Math.max(2, sample.length*0.5)){ m.date = c; break; }
    }
  }
  if(m.amount<0 && m.debit<0 && m.credit<0){
    let best = -1, bestScore = 0;
    for(let c=0;c<IMP.headers.length;c++){
      if(c===m.date) continue;
      const vals = sample.map(r=>parseAnyNumber(r[c])).filter(v=>v!==null && v!==0);
      if(vals.length > bestScore){ bestScore = vals.length; best = c; }
    }
    if(bestScore >= Math.max(2, sample.length*0.4)) m.amount = best;
  }
  if(m.desc<0){
    let best = -1, bestLen = 0;
    for(let c=0;c<IMP.headers.length;c++){
      if(c===m.date || c===m.amount) continue;
      const avg = sample.reduce((s,r)=>s+String(r[c]||'').length,0)/(sample.length||1);
      if(avg > bestLen){ bestLen = avg; best = c; }
    }
    if(bestLen > 4) m.desc = best;
  }
}

function renderMapping(){
  const opts = (sel) => `<option value="-1">— нет —</option>` +
    IMP.headers.map((h,i)=>`<option value="${i}" ${i===sel?'selected':''}>${esc(h)}</option>`).join('');
  document.getElementById('impMapBody').innerHTML = `
    <div class="note">Колонки определены автоматически. Проверьте и поправьте, если что-то не так.</div>
    <div class="f2">
      <div class="f"><label>Дата операции *</label><select id="mpDate" onchange="rebuildRows()">${opts(IMP.map.date)}</select></div>
      <div class="f"><label>Описание</label><select id="mpDesc" onchange="rebuildRows()">${opts(IMP.map.desc)}</select></div>
    </div>
    <div class="f"><label>Сумма (одна колонка со знаком)</label><select id="mpAmount" onchange="rebuildRows()">${opts(IMP.map.amount)}</select></div>
    <div class="f"><label>Сумма за счёт средств банка (кредитные карты)</label><select id="mpBank" onchange="rebuildRows()">${opts(IMP.map.bank)}</select></div>
    <div class="f2">
      <div class="f"><label>Или: расход</label><select id="mpDebit" onchange="rebuildRows()">${opts(IMP.map.debit)}</select></div>
      <div class="f"><label>Или: приход</label><select id="mpCredit" onchange="rebuildRows()">${opts(IMP.map.credit)}</select></div>
    </div>
    <div class="f"><label>Формат даты, если в файле только цифры</label>
      <select id="mpDateOrder" onchange="setDateOrder(this.value)">
        <option value="dmy" ${IMP_DATE_ORDER==='dmy'?'selected':''}>05/08 — это 5 августа (Россия, Европа)</option>
        <option value="mdy" ${IMP_DATE_ORDER==='mdy'?'selected':''}>05/08 — это 8 мая (США)</option>
      </select></div>
    <label class="check"><input type="checkbox" id="mpInvert" onchange="rebuildRows()"> Поменять местами приход и расход</label>`;
  /* Если колонки нашлись сами — настройку не показываем, чтобы не пугать:
     она открывается кнопкой «Колонки определены неверно?» в предпросмотре */
  const m = IMP.map;
  const autoOk = m.date>=0 && (m.amount>=0 || m.debit>=0 || m.credit>=0);
  document.getElementById('impMapCard').style.display = autoOk ? 'none' : 'block';
  rebuildRows();
}
function toggleImpMap(){
  const c = document.getElementById('impMapCard');
  c.style.display = c.style.display==='none' ? 'block' : 'none';
  if(c.style.display==='block') c.scrollIntoView({behavior:'smooth', block:'start'});
}

/* Переключение порядка день/месяц — даты надо разобрать заново */
function setDateOrder(v){
  IMP_DATE_ORDER = v;
  rebuildRows();
}

function rebuildRows(){
  const g = id => parseInt(document.getElementById(id).value, 10);
  const bankEl = document.getElementById('mpBank');
  IMP.map = {date:g('mpDate'), desc:g('mpDesc'), amount:g('mpAmount'), debit:g('mpDebit'), credit:g('mpCredit'),
             bank: bankEl ? g('mpBank') : -1};
  IMP.isCard = IMP.map.bank >= 0;
  const invert = document.getElementById('mpInvert').checked;
  const M = IMP.map;
  const out = [];

  for(const r of IMP.raw){
    const date = M.date>=0 ? parseAnyDate(r[M.date]) : null;
    if(!date) continue;
    const desc = M.desc>=0 ? String(r[M.desc]||'').trim().slice(0,120) : '';

    /* Колонка «средства банка» — это деньги в кредит: покупка увеличивает долг.
       Строка может быть заполнена в обеих колонках сразу — тогда это две операции. */
    if(M.bank>=0){
      const bv = parseAnyNumber(r[M.bank]);
      if(bv!==null && bv!==0){
        let kind = bv<0 ? 'expense' : 'income';
        if(invert) kind = kind==='expense' ? 'income' : 'expense';
        out.push({ date, desc, amount: Math.abs(bv), kind, col:'bank' });
      }
    }

    let amount = null, kind = null;
    if(M.debit>=0 || M.credit>=0){
      const d = M.debit>=0 ? parseAnyNumber(r[M.debit]) : null;
      const c = M.credit>=0 ? parseAnyNumber(r[M.credit]) : null;
      if(d && Math.abs(d)>0){ amount = Math.abs(d); kind = 'expense'; }
      else if(c && Math.abs(c)>0){ amount = Math.abs(c); kind = 'income'; }
    }
    if(amount===null && M.amount>=0){
      const v = parseAnyNumber(r[M.amount]);
      if(v!==null && v!==0){ amount = Math.abs(v); kind = v<0 ? 'expense' : 'income'; }
    }
    if(amount===null || amount===0) continue;
    if(invert) kind = kind==='expense' ? 'income' : 'expense';

    out.push({ date, desc, amount, kind, col: M.bank>=0 ? 'own' : null });
  }
  IMP.rows = prepRows(out);
  showPreview();
}

/* ---------------- подготовка строк: роли, категории, дубли ---------------- */

/* Телефон человека — цифры без «+7» и пробелов, только последние 10.
   Нужен, чтобы узнавать входящие переводы с его же номера. */
function phoneDigits(s){ return String(s||'').replace(/\D/g,'').slice(-10); }

/* Что за строка на самом деле. Главное — не принять переводы между своими
   счетами за доходы и расходы: на выписке одного из банков их было больше
   трети, и цифры на главном экране выходили завышены в разы.
     own    — перевод между своими счетами: не записываем
     fund   — пополнение собственными деньгами кредитной карты: не записываем
     repay  — погашение кредита: запишем как перевод на карту
     srcexp — комиссия или трата собственными деньгами по кредитной карте:
              спишется со счёта, откуда пополняли карту
     ask    — исходящий перевод по СБП: неизвестно, себе или другому человеку
     fee    — комиссия банка (обычный расход)                                */
function classifyRow(r){
  const d = ruleNorm(r.desc);
  const digits = String(r.desc||'').replace(/\D/g,'');
  const my = phoneDigits(IMP_MY_PHONE);
  const fromMe = my.length===10 && digits.includes(my);
  const isCard = !!(IMP && IMP.isCard);

  if(d.includes('перевод собственных средств'))
    return isCard && r.col==='own' && r.kind==='income'
      ? {role:'fund',  why:'пополнение карты своими деньгами'}
      : {role:'own',   why:'перевод между своими счетами'};
  if(r.kind==='income' && fromMe && /зачислени/.test(d))
    return {role:'own', why:'перевод с вашего номера'};

  if(isCard && r.col==='own' && r.kind==='expense'){
    if(/погашение кредита/.test(d)) return {role:'repay', why:'погашение кредита'};
    return {role:'srcexp', why: /комисси/.test(d) ? 'комиссия' : 'списание своих денег'};
  }
  if(/комисси/.test(d)) return {role:'fee', why:'комиссия'};
  if(r.kind==='expense' && /перевод согласно распоряжению/.test(d))
    return {role:'ask', why:'перевод — себе или другому?'};
  return {role:'normal', why:''};
}

function prepRows(rows){
  const existing = new Set(S.transactions.map(t => t.date+'|'+t.amount.toFixed(2)+'|'+(t.note||'').toLowerCase().slice(0,40)));
  return rows.map(r=>{
    const key = r.date+'|'+r.amount.toFixed(2)+'|'+r.desc.toLowerCase().slice(0,40);
    const cl = classifyRow(r);
    const skip = cl.role==='own' || cl.role==='fund';
    return Object.assign({}, r, {
      id: uid(),
      role: cl.role, why: cl.why,
      categoryId: guessCategory(r.desc, r.kind),
      dup: existing.has(key),
      use: !existing.has(key) && !skip
    });
  });
}

/* Номер телефона поменяли — роли надо определить заново */
function onImpPhone(v){
  IMP_MY_PHONE = v;
  if(!IMP || !IMP.rows) return;
  for(const r of IMP.rows){
    const cl = classifyRow(r);
    r.role = cl.role; r.why = cl.why;
    r.use = !r.dup && cl.role!=='own' && cl.role!=='fund';
  }
  showPreview();
}

/* Приводим текст к виду, в котором мелкие различия написания не мешают
   сравнению: регистр, «ё» против «е» (банки в выписках пишут «ПЯТЕРОЧКА»,
   а человек в описании — «Пятёрочка») и лишние пробелы. */
function ruleNorm(s){
  return String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
}

function guessCategory(desc, kind){
  const d = ruleNorm(desc);
  for(const rule of S.rules){
    if(rule.match && d.includes(ruleNorm(rule.match))){
      const c = cat(rule.categoryId);
      if(c && c.kind===kind) return rule.categoryId;
    }
  }
  return kind==='income' ? 'c_other_i' : 'c_other_e';
}

/* ---------------- предпросмотр ---------------- */
function impSum(rows){ return round2(rows.reduce((s,r)=>s+r.amount,0)); }

function showPreview(){
  if(!IMP || !IMP.rows){ return; }
  const rows = IMP.rows;
  const card = document.getElementById('impPreviewCard');
  if(!rows.length){
    card.style.display = 'block';
    document.getElementById('impStats').innerHTML = `<div class="note err">Не найдено ни одной операции. Проверьте настройку колонок.</div>`;
    document.getElementById('impTable').innerHTML = '';
    if(IMP.mode==='table') document.getElementById('impMapCard').style.display = 'block';
    return;
  }
  card.style.display = 'block';
  if(!IMP.seen){
    IMP.seen = true;
    /* Файл прочитан: убираем окно загрузки и показываем сразу итог */
    document.getElementById('impUploadCard').style.display = 'none';
    setTimeout(()=>card.scrollIntoView({behavior:'smooth', block:'start'}), 50);
  }

  const accSel = document.getElementById('impAccount');
  const usable = S.accounts.filter(a=>!a.archived && (ACC_TYPES[a.type].asset || a.type==='credit_card'));
  /* Сохраняем выбор пользователя — иначе при каждой перерисовке
     список сбрасывался бы. Если счёта ещё не выбирали — подставляем тот,
     с которого открыли импорт; для карточной выписки — кредитную карту;
     а если подходящих счетов нет — предлагаем завести новый. */
  const prevAcc = accSel.value || IMP_PRESET_ACCOUNT || '';
  IMP_PRESET_ACCOUNT = null;
  accSel.innerHTML = usable.map(a=>`<option value="${a.id}">${esc(accLabel(a))}${a.placeholder?' — ждёт выписки':''}</option>`).join('')
    + `<option value="__new__">➕ Новый счёт</option>`;
  if(prevAcc && (prevAcc==='__new__' || usable.some(a=>a.id===prevAcc))) accSel.value = prevAcc;
  else {
    const pick = IMP.isCard ? usable.find(a=>a.type==='credit_card') : usable.find(a=>ACC_TYPES[a.type].asset);
    accSel.value = pick ? pick.id : '__new__';
  }
  const isNew = accSel.value==='__new__';
  const phEl = document.getElementById('impPhone');
  if(!phEl.value && IMP_MY_PHONE) phEl.value = IMP_MY_PHONE;
  const tAcc0 = isNew ? null : S.accounts.find(a=>a.id===accSel.value);
  const isWait = !!(tAcc0 && tAcc0.placeholder);   // счёт создан из перевода в другой выписке
  document.getElementById('impNewAcc').style.display = (isNew || isWait) ? 'block' : 'none';
  document.getElementById('impNewNameBox').style.display = isNew ? 'block' : 'none';
  document.getElementById('impNewBalLbl').textContent = (IMP.isCard || (tAcc0 && tAcc0.type==='credit_card')) ? 'Текущий долг по карте, ₽' : 'Сколько сейчас на счёте, ₽';
  document.getElementById('impNewLimitBox').style.display = IMP.isCard ? 'block' : 'none';
  const nn = document.getElementById('impNewName');
  if(isNew && !nn.value) nn.placeholder = IMP.isCard ? 'Например: Кредитная карта' : 'Например: Дебетовая карта';

  const target = isNew ? null : S.accounts.find(a=>a.id===accSel.value);
  const cardWarn = IMP.isCard && target && target.type!=='credit_card';

  /* Вторая сторона перевода, который уже записан из выписки другого счёта,
     второй раз доходом или расходом не считаем */
  if(target && IMP.mirrorFor!==target.id){
    IMP.mirrorFor = target.id;
    const day = d => Date.parse(d+'T00:00:00Z');
    const used = new Set();
    for(const r of rows){
      if(r.role!=='normal' || r.dup) continue;
      const m = S.transactions.find(t=>t.type==='transfer' && !used.has(t.id) && t.amount===r.amount &&
        (r.kind==='income' ? t.toAccountId===target.id : t.accountId===target.id) &&
        Math.abs(day(t.date)-day(r.date)) <= 3*86400000);
      if(m){ used.add(m.id); r.role='own'; r.why='уже записан как перевод'; r.use=false; }
    }
  }

  /* Со счёта, которым гасят кредитку, спишутся погашения и комиссии */
  const needSrc = rows.some(r=>r.use && (r.role==='repay' || r.role==='srcexp'));
  const srcSel = document.getElementById('impSrcAcc');
  const assets = S.accounts.filter(a=>!a.archived && ACC_TYPES[a.type].asset && a.type!=='deposit');
  const prevSrc = srcSel.value;
  srcSel.innerHTML = assets.map(a=>`<option value="${a.id}">${esc(accLabel(a))}</option>`).join('')
    + `<option value="">— записать на самой карте —</option>`;
  if(prevSrc!=='' && assets.some(a=>a.id===prevSrc)) srcSel.value = prevSrc;
  else if(prevSrc==='' && srcSel.dataset.touched) srcSel.value = '';
  document.getElementById('impSrcBox').style.display = needSrc ? 'block' : 'none';

  const rec = rows.filter(r=>r.use);
  const notPlain = r => r.role==='repay' || r.role==='srcexp' || r.role==='xfer' || r.role==='loan';
  const inc = impSum(rec.filter(r=>r.kind==='income' && !notPlain(r)));
  const exp = impSum(rec.filter(r=>r.kind==='expense' && !notPlain(r)));
  const own = rows.filter(r=>r.role==='own' || r.role==='fund');
  const ownOff = own.filter(r=>!r.use);
  const rep = rows.filter(r=>r.role==='repay');
  const srx = rows.filter(r=>r.role==='srcexp');
  const ask = rows.filter(r=>r.role==='ask' && r.use);
  const dups = rows.filter(r=>r.dup).length;
  const dates = rows.map(r=>r.date).sort();

  /* В какой валюте запишутся суммы — берётся у счёта */
  const impAcc = target || usable[0];
  const impCur = target ? accCurrency(target) : BASE;
  const curName = (CURRENCIES[impCur]||{}).name || impCur;

  const line = (t, cls) => `<div style="font-size:13px;margin-top:6px" class="${cls||''}">${t}</div>`;
  document.getElementById('impStats').innerHTML = `
    <div class="note" style="margin-bottom:10px">Выписка прочитана. Проверьте итоги, укажите, куда записать операции, и нажмите «Импортировать».</div>
    <div class="grid3">
      <div class="stat"><div class="n" style="font-size:15px">${rec.filter(r=>r.role!=='repay'&&r.role!=='srcexp').length}</div><div class="l">Запишем операций</div></div>
      <div class="stat"><div class="n pos" style="font-size:15px">${money(inc,{cur:impCur})}</div><div class="l">Приход</div></div>
      <div class="stat"><div class="n neg" style="font-size:15px">${money(exp,{cur:impCur})}</div><div class="l">Расход</div></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Период: ${dateLong(dates[0])} — ${dateLong(dates[dates.length-1])}</div>
    ${own.length ? line(`Переводы между своими счетами не считаем доходом и расходом: <b>${ownOff.length}</b> шт. на ${money(impSum(ownOff),{cur:impCur})} пропущено.`) : ''}
    ${rep.length ? line(`Погашения кредита: <b>${rep.length}</b> шт. на ${money(impSum(rep),{cur:impCur})} — запишем как переводы с вашего счёта на карту.`) : ''}
    ${srx.length ? line(`Комиссии и списания своих денег по карте: <b>${srx.length}</b> шт. на ${money(impSum(srx),{cur:impCur})} — спишем со счёта, откуда гасите карту.`) : ''}
    ${ask.length ? line(`Исходящие переводы по СБП (<b>${ask.length}</b> шт.) записаны как расход. Если это перевод себе — снимите галочку. Чтобы приложение узнавало их само, укажите ваш номер телефона ниже.`,'note warn') : ''}
    ${cardWarn ? line(`Похоже на выписку по кредитной карте, а выбран счёт другого типа. Лучше выбрать кредитную карту или завести новый счёт.`,'note warn') : ''}
    ${impCur===BASE ? '' : `<div class="note warn" style="margin-top:8px">Суммы будут записаны в валюте счёта: <b>${impCur} · ${esc(curName)}</b>. Проверьте, что выписка действительно в ${impCur}.</div>`}
    ${dups ? `<div class="note warn" style="margin-top:8px">Найдено похожих на уже существующие: <b>${dups}</b>. Они сняты с отметки — поставьте галочку, если хотите их импортировать.</div>` : ''}`;

  /* Счета, которые можно выбрать второй стороной перевода */
  const peerOpts = (r) => {
    const list = S.accounts.filter(a=>!a.archived && (!target || a.id!==target.id) &&
      (r.role==='loan' ? ['loan','credit_card','installment','debt'].includes(a.type)
                       : (r.kind==='income' ? ACC_TYPES[a.type].asset : true)));
    return `<option value="">— выберите счёт —</option>` +
      `<option value="__new__" ${r.peer==='__new__'?'selected':''}>➕ Новый счёт…</option>` +
      list.map(a=>`<option value="${a.id}" ${a.id===r.peer?'selected':''}>${esc(accLabel(a))}</option>`).join('');
  };
  const roleOpts = (r) => {
    const base = [['normal', r.kind==='income'?'Обычный доход':'Обычный расход'],
                  ['xfer','Перевод между своими счетами']];
    if(r.kind==='expense') base.push(['loan','Погашение кредита']);
    const cur = ['normal','fee','ask'].includes(r.role) ? 'normal' : r.role;
    if(!base.some(o=>o[0]===cur)) base.push([cur, r.why || cur]);
    return base.map(o=>`<option value="${o[0]}" ${o[0]===cur?'selected':''}>${esc(o[1])}</option>`).join('');
  };
  const selStyle = 'max-width:170px;padding:4px;border:1px solid var(--line);border-radius:6px;font-size:12px';

  document.getElementById('impTable').innerHTML = `
    <thead><tr>
      <th style="width:28px"><input type="checkbox" checked onchange="toggleAllImp(this.checked)"></th>
      <th>Дата</th><th>Описание</th><th class="r">Сумма</th><th>Как записать</th><th>Категория / счёт</th>
    </tr></thead>
    <tbody>${rows.map((r,i)=>`
      <tr style="${(r.dup||!r.use)?'opacity:.55':''}">
        <td><input type="checkbox" ${r.use?'checked':''} onchange="IMP.rows[${i}].use=this.checked; updSel(); showPreviewStats()"></td>
        <td style="white-space:nowrap">${dateShort(r.date)}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(r.desc)||'<span class="mut">без описания</span>'}${r.dup?' <span class="chip bad">дубль</span>':''}${r.why?` <span class="chip">${esc(r.why)}</span>`:''}</td>
        <td class="r ${r.kind==='income'?'pos':'neg'}" style="white-space:nowrap">${r.kind==='income'?'+':'−'}${money(r.amount,{cur:impCur})}</td>
        <td><select onchange="setImpRole(${i},this.value)" style="${selStyle}">${roleOpts(r)}</select></td>
        <td>${(r.role==='xfer'||r.role==='loan')
          ? `<select onchange="setImpPeer(${i},this.value)" style="${selStyle}">${peerOpts(r)}</select>`
            + (r.peer==='__new__' ? `<input type="text" value="${esc(r.peerName||'')}" oninput="IMP.rows[${i}].peerName=this.value"
                placeholder="${r.role==='loan'?'Например: Кредит в банке':'Например: Накопительный счёт'}" style="${selStyle};margin-top:4px;width:100%">
                <div style="font-size:11px;color:var(--muted);margin-top:3px;max-width:170px">Назовите счёт так, как он называется в вашем банке. Когда будете загружать выписку по нему, выберите этот счёт в списке — операции сопоставятся сами.</div>` : '')
          : `<select onchange="IMP.rows[${i}].categoryId=this.value" style="${selStyle}">
              ${S.categories.filter(c=>c.kind===r.kind).map(c=>`<option value="${c.id}" ${c.id===r.categoryId?'selected':''}>${esc(c.name)}</option>`).join('')}
            </select>`}</td>
      </tr>`).join('')}</tbody>`;
  updSel();
}
/* Способ записи строки поменяли вручную */
function setImpRole(i, v){
  const r = IMP.rows[i];
  r.role = v; r.why = '';
  if(v==='xfer' || v==='loan'){ r.peer = ''; r.use = true; }
  else if(v==='normal'){ r.use = true; }
  showPreviewStats();
}
function setImpPeer(i, v){
  IMP.rows[i].peer = v;
  showPreviewStats();
}
/* Галочку в таблице сняли — итоги наверху пересчитываем, таблицу не трогаем */
function showPreviewStats(){
  const t = document.getElementById('impTable');
  const y = t.parentNode.scrollTop;
  showPreview();
  t.parentNode.scrollTop = y;
}
function toggleAllImp(v){
  IMP.rows.forEach(r=>r.use = v);
  document.querySelectorAll('#impTable tbody input[type=checkbox]').forEach(cb=>cb.checked=v);
  updSel();
}
function updSel(){
  const n = IMP.rows.filter(r=>r.use).length;
  document.getElementById('impSelCount').value = n + ' из ' + IMP.rows.length;
}
function cancelImport(){
  IMP = null;
  document.getElementById('impPreviewCard').style.display = 'none';
  document.getElementById('impMapCard').style.display = 'none';
  document.getElementById('impUploadCard').style.display = 'block';
  document.getElementById('pasteArea').value = '';
  ['impNewName','impNewBal','impNewLimit'].forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; });
  document.getElementById('impAccount').value = '';
  const ss = document.getElementById('impSrcAcc'); if(ss){ ss.value=''; delete ss.dataset.touched; }
}
function commitImport(){
  if(!IMP || !IMP.rows) return;
  let accountId = document.getElementById('impAccount').value;
  const isNew = accountId==='__new__';
  let acct = null, typedBal = null;
  if(isNew){
    const name = document.getElementById('impNewName').value.trim();
    const balRaw = document.getElementById('impNewBal').value.trim();
    if(!name){ toast('Назовите новый счёт'); return; }
    typedBal = parseAnyNumber(balRaw);
    if(balRaw==='' || typedBal==null || isNaN(typedBal)){
      toast(IMP.isCard ? 'Укажите, какой сейчас долг по карте' : 'Укажите, сколько сейчас на счёте'); return;
    }
    typedBal = Math.abs(typedBal);
    acct = {id: uid(), type: IMP.isCard ? 'credit_card' : 'debit', name, currency: BASE,
            openingBalance: 0, archived: false, note: ''};
    if(IMP.isCard){
      const lim = parseAnyNumber(document.getElementById('impNewLimit').value);
      acct.limit = lim>0 ? lim : null; acct.rate = null; acct.paymentDay = 25;
      acct.minPayment = null; acct.minPercent = 5; acct.gracePeriodDays = null; acct.graceUntil = null;
    }
    accountId = acct.id;
  } else {
    if(!accountId){ toast('Выберите счёт для зачисления'); return; }
    acct = acc(accountId);
    if(acct.placeholder){
      const balRaw = document.getElementById('impNewBal').value.trim();
      typedBal = parseAnyNumber(balRaw);
      if(balRaw==='' || typedBal==null || isNaN(typedBal)){ toast('Укажите, сколько сейчас на этом счёте'); return; }
      typedBal = Math.abs(typedBal);
    }
  }
  const sel = IMP.rows.filter(r=>r.use);
  if(!sel.length){ toast('Не выбрано ни одной операции'); return; }

  const srcId = document.getElementById('impSrcAcc').value;
  const src = srcId ? acc(srcId) : null;
  const txs = [];
  const newPeers = {};
  let nRec = 0, nRep = 0, nSrc = 0, nSkip = 0, nXfer = 0;
  for(const r of sel){
    if(r.role==='repay'){
      if(!src){ nSkip++; continue; }
      txs.push({id: uid(), date: r.date, type:'transfer', accountId: src.id, toAccountId: accountId,
                amount: r.amount, note: r.desc, source:'import'});
      /* Деньги на счёте погашения были до выписки — компенсируем, чтобы
         его остаток не ушёл в минус из-за старых списаний */
      src.openingBalance = round2((src.openingBalance||0) + r.amount);
      nRep++;
    } else if(r.role==='srcexp'){
      const tgt = src || acct;
      txs.push({id: uid(), date: r.date, type:'expense', accountId: tgt.id,
                categoryId: r.categoryId, amount: r.amount, note: r.desc, source:'import'});
      /* Компенсируем, чтобы остаток не сдвинулся из-за старых списаний */
      if(!(isNew && !src)) tgt.openingBalance = round2((tgt.openingBalance||0) + (ACC_TYPES[tgt.type].asset ? r.amount : -r.amount));
      nSrc++;
    } else if(r.role==='xfer' || r.role==='loan'){
      let peer = null, peerIsNew = false;
      if(r.peer==='__new__'){
        const pn = (r.peerName||'').trim();
        if(pn){
          const key = pn.toLowerCase();
          peer = S.accounts.find(a=>!a.archived && a.name.trim().toLowerCase()===key) || newPeers[key] || null;
          if(!peer){
            /* Заготовка счёта: остаток зададим, когда придёт его выписка */
            peer = newPeers[key] = {id: uid(), type: r.role==='loan' ? 'loan' : 'debit', name: pn, currency: BASE,
                                    openingBalance: 0, archived: false, note: '', placeholder: true};
          }
          peerIsNew = !!newPeers[key];
        }
      } else if(r.peer) peer = acc(r.peer);
      if(!peer){ nSkip++; continue; }
      const out = r.kind==='expense';   // деньги ушли с этого счёта на peer — или наоборот
      txs.push({id: uid(), date: r.date, type:'transfer',
                accountId: out ? accountId : peer.id, toAccountId: out ? peer.id : accountId,
                amount: r.amount, note: r.desc, source:'import'});
      /* Второй счёт уже показывает актуальный остаток — гасим влияние старой операции */
      const asset = ACC_TYPES[peer.type].asset;
      const eff = out ? (asset ? r.amount : -r.amount) : (asset ? -r.amount : r.amount);
      if(!peerIsNew && !peer.placeholder) peer.openingBalance = round2((peer.openingBalance||0) - eff);
      nXfer++;
    } else {
      txs.push({id: uid(), date: r.date, type: r.kind, accountId,
                categoryId: r.categoryId, amount: r.amount, note: r.desc, source:'import'});
      nRec++;
    }
  }

  if(isNew) S.accounts.push(acct);
  Object.values(newPeers).forEach(a=>S.accounts.push(a));
  S.transactions.push(...txs);
  if(isNew || acct.placeholder){
    delete acct.placeholder;
    /* Начальный остаток подбираем так, чтобы после всех операций
       на счёте оказалась именно та сумма, которую назвал человек */
    acct.openingBalance = round2(typedBal - balance(acct));
  }
  const ph = document.getElementById('impPhone').value.trim();
  if(phoneDigits(ph).length===10) S.settings.myPhone = ph;
  save(); cancelImport(); renderAll();
  toast(`Записано операций: ${nRec}` + (nRep ? `, погашений: ${nRep}` : '')
    + (nSrc ? `, списаний: ${nSrc}` : '') + (nXfer ? `, переводов: ${nXfer}` : '') + (nSkip ? `, пропущено без выбранного счёта: ${nSkip}` : '')
    + (Object.keys(newPeers).length ? `. Новые счета: ${Object.values(newPeers).map(a=>a.name).join(', ')} — загрузите по ним выписку` : ''));
  go(isNew ? 'home' : 'accounts');
}

/* ---------------- правила автокатегоризации ----------------
   Живут в профиле, рядом с категориями. Применяются везде:
   при импорте выписки и при ручном вводе операции. */
var RULES_OPEN = false;
function toggleRulesSection(){
  RULES_OPEN = !RULES_OPEN;
  const body = document.getElementById('rulesSecBody');
  const arw  = document.getElementById('rulesArw');
  if(body) body.style.display = RULES_OPEN ? 'block' : 'none';
  if(arw)  arw.style.transform = RULES_OPEN ? 'rotate(90deg)' : 'none';
  if(RULES_OPEN) renderRules();
}
function renderRules(){
  const box = document.getElementById('rulesList');
  if(!box) return;
  if(!S.rules.length){
    box.innerHTML = `<div class="empty">Правил пока нет.<br>
      Они появятся сами: после новой операции приложение спросит, запомнить ли связку.</div>`;
    return;
  }
  box.innerHTML = S.rules.map(r=>`
    <div class="row" onclick="openRule('${r.id}')" style="cursor:pointer">
      <div class="l"><div class="t">«${esc(r.match)}»</div><div class="s">→ ${esc(catName(r.categoryId))}</div></div>
      <div class="v mut">›</div>
    </div>`).join('');
}
function openRule(id){
  const r = id ? S.rules.find(x=>x.id===id) : null;
  document.getElementById('ovRuleBody').innerHTML = `
    <h3>${r?'Правило':'Новое правило'}</h3>
    <div class="f"><label>Если описание содержит</label>
      <input type="text" id="rlMatch" value="${r?esc(r.match):''}" placeholder="напр. пятероч">
      <div class="hint">Регистр не важен. Достаточно части слова.</div></div>
    <div class="f"><label>Присвоить категорию</label>
      <select id="rlCat">${S.categories.map(c=>`<option value="${c.id}" ${r&&r.categoryId===c.id?'selected':''}>${c.kind==='income'?'↑':'↓'} ${esc(c.name)}</option>`).join('')}</select></div>
    <div class="btnrow">
      ${r?`<button class="btn btn-d" onclick="deleteRule('${r.id}')">Удалить</button>`:''}
      <button class="btn btn-p" onclick="saveRule(${r?"'"+r.id+"'":'null'})">Сохранить</button>
    </div>`;
  openOv('ovRule');
}
function saveRule(id){
  const match = document.getElementById('rlMatch').value.trim();
  if(!match){ toast('Введите текст для поиска'); return; }
  const categoryId = document.getElementById('rlCat').value;
  if(id){ const r = S.rules.find(x=>x.id===id); r.match = match; r.categoryId = categoryId; }
  else S.rules.push({id:uid(), match, categoryId});
  save(); closeOv('ovRule'); renderRules(); toast('Правило сохранено');
}
function deleteRule(id){
  S.rules = S.rules.filter(r=>r.id!==id);
  save(); closeOv('ovRule'); renderRules(); toast('Удалено');
}
