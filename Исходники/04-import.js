/* =========================================================================
   ИМПОРТ ВЫПИСОК: CSV / XLSX / PDF / текст
   ========================================================================= */

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

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
  IMP = {mode:'text', source:sourceLabel, rows: prepRows(parsed), isCard:false};
  document.getElementById('impMapCard').style.display = 'none';
  showStatementForm();
}

function parsePasted(){
  const txt = document.getElementById('pasteArea').value.trim();
  if(!txt){ toast('Вставьте текст операций'); return; }
  parseTextLines(txt.split(/\r?\n/), 'текст');
}

/* ---------------- маппинг колонок для таблиц ---------------- */
function startMapping(raw){
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
  showStatementForm();
}

/* ---------------- подготовка строк: роли, категории, дубли ---------------- */

/* Телефон человека — цифры без «+7» и пробелов, только последние 10.
   Нужен, чтобы узнавать входящие переводы с его же номера. */

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
function classifyRow(r, isCard){
  const d = ruleNorm(r.desc);

  if(d.includes('перевод собственных средств'))
    return isCard && r.col==='own' && r.kind==='income'
      ? {role:'fund',  why:'пополнение карты своими деньгами'}
      : {role:'own',   why:'перевод между своими счетами'};

  if(isCard && r.col==='own' && r.kind==='expense'){
    if(/погашение кредита/.test(d)) return {role:'repay', why:'погашение кредита'};
    return {role:'srcexp', why: /комисси/.test(d) ? 'комиссия' : 'списание своих денег'};
  }
  if(/комисси/.test(d)) return {role:'fee', why:'комиссия'};
  if(r.kind==='expense' && /перевод согласно распоряжению/.test(d))
    return {role:'ask', why:'перевод — себе или другому?'};
  return {role:'normal', why:''};
}

function prepRows(rows){ return rows.map(r=>Object.assign({}, r, {id: uid()})); }

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

/* =========================================================================
   ВЫПИСКИ ПО ОЧЕРЕДИ
   Порядок такой: человек загружает выписки по всем своим счетам, каждой
   даёт название счёта → «Проанализировать» (приложение находит переводы
   между счетами, погашения кредитов, пополнения вкладов) → ручная проверка
   → «Записать». Выписки ждут своей очереди в S.pendingImports, чтобы
   обновление страницы их не стёрло.
   ========================================================================= */
var IMP_STAGE = 'upload';   // upload | name | review
var ANA = null;             // результат анализа: {rows, srcId, filter}
const STMT_TYPES = {
  debit: 'Дебетовая карта или счёт',
  credit_card: 'Кредитная карта',
  deposit: 'Накопительный счёт или вклад'
};
const elv = id => { const e = document.getElementById(id); return e ? e.value : ''; };

function pendingList(){
  if(!Array.isArray(S.pendingImports)) S.pendingImports = [];
  return S.pendingImports;
}

function impShow(stage){
  IMP_STAGE = stage;
  const on = (id, v) => { const e = document.getElementById(id); if(e) e.style.display = v ? 'block' : 'none'; };
  on('impUploadCard', stage==='upload');
  on('impNameCard',   stage==='name');
  on('impListCard',   stage==='upload' && pendingList().length>0);
  on('impReviewCard', stage==='review');
  if(stage!=='name') on('impMapCard', false);
  const intro = document.getElementById('impUploadIntro');
  if(intro) intro.innerHTML = pendingList().length
    ? 'Загрузите выписку по следующему счёту или нажмите «Проанализировать выписки» в списке ниже.'
    : 'Загрузите выписки по всем своим счетам — по одной. Лучше всего за последний месяц, но период можно взять любой.';
}

/* Вызывается при открытии экрана «импорт» */
function renderImport(){
  if(IMP_STAGE==='name' && !IMP) IMP_STAGE = 'upload';
  if(IMP_STAGE==='review' && !ANA) IMP_STAGE = 'upload';
  renderStatementList();
  impShow(IMP_STAGE);
  if(IMP_STAGE==='review') renderReview();
}

