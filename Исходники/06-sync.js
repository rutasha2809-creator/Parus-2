/* =========================================================================
   ОБЛАЧНАЯ СИНХРОНИЗАЦИЯ (Supabase)

   Логика: локальное хранилище браузера остаётся основным — приложение
   полностью работает офлайн. Облако — это зеркало: после каждого изменения
   данные выгружаются, при входе на другом устройстве — загружаются.
   Если на двух устройствах меняли данные независимо, пользователь сам
   выбирает, какую версию оставить (молча ничего не перезаписываем).
   ========================================================================= */

/* Адрес проекта и ПУБЛИКУЕМЫЙ ключ. Их безопасно держать в открытом коде:
   доступ к данным ограничен правилами на стороне базы (row level security),
   а не секретностью ключа. Каждый пользователь видит только свою строку. */
var SUPABASE_URL = 'https://rjvuleatdyvnvqgxrjno.supabase.co';
var SUPABASE_KEY = 'sb_publishable_d3QtwahCubeFrGPpkbomnQ_xX4trTv9';

const SYNC_CFG_KEY  = 'finapp_sync_cfg';    // {url, key} — только если меняли вручную
const SYNC_META_KEY = 'finapp_sync_meta';   // {syncedAt, dirty}

var sb = null;              // клиент Supabase
var sbUser = null;          // текущий пользователь
var syncTimer = null;
var syncBusy = false;

/* ---------------- конфигурация ---------------- */
function syncCfg(){
  try{
    const saved = JSON.parse(localStorage.getItem(SYNC_CFG_KEY));
    if(saved && saved.url && saved.key) return saved;
  }catch(e){}
  return (SUPABASE_URL && SUPABASE_KEY) ? {url:SUPABASE_URL, key:SUPABASE_KEY} : null;
}
function syncCfgSave(url, key){
  localStorage.setItem(SYNC_CFG_KEY, JSON.stringify({url:url.trim().replace(/\/+$/,''), key:key.trim()}));
}
function syncCfgClear(){ localStorage.removeItem(SYNC_CFG_KEY); localStorage.removeItem(SYNC_META_KEY); }

function syncMeta(){
  try{ return JSON.parse(localStorage.getItem(SYNC_META_KEY)) || {syncedAt:null, dirty:false}; }
  catch(e){ return {syncedAt:null, dirty:false}; }
}
function syncMetaSet(patch){
  localStorage.setItem(SYNC_META_KEY, JSON.stringify(Object.assign(syncMeta(), patch)));
}

/* ---------------- статус в шапке ---------------- */
function setSyncStatus(text, cls){
  const el = document.getElementById('syncChip');
  if(!el) return;
  el.innerHTML = text ? `<span class="chip ${cls||'info'}">${esc(text)}</span>` : '';
  el.style.cursor = 'pointer';
  el.title = 'Открыть настройки аккаунта';
}

/* ---------------- инициализация ---------------- */
async function syncInit(){
  const cfg = syncCfg();
  if(!cfg){ setSyncStatus('Вход не выполнен','req'); renderSync(); return; }
  if(typeof window.supabase === 'undefined' || !window.supabase.createClient){
    setSyncStatus('Нет связи','bad'); renderSync(); return;
  }
  try{
    sb = window.supabase.createClient(cfg.url, cfg.key);
    const { data } = await sb.auth.getSession();
    sbUser = data && data.session ? data.session.user : null;

    sb.auth.onAuthStateChange((event, session)=>{
      sbUser = session ? session.user : null;
      renderSync();
      if(sbUser && event === 'SIGNED_IN'){ adoptServerName(); syncOnLogin(); }
      if(!sbUser) setSyncStatus('Вход не выполнен','req');
    });

    if(sbUser){ adoptServerName(); await syncOnLogin(); }
    else setSyncStatus('Вход не выполнен','req');
  }catch(e){
    console.error('Sync init', e);
    setSyncStatus('Ошибка подключения','bad');
  }
  renderAll();   // модуль грузится последним — обновляем и главный экран
}

