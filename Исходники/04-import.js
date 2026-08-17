/* =========================================================================
   ИМПОРТ ВЫПИСОК: CSV / XLSX / PDF / текст
   ========================================================================= */

if(window.pdfjsLib){
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}

var IMP = null;   // текущий разбираемый импорт  // {raw: [][], headers: [], map:{date,desc,amount,debit,credit}, rows:[], mode}

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

  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);                       // 2026-08-05
  if(m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);         // 05.08.2026
  if(m){
    let [_,d,mo,y] = m;
    if(y.length===2) y = (+y > 60 ? '19' : '20') + y;
    return `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
  }
  const MN = {'янв':1,'фев':2,'мар':3,'апр':4,'мая':5,'май':5,'июн':6,'июл':7,'авг':8,'сен':9,'окт':10,'ноя':11,'дек':12};
  m = s.match(/^(\d{1,2})\s+([а-яё]{3,})\.?\s*(\d{4})?/i);           // 5 августа 2026
  if(m){
    const k = m[2].toLowerCase().slice(0,3);
    if(MN[k]){
      const y = m[3] || String(new Date().getFullYear());
      return `${y}-${String(MN[k]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
    }
  }
  return null;
}

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
  if(!raw || raw.length<2){ toast('В файле нет данных'); return; }

  // находим строку заголовков — первую, где есть похожие на «дата» и «сумма»
  let hIdx = 0;
  const kw = /дата|date|сумма|amount|описан|назначен|операц|приход|расход|дебет|кредит|payment/i;
  for(let i=0; i<Math.min(raw.length, 25); i++){
    const hits = raw[i].filter(c=> kw.test(String(c))).length;
    if(hits >= 2){ hIdx = i; break; }
  }
  const headers = raw[hIdx].map((h,i)=> String(h).trim() || 'Колонка '+(i+1));
  const body = raw.slice(hIdx+1);

  IMP = {mode:'table', raw: body, headers, map:{}};
  autoDetectColumns();
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
    <div class="f2">
      <div class="f"><label>Или: расход</label><select id="mpDebit" onchange="rebuildRows()">${opts(IMP.map.debit)}</select></div>
      <div class="f"><label>Или: приход</label><select id="mpCredit" onchange="rebuildRows()">${opts(IMP.map.credit)}</select></div>
    </div>
    <label class="check"><input type="checkbox" id="mpInvert" onchange="rebuildRows()"> Поменять местами приход и расход</label>`;
  document.getElementById('impMapCard').style.display = 'block';
  rebuildRows();
}

function rebuildRows(){
  const g = id => parseInt(document.getElementById(id).value, 10);
  IMP.map = {date:g('mpDate'), desc:g('mpDesc'), amount:g('mpAmount'), debit:g('mpDebit'), credit:g('mpCredit')};
  const invert = document.getElementById('mpInvert').checked;
  const M = IMP.map;
  const out = [];

  for(const r of IMP.raw){
    const date = M.date>=0 ? parseAnyDate(r[M.date]) : null;
    if(!date) continue;
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

    out.push({ date, desc: M.desc>=0 ? String(r[M.desc]||'').trim().slice(0,120) : '', amount, kind });
  }
  IMP.rows = prepRows(out);
  showPreview();
}

/* ---------------- подготовка строк: категории + дубли ---------------- */
function prepRows(rows){
  const existing = new Set(S.transactions.map(t => t.date+'|'+t.amount.toFixed(2)+'|'+(t.note||'').toLowerCase().slice(0,40)));
  return rows.map(r=>{
    const key = r.date+'|'+r.amount.toFixed(2)+'|'+r.desc.toLowerCase().slice(0,40);
    return Object.assign({}, r, {
      id: uid(),
      categoryId: guessCategory(r.desc, r.kind),
      dup: existing.has(key),
      use: !existing.has(key)
    });
  });
}
function guessCategory(desc, kind){
  const d = (desc||'').toLowerCase();
  for(const rule of S.rules){
    if(rule.match && d.includes(rule.match.toLowerCase())){
      const c = cat(rule.categoryId);
      if(c && c.kind===kind) return rule.categoryId;
    }
  }
  return kind==='income' ? 'c_other_i' : 'c_other_e';
}

/* ---------------- предпросмотр ---------------- */
function showPreview(){
  if(!IMP || !IMP.rows){ return; }
  const rows = IMP.rows;
  const card = document.getElementById('impPreviewCard');
  if(!rows.length){
    card.style.display = 'block';
    document.getElementById('impStats').innerHTML = `<div class="note err">Не найдено ни одной операции. Проверьте настройку колонок.</div>`;
    document.getElementById('impTable').innerHTML = '';
    return;
  }
  card.style.display = 'block';

  const accSel = document.getElementById('impAccount');
  const usable = S.accounts.filter(a=>!a.archived && (ACC_TYPES[a.type].asset || a.type==='credit_card'));
  accSel.innerHTML = usable.length
    ? usable.map(a=>`<option value="${a.id}">${ACC_TYPES[a.type].icon} ${esc(a.name)}</option>`).join('')
    : `<option value="">— сначала добавьте счёт —</option>`;

  const dups = rows.filter(r=>r.dup).length;
  const inc = rows.filter(r=>r.kind==='income').reduce((s,r)=>s+r.amount,0);
  const exp = rows.filter(r=>r.kind==='expense').reduce((s,r)=>s+r.amount,0);
  const dates = rows.map(r=>r.date).sort();

  document.getElementById('impStats').innerHTML = `
    <div class="grid3">
      <div class="stat"><div class="n" style="font-size:15px">${rows.length}</div><div class="l">Операций</div></div>
      <div class="stat"><div class="n pos" style="font-size:15px">${moneyShort(inc)}</div><div class="l">Приход</div></div>
      <div class="stat"><div class="n neg" style="font-size:15px">${moneyShort(exp)}</div><div class="l">Расход</div></div>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-top:8px">Период: ${dateLong(dates[0])} — ${dateLong(dates[dates.length-1])}</div>
    ${dups ? `<div class="note warn" style="margin-top:8px">Найдено похожих на уже существующие: <b>${dups}</b>. Они сняты с отметки — снимите галочку «дубль», если хотите импортировать.</div>` : ''}`;

  const catOpts = kind => S.categories.filter(c=>c.kind===kind)
      .map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('');

  document.getElementById('impTable').innerHTML = `
    <thead><tr>
      <th style="width:28px"><input type="checkbox" checked onchange="toggleAllImp(this.checked)"></th>
      <th>Дата</th><th>Описание</th><th class="r">Сумма</th><th>Категория</th>
    </tr></thead>
    <tbody>${rows.map((r,i)=>`
      <tr class="${r.dup?'':''}" style="${r.dup?'opacity:.55':''}">
        <td><input type="checkbox" ${r.use?'checked':''} onchange="IMP.rows[${i}].use=this.checked; updSel()"></td>
        <td style="white-space:nowrap">${dateShort(r.date)}</td>
        <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis">${esc(r.desc)||'<span class="mut">без описания</span>'}${r.dup?' <span class="chip bad">дубль</span>':''}</td>
        <td class="r ${r.kind==='income'?'pos':'neg'}" style="white-space:nowrap">${r.kind==='income'?'+':'−'}${money(r.amount)}</td>
        <td><select onchange="IMP.rows[${i}].categoryId=this.value" style="max-width:150px;padding:4px;border:1px solid var(--line);border-radius:6px;font-size:12px">
          ${S.categories.filter(c=>c.kind===r.kind).map(c=>`<option value="${c.id}" ${c.id===r.categoryId?'selected':''}>${esc(c.name)}</option>`).join('')}
        </select></td>
      </tr>`).join('')}</tbody>`;
  updSel();
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
  document.getElementById('pasteArea').value = '';
}
function commitImport(){
  if(!IMP || !IMP.rows) return;
  const accountId = document.getElementById('impAccount').value;
  if(!accountId){ toast('Выберите счёт для зачисления'); return; }
  const sel = IMP.rows.filter(r=>r.use);
  if(!sel.length){ toast('Не выбрано ни одной операции'); return; }

  for(const r of sel){
    S.transactions.push({
      id: uid(), date: r.date, type: r.kind, accountId,
      categoryId: r.categoryId, amount: r.amount, note: r.desc, source: 'import'
    });
  }
  save(); cancelImport(); renderAll();
  toast(`Импортировано операций: ${sel.length}`);
  go('tx');
}

/* ---------------- правила автокатегоризации ---------------- */
function renderRules(){
  const box = document.getElementById('rulesList');
  if(!S.rules.length){ box.innerHTML = `<div class="empty">Правил пока нет.</div>`; return; }
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