/* ---------- шаг 1: выписка прочитана, даём название счёту ---------- */
function showStatementForm(){
  if(!IMP || !IMP.rows) return;
  const rows = IMP.rows;
  const stats = document.getElementById('impNameStats');
  const form = document.getElementById('impNameForm');
  impShow('name');
  if(!rows.length){
    stats.innerHTML = `<div class="note err">Не найдено ни одной операции. Проверьте настройку колонок.</div>`;
    form.style.display = 'none';
    if(IMP.mode==='table') document.getElementById('impMapCard').style.display = 'block';
    return;
  }
  form.style.display = 'block';
  const dates = rows.map(r=>r.date).sort();
  stats.innerHTML = `<div class="note">Выписка прочитана: операций — <b>${rows.length}</b>, период ${dateLong(dates[0])} — ${dateLong(dates[dates.length-1])}. Теперь назовите счёт, по которому она получена.</div>`;

  const dl = document.getElementById('impNameList');
  const names = [...pendingList().map(s=>s.name), ...S.accounts.filter(a=>!a.archived).map(a=>a.name)];
  dl.innerHTML = [...new Set(names)].map(n=>`<option value="${esc(n)}">`).join('');

  const nameEl = document.getElementById('impStName');
  const typeEl = document.getElementById('impStType');
  if(IMP_PRESET_ACCOUNT){
    const a = acc(IMP_PRESET_ACCOUNT);
    if(a && !nameEl.value){ nameEl.value = a.name; if(STMT_TYPES[a.type]) typeEl.value = a.type; IMP.typeTouched = true; }
    IMP_PRESET_ACCOUNT = null;
  }
  if(!IMP.typeTouched) typeEl.value = IMP.isCard ? 'credit_card' : 'debit';
  onStmtName();
  setTimeout(()=>document.getElementById('impNameCard').scrollIntoView({behavior:'smooth', block:'start'}), 50);
}

function stmtMatch(name){
  const key = name.trim().toLowerCase();
  if(!key) return {};
  return {
    st: pendingList().find(s=>s.name.trim().toLowerCase()===key),
    exist: S.accounts.find(a=>!a.archived && a.name.trim().toLowerCase()===key)
  };
}

function onStmtName(){
  const {st, exist} = stmtMatch(elv('impStName'));
  const typeEl = document.getElementById('impStType');
  const balEl = document.getElementById('impStBal');
  const hint = document.getElementById('impStHint');
  if(st){ typeEl.value = st.type; if(balEl.value==='' && st.balance!=null) balEl.value = st.balance; }
  else if(exist && STMT_TYPES[exist.type]) typeEl.value = exist.type;
  const locked = !!(st || (exist && STMT_TYPES[exist.type]));
  typeEl.disabled = locked;
  hint.innerHTML = st ? 'Такой счёт уже есть в списке загруженных — операции добавятся к нему.'
    : (exist && !exist.placeholder) ? 'Такой счёт уже есть в приложении — операции добавятся к нему. Остаток можно не указывать.'
    : (exist && exist.placeholder) ? 'Этот счёт создан из перевода в другой выписке — укажите его остаток.' : '';
  hint.style.display = hint.innerHTML ? 'block' : 'none';
  const t = typeEl.value;
  document.getElementById('impStBalLbl').textContent =
    t==='credit_card' ? 'Текущий долг по карте, ₽' : t==='deposit' ? 'Сколько сейчас на вкладе, ₽' : 'Сколько сейчас на счёте, ₽';
  document.getElementById('impStLimitBox').style.display = (t==='credit_card' && !locked) ? 'block' : 'none';
}

function addStatement(){
  if(!IMP || !IMP.rows || !IMP.rows.length) return;
  const name = elv('impStName').trim();
  if(!name){ toast('Назовите счёт — без названия выписку не добавить'); return; }
  const {st: oldSt, exist} = stmtMatch(name);
  const type = oldSt ? oldSt.type : (exist && STMT_TYPES[exist.type]) ? exist.type : elv('impStType');
  const balRaw = elv('impStBal').trim();
  let bal = null;
  if(balRaw!==''){
    const v = parseAnyNumber(balRaw);
    if(v==null || isNaN(v)){ toast('Остаток должен быть числом'); return; }
    bal = Math.abs(v);
  }
  const needBal = !(exist && !exist.placeholder) && !(oldSt && oldSt.balance!=null);
  if(bal==null && needBal){
    toast(type==='credit_card' ? 'Укажите, какой сейчас долг по карте' : 'Укажите, сколько сейчас на счёте'); return;
  }
  const list = pendingList();
  let st = oldSt;
  if(!st){
    st = {sid: uid(), name, type, balance: null, limit: null, existingId: exist ? exist.id : null, rows: [], files: 0};
    list.push(st);
  }
  if(bal!=null) st.balance = bal;
  const lim = parseAnyNumber(elv('impStLimit'));
  if(lim>0) st.limit = lim;
  const fid = ++st.files;
  st.rows.push(...IMP.rows.map(r=>({date:r.date, desc:r.desc, amount:r.amount, kind:r.kind, col:r.col||null, card:!!IMP.isCard, fid})));
  save();
  resetStatementForm();
  toast(`Выписка добавлена: ${name}`);
  renderStatementList(); impShow('upload');
  window.scrollTo(0,0);
}