/* ---------------- вход по ссылке на почту ---------------- */
async function syncSendLink(){
  const email = (document.getElementById('syEmail').value||'').trim();
  const nameEl = document.getElementById('syName');
  const name = nameEl ? nameEl.value.trim() : '';
  if(!/.+@.+\..+/.test(email)){ toast('Введите корректный адрес почты'); return; }
  if(!sb){ toast('Нет связи с сервером, попробуйте позже'); return; }
  if(name){ profile().name = name; save(); }
  const btn = document.getElementById('syLinkBtn');
  if(btn){ btn.disabled = true; btn.textContent = 'Отправляю…'; }
  try{
    const { error } = await sb.auth.signInWithOtp({
      email,
      options:{ emailRedirectTo: location.origin + location.pathname, data: name ? {full_name: name} : undefined }
    });
    if(error) throw error;
    toast('Письмо отправлено — откройте ссылку из него');
    const box = document.getElementById('syHint');
    if(box) box.innerHTML = `<div class="note ok">Письмо отправлено на <b>${esc(email)}</b>.
      Откройте ссылку из письма на этом же устройстве. Если письма нет — проверьте папку «Спам».</div>`;
  }catch(e){
    toast('Не удалось отправить: ' + (e.message||e));
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Получить ссылку для входа'; }
  }
}
async function syncSignOut(){
  if(!sb) return;
  if(!confirm('Выйти из аккаунта? Данные останутся на этом устройстве.')) return;
  await sb.auth.signOut();
  sbUser = null;
  setSyncStatus('Вход не выполнен','req');
  renderSync();
  toast('Вы вышли из аккаунта');
}

/* ---------------- обмен данными ---------------- */
async function syncPull(){
  const { data, error } = await sb.from('app_state')
    .select('data, updated_at').eq('user_id', sbUser.id).maybeSingle();
  if(error) throw error;
  return data || null;
}
async function syncPush(){
  const now = new Date().toISOString();
  const { error } = await sb.from('app_state')
    .upsert({ user_id: sbUser.id, data: S, updated_at: now }, { onConflict:'user_id' });
  if(error) throw error;
  syncMetaSet({ syncedAt: now, dirty: false });
  return now;
}

/* Первый обмен после входа: решаем, чьи данные новее */
async function syncOnLogin(){
  if(!sb || !sbUser) return;
  setSyncStatus('Синхронизация…','info');
  try{
    const remote = await syncPull();
    const meta = syncMeta();

    // в облаке пусто — выгружаем то, что есть локально
    if(!remote){
      await syncPush();
      setSyncStatus('Синхронизировано','ok');
      renderSync();
      return;
    }

    const localEmpty = !S.accounts.length && !S.transactions.length;
    const remoteNewer = !meta.syncedAt || remote.updated_at > meta.syncedAt;

    // локально пусто либо ничего не меняли — просто берём облако
    if(localEmpty || !meta.dirty){
      applyRemote(remote);
      setSyncStatus('Синхронизировано','ok');
      renderSync();
      return;
    }

    // меняли и здесь, и там — спрашиваем
    if(meta.dirty && remoteNewer){
      showConflict(remote);
      return;
    }

    await syncPush();
    setSyncStatus('Синхронизировано','ok');
  }catch(e){
    console.error('syncOnLogin', e);
    setSyncStatus('Ошибка синхронизации','bad');
    toast('Синхронизация не удалась: ' + (e.message||e));
  }
  renderSync();
}

/* Имя из учётной записи, если пользователь не задал его в приложении */
function adoptServerName(){
  if(!sbUser) return;
  const meta = sbUser.user_metadata || {};
  if(!profile().name && meta.full_name){ profile().name = meta.full_name; save(); }
}

function applyRemote(remote){
  S = Object.assign(JSON.parse(JSON.stringify(DEFAULT)), remote.data || {});
  localStorage.setItem(KEY, JSON.stringify(S));
  syncMetaSet({ syncedAt: remote.updated_at, dirty:false });
  renderAll();
}

/* Конфликт версий — решает пользователь, автоматически ничего не теряем */
function showConflict(remote){
  const rd = remote.data || {};
  const rCount = (rd.transactions||[]).length, rAcc = (rd.accounts||[]).length;
  const lCount = S.transactions.length, lAcc = S.accounts.length;
  document.getElementById('ovSchedBody').innerHTML = `
    <h3>Данные различаются</h3>
    <div class="note warn">На этом устройстве и в облаке данные менялись независимо.
      Выберите, какую версию оставить. Вторая будет заменена, поэтому сначала можно скачать копию.</div>
    <div class="grid2">
      <div class="stat">
        <div class="n" style="font-size:15px">${lAcc} / ${lCount}</div>
        <div class="l">Это устройство<br>счетов / операций</div>
      </div>
      <div class="stat">
        <div class="n" style="font-size:15px">${rAcc} / ${rCount}</div>
        <div class="l">Облако (${dateLong(remote.updated_at.slice(0,10))})<br>счетов / операций</div>
      </div>
    </div>
    <div class="btnrow" style="margin-top:14px">
      <button class="btn btn-s" onclick="backupData()">Скачать копию</button>
    </div>
    <div class="btnrow" style="margin-top:8px">
      <button class="btn btn-s" onclick='conflictKeepRemote(${JSON.stringify(JSON.stringify(remote))})'>Взять из облака</button>
      <button class="btn btn-p" onclick="conflictKeepLocal()">Оставить это устройство</button>
    </div>`;
  openOv('ovSched');
  setSyncStatus('Требуется выбор','bad');
}
function conflictKeepRemote(json){
  const remote = JSON.parse(json);
  applyRemote(remote);
  closeOv('ovSched');
  setSyncStatus('Синхронизировано','ok');
  toast('Загружены данные из облака');
  renderSync();
}
async function conflictKeepLocal(){
  closeOv('ovSched');
  try{
    await syncPush();
    setSyncStatus('Синхронизировано','ok');
    toast('Данные этого устройства выгружены в облако');
  }catch(e){ setSyncStatus('Ошибка синхронизации','bad'); toast('Не удалось выгрузить'); }
  renderSync();
}