function resetStatementForm(){
  IMP = null;
  ['impStName','impStBal','impStLimit'].forEach(i=>{ const e=document.getElementById(i); if(e) e.value=''; });
  const h = document.getElementById('impStHint'); if(h) h.innerHTML = '';
  const t = document.getElementById('impStType'); if(t) t.disabled = false;
  document.getElementById('impMapCard').style.display = 'none';
  document.getElementById('pasteArea').value = '';
}
function cancelStatement(){ resetStatementForm(); impShow('upload'); }

function removeStatement(sid){
  S.pendingImports = pendingList().filter(s=>s.sid!==sid);
  save(); renderStatementList(); impShow(IMP_STAGE);
}

function stmtPeriod(st){
  const d = st.rows.map(r=>r.date).sort();
  return d.length ? dateShort(d[0]) + ' — ' + dateShort(d[d.length-1]) : '';
}
function renderStatementList(){
  const box = document.getElementById('impList');
  if(!box) return;
  box.innerHTML = pendingList().map(s=>`
    <div class="row"><div class="l"><div class="t">${esc(s.name)}</div>
      <div class="s">${STMT_TYPES[s.type]||s.type} · операций: ${s.rows.length} · ${stmtPeriod(s)}</div></div>
      <button class="btn btn-s btn-sm" onclick="removeStatement('${s.sid}')">Убрать</button></div>`).join('');
}