/* ---------------- автосохранение ---------------- */
/* Вызывается из save() после каждой записи в локальное хранилище */
function syncScheduleUpload(){
  syncMetaSet({ dirty:true });
  if(!sb || !sbUser) return;
  setSyncStatus('Сохранение…','info');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(syncFlush, 1500);
}
async function syncFlush(){
  if(!sb || !sbUser || syncBusy) return;
  if(!navigator.onLine){ setSyncStatus('Офлайн — сохранится позже','req'); return; }
  syncBusy = true;
  try{
    await syncPush();
    setSyncStatus('Синхронизировано','ok');
  }catch(e){
    console.error('syncFlush', e);
    setSyncStatus('Не сохранено в облако','bad');
  }finally{
    syncBusy = false;
    renderSync();
  }
}
/* вернулся интернет — дослать накопленное */
window.addEventListener('online', ()=>{ if(syncMeta().dirty) syncFlush(); });
window.addEventListener('offline', ()=>{ if(sbUser) setSyncStatus('Офлайн','req'); });

async function syncNow(){
  if(!sb){ toast('Синхронизация не настроена'); return; }
  if(!sbUser){ toast('Сначала войдите'); return; }
  await syncOnLogin();
  toast('Готово');
}


/* старт */
syncInit();

/* -------------------------------------------------------------------------
   Установка на телефон и работа без интернета.
   Service worker регистрируется только на настоящем сайте (https),
   при открытии файла с диска он невозможен — это нормально.
   ------------------------------------------------------------------------- */
if('serviceWorker' in navigator && location.protocol.startsWith('http')){
  window.addEventListener('load', ()=>{
    navigator.serviceWorker.register('sw.js').catch(e=>console.log('SW не зарегистрирован:', e.message));
  });
}

/* =========================================================================
   ПРОФИЛЬ: аватар в шапке, имя и фото, вход и выход
   ========================================================================= */

function profile(){
  if(!S.profile) S.profile = {name:'', avatar:''};
  return S.profile;
}

/* Инициалы из имени, иначе первая буква почты */
function initials(){
  const n = (profile().name||'').trim();
  if(n){
    const parts = n.split(/\s+/).filter(Boolean);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  if(sbUser && sbUser.email) return sbUser.email[0].toUpperCase();
  return '?';
}

/* Аватар в шапке: фото, инициалы или приглашение войти */
function renderAvatar(){
  const btn = document.getElementById('avatarBtn');
  if(!btn) return;
  const p = profile();
  const guest = !sbUser;

  btn.className = 'avatar' + (guest && !p.avatar ? ' guest' : '');
  btn.innerHTML = p.avatar
    ? `<img src="${p.avatar}" alt="">`
    : (guest ? '?' : esc(initials()));
  btn.title = guest ? 'Войти в аккаунт' : (p.name || (sbUser && sbUser.email) || 'Аккаунт');
}

/* ---------------- окно аккаунта ---------------- */
function openAccountSheet(){
  renderAccountSheet();
  openOv('ovAccount');
}

/* Общий хвост окна профиля: категории расходов, курсы валют, о приложении.
   Один и тот же блок нужен и гостю, и вошедшему — вынесен отдельно,
   чтобы не дублировать разметку. */
function settingsBlockHtml(){
  return `
    <div class="sec-title" style="margin-top:18px">Категории</div>
    <div class="row" onclick="toggleCatSection()" style="cursor:pointer">
      <div class="l"><div class="t">Категории расходов</div>
        <div class="s">Отметьте, какие можно сократить при необходимости</div></div>
      <span class="arw" id="catArw" style="display:inline-block;width:9px;color:var(--muted);font-size:9px;transition:transform .15s">▶</span>
    </div>
    <div id="catBody" style="display:none">
      <div style="text-align:right;margin:6px 0 8px">
        <button class="act" onclick="openCategory()">+ Категория</button>
      </div>
      <div class="note" id="catNote">Отметка «необязательная» используется в аналитике, чтобы показать, где можно сократить траты.</div>
      <div id="catList"></div>
    </div>

    <div class="row" onclick="toggleRulesSection()" style="cursor:pointer">
      <div class="l"><div class="t">Правила подстановки</div>
        <div class="s">«Пятёрочка» — это «Продукты»: категория подставится сама</div></div>
      <span class="arw" id="rulesArw" style="display:inline-block;width:9px;color:var(--muted);font-size:9px;transition:transform .15s">▶</span>
    </div>
    <div id="rulesSecBody" style="display:none">
      <div style="text-align:right;margin:6px 0 8px">
        <button class="act" onclick="openRule()">+ Правило</button>
      </div>
      <div class="note">Если описание операции содержит указанный текст, категория подставится
        автоматически — и при ручном вводе, и при загрузке выписки.</div>
      <div id="rulesList"></div>
    </div>

    <div class="sec-title" style="margin-top:18px">Курсы валют</div>
    <div class="row" onclick="toggleRatesSection()" style="cursor:pointer">
      <div class="l"><div class="t">Курсы к рублю</div>
        <div class="s">Итоги в других валютах считаются по этим курсам</div></div>
      <span class="arw" id="ratesArw" style="display:inline-block;width:9px;color:var(--muted);font-size:9px;transition:transform .15s">▶</span>
    </div>
    <div id="ratesSecBody" style="display:none">
      <div style="text-align:right;margin:6px 0 8px">
        <button class="act" onclick="fetchRates()">Обновить из интернета</button>
      </div>
      <div id="ratesBody"></div>
    </div>

    <div class="sec-title" style="margin-top:18px">О приложении</div>
    <div style="font-size:12.5px;color:var(--muted);line-height:1.6">
      ${sbUser
        ? `Данные хранятся в двух местах: в этом браузере — поэтому приложение работает без интернета,
           и копия на сервере, привязанная к вашей почте — чтобы те же данные открывались на других устройствах.
           Доступ к ним есть только у вас: другие пользователи вашу копию не видят.`
        : `Вход не выполнен, поэтому данные хранятся только в этом браузере и на другом устройстве не откроются.
           Очистка данных браузера удалит их — делайте резервную копию.`}
      <br><br>
      К банкам приложение не подключается и ничего не списывает.
      Чтобы поставить иконку на телефон — откройте страницу в браузере и выберите «Добавить на экран Домой».
    </div>`;
}

function renderAccountSheet(){
  const box = document.getElementById('accountBody');
  if(!box) return;
  const p = profile();
  const meta = syncMeta();
  CAT_OPEN = false;
  RATES_OPEN = false;
  RULES_OPEN = false;

  /* --- гость: вход, он же регистрация --- */
  if(!sbUser){
    box.innerHTML = `
      <h3>Вход в аккаунт</h3>
      <div class="note">Введите имя и почту — придёт письмо со ссылкой.
        Отдельная регистрация не нужна: если вы здесь впервые, аккаунт создастся сам.
        Пароль придумывать не придётся.</div>
      <div class="f"><label>Как к вам обращаться</label>
        <input type="text" id="syName" placeholder="Наталья" value="${esc(p.name||'')}" autocomplete="name"></div>
      <div class="f"><label>Почта</label>
        <input type="email" id="syEmail" placeholder="name@example.com" autocomplete="email"></div>
      <button class="btn btn-p btn-blk" id="syLinkBtn" onclick="syncSendLink()">Получить ссылку для входа</button>
      <div id="syHint"></div>
      <div style="font-size:12px;color:var(--muted);margin-top:14px;line-height:1.6">
        Без входа приложение тоже работает, но данные останутся только в этом браузере
        и не откроются на телефоне.
      </div>

      <div class="sec-title" style="margin-top:18px">Данные</div>
      <div class="row"><div class="l"><div class="t">Резервная копия</div><div class="s">Сохранить все данные в файл</div></div>
        <button class="btn btn-s btn-sm" onclick="backupData()">Скачать</button></div>
      <div class="row"><div class="l"><div class="t">Восстановить</div><div class="s">Загрузить данные из файла копии</div></div>
        <button class="btn btn-s btn-sm" onclick="document.getElementById('restoreInput').click()">Загрузить</button></div>
      <div class="row"><div class="l"><div class="t">Очистить всё</div><div class="s">Удалить все данные без возврата</div></div>
        <button class="btn btn-d btn-sm" onclick="wipeData()">Очистить</button></div>
      ${settingsBlockHtml()}`;
    renderCategories(); renderRates(); renderRules();
    return;
  }

  /* --- вошедший пользователь --- */
  box.innerHTML = `
    <h3>Профиль</h3>
    <div style="text-align:center;margin-bottom:6px">
      <div class="avatar-lg" id="avatarBig">${p.avatar ? `<img src="${p.avatar}" alt="">` : esc(initials())}</div>
      <button class="btn btn-s btn-sm" onclick="pickAvatar()">${p.avatar ? 'Заменить фото' : 'Добавить фото'}</button>
      ${p.avatar ? `<button class="btn btn-s btn-sm" onclick="removeAvatar()">Убрать</button>` : ''}
    </div>
    <div class="f" style="margin-top:14px"><label>Имя</label>
      <input type="text" id="prName" value="${esc(p.name||'')}" placeholder="Ваше имя" onchange="saveProfileName()"></div>
    <div class="row"><div class="l"><div class="t">Почта</div>
      <div class="s">${esc(sbUser.email||'')}</div></div>
      <span class="chip ok">вход выполнен</span></div>
    <div class="row"><div class="l"><div class="t">Последняя синхронизация</div>
      <div class="s">${meta.syncedAt ? dateLong(meta.syncedAt.slice(0,10))+', '+meta.syncedAt.slice(11,16) : 'ещё не было'}</div></div>
      <button class="btn btn-s btn-sm" onclick="syncNow()">Обновить</button></div>

    <div class="sec-title" style="margin-top:18px">Данные</div>
    <div class="row"><div class="l"><div class="t">Резервная копия</div><div class="s">Сохранить все данные в файл</div></div>
      <button class="btn btn-s btn-sm" onclick="backupData()">Скачать</button></div>
    <div class="row"><div class="l"><div class="t">Восстановить</div><div class="s">Загрузить данные из файла копии</div></div>
      <button class="btn btn-s btn-sm" onclick="document.getElementById('restoreInput').click()">Загрузить</button></div>
    <div class="row"><div class="l"><div class="t">Очистить всё</div><div class="s">Удалить все данные без возврата</div></div>
      <button class="btn btn-d btn-sm" onclick="wipeData()">Очистить</button></div>
    ${settingsBlockHtml()}

    <div class="btnrow" style="margin-top:14px">
      <button class="btn btn-d btn-blk" onclick="syncSignOut()">Выйти из аккаунта</button>
    </div>`;
  renderCategories(); renderRates(); renderRules();
}

function saveProfileName(){
  const el = document.getElementById('prName');
  if(!el) return;
  profile().name = el.value.trim();
  save(); renderAvatar();
  const big = document.getElementById('avatarBig');
  if(big && !profile().avatar) big.textContent = initials();
  toast('Имя сохранено');
}

/* ---------------- фото ---------------- */
function pickAvatar(){ document.getElementById('avatarInput').click(); }

function removeAvatar(){
  profile().avatar = '';
  save(); renderAvatar(); renderAccountSheet();
  toast('Фото убрано');
}

/* Уменьшаем фото до 160 px и сжимаем — иначе оно раздует данные при синхронизации */
document.getElementById('avatarInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if(!file) return;
  if(!/^image\//.test(file.type)){ toast('Нужен файл изображения'); return; }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const SIZE = 160;
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = SIZE;
      const ctx = canvas.getContext('2d');
      // вписываем по короткой стороне, центрируем
      const side = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width-side)/2, (img.height-side)/2, side, side, 0, 0, SIZE, SIZE);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.82);
      if(dataUrl.length > 200000){ toast('Фото слишком большое'); return; }
      profile().avatar = dataUrl;
      save(); renderAvatar(); renderAccountSheet();
      toast('Фото сохранено');
    };
    img.onerror = () => toast('Не удалось прочитать изображение');
    img.src = reader.result;
  };
  reader.onerror = () => toast('Не удалось прочитать файл');
  reader.readAsDataURL(file);
});

/* renderSync теперь обновляет аватар и открытое окно профиля */
function renderSync(){
  renderAvatar();
  const ov = document.getElementById('ovAccount');
  if(ov && ov.classList.contains('on')) renderAccountSheet();
}