/* ---------- шаг 2: анализ ---------- */
function ruleKey(desc){
  const w = ruleNorm(desc).replace(/[\d.,:;\/\\|"'()*_#№\-+]+/g,' ').split(' ').filter(x=>x.length>2);
  const k = w.slice(0,3).join(' ');
  return k.length>=4 ? k : '';
}

function analyzeStatements(){
  const sts = pendingList();
  if(!sts.length){ toast('Сначала загрузите хотя бы одну выписку'); return; }
  const existing = new Set(S.transactions.map(t => t.date+'|'+t.amount.toFixed(2)+'|'+(t.note||'').toLowerCase().slice(0,40)));
  const rows = [];
  for(const st of sts){
    /* Одна и та же операция в двух файлах по одному счёту (периоды пересеклись) — дубль */
    const prev = {}, cur = {};
    let curFid = 0;
    for(const r of st.rows){
      const key = r.date+'|'+r.amount.toFixed(2)+'|'+r.desc.toLowerCase().slice(0,40);
      if(r.fid!==curFid){
        Object.keys(cur).forEach(k=>{ prev[k] = (prev[k]||0) + cur[k]; delete cur[k]; });
        curFid = r.fid;
      }
      const idx = cur[key] = (cur[key]||0) + 1;
      const dup = existing.has(key) || idx <= (prev[key]||0);
      const cl = classifyRow(r, !!r.card);
      rows.push(Object.assign({}, r, {
        id: uid(), sid: st.sid, role: cl.role, why: cl.why,
        categoryId: guessCategory(r.desc, r.kind),
        dup, use: !dup && cl.role!=='own' && cl.role!=='fund',
        peer: '', peerName: '', matched: false
      }));
    }
  }

  /* Ищем пары: расход на одном счёте и приход такой же суммы на другом.
     Это и есть перевод между своими счетами. */
  const day = d => Date.parse(d+'T00:00:00Z');
  const tl = r => /перевод|собственных средств|зачислени|распоряжению|сбп|пополнени/.test(ruleNorm(r.desc));
  const stById = {}; sts.forEach(s=>stById[s.sid]=s);
  const outs = rows.filter(r=>r.kind==='expense' && !r.dup && ['own','ask','normal','fee'].includes(r.role) && tl(r))
                   .sort((a,b)=>a.date<b.date?-1:1);
  const ins  = rows.filter(r=>r.kind==='income' && !r.dup && ['own','normal','fund'].includes(r.role) && tl(r));
  for(const x of outs){
    let best = null, gap = 4*86400000;
    for(const y of ins){
      if(y.matched || y.sid===x.sid || Math.abs(y.amount-x.amount)>0.001) continue;
      const g = Math.abs(day(y.date)-day(x.date));
      if(g < gap){ gap = g; best = y; }
    }
    if(!best) continue;
    best.matched = true; x.matched = true;
    if(best.role==='fund'){
      /* Пополнение кредитки своими деньгами: карта загружена, обе стороны известны, записывать нечего */
      x.role = 'own'; x.use = false; x.why = 'пополнение карты своими деньгами';
      best.why = 'пополнение карты своими деньгами';
      continue;
    }
    const toT = stById[best.sid].type;
    x.role = 'xfer'; x.peer = 's:'+best.sid; x.use = true;
    x.why = toT==='deposit' ? 'пополнение вклада' : toT==='credit_card' ? 'погашение кредита' : 'перевод между своими счетами';
    best.role = 'own'; best.use = false; best.why = 'вторая сторона перевода';
  }
  for(const r of rows){
    if(r.role==='own' && !r.matched) r.why = 'вторая сторона не найдена';
    if(r.role==='ask' && !r.matched) r.why = 'встречного прихода не нашла — записан как расход';
  }
  rows.sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);

  /* Со счёта чего гасим кредитку: если дебетовая выписка одна — она */
  const debits = sts.filter(s=>s.type==='debit');
  ANA = {rows, filter: 'attention', srcId: debits.length===1 ? 's:'+debits[0].sid : ''};
  impShow('review');
  renderReview();
  window.scrollTo(0,0);
}

function needsAttention(r){
  return r.role==='ask' || (r.role==='own' && !r.matched) ||
         ((r.role==='xfer'||r.role==='loan') && !r.peer);
}

/* Счета, которые можно выбрать второй стороной перевода */
function rvPeerList(r){
  const sts = pendingList();
  const out = [];
  const liab = ['loan','credit_card','installment','debt'];
  const ok = t => r.role==='loan' ? liab.includes(t) : (r.kind==='income' ? ACC_TYPES[t].asset : true);
  for(const s of sts){
    if(s.sid===r.sid) continue;
    const t = s.existingId && acc(s.existingId) ? acc(s.existingId).type : s.type;
    if(ok(t)) out.push({v:'s:'+s.sid, label:s.name});
  }
  for(const a of S.accounts){
    if(a.archived || sts.some(s=>s.existingId===a.id)) continue;
    if(ok(a.type)) out.push({v:a.id, label:accLabel(a)});
  }
  return out;
}

function rvSet(id, field, v){
  const r = ANA.rows.find(x=>x.id===id); if(!r) return;
  if(field==='role'){
    r.role = v; r.why = '';
    if(v==='xfer' || v==='loan'){ r.peer = ''; r.use = true; }
    else if(v==='normal'){ r.use = true; }
  } else if(field==='peer'){ r.peer = v; }
  else if(field==='use'){ r.use = v; }
  else if(field==='cat'){ r.categoryId = v; r.catTouched = true; return; }
  else if(field==='peerName'){ r.peerName = v; return; }
  renderReview(true);
}
function rvFilter(f){ ANA.filter = f; renderReview(); }
function rvSrc(v){ ANA.srcId = v; renderReview(true); }

function impSum(rows){ return round2(rows.reduce((s,r)=>s+r.amount,0)); }

function renderReview(keepScroll){
  if(!ANA) return;
  const y = window.scrollY;
  const rows = ANA.rows, sts = pendingList();
  const nameOf = sid => { const s = sts.find(x=>x.sid===sid); return s ? s.name : '—'; };
  const rec = rows.filter(r=>r.use);
  const plain = r => !['repay','srcexp','xfer','loan'].includes(r.role);
  const inc = impSum(rec.filter(r=>r.kind==='income' && plain(r)));
  const exp = impSum(rec.filter(r=>r.kind==='expense' && plain(r)));
  const xf = rec.filter(r=>r.role==='xfer' || r.role==='loan');
  const rep = rec.filter(r=>r.role==='repay' || r.role==='srcexp');
  const unm = rows.filter(r=>r.role==='own' && !r.matched).length;
  const ask = rows.filter(r=>r.role==='ask' && r.use).length;
  const dups = rows.filter(r=>r.dup).length;
  const line = (t, cls) => `<div style="font-size:13px;margin-top:6px" class="${cls||''}">${t}</div>`;

  document.getElementById('impRvStats').innerHTML = `
    <div class="note" style="margin-bottom:10px">Выписки проанализированы. Проверьте, что нашло приложение, поправьте ошибки и нажмите «Записать».</div>
    <div class="grid3">
      <div class="stat"><div class="n" style="font-size:15px">${rec.filter(plain).length}</div><div class="l">Операций</div></div>
      <div class="stat"><div class="n pos" style="font-size:15px">${money(inc)}</div><div class="l">Приход</div></div>
      <div class="stat"><div class="n neg" style="font-size:15px">${money(exp)}</div><div class="l">Расход</div></div>
    </div>
    ${xf.length ? line(`Переводов между своими счетами и погашений: <b>${xf.length}</b> шт. на ${money(impSum(xf))} — они не считаются доходом и расходом.`) : ''}
    ${rep.length ? line(`Списаний по кредитной карте своими деньгами и погашений: <b>${rep.length}</b> шт. на ${money(impSum(rep))}.`) : ''}
    ${unm ? line(`Переводов без второго счёта: <b>${unm}</b>. Загрузите выписку по второму счёту или выберите счёт вручную в списке ниже.`,'note warn') : ''}
    ${ask ? line(`Исходящих переводов по СБП без пары: <b>${ask}</b>. Записаны как расход; если это перевод себе — выберите «Перевод между своими счетами».`,'note warn') : ''}
    ${dups ? line(`Уже есть в приложении или повторяются в файлах: <b>${dups}</b> — сняты с отметки.`) : ''}`;

  /* Со счёта чего списывать погашения и комиссии по кредитной карте */
  const needSrc = rows.some(r=>r.use && (r.role==='repay' || r.role==='srcexp'));
  document.getElementById('impRvSrcBox').style.display = needSrc ? 'block' : 'none';
  if(needSrc){
    const opts = sts.filter(s=>s.type!=='credit_card').map(s=>({v:'s:'+s.sid, label:s.name}))
      .concat(S.accounts.filter(a=>!a.archived && ACC_TYPES[a.type].asset && a.type!=='deposit' && !sts.some(s=>s.existingId===a.id))
        .map(a=>({v:a.id, label:accLabel(a)})));
    document.getElementById('impRvSrc').innerHTML = opts.map(o=>`<option value="${o.v}" ${o.v===ANA.srcId?'selected':''}>${esc(o.label)}</option>`).join('')
      + `<option value="" ${ANA.srcId===''?'selected':''}>— записать на самой карте —</option>`;
  }

  const shown = ANA.filter==='all' ? rows : rows.filter(needsAttention);
  const nAtt = rows.filter(needsAttention).length;
  document.getElementById('impRvFilter').innerHTML = `
    <button class="btn ${ANA.filter==='attention'?'btn-p':'btn-s'} btn-sm" onclick="rvFilter('attention')">Требуют внимания (${nAtt})</button>
    <button class="btn ${ANA.filter==='all'?'btn-p':'btn-s'} btn-sm" onclick="rvFilter('all')">Все операции (${rows.length})</button>`;

  const roleOpts = r => {
    const base = [['normal', r.kind==='income'?'Обычный доход':'Обычный расход'], ['xfer','Перевод между своими счетами']];
    if(r.kind==='expense') base.push(['loan','Погашение кредита']);
    const cur = ['normal','fee','ask'].includes(r.role) ? 'normal' : r.role;
    if(!base.some(o=>o[0]===cur)) base.push([cur, cur==='own' ? 'Свой перевод — не записывать' : cur==='fund' ? 'Пополнение карты — не записывать' : (r.why || cur)]);
    return base.map(o=>`<option value="${o[0]}" ${o[0]===cur?'selected':''}>${esc(o[1])}</option>`).join('');
  };
  const selStyle = 'max-width:170px;padding:4px;border:1px solid var(--line);border-radius:6px;font-size:12px';
  const peerCell = r => {
    const list = rvPeerList(r);
    let h = `<select onchange="rvSet('${r.id}','peer',this.value)" style="${selStyle}"><option value="">— выберите счёт —</option>`
      + list.map(o=>`<option value="${o.v}" ${o.v===r.peer?'selected':''}>${esc(o.label)}</option>`).join('')
      + `<option value="__new__" ${r.peer==='__new__'?'selected':''}>➕ Новый счёт…</option></select>`;
    if(r.peer==='__new__') h += `<input type="text" value="${esc(r.peerName||'')}" oninput="rvSet('${r.id}','peerName',this.value)"
      placeholder="${r.role==='loan'?'Например: Кредит в банке':'Например: Накопительный счёт'}" style="${selStyle};margin-top:4px;width:100%">
      <div style="font-size:11px;color:var(--muted);margin-top:3px;max-width:170px">Назовите счёт так, как он называется в вашем банке. Когда будете загружать выписку по нему, назовите её так же — приложение узнает счёт по названию.</div>`;
    return h;
  };

  document.getElementById('impRvTable').innerHTML = shown.length ? `
    <thead><tr><th style="width:28px"></th><th>Дата</th><th>Счёт</th><th>Описание</th><th class="r">Сумма</th><th>Как записать</th><th>Категория / счёт</th></tr></thead>
    <tbody>${shown.map(r=>`
      <tr style="${(r.dup||!r.use)?'opacity:.55':''}">
        <td><input type="checkbox" ${r.use?'checked':''} onchange="rvSet('${r.id}','use',this.checked)"></td>
        <td style="white-space:nowrap">${dateShort(r.date)}</td>
        <td>${esc(nameOf(r.sid))}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis">${esc(r.desc)||'<span class="mut">без описания</span>'}${r.dup?' <span class="chip bad">дубль</span>':''}${r.why?` <span class="chip">${esc(r.why)}</span>`:''}</td>
        <td class="r ${r.kind==='income'?'pos':'neg'}" style="white-space:nowrap">${r.kind==='income'?'+':'−'}${money(r.amount)}</td>
        <td><select onchange="rvSet('${r.id}','role',this.value)" style="${selStyle}">${roleOpts(r)}</select></td>
        <td>${(r.role==='xfer'||r.role==='loan') ? peerCell(r)
          : (r.role==='own'||r.role==='fund') ? '<span class="mut">—</span>'
          : `<select onchange="rvSet('${r.id}','cat',this.value)" style="${selStyle}">${S.categories.filter(c=>c.kind===r.kind).map(c=>`<option value="${c.id}" ${c.id===r.categoryId?'selected':''}>${esc(c.name)}</option>`).join('')}</select>`}</td>
      </tr>`).join('')}</tbody>`
    : `<tbody><tr><td class="mut" style="padding:12px">Всё определилось. Нажмите «Все операции», чтобы просмотреть полный список.</td></tr></tbody>`;
  if(keepScroll) window.scrollTo(0, y);
}

function backToStatements(){ ANA = null; impShow('upload'); renderStatementList(); window.scrollTo(0,0); }

/* ---------- шаг 3: запись ---------- */
function commitAnalysis(){
  if(!ANA) return;
  const sts = pendingList();
  const accMap = {};          // sid → счёт
  const created = [];
  const newPeers = {};
  for(const st of sts){
    let a = st.existingId ? acc(st.existingId) : null;
    if(!a){
      a = {id: uid(), type: st.type, name: st.name, currency: BASE, openingBalance: 0, archived: false, note: ''};
      if(st.type==='credit_card'){
        a.limit = st.limit; a.rate = null; a.paymentDay = 25; a.minPayment = null; a.minPercent = 5;
        a.gracePeriodDays = null; a.graceUntil = null;
      }
      if(st.type==='deposit'){
        a.rate = null; a.endDate = ''; a.capitalization = false; a.linkAccountId = '';
        a.liquid = true; a.excludeFromBalance = false; a.goal = null;
      }
      created.push(a);
    }
    accMap[st.sid] = a;
  }
  const byRef = ref => !ref ? null : ref.startsWith('s:') ? accMap[ref.slice(2)] : acc(ref);
  const isStmtAcc = a => Object.values(accMap).includes(a);
  const src = byRef(ANA.srcId);

  const txs = [];
  let nRec = 0, nXfer = 0, nSrc = 0, nSkip = 0;
  const learned = [];
  for(const r of ANA.rows){
    if(!r.use) continue;
    const a = accMap[r.sid];
    if(r.role==='own' || r.role==='fund') continue;
    if(r.role==='repay'){
      if(!src){ nSkip++; continue; }
      txs.push({id: uid(), date: r.date, type:'transfer', accountId: src.id, toAccountId: a.id, amount: r.amount, note: r.desc, source:'import'});
      if(!isStmtAcc(src)) src.openingBalance = round2((src.openingBalance||0) + r.amount);
      nXfer++;
    } else if(r.role==='srcexp'){
      const tgt = src || a;
      txs.push({id: uid(), date: r.date, type:'expense', accountId: tgt.id, categoryId: r.categoryId, amount: r.amount, note: r.desc, source:'import'});
      if(!isStmtAcc(tgt)) tgt.openingBalance = round2((tgt.openingBalance||0) + (ACC_TYPES[tgt.type].asset ? r.amount : -r.amount));
      nSrc++;
    } else if(r.role==='xfer' || r.role==='loan'){
      let peer = null, peerFresh = false;
      if(r.peer==='__new__'){
        const pn = (r.peerName||'').trim();
        if(pn){
          const key = pn.toLowerCase();
          peer = S.accounts.find(x=>!x.archived && x.name.trim().toLowerCase()===key)
              || Object.values(accMap).find(x=>x.name.trim().toLowerCase()===key) || newPeers[key] || null;
          if(!peer){
            peer = newPeers[key] = {id: uid(), type: r.role==='loan' ? 'loan' : 'debit', name: pn, currency: BASE,
                                    openingBalance: 0, archived: false, note: '', placeholder: true};
          }
          peerFresh = !!newPeers[key];
        }
      } else peer = byRef(r.peer);
      if(!peer){ nSkip++; continue; }
      const out = r.kind==='expense';
      txs.push({id: uid(), date: r.date, type:'transfer',
                accountId: out ? a.id : peer.id, toAccountId: out ? peer.id : a.id,
                amount: r.amount, note: r.desc, source:'import'});
      /* Счёт вне выписок уже показывает актуальный остаток — гасим влияние старой операции */
      if(!peerFresh && !peer.placeholder && !isStmtAcc(peer)){
        const asset = ACC_TYPES[peer.type].asset;
        const eff = out ? (asset ? r.amount : -r.amount) : (asset ? -r.amount : r.amount);
        peer.openingBalance = round2((peer.openingBalance||0) - eff);
      }
      nXfer++;
    } else {
      txs.push({id: uid(), date: r.date, type: r.kind, accountId: a.id, categoryId: r.categoryId, amount: r.amount, note: r.desc, source:'import'});
      nRec++;
      if(r.catTouched) learned.push(r);
    }
  }

  created.forEach(a=>S.accounts.push(a));
  Object.values(newPeers).forEach(a=>S.accounts.push(a));
  S.transactions.push(...txs);

  /* Начальный остаток подбираем так, чтобы после всех операций на счёте
     оказалась именно та сумма, которую назвал человек */
  for(const st of sts){
    const a = accMap[st.sid];
    if(st.balance!=null) a.openingBalance = round2((a.openingBalance||0) + st.balance - balance(a));
    if(a.placeholder) delete a.placeholder;
  }

  /* Запоминаем правку категории — в следующий раз подставится сама */
  let nRules = 0;
  for(const r of learned){
    const key = ruleKey(r.desc);
    if(!key || S.rules.some(x=>ruleNorm(x.match)===key)) continue;
    S.rules.push({id: uid(), match: key, categoryId: r.categoryId}); nRules++;
  }

  S.pendingImports = []; ANA = null; IMP = null;
  save(); renderAll();
  toast(`Записано операций: ${nRec}` + (nXfer ? `, переводов: ${nXfer}` : '') + (nSrc ? `, списаний: ${nSrc}` : '')
    + (nSkip ? `, пропущено без выбранного счёта: ${nSkip}` : '')
    + (nRules ? `. Запомнила правил категорий: ${nRules}` : '')
    + (Object.keys(newPeers).length ? `. Новые счета: ${Object.values(newPeers).map(a=>a.name).join(', ')}` : ''));
  impShow('upload');
  go(created.length ? 'home' : 'accounts');
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
