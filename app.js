(function () {
  'use strict';

  // ===== Firebase Config (내장) =====
  const FB_CONFIG = {
    apiKey: "AIzaSyA7XKSZYG6ZcOotH3JyNnaj4Xaq4l40Qhg",
    authDomain: "chogpan-oda.firebaseapp.com",
    projectId: "chogpan-oda",
    storageBucket: "chogpan-oda.firebasestorage.app",
    messagingSenderId: "356064548857",
    appId: "1:356064548857:web:ecc9edda7c2891e7bc8f28",
  };

  const STORAGE_KEY = 'chogpan_records_v2';
  const MANAGERS_KEY = 'chogpan_managers';

  // ===== 담당자별 입금요청 정보 (Firestore 기반) =====
  // state.paymentInfos = [{ id, managerName, phone, ssn, bank, account }, ...]

  function buildPayRequestText(r) {
    const managerName = r.managerName || '';
    const info = (state.paymentInfos || []).find((p) => p.managerName === managerName)
      || (state.paymentInfos || [])[0]
      || {};
    const lines = [];
    lines.push('📋 코웨이 렌탈 접수');
    lines.push('');
    lines.push(`☞ ${r.customerName}고객님 건 입금요청 드립니다.`);
    lines.push('');
    if (info.managerName) lines.push(`성함: ${info.managerName}`);
    if (info.phone)       lines.push(`핸드폰번호: ${info.phone}`);
    if (info.ssn)         lines.push(`주민번호: ${info.ssn}`);
    if (info.bank || info.account) lines.push(`계좌번호: ${info.bank || ''} ${info.account || ''}`.trim());
    return lines.join('\n');
  }

  async function loadPaymentInfosFromFirestore() {
    if (!state.fbEnabled) {
      state.paymentInfos = [];
      return;
    }
    try {
      const snap = await state.fbDb.collection('paymentInfos').get();
      state.paymentInfos = [];
      snap.forEach((doc) => state.paymentInfos.push({ id: doc.id, ...doc.data() }));
      state.paymentInfos.sort((a, b) => (a.managerName || '').localeCompare(b.managerName || ''));
    } catch (e) {
      console.warn('paymentInfos load error:', e);
      state.paymentInfos = [];
    }
  }

  async function fbSavePaymentInfo(data) {
    if (!state.fbEnabled) throw new Error('Firestore 미연결 상태입니다. 페이지를 새로고침 후 다시 시도하세요.');
    if (data.id) {
      // 수정
      const { id, ...fields } = data;
      await state.fbDb.collection('paymentInfos').doc(id).set(fields);
      const idx = state.paymentInfos.findIndex((p) => p.id === id);
      if (idx >= 0) state.paymentInfos[idx] = { ...data };
    } else {
      // 신규
      const ref = await state.fbDb.collection('paymentInfos').add(data);
      state.paymentInfos.push({ id: ref.id, ...data });
    }
  }

  async function fbDeletePaymentInfo(id) {
    await state.fbDb.collection('paymentInfos').doc(id).delete();
    state.paymentInfos = state.paymentInfos.filter((p) => p.id !== id);
  }

  function renderPayReqList() {
    const el = $('#payReqList');
    if (!el) return;
    const list = state.paymentInfos || [];
    if (list.length === 0) {
      el.innerHTML = '<p class="manager-empty">등록된 입금요청 정보가 없습니다.</p>';
      return;
    }
    el.innerHTML = list.map((p) => `
      <div class="payreq-item" data-id="${escapeHtml(p.id || '')}">
        <div class="payreq-item-info">
          <strong>${escapeHtml(p.managerName || '')}</strong>
          <span>${escapeHtml(p.phone || '')}${p.ssn ? ' · ' + escapeHtml(p.ssn) : ''}</span>
          <span>${escapeHtml(p.bank || '')} ${escapeHtml(p.account || '')}</span>
        </div>
        <div class="payreq-item-btns">
          <button class="btn btn-sm btn-outline" onclick="window._editPayReq('${escapeHtml(p.id || '')}')">수정</button>
          <button class="btn btn-sm btn-danger" onclick="window._deletePayReq('${escapeHtml(p.id || '')}')">삭제</button>
        </div>
      </div>`).join('');
  }

  window._deletePayReq = async (id) => {
    if (!confirm('이 입금요청 정보를 삭제할까요?')) return;
    try {
      await fbDeletePaymentInfo(id);
      renderPayReqList();
      showToast('삭제되었습니다.', 'info');
    } catch (e) {
      showToast('삭제 실패: ' + e.message, 'error');
    }
  };

  window._editPayReq = (id) => {
    const p = (state.paymentInfos || []).find((x) => x.id === id);
    if (!p) return;
    $('#payReqAddName').value  = p.managerName || '';
    $('#payReqAddPhone').value = p.phone || '';
    $('#payReqAddSSN').value   = p.ssn || '';
    $('#payReqAddBank').value  = p.bank || '';
    $('#payReqAddAccount').value = p.account || '';
    $('#savePayReqAddBtn').dataset.editId = id;
    $('#savePayReqAddBtn').textContent = '💾 수정 저장';
    $('#payReqAddName').focus();
  };

  let state = {
    records: [],
    managers: [],
    products: [],
    paymentInfos: [],
    fbApp: null,
    fbDb: null,
    fbEnabled: false,
    currentDetail: null,
    searchQuery: '',
    monthFilter: '',
    managerFilter: '',
    unsubscribe: null,
  };

  // ===== 담당자 관리 (Firestore 기반) =====
  function loadManagers() {
    // localStorage 폴백 (Firestore 연결 전 빠른 로드)
    try {
      const raw = localStorage.getItem(MANAGERS_KEY);
      state.managers = raw ? JSON.parse(raw) : [];
    } catch { state.managers = []; }
  }
  function saveManagers() {
    localStorage.setItem(MANAGERS_KEY, JSON.stringify(state.managers));
  }

  // Firestore에서 담당자 목록 불러오기
  async function loadManagersFromFirestore() {
    if (!state.fbEnabled) return;
    try {
      const snap = await state.fbDb.collection('managers').orderBy('name').get();
      if (!snap.empty) {
        state.managers = [];
        snap.forEach((doc) => state.managers.push(doc.data().name));
        saveManagers();
        refreshManagerSelect();
        renderManagerList();
      } else if (state.managers.length > 0) {
        for (const name of state.managers) {
          await state.fbDb.collection('managers').add({ name, createdAt: Date.now() });
        }
      }
      // 기본 담당자 손진호 없으면 자동 추가
      if (!state.managers.includes('손진호')) {
        await fbAddManager('손진호');
        refreshManagerSelect();
        renderManagerList();
      }
      // 기본값 손진호 선택
      const sel = $('#managerName');
      if (sel && !sel.value) sel.value = '손진호';
    } catch (e) {
      console.warn('managers load error:', e);
    }
  }

  async function fbAddManager(name) {
    if (state.fbEnabled) {
      await state.fbDb.collection('managers').add({ name, createdAt: Date.now() });
    }
    if (!state.managers.includes(name)) {
      state.managers.push(name);
      state.managers.sort();
      saveManagers();
    }
  }

  async function fbDeleteManager(name) {
    if (state.fbEnabled) {
      const snap = await state.fbDb.collection('managers').where('name', '==', name).get();
      const batch = state.fbDb.batch();
      snap.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    state.managers = state.managers.filter((m) => m !== name);
    saveManagers();
  }
  function getManagerOptions() {
    const base = '<option value="">-- 선택 --</option>';
    return base + state.managers.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  }
  function refreshManagerSelect() {
    const sel = $('#managerName');
    if (!sel) return;
    const current = sel.value;
    sel.innerHTML = getManagerOptions();
    if (current) sel.value = current;
  }

  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  // ===== Toast =====
  function showToast(msg, type = 'info', ms = 2500) {
    let el = document.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      document.body.appendChild(el);
    }
    el.className = 'toast ' + type;
    el.textContent = msg;
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ===== Format helpers =====
  function formatPhone(v) {
    v = v.replace(/\D/g, '').slice(0, 11);
    if (v.length < 4) return v;
    if (v.length < 8) return v.slice(0, 3) + '-' + v.slice(3);
    return v.slice(0, 3) + '-' + v.slice(3, 7) + '-' + v.slice(7);
  }
  function formatCard(v) {
    v = v.replace(/\D/g, '').slice(0, 16);
    const parts = [];
    for (let i = 0; i < v.length; i += 4) parts.push(v.slice(i, i + 4));
    return parts.join('-');
  }
  function formatDate(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  function formatBirthday(dateStr) {
    if (!dateStr) return '';
    // 숫자 8자리 형식 처리 (19800101)
    const s = String(dateStr).replace(/\D/g, '');
    if (s.length === 8) {
      return `${s.slice(0,4)}년 ${s.slice(4,6)}월 ${s.slice(6,8)}일`;
    }
    // 기존 date 형식 처리 (2000-01-01)
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}년 ${pad(d.getMonth() + 1)}월 ${pad(d.getDate())}일`;
  }
  function formatCardExpiry(monthStr) {
    if (!monthStr) return '';
    const [y, m] = monthStr.split('-');
    if (!y || !m) return monthStr;
    return `${m}/${y.slice(2)}`;
  }
  function formatFee(v) {
    if (!v) return '';
    return Number(v).toLocaleString('ko-KR') + '원';
  }
  function escapeHtml(str) {
    if (str == null) return '';
    return String(str).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }
  function maskAccountNumber(num) {
    if (!num) return '';
    const s = num.replace(/\D/g, '');
    if (s.length <= 5) return '*'.repeat(s.length);
    return s.slice(0, 3) + '*'.repeat(s.length - 5) + s.slice(-2);
  }
  function maskCardNumber(num) {
    if (!num) return '';
    const parts = num.replace(/\D/g, '').match(/.{1,4}/g) || [];
    return parts.map((p, i) => (i === 1 || i === 2) ? '****' : p).join('-');
  }

  // ===== Firebase Init =====
  function initFirebase() {
    if (state.fbEnabled) return true;
    try {
      if (typeof firebase === 'undefined') throw new Error('firebase SDK not loaded');
      if (firebase.apps && firebase.apps.length > 0) {
        state.fbApp = firebase.app();
      } else {
        state.fbApp = firebase.initializeApp(FB_CONFIG);
      }
      state.fbDb = firebase.firestore();
      state.fbEnabled = true;
      return true;
    } catch (e) {
      console.error('Firebase init error:', e);
      state.fbEnabled = false;
      return false;
    }
  }

  // ===== Firestore CRUD =====
  async function fbAdd(record) {
    const toSave = { ...record };
    delete toSave.id; // Firestore doc ID = record.id
    await state.fbDb.collection('rentalReceipts').doc(record.id).set(toSave);
    return record.id;
  }

  async function fbUpdate(id, data) {
    await state.fbDb.collection('rentalReceipts').doc(id).update(data);
  }

  async function fbDelete(id) {
    await state.fbDb.collection('rentalReceipts').doc(id).delete();
  }

  // ===== 엑셀/CSV 파싱 =====
  async function parseProductFile(file) {
    const name = file.name.toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt')) {
      return parseCsvProducts(await file.text());
    }
    // xlsx/xls → SheetJS 사용
    if (typeof XLSX === 'undefined') throw new Error('엑셀 파싱 라이브러리 로드 실패. 인터넷 연결을 확인하고 페이지를 새로고침하세요.');
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });

    // 코웨이 탭 찾기
    let sheetName = wb.SheetNames.find((n) =>
      n.replace(/\s/g,'').includes('코웨이') ||
      n.toLowerCase().replace(/\s/g,'').includes('coway')
    );
    if (!sheetName) {
      // 없으면 첫 번째 시트 사용
      sheetName = wb.SheetNames[0];
    }
    console.log('사용 시트:', sheetName, '/ 전체 시트:', wb.SheetNames);

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    console.log('총 행 수:', rows.length, '/ 샘플 첫행:', rows[0]);

    const products = parseRowsToProducts(rows);
    console.log('파싱된 제품 수:', products.length);
    if (products.length > 0) {
      console.log('첫 제품 샘플:', products[0]);
      const withPromo = products.filter(p => p.promo && p.promo.trim());
      console.log('프로모션 있는 제품 수:', withPromo.length, '/ 샘플:', withPromo[0]);
    }
    return products;
  }

  function parseRowsToProducts(rows) {
    const products = [];
    let lastTitle = '';
    let lastModel = '';

    // 헤더 행 찾기
    let dataStart = 0;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const joined = rows[i].join('').replace(/\s/g, '').toLowerCase();
      if (joined.includes('타이틀') || joined.includes('모델명') || joined.includes('관리구분')) {
        dataStart = i + 1;
        console.log('헤더 행 발견 (행', i, '):', rows[i]);
        break;
      }
    }

    // 컬럼 인덱스 동적 탐지
    let colTitle = 0, colModel = 1, colManageType = 2, colContract = 3;
    let colCycle = 4, colPromo = -1, colPeriod = -1, colFee = -1, colFee133 = -1;

    if (dataStart > 0) {
      const header = rows[dataStart - 1].map((c) => String(c).trim());
      console.log('헤더 컬럼:', header);
      header.forEach((h, i) => {
        const lh = h.replace(/\s/g, '').toLowerCase();
        if (lh.includes('타이틀') || lh === 'title') colTitle = i;
        else if (lh.includes('모델명') || lh === 'model') colModel = i;
        else if (lh.includes('관리구분') || lh.includes('managetype')) colManageType = i;
        else if (lh.includes('약정명')) colContract = i;
        else if (lh.includes('관리주기') || lh.includes('cycle')) colCycle = i;
        else if (lh.includes('프로모션') || lh.includes('promo')) colPromo = i;
        else if (lh.includes('렌탈기간') || lh.includes('period')) colPeriod = i;
        else if (lh.includes('렌탈료') && !lh.includes('13')) colFee = i;
        else if (lh.includes('13.3') || lh.includes('제외')) colFee133 = i;
      });
      console.log('컬럼 인덱스 → title:', colTitle, 'model:', colModel, 'manage:', colManageType, 'contract:', colContract, 'promo:', colPromo, 'fee:', colFee);
    }

    if (colFee === -1) colFee = 9;
    if (colFee133 === -1) colFee133 = 10;
    if (colPeriod === -1) colPeriod = 8;
    if (colPromo === -1) colPromo = 6; // 기본값: 타이틀|모델명|관리구분|약정명|관리주기|프로모션 → 인덱스 5, 또는 9개월내재접수 포함 시 6

    for (let i = dataStart; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 6) continue;

      let title = String(row[colTitle] || '').trim();
      let model = String(row[colModel] || '').trim();

      // 빈 타이틀/모델 이전 값으로 채우기
      if (title) lastTitle = title;
      else title = lastTitle;
      if (model) lastModel = model;
      else model = lastModel;

      const manageType = String(row[colManageType] || '').trim();
      const contractTerm = String(row[colContract] || '').trim();
      const manageCycle = String(row[colCycle] || '').trim();
      const promo = String(row[colPromo] || '').trim();
      const rentalPeriod = colPeriod >= 0 ? String(row[colPeriod] || '').trim() : '';

      // 렌탈료: 해당 컬럼에서 먼저 시도, 없으면 뒤에서 숫자 찾기
      let rentalFee = parseInt(String(row[colFee] || '').replace(/[^0-9]/g, '') || '0', 10);
      let fee133 = parseInt(String(row[colFee133] || '').replace(/[^0-9]/g, '') || '0', 10);

      // 렌탈료가 0이면 행 전체에서 숫자 컬럼 탐색 (5~12번째 컬럼)
      if (!rentalFee) {
        for (let c = 5; c < Math.min(row.length, 13); c++) {
          const v = parseInt(String(row[c] || '').replace(/[^0-9]/g, '') || '0', 10);
          if (v >= 5000 && v <= 500000) { rentalFee = v; break; }
        }
      }

      if (!title || !manageType || !contractTerm || !rentalFee) continue;
      // 헤더행 스킵
      if (title === '타이틀' || manageType === '관리구분' || manageType === '관리방식') continue;
      // 빈 행 스킵
      if (title.length < 2) continue;

      products.push({ title, model, manageType, contractTerm, manageCycle, rentalPeriod, rentalFee, fee133, promo });
    }
    return products;
  }

  function parseCsvProducts(text) {
    const lines = text.split('\n').map((l) => l.trim()).filter((l) => l);
    const rows = lines.map((line) => line.split(',').map((c) => c.replace(/^"|"$/g, '').trim()));
    return parseRowsToProducts(rows);
  }

  // ===== Products Firestore =====
  async function loadProductsFromFirestore() {
    const fallback = window.COWAY_PRODUCTS || [];
    if (!state.fbEnabled) {
      state.products = fallback;
      buildProductSelect();
      updateProductCountInfo();
      return;
    }
    try {
      const snap = await state.fbDb.collection('products').get();
      if (snap.empty) {
        state.products = fallback;
      } else {
        state.products = [];
        snap.forEach((doc) => state.products.push({ id: doc.id, ...doc.data() }));
      }
    } catch (e) {
      console.warn('products load error:', e);
      state.products = fallback;
    }
    buildProductSelect();
    updateProductCountInfo();
  }

  async function uploadProductsToFirestore(products) {
    if (!state.fbEnabled) throw new Error('Firestore 미연결');
    // 기존 전체 삭제
    const existing = await state.fbDb.collection('products').get();
    if (!existing.empty) {
      // 100개씩 배치 삭제
      const docRefs = [];
      existing.forEach((doc) => docRefs.push(doc.ref));
      for (let i = 0; i < docRefs.length; i += 100) {
        const delBatch = state.fbDb.batch();
        docRefs.slice(i, i + 100).forEach((ref) => delBatch.delete(ref));
        await delBatch.commit();
      }
    }
    // 새 데이터 100개씩 배치 업로드
    for (let i = 0; i < products.length; i += 100) {
      const addBatch = state.fbDb.batch();
      products.slice(i, i + 100).forEach((p) => {
        const ref = state.fbDb.collection('products').doc();
        // promo 포함 모든 필드 명시적으로 저장
        addBatch.set(ref, {
          title: p.title || '',
          model: p.model || '',
          manageType: p.manageType || '',
          contractTerm: p.contractTerm || '',
          manageCycle: p.manageCycle || '',
          rentalPeriod: p.rentalPeriod || '',
          rentalFee: p.rentalFee || 0,
          fee133: p.fee133 || 0,
          promo: p.promo || '',
        });
      });
      await addBatch.commit();
    }
    state.products = products;
    buildProductSelect();
    updateProductCountInfo();
  }

  // ===== LocalStorage fallback =====
  function loadLocalRecords() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch { return []; }
  }
  function saveLocalRecords() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.records));
  }

  // ===== Realtime listener =====
  function startRealtimeSync() {
    if (!state.fbEnabled || state.unsubscribe) return;
    state.unsubscribe = state.fbDb
      .collection('rentalReceipts')
      .orderBy('createdAt', 'desc')
      .onSnapshot((snap) => {
        state.records = [];
        snap.forEach((doc) => {
          state.records.push({ id: doc.id, ...doc.data() });
        });
        saveLocalRecords();
        renderList();
        refreshMonthFilter();
        refreshManagerFilter();
        refreshDbMonthFilter();
        refreshDbManagerFilter();
        updateDbStats();
      }, (err) => {
        console.error('Realtime sync error:', err);
        showToast('Firestore 실시간 연결 오류', 'error');
      });
  }

  // ===== Save / Delete =====
  async function saveRecord(data) {
    const now = Date.now();
    const record = {
      id: uid(),
      createdAt: now,
      updatedAt: now,
      ...data,
    };

    if (state.fbEnabled) {
      await fbAdd(record);
      // Realtime listener will update state.records automatically
    } else {
      state.records.unshift(record);
      saveLocalRecords();
      renderList();
    }
    return record;
  }

  async function deleteRecord(id) {
    if (state.fbEnabled) {
      await fbDelete(id);
      // Realtime listener handles removal
    } else {
      const idx = state.records.findIndex((r) => r.id === id);
      if (idx < 0) return false;
      state.records.splice(idx, 1);
      saveLocalRecords();
      renderList();
    }
    return true;
  }

  // ===== Form =====
  function readForm() {
    const fd = new FormData($('#rentalForm'));
    const data = {};
    fd.forEach((v, k) => { data[k] = v; });
    return data;
  }

  function validateForm(data) {
    const errors = [];
    if (!data.managerName?.trim()) errors.push('담당자를 선택하세요.');
    if (!data.customerName?.trim()) errors.push('성함을 입력하세요.');
    if (!data.customerPhone?.trim()) errors.push('핸드폰 번호를 입력하세요.');
    else if (data.customerPhone.replace(/\D/g, '').length < 10) errors.push('정확한 핸드폰 번호를 입력하세요.');
    if (!data.birthDate) errors.push('생년월일을 입력하세요.');
    if (!data.gender) errors.push('성별을 선택하세요.');
    if (!data.installAddress?.trim()) errors.push('설치 주소를 입력하세요.');
    if (!data.payMethod) errors.push('결제 방식을 선택하세요.');
    if (data.payMethod === '계좌이체') {
      if (!data.bankName) errors.push('은행명을 선택하세요.');
      if (!data.accountHolder?.trim()) errors.push('예금주를 입력하세요.');
      if (!data.accountNumber?.trim()) errors.push('계좌번호를 입력하세요.');
    } else if (data.payMethod === '신용카드') {
      if (!data.cardCompany) errors.push('카드사를 선택하세요.');
      if (!data.cardHolder?.trim()) errors.push('카드소유주를 입력하세요.');
      if (!data.cardNumber?.trim()) errors.push('카드번호를 입력하세요.');
      else if (data.cardNumber.replace(/\D/g, '').length !== 16) errors.push('카드번호 16자리를 모두 입력하세요.');
      if (!data.cardExpiry) errors.push('카드 유효기간을 선택하세요.');
    }
    // 제품: productsJson 우선, 없으면 productName 폴백
    const cartProducts = data.productsJson ? (() => { try { return JSON.parse(data.productsJson); } catch { return []; } })() : [];
    if (cartProducts.length === 0 && !data.productName?.trim()) errors.push('제품을 1개 이상 추가하세요.');
    return errors;
  }

  function bindForm() {
    $('#customerPhone').addEventListener('input', (e) => {
      e.target.value = formatPhone(e.target.value);
    });
    $('#cardNumber').addEventListener('input', (e) => {
      e.target.value = formatCard(e.target.value);
    });

    // 성함 입력 시 예금주/카드소유주 자동 입력
    $('#customerName').addEventListener('input', (e) => {
      const name = e.target.value;
      const holder = $('#accountHolder');
      const cardHolder = $('#cardHolder');
      // 성함 변경 시 항상 덮어씀 (수동 플래그 초기화)
      if (holder) { holder.value = name; holder.dataset.manualEdit = ''; }
      if (cardHolder) { cardHolder.value = name; cardHolder.dataset.manualEdit = ''; }
    });
    // 수동 입력 시 자동입력 중단 플래그
    $('#accountHolder').addEventListener('input', (e) => {
      const customerName = $('#customerName').value;
      e.target.dataset.manualEdit = e.target.value !== customerName ? '1' : '';
    });
    $('#cardHolder').addEventListener('input', (e) => {
      const customerName = $('#customerName').value;
      e.target.dataset.manualEdit = e.target.value !== customerName ? '1' : '';
    });

    // 통신사 라디오 + 알뜰폰 체크박스 연동
    function updateTelecomValue() {
      const mvno = $('#telecomMvno');
      const checked = $$('input[name="telecomCarrier"]').find((r) => r.checked);
      const hiddenVal = $('#telecomValue');
      if (!hiddenVal) return;
      const carrier = checked ? checked.value : '';
      const isMvno = mvno && mvno.checked;
      // 안내 문구 표시
      const note = $('#telecomMvnoNote');
      if (note) note.style.display = isMvno ? 'block' : 'none';
      if (carrier && isMvno) {
        hiddenVal.value = carrier + ' 알뜰폰';
      } else if (carrier) {
        hiddenVal.value = carrier;
      } else if (isMvno) {
        hiddenVal.value = '알뜰폰';
      } else {
        hiddenVal.value = '';
      }
    }
    $$('input[name="telecomCarrier"]').forEach((radio) => {
      radio.addEventListener('change', updateTelecomValue);
    });
    $('#telecomMvno')?.addEventListener('change', updateTelecomValue);

    $$('input[name="payMethod"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        const val = e.target.value;
        $('#accountFields').style.display = val === '계좌이체' ? 'block' : 'none';
        $('#cardFields').style.display = val === '신용카드' ? 'block' : 'none';
        if (val === '계좌이체') {
          ['bankName','accountHolder','accountNumber'].forEach((id) => $(`#${id}`).setAttribute('required','required'));
          ['cardCompany','cardHolder','cardNumber','cardExpiry'].forEach((id) => $(`#${id}`).removeAttribute('required'));
        } else {
          ['cardCompany','cardHolder','cardNumber','cardExpiry'].forEach((id) => $(`#${id}`).setAttribute('required','required'));
          ['bankName','accountHolder','accountNumber'].forEach((id) => $(`#${id}`).removeAttribute('required'));
        }
      });
    });
    $('#resetBtn').addEventListener('click', () => {
      if (!confirm('입력된 내용을 모두 초기화할까요?')) return;
      $('#rentalForm').reset();
      $('#accountFields').style.display = 'none';
      $('#cardFields').style.display = 'none';
      if ($('#telecomValue')) $('#telecomValue').value = '';
      if ($('#telecomMvno')) $('#telecomMvno').checked = false;
      const note = $('#telecomMvnoNote');
      if (note) note.style.display = 'none';
      // 제품 검색 초기화
      const si = $('#productSearchInput');
      if (si) si.value = '';
      clearProductDetail();
      hideSelectedBadge();
      const pd = $('#productDetailRow');
      if (pd) pd.style.display = 'none';
      hideFormMsg();
      showToast('폼이 초기화되었습니다.', 'info');
    });
    $('#rentalForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      hideFormMsg();
      const data = readForm();
      const errors = validateForm(data);
      if (errors.length > 0) {
        showFormMsg(errors.join('<br>'), 'error');
        showToast('입력 항목을 확인하세요.', 'error');
        return;
      }
      const submitBtn = e.target.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = '저장 중...';
      try {
        const rec = await saveRecord(data);
        $('#rentalForm').reset();
        $('#accountFields').style.display = 'none';
        $('#cardFields').style.display = 'none';
        if ($('#telecomValue')) $('#telecomValue').value = '';
        if ($('#telecomMvno')) $('#telecomMvno').checked = false;
        const noteEl = $('#telecomMvnoNote');
        if (noteEl) noteEl.style.display = 'none';
        clearProductDetail();
        const where = state.fbEnabled ? 'Firestore DB + 로컬 저장 완료 ✅' : '로컬에만 저장됨 (Firebase 미연결)';
        showFormMsg(`✅ 접수가 저장되었습니다.<br>${where}`, 'success');
        showToast('저장되었습니다!', 'success');
        if (confirm('저장된 내용을 카카오톡으로 보낼까요?')) {
          const text = buildKakaoText(rec, { includeSensitive: true });
          await shareViaKakao(text);
        }
      } catch (err) {
        console.error(err);
        showFormMsg('저장 실패: ' + (err.message || err), 'error');
        showToast('저장 실패', 'error');
      } finally {
        submitBtn.disabled = false;
        submitBtn.textContent = '저장하기';
      }
    });
  }

  function showFormMsg(html, type = 'info') {
    const el = $('#formMsg');
    el.className = 'form-msg ' + type;
    el.innerHTML = html;
    el.style.display = 'block';
  }
  function hideFormMsg() {
    $('#formMsg').style.display = 'none';
  }

  // ===== Kakao / Clipboard =====
  function buildKakaoText(r, { includeSensitive = true } = {}) {
    const lines = [];
    lines.push('📋 코웨이 렌탈 접수 내역');
    lines.push('──────────────');
    lines.push('👤 [고객 정보]');
    lines.push(`성함: ${r.customerName}`);
    lines.push(`핸드폰: ${r.customerPhone}${r.telecom ? ' (' + r.telecom + ')' : ''}`);
    // 생년월일 6자리 + 성별코드 (남자=1, 여자=2)
    const bdRaw = String(r.birthDate || '').replace(/\D/g, '');
    const bd6 = bdRaw.length >= 8 ? bdRaw.slice(2, 8) : bdRaw.slice(0, 6);
    const genderCode = r.gender === '여자' ? '2' : '1';
    lines.push(`주민번호앞자리: ${bd6}-${genderCode}`);
    lines.push(`설치주소: ${r.installAddress}`);
    lines.push('');
    lines.push('💳 [결제 정보]');
    lines.push(`결제방식: ${r.payMethod}`);
    if (r.payMethod === '계좌이체') {
      lines.push(`은행명: ${r.bankName}`);
      lines.push(`예금주: ${r.accountHolder}`);
      lines.push(`계좌번호: ${includeSensitive ? r.accountNumber : maskAccountNumber(r.accountNumber)}`);
    } else {
      lines.push(`카드사: ${r.cardCompany}`);
      lines.push(`카드소유주: ${r.cardHolder}`);
      lines.push(`카드번호: ${includeSensitive ? r.cardNumber : maskCardNumber(r.cardNumber)}`);
      lines.push(`유효기간: ${formatCardExpiry(r.cardExpiry)}`);
    }
    lines.push('');
    lines.push('🧺 [제품 정보]');
    // 다중 제품 지원
    const products = r.productsJson ? (() => { try { return JSON.parse(r.productsJson); } catch { return []; } })() : [];
    if (products.length > 1) {
      products.forEach((p, i) => {
        if (i > 0) lines.push('');
        lines.push(`[${i + 1}] ${p.title} (${p.model || ''})`);
        lines.push(`    ${p.contractTerm} / ${p.manageType} / ${Number(p.rentalFee).toLocaleString()}원${p.promo ? ' / 🎁' + p.promo : ''}`);
      });
      const total = products.reduce((s, p) => s + (Number(p.rentalFee) || 0), 0);
      lines.push('');
      lines.push(`합계 월 렌탈료: ${total.toLocaleString()}원`);
    } else {
      lines.push(`제품명: ${r.productName}`);
      lines.push(`모델명: ${r.productModel}`);
      lines.push(`약정기간: ${r.contractTerm}`);
      lines.push(`관리방식: ${r.manageType}`);
      if (r.rentalFee) lines.push(`월 렌탈료: ${formatFee(r.rentalFee)}`);
    }
    if (r.otherDiscount?.trim()) lines.push(`기타할인/비고: ${r.otherDiscount.trim()}`);
    lines.push('');
    lines.push('──────────────');
    lines.push(`접수일: ${formatDate(r.createdAt)}`);
    lines.push('✅ 위의 모든 정보는 한사람 명의로 일치합니다.');
    return lines.join('\n');
  }

  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); document.body.removeChild(ta); return true; }
      catch (e) { document.body.removeChild(ta); return false; }
    }
  }

  async function shareViaKakao(text) {
    if (navigator.share) {
      try {
        await navigator.share({ text });
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') return false;
      }
    }
    const ok = await copyToClipboard(text);
    if (ok) showToast('내용이 복사되었습니다. 카톡에 붙여넣으세요.', 'info', 3000);
    return ok;
  }

  // ===== List Rendering =====
  function renderList() {
    const container = $('#listContainer');
    let list = state.records.slice();

    // 텍스트 검색 (이름, 전화번호, 제품명, 모델명, 주소, 담당자)
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase().trim();
      const qNum = q.replace(/\D/g, '');
      list = list.filter((r) => {
        // 이름 검색
        if ((r.customerName || '').toLowerCase().includes(q)) return true;
        // 전화번호 검색 (숫자만)
        if (qNum && (r.customerPhone || '').replace(/\D/g, '').includes(qNum)) return true;
        // 제품명 검색
        if ((r.productName || '').toLowerCase().includes(q)) return true;
        // 모델명 검색
        if ((r.productModel || '').toLowerCase().includes(q)) return true;
        // 주소 검색
        if ((r.installAddress || '').toLowerCase().includes(q)) return true;
        // 담당자 검색
        if ((r.managerName || '').toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // 월 필터
    if (state.monthFilter) {
      list = list.filter((r) => {
        if (!r.createdAt) return false;
        const d = new Date(r.createdAt);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return ym === state.monthFilter;
      });
    }

    // 담당자 필터
    if (state.managerFilter) {
      list = list.filter((r) => (r.managerName || '') === state.managerFilter);
    }

    // 건수 표시
    const countEl = $('#listCount');
    if (countEl) {
      countEl.textContent = list.length > 0 ? `총 ${list.length}건` : '';
    }

    if (list.length === 0) {
      container.innerHTML = `<p class="empty-msg">${(state.searchQuery || state.monthFilter) ? '검색 결과가 없습니다.' : '아직 저장된 접수가 없습니다.'}</p>`;
      return;
    }
    container.innerHTML = list.map((r) => {
      const payBadge = r.payMethod === '신용카드' ? 'badge-card' : 'badge-account';
      const fee = r.rentalFee ? formatFee(r.rentalFee) : '-';
      return `
        <div class="record-card" data-id="${r.id}">
          <div class="record-head">
            <div>
              <span class="record-title">${escapeHtml(r.customerName)} · ${escapeHtml(r.customerPhone)}</span>
              <span class="badge ${payBadge}">${escapeHtml(r.payMethod)}</span>
              ${r.managerName ? `<span class="badge badge-manager">👤 ${escapeHtml(r.managerName)}</span>` : ''}
            </div>
            <span class="record-date">${formatDate(r.createdAt)}</span>
          </div>
          <div class="record-meta">
            <div><span>제품</span>${escapeHtml(r.productName)} (${escapeHtml(r.productModel)})</div>
            <div><span>약정/관리</span>${escapeHtml(r.contractTerm)} / ${escapeHtml(r.manageType)}</div>
            <div><span>월 렌탈료</span>${fee}</div>
            <div><span>주소</span>${escapeHtml(r.installAddress || '')}</div>
          </div>
        </div>`;
    }).join('');
  }

  // 월 필터 옵션 갱신
  function refreshMonthFilter() {
    const sel = $('#monthFilter');
    if (!sel) return;
    const months = new Set();
    state.records.forEach((r) => {
      if (!r.createdAt) return;
      const d = new Date(r.createdAt);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    const sorted = [...months].sort().reverse();
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 월</option>' +
      sorted.map((m) => {
        const [y, mo] = m.split('-');
        return `<option value="${m}">${y}년 ${parseInt(mo, 10)}월</option>`;
      }).join('');
    if (current && months.has(current)) sel.value = current;
  }

  // 담당자 필터 옵션 갱신 (접수 목록 탭)
  function refreshManagerFilter() {
    const sel = $('#managerFilter');
    if (!sel) return;
    const managers = [...new Set(
      state.records.map((r) => r.managerName || '').filter(Boolean)
    )].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 담당자</option>' +
      managers.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (current && managers.includes(current)) sel.value = current;
  }

  // ===== Detail Modal =====
  function openDetail(id) {
    const r = state.records.find((x) => x.id === id);
    if (!r) return;
    state.currentDetail = r;
    $('#modalTitle').textContent = `${r.customerName}님 접수 상세`;

    const payRows = r.payMethod === '계좌이체'
      ? `<div class="d-label">은행명</div><div class="d-value">${escapeHtml(r.bankName || '')}</div>
         <div class="d-label">예금주</div><div class="d-value">${escapeHtml(r.accountHolder || '')}</div>
         <div class="d-label">계좌번호</div><div class="d-value">${escapeHtml(r.accountNumber || '')}</div>`
      : `<div class="d-label">카드사</div><div class="d-value">${escapeHtml(r.cardCompany || '')}</div>
         <div class="d-label">카드소유주</div><div class="d-value">${escapeHtml(r.cardHolder || '')}</div>
         <div class="d-label">카드번호</div><div class="d-value">${escapeHtml(r.cardNumber || '')}</div>
         <div class="d-label">유효기간</div><div class="d-value">${escapeHtml(formatCardExpiry(r.cardExpiry))}</div>`;

    $('#modalBody').innerHTML = `
      <div class="detail-section">
        <h4>👤 고객 정보</h4>
        <div class="detail-grid">
          <div class="d-label">담당자</div><div class="d-value">${escapeHtml(r.managerName || '-')}</div>
          <div class="d-label">성함</div><div class="d-value">${escapeHtml(r.customerName)}</div>
          <div class="d-label">핸드폰</div><div class="d-value">${escapeHtml(r.customerPhone)}</div>
          ${r.telecom ? `<div class="d-label">통신사</div><div class="d-value">${escapeHtml(r.telecom)}</div>` : ''}
          <div class="d-label">생년월일</div><div class="d-value">${escapeHtml(formatBirthday(r.birthDate))}</div>
          <div class="d-label">성별</div><div class="d-value">${escapeHtml(r.gender || '')}</div>
          <div class="d-label">설치주소</div><div class="d-value">${escapeHtml(r.installAddress || '')}</div>
        </div>
      </div>
      <div class="detail-section">
        <h4>💳 결제 정보 (${escapeHtml(r.payMethod || '')})</h4>
        <div class="detail-grid">${payRows}</div>
      </div>
      <div class="detail-section">
        <h4>🧺 제품 정보</h4>
        ${(() => {
          const products = r.productsJson ? (() => { try { return JSON.parse(r.productsJson); } catch { return []; } })() : [];
          if (products.length > 1) {
            const total = products.reduce((s, p) => s + (Number(p.rentalFee) || 0), 0);
            const totalFee133 = products.reduce((s, p) => s + (Number(p.fee133) || 0), 0);
            return `<div class="multi-product-list">
              ${products.map((p, i) => `
                <div class="multi-product-item">
                  <span class="multi-product-num">${i + 1}</span>
                  <div class="multi-product-info">
                    <div class="multi-product-title">${escapeHtml(p.title)} <small>${escapeHtml(p.model || '')}</small></div>
                    <div class="multi-product-meta">${escapeHtml(p.contractTerm)} · ${escapeHtml(p.manageType)} · <strong>${Number(p.rentalFee).toLocaleString()}원</strong>${p.promo ? ' · 🎁 ' + escapeHtml(p.promo) : ''}${p.fee133 ? ' <span class="fee133-badge">💰 ' + Number(p.fee133).toLocaleString() + '</span>' : ''}</div>
                  </div>
                </div>`).join('')}
              <div class="multi-product-total">합계 월 렌탈료: <strong>${total.toLocaleString()}원</strong>${totalFee133 ? ' <span class="fee133-badge">💰 ' + totalFee133.toLocaleString() + '</span>' : ''}</div>
            </div>
            <div class="detail-grid">
              <div class="d-label">기타 할인/비고</div><div class="d-value">${escapeHtml(r.otherDiscount || '-').replace(/\n/g, '<br>')}</div>
            </div>`;
          } else {
            return `<div class="detail-grid">
              <div class="d-label">제품명</div><div class="d-value">${escapeHtml(r.productName)}</div>
              <div class="d-label">모델명</div><div class="d-value">${escapeHtml(r.productModel)}</div>
              <div class="d-label">약정기간</div><div class="d-value">${escapeHtml(r.contractTerm || '')}</div>
              <div class="d-label">관리방식</div><div class="d-value">${escapeHtml(r.manageType || '')}</div>
              <div class="d-label">월 렌탈료</div><div class="d-value">${escapeHtml(formatFee(r.rentalFee))}${(products[0]?.fee133 || r.fee133) ? ' <span class="fee133-badge">💰 ' + Number(products[0]?.fee133 || r.fee133).toLocaleString() + '</span>' : ''}</div>
              <div class="d-label">기타 할인/비고</div><div class="d-value">${escapeHtml(r.otherDiscount || '-').replace(/\n/g, '<br>')}</div>
            </div>`;
          }
        })()}
      </div>
      <div class="detail-section">
        <h4>📋 접수</h4>
        <div class="detail-grid">
          <div class="d-label">담당자</div><div class="d-value">${escapeHtml(r.managerName || '-')}</div>
          <div class="d-label">접수일시</div><div class="d-value">${escapeHtml(formatDate(r.createdAt))}</div>
        </div>
      </div>`;
    $('#detailModal').style.display = 'flex';
  }

  function closeDetail() {
    $('#detailModal').style.display = 'none';
    state.currentDetail = null;
  }

  // ===== DB 관리 탭 =====
  function updateDbStats() {
    const el = $('#dbStats');
    if (!el) return;

    const now = new Date();
    const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastYM = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    const total = state.records.length;

    // 이번 달 / 지난 달 접수
    const thisMonthRecs = state.records.filter((r) => {
      if (!r.createdAt) return false;
      const d = new Date(r.createdAt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === thisYM;
    });
    const lastMonthRecs = state.records.filter((r) => {
      if (!r.createdAt) return false;
      const d = new Date(r.createdAt);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` === lastYM;
    });
    const thisMonthCount = thisMonthRecs.length;
    const lastMonthCount = lastMonthRecs.length;
    const monthDiff = thisMonthCount - lastMonthCount;
    const monthDiffHtml = monthDiff > 0
      ? `<span class="stat-trend up">▲ ${monthDiff}</span>`
      : monthDiff < 0
        ? `<span class="stat-trend down">▼ ${Math.abs(monthDiff)}</span>`
        : `<span class="stat-trend flat">— 동일</span>`;

    // 총 월 렌탈료 → 제거됨

    // 담당자별 이번 달 실적
    const managerStats = {};
    thisMonthRecs.forEach((r) => {
      const m = r.managerName || '미지정';
      managerStats[m] = (managerStats[m] || 0) + 1;
    });
    const managerRows = Object.entries(managerStats)
      .sort((a, b) => b[1] - a[1])
      .map(([name, cnt]) => `<div class="stat-rank-row"><span>${escapeHtml(name)}</span><span class="stat-rank-num">${cnt}건</span></div>`)
      .join('') || '<div class="stat-rank-row empty">접수 없음</div>';

    // 품목별 렌탈 수 (productName 앞 키워드 추출)
    const categoryKeywords = [
      { key: '정수기', label: '정수기 💧' },
      { key: '비데', label: '비데 🚽' },
      { key: '공기청정기', label: '공기청정기 🌬️' },
      { key: '매트리스', label: '매트리스 🛏️' },
      { key: '연수기', label: '연수기 🫧' },
      { key: '제습기', label: '제습기 💨' },
      { key: '안마의자', label: '안마의자 💆' },
    ];
    const categoryStats = {};
    state.records.forEach((r) => {
      const name = (r.productName || '').toLowerCase();
      let matched = false;
      for (const { key, label } of categoryKeywords) {
        if (name.includes(key)) {
          categoryStats[label] = (categoryStats[label] || 0) + 1;
          matched = true;
          break;
        }
      }
      if (!matched) {
        categoryStats['기타'] = (categoryStats['기타'] || 0) + 1;
      }
    });
    const categoryRows = Object.entries(categoryStats)
      .sort((a, b) => b[1] - a[1])
      .map(([label, cnt]) => {
        const pct = total > 0 ? Math.round((cnt / total) * 100) : 0;
        return `
          <div class="stat-bar-row">
            <span class="stat-bar-label">${label}</span>
            <div class="stat-bar-wrap">
              <div class="stat-bar-fill" style="width:${pct}%"></div>
            </div>
            <span class="stat-bar-num">${cnt}건</span>
          </div>`;
      }).join('') || '<div class="stat-rank-row empty">데이터 없음</div>';

    el.innerHTML = `
      <div class="stat-card">
        <div class="stat-num">${total}</div>
        <div class="stat-label">총 누적 접수</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">${thisMonthCount} ${monthDiffHtml}</div>
        <div class="stat-label">이번 달 접수</div>
        <div class="stat-sub">지난달 ${lastMonthCount}건</div>
      </div>
      <div class="stat-card stat-card-wide">
        <div class="stat-label-top">👤 이번 달 담당자별 실적</div>
        <div class="stat-rank">${managerRows}</div>
      </div>
      <div class="stat-card stat-card-wide">
        <div class="stat-label-top">📦 품목별 누적 접수</div>
        <div class="stat-bars">${categoryRows}</div>
      </div>`;

    // dbConnectionStatus 제거됨 (HTML에서 삭제)
  }

  function renderDbTable() {
    const tbody = $('#dbTableBody');
    if (!tbody) return;
    let list = state.records.slice();

    // 텍스트 검색 - 이름, 전화번호, 제품명, 모델명, 주소, 담당자 전부
    const q = ($('#dbSearchInput')?.value || '').toLowerCase().trim();
    if (q) {
      const qNum = q.replace(/\D/g, '');
      list = list.filter((r) => {
        if ((r.customerName || '').toLowerCase().includes(q)) return true;
        if (qNum && (r.customerPhone || '').replace(/\D/g, '').includes(qNum)) return true;
        if ((r.productName || '').toLowerCase().includes(q)) return true;
        if ((r.productModel || '').toLowerCase().includes(q)) return true;
        if ((r.installAddress || '').toLowerCase().includes(q)) return true;
        if ((r.managerName || '').toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // 월 필터
    const mf = ($('#dbMonthFilter')?.value || '');
    if (mf) {
      list = list.filter((r) => {
        if (!r.createdAt) return false;
        const d = new Date(r.createdAt);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        return ym === mf;
      });
    }

    // 담당자 필터
    const dmf = ($('#dbManagerFilter')?.value || '');
    if (dmf) {
      list = list.filter((r) => (r.managerName || '') === dmf);
    }

    // 건수 표시
    const countEl = $('#dbCount');
    if (countEl) countEl.textContent = list.length > 0 ? `총 ${list.length}건` : '';

    if (list.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;color:#6b7280;padding:24px;">데이터가 없습니다.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((r, i) => `
      <tr class="db-row" onclick="window._viewRecord('${r.id}')">
        <td data-label="#">${i + 1}</td>
        <td data-label="담당자">${escapeHtml(r.managerName || '-')}</td>
        <td data-label="성함"><strong>${escapeHtml(r.customerName)}</strong></td>
        <td data-label="핸드폰">${escapeHtml(r.customerPhone)}</td>
        <td data-label="제품">${escapeHtml(r.productName)}<br><small style="color:#6b7280">${escapeHtml(r.productModel)}</small></td>
        <td data-label="결제"><span class="badge ${r.payMethod === '신용카드' ? 'badge-card' : 'badge-account'}">${escapeHtml(r.payMethod)}</span></td>
        <td data-label="렌탈료">${r.rentalFee ? formatFee(r.rentalFee) : '-'}</td>
        <td data-label="관리" onclick="event.stopPropagation()">
          <div style="display:flex;gap:6px;justify-content:center;">
            <button class="btn btn-sm btn-outline" onclick="window._viewRecord('${r.id}')">상세</button>
            <button class="btn btn-sm btn-danger" onclick="window._deleteFromDb('${r.id}','${escapeHtml(r.customerName)}')">삭제</button>
          </div>
        </td>
      </tr>`).join('');
  }

  // DB 탭 월 필터 옵션 갱신
  function refreshDbMonthFilter() {
    const sel = $('#dbMonthFilter');
    if (!sel) return;
    const months = new Set();
    state.records.forEach((r) => {
      if (!r.createdAt) return;
      const d = new Date(r.createdAt);
      months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    });
    const sorted = [...months].sort().reverse();
    const current = sel.value;
    // 당월 기본값
    const now = new Date();
    const thisYM = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    sel.innerHTML = '<option value="">전체</option>' +
      sorted.map((m) => {
        const [y, mo] = m.split('-');
        return `<option value="${m}">${y}년 ${parseInt(mo, 10)}월</option>`;
      }).join('');
    // 기존 선택 유지, 없으면 당월 기본 선택
    if (current && months.has(current)) {
      sel.value = current;
    } else if (months.has(thisYM)) {
      sel.value = thisYM;
    }
  }

  // DB 탭 담당자 필터 옵션 갱신
  function refreshDbManagerFilter() {
    const sel = $('#dbManagerFilter');
    if (!sel) return;
    const managers = [...new Set(
      state.records.map((r) => r.managerName || '').filter(Boolean)
    )].sort();
    const current = sel.value;
    sel.innerHTML = '<option value="">전체 담당자</option>' +
      managers.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (current && managers.includes(current)) sel.value = current;
  }

  // Global handlers for inline onclick in table
  window._viewRecord = (id) => {
    openDetail(id);
  };
  window._deleteFromDb = async (id, name) => {
    if (!confirm(`"${name}" 접수를 삭제할까요?\nFirestore DB에서 영구 삭제됩니다.`)) return;
    try {
      await deleteRecord(id);
      showToast('삭제되었습니다.', 'success');
    } catch (e) {
      showToast('삭제 실패: ' + e.message, 'error');
    }
  };

  function bindDbTab() {
    $('#dbSearchInput')?.addEventListener('input', () => renderDbTable());
    $('#dbMonthFilter')?.addEventListener('change', () => renderDbTable());
    $('#dbManagerFilter')?.addEventListener('change', () => renderDbTable());

    $('#exportJsonBtn')?.addEventListener('click', () => {
      const data = { exportedAt: new Date().toISOString(), version: 2, records: state.records };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chogpan-records-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('JSON 파일로 내보냈습니다.', 'success');
    });

    $('#importJsonBtn')?.addEventListener('click', () => $('#importFile').click());
    $('#importFile')?.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        const text = await f.text();
        const obj = JSON.parse(text);
        const list = Array.isArray(obj) ? obj : (obj.records || []);
        if (!Array.isArray(list) || list.length === 0) { alert('가져올 레코드가 없습니다.'); return; }
        if (!confirm(`${list.length}건을 가져옵니다. Firestore에 업로드됩니다. 계속할까요?`)) return;
        let added = 0;
        const existingIds = new Set(state.records.map((r) => r.id));
        for (const r of list) {
          if (!r.id) r.id = uid();
          if (!r.createdAt) r.createdAt = Date.now();
          if (existingIds.has(r.id)) continue;
          if (state.fbEnabled) {
            await fbAdd(r);
          } else {
            state.records.unshift(r);
          }
          added++;
        }
        if (!state.fbEnabled) { saveLocalRecords(); renderList(); }
        showToast(`${added}건 추가 완료`, 'success');
      } catch (err) {
        alert('가져오기 실패: ' + (err.message || err));
      }
    });

    $('#clearAllBtn')?.addEventListener('click', async () => {
      if (!confirm('⚠️ Firestore DB의 모든 접수 데이터를 삭제할까요?\n이 작업은 되돌릴 수 없습니다.')) return;
      if (!confirm('정말로 전체 삭제하시겠습니까?')) return;
      if (!state.fbEnabled) {
        state.records = [];
        saveLocalRecords();
        renderList();
        showToast('로컬 데이터 삭제됨', 'success');
        return;
      }
      try {
        const snap = await state.fbDb.collection('rentalReceipts').get();
        const batch = state.fbDb.batch();
        snap.forEach((doc) => batch.delete(doc.ref));
        await batch.commit();
        showToast('전체 삭제 완료', 'success');
      } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
      }
    });
  }

  // ===== 제품 카탈로그 UI (장바구니) =====
  let productCart = []; // 선택된 제품 목록
  let currentCartItem = null; // 현재 선택 중인 제품

  function buildProductSelect() { updateProductCountInfo(); }

  function updateProductCountInfo() {
    const el = $('#productCountInfo');
    if (el) el.textContent = `현재 등록된 제품 옵션: ${state.products.length}개`;
  }

  function renderCartItems() {
    const list = $('#cartItems');
    const wrap = $('#productCartList');
    if (!list || !wrap) return;
    if (productCart.length === 0) {
      wrap.style.display = 'none';
      // hidden 필드 초기화
      $('#productName').value = '';
      $('#productModel').value = '';
      $('#contractTerm').value = '';
      $('#manageType').value = '';
      $('#rentalFee').value = '';
      $('#productsJson').value = '';
      return;
    }
    wrap.style.display = 'block';
    list.innerHTML = productCart.map((item, i) => `
      <li class="cart-item">
        <div class="cart-item-info">
          <span class="cart-item-title">${escapeHtml(item.title)}</span>
          <span class="cart-item-sub">${escapeHtml(item.model)} · ${escapeHtml(item.manageType)} · ${escapeHtml(item.contractTerm)} · ${Number(item.rentalFee).toLocaleString()}원${item.promo ? ' · 🎁 ' + escapeHtml(item.promo) : ''}${item.fee133 ? ' <span class="fee133-badge">💰 ' + Number(item.fee133).toLocaleString() + '</span>' : ''}</span>
        </div>
        <button type="button" class="btn-cart-remove" onclick="window._removeCartItem(${i})">✕</button>
      </li>`).join('');
    // hidden 필드: 첫 번째 제품 기준 + 전체 JSON
    const first = productCart[0];
    $('#productName').value = first.title;
    $('#productModel').value = first.model || '';
    $('#contractTerm').value = first.contractTerm || '';
    $('#manageType').value = first.manageType || '';
    $('#rentalFee').value = first.rentalFee || '';
    $('#productsJson').value = JSON.stringify(productCart);
  }

  window._removeCartItem = (i) => {
    productCart.splice(i, 1);
    renderCartItems();
  };

  function bindProductSelect() {
    const searchInput = $('#productSearchInput');
    const dropdown = $('#productDropdown');
    if (!searchInput || !dropdown) return;

    // 비고란 수동입력 추적
    const discountEl = $('#otherDiscount');
    if (discountEl) {
      discountEl.dataset.manualText = '';
      discountEl.addEventListener('input', () => {
        // 자동입력 부분 제외한 수동 입력 추적
        const autoPromo = discountEl.dataset.autoPromo || '';
        let val = discountEl.value;
        if (autoPromo && val.endsWith(autoPromo)) {
          val = val.slice(0, val.length - autoPromo.length).replace(/\n$/, '');
        }
        discountEl.dataset.manualText = val;
      });
    }

    searchInput.addEventListener('input', () => {
      const q = searchInput.value.trim().toLowerCase();
      currentCartItem = null;
      hideSelectedBadge();
      $('#productDetailRow').style.display = 'none';
      $('#productAddRow').style.display = 'none';

      if (!q) { dropdown.style.display = 'none'; return; }

      const seen = new Set();
      const matches = [];
      state.products.forEach((p) => {
        const key = p.title + '|' + p.model;
        if (seen.has(key)) return;
        if (p.title.toLowerCase().includes(q) || (p.model || '').toLowerCase().includes(q)) {
          seen.add(key); matches.push(p);
        }
      });
      matches.sort((a, b) => a.title.localeCompare(b.title));

      if (matches.length === 0) {
        dropdown.innerHTML = '<div class="pd-item pd-empty">검색 결과 없음</div>';
        dropdown.style.display = 'block';
        return;
      }
      dropdown.innerHTML = matches.slice(0, 40).map((p) => {
        const ht = p.title.replace(new RegExp(`(${escapeRegex(q)})`, 'gi'), '<mark>$1</mark>');
        const hm = (p.model || '').replace(new RegExp(`(${escapeRegex(q)})`, 'gi'), '<mark>$1</mark>');
        return `<div class="pd-item" data-title="${escapeHtml(p.title)}">
          <div class="pd-title">${ht}</div><div class="pd-model">${hm}</div></div>`;
      }).join('');
      dropdown.style.display = 'block';
    });

    dropdown.addEventListener('click', (e) => {
      const item = e.target.closest('.pd-item[data-title]');
      if (!item) return;
      const title = item.dataset.title;
      searchInput.value = '';
      dropdown.style.display = 'none';
      onProductTitleSelected(title);
    });

    document.addEventListener('click', (e) => {
      if (!e.target.closest('#productSearchWrap')) dropdown.style.display = 'none';
    });

    $('#clearProductBtn')?.addEventListener('click', () => {
      currentCartItem = null;
      searchInput.value = '';
      hideSelectedBadge();
      $('#productDetailRow').style.display = 'none';
      $('#productAddRow').style.display = 'none';
      // 비고란 프로모션 초기화
      const de = $('#otherDiscount');
      if (de) { de.value = de.dataset.manualText || ''; de.dataset.autoPromo = ''; }
    });

    $('#productManageType')?.addEventListener('change', () => {
      const mt = $('#productManageType').value;
      if (!currentCartItem || !mt) return;
      const matched = state.products.filter((p) => p.title === currentCartItem.title && p.manageType === mt);
      $('#productContract').innerHTML = '<option value="">-- 선택 --</option>' +
        [...new Set(matched.map((p) => p.contractTerm))].map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
      $('#productAddRow').style.display = 'none';
    });

    $('#productContract')?.addEventListener('change', () => {
      const mt = $('#productManageType').value;
      const contract = $('#productContract').value;
      if (!currentCartItem || !mt || !contract) return;
      const item = state.products.find((p) =>
        p.title === currentCartItem.title && p.manageType === mt && p.contractTerm === contract
      );
      if (!item) return;
      currentCartItem = { ...item };
      // 약정 선택 시 비고란 초기화 후 프로모션 입력
      const discountEl = $('#otherDiscount');
      if (discountEl) {
        // 기존에 자동입력된 프로모션만 제거 (수동 입력은 유지)
        // 가장 간단하게: 약정 바꿀 때마다 자동입력 부분만 교체
        discountEl.dataset.autoPromo = item.promo || '';
        const manualText = (discountEl.dataset.manualText || '').trim();
        const promoText = (item.promo || '').trim();
        discountEl.value = manualText
          ? (promoText ? manualText + '\n' + promoText : manualText)
          : promoText;
      }

      showSelectedBadge(currentCartItem);
      $('#productAddRow').style.display = 'block';
    });

    // 추가 버튼
    $('#addCartBtn')?.addEventListener('click', () => {
      if (!currentCartItem) return;
      productCart.push({ ...currentCartItem });
      renderCartItems();

      // 초기화 후 다음 제품 바로 선택 가능
      currentCartItem = null;
      searchInput.value = '';
      hideSelectedBadge();
      $('#productDetailRow').style.display = 'none';
      $('#productAddRow').style.display = 'none';
      $('#productManageType').innerHTML = '<option value="">-- 선택 --</option>';
      $('#productContract').innerHTML = '<option value="">-- 선택 --</option>';
      showToast('제품이 추가되었습니다.', 'success', 1500);
    });
  }

  function onProductTitleSelected(title) {
    const matched = state.products.filter((p) => p.title === title);
    if (!matched.length) return;
    currentCartItem = { title, model: matched[0]?.model || '' };
    const manageTypes = [...new Set(matched.map((p) => p.manageType))];
    $('#productManageType').innerHTML = '<option value="">-- 선택 --</option>' +
      manageTypes.map((m) => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    $('#productContract').innerHTML = '<option value="">-- 선택 --</option>';
    $('#productDetailRow').style.display = 'grid';
    $('#productAddRow').style.display = 'none';
    const badge = $('#selectedProductBadge');
    const info = $('#selectedProductInfo');
    if (badge && info) {
      info.textContent = `${title}  (${matched[0]?.model || ''})`;
      badge.style.display = 'flex';
    }
  }

  function showSelectedBadge(item) {
    const badge = $('#selectedProductBadge');
    const info = $('#selectedProductInfo');
    if (!badge || !info) return;
    let text = `${item.title}  ${item.model}  |  ${item.manageType}  |  ${item.contractTerm}  |  ${Number(item.rentalFee).toLocaleString()}원`;
    if (item.promo && item.promo.trim()) text += `  |  🎁 ${item.promo}`;
    info.textContent = text;
    // fee133 살짝 표시 (나만 보는 수수료)
    let feeEl = badge.querySelector('.badge-fee133');
    if (!feeEl) {
      feeEl = document.createElement('span');
      feeEl.className = 'badge-fee133';
      badge.appendChild(feeEl);
    }
    feeEl.textContent = item.fee133 ? `💰 ${Number(item.fee133).toLocaleString()}` : '';
    badge.style.display = 'flex';
  }

  function hideSelectedBadge() {
    const badge = $('#selectedProductBadge');
    if (badge) badge.style.display = 'none';
  }

  function clearProductDetail() {
    productCart = [];
    currentCartItem = null;
    $('#productName').value = '';
    $('#productModel').value = '';
    $('#rentalFee').value = '';
    $('#manageType').value = '';
    $('#contractTerm').value = '';
    $('#productsJson').value = '';
    $('#productDetailRow').style.display = 'none';
    $('#productAddRow').style.display = 'none';
    const pf = $('#productFields');
    if (pf) pf.style.display = 'none';
    if ($('#productManageType')) $('#productManageType').innerHTML = '<option value="">-- 선택 --</option>';
    if ($('#productContract')) $('#productContract').innerHTML = '<option value="">-- 선택 --</option>';
    hideSelectedBadge();
    renderCartItems();
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  // ===== 수정 모달 =====
  function openEdit(id) {
    const r = state.records.find((x) => x.id === id);
    if (!r) return;

    // 필드 채우기
    $('#edit_customerName').value = r.customerName || '';
    $('#edit_customerPhone').value = r.customerPhone || '';
    // 통신사 파싱: "SKT 알뜰폰" → carrier=SKT, mvno=true
    const telecomVal = r.telecom || '';
    const isMvno = telecomVal.includes('알뜰폰');
    const carrier = telecomVal.replace(' 알뜰폰', '').trim();
    $$('input[name="edit_telecomCarrier"]').forEach((el) => { el.checked = el.value === carrier; });
    const editMvno = $('#edit_telecomMvno');
    if (editMvno) editMvno.checked = isMvno;
    $('#edit_telecom').value = telecomVal;
    $('#edit_birthDate').value = r.birthDate || '';
    document.querySelectorAll('input[name="edit_gender"]').forEach((el) => {
      el.checked = el.value === r.gender;
    });
    $('#edit_installAddress').value = r.installAddress || '';
    $('#edit_productName').value = r.productName || '';
    $('#edit_productModel').value = r.productModel || '';
    $('#edit_contractTerm').value = r.contractTerm || '';
    $('#edit_manageType').value = r.manageType || '';
    $('#edit_rentalFee').value = r.rentalFee || '';
    $('#edit_managerName').value = r.managerName || '';
    $('#edit_otherDiscount').value = r.otherDiscount || '';

    // 결제방식
    document.querySelectorAll('input[name="edit_payMethod"]').forEach((el) => {
      el.checked = el.value === r.payMethod;
    });
    const isCard = r.payMethod === '신용카드';
    $('#edit_accountFields').style.display = isCard ? 'none' : 'block';
    $('#edit_cardFields').style.display = isCard ? 'block' : 'none';

    if (!isCard) {
      $('#edit_bankName').value = r.bankName || '';
      $('#edit_accountHolder').value = r.accountHolder || '';
      $('#edit_accountNumber').value = r.accountNumber || '';
    } else {
      $('#edit_cardCompany').value = r.cardCompany || '';
      $('#edit_cardHolder').value = r.cardHolder || '';
      $('#edit_cardNumber').value = r.cardNumber || '';
      $('#edit_cardExpiry').value = r.cardExpiry || '';
    }

    $('#editModal').dataset.editId = id;
    $('#editModal').style.display = 'flex';
  }

  function closeEdit() {
    $('#editModal').style.display = 'none';
  }

  function bindEditModal() {
    $('#closeEditBtn')?.addEventListener('click', closeEdit);
    $('#cancelEditBtn')?.addEventListener('click', closeEdit);
    $('#editModalOverlay')?.addEventListener('click', closeEdit);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#editModal').style.display === 'flex') closeEdit();
    });

    // 수정 모달 통신사 연동
    function updateEditTelecom() {
      const checked = $$('input[name="edit_telecomCarrier"]').find((r) => r.checked);
      const mvno = $('#edit_telecomMvno');
      const hidden = $('#edit_telecom');
      if (!hidden) return;
      const carrier = checked ? checked.value : '';
      const isMvno = mvno && mvno.checked;
      if (carrier && isMvno) hidden.value = carrier + ' 알뜰폰';
      else if (carrier) hidden.value = carrier;
      else if (isMvno) hidden.value = '알뜰폰';
      else hidden.value = '';
    }
    $$('input[name="edit_telecomCarrier"]').forEach((r) => r.addEventListener('change', updateEditTelecom));
    $('#edit_telecomMvno')?.addEventListener('change', updateEditTelecom);

    // 결제방식 라디오 변경
    document.querySelectorAll('input[name="edit_payMethod"]').forEach((el) => {
      el.addEventListener('change', (e) => {
        const isCard = e.target.value === '신용카드';
        $('#edit_accountFields').style.display = isCard ? 'none' : 'block';
        $('#edit_cardFields').style.display = isCard ? 'block' : 'none';
      });
    });

    // 저장
    $('#saveEditBtn')?.addEventListener('click', async () => {
      const id = $('#editModal').dataset.editId;
      if (!id) return;
      const idx = state.records.findIndex((r) => r.id === id);
      if (idx < 0) return;

      const payMethod = document.querySelector('input[name="edit_payMethod"]:checked')?.value || '';
      const gender = document.querySelector('input[name="edit_gender"]:checked')?.value || '';

      const updates = {
        customerName: $('#edit_customerName').value.trim(),
        customerPhone: $('#edit_customerPhone').value.trim(),
        telecom: $('#edit_telecom').value,
        birthDate: $('#edit_birthDate').value,
        gender,
        installAddress: $('#edit_installAddress').value.trim(),
        productName: $('#edit_productName').value.trim(),
        productModel: $('#edit_productModel').value.trim(),
        contractTerm: $('#edit_contractTerm').value.trim(),
        manageType: $('#edit_manageType').value.trim(),
        rentalFee: $('#edit_rentalFee').value,
        managerName: $('#edit_managerName').value.trim(),
        otherDiscount: $('#edit_otherDiscount').value.trim(),
        payMethod,
        updatedAt: Date.now(),
      };

      if (payMethod === '계좌이체') {
        updates.bankName = $('#edit_bankName').value.trim();
        updates.accountHolder = $('#edit_accountHolder').value.trim();
        updates.accountNumber = $('#edit_accountNumber').value.trim();
        updates.cardCompany = ''; updates.cardHolder = ''; updates.cardNumber = ''; updates.cardExpiry = '';
      } else if (payMethod === '신용카드') {
        updates.cardCompany = $('#edit_cardCompany').value.trim();
        updates.cardHolder = $('#edit_cardHolder').value.trim();
        updates.cardNumber = $('#edit_cardNumber').value.trim();
        updates.cardExpiry = $('#edit_cardExpiry').value;
        updates.bankName = ''; updates.accountHolder = ''; updates.accountNumber = '';
      }

      try {
        $('#saveEditBtn').disabled = true;
        $('#saveEditBtn').textContent = '저장 중...';
        if (state.fbEnabled) {
          await fbUpdate(id, updates);
        } else {
          Object.assign(state.records[idx], updates);
          saveLocalRecords();
          renderList();
        }
        closeEdit();
        closeDetail();
        showToast('수정되었습니다.', 'success');
      } catch (e) {
        showToast('수정 실패: ' + e.message, 'error');
      } finally {
        $('#saveEditBtn').disabled = false;
        $('#saveEditBtn').textContent = '💾 저장';
      }
    });
  }
  function renderManagerList() {
    const ul = $('#managerList');
    if (!ul) return;
    if (state.managers.length === 0) {
      ul.innerHTML = '<li class="manager-empty">등록된 담당자가 없습니다.</li>';
      return;
    }
    ul.innerHTML = state.managers.map((m) => `
      <li class="manager-item">
        <span>${escapeHtml(m)}</span>
        <button class="btn btn-sm btn-danger" onclick="window._deleteManager('${escapeHtml(m)}')">삭제</button>
      </li>`).join('');
  }
  window._deleteManager = async (name) => {
    if (!confirm(`"${name}" 담당자를 삭제할까요?`)) return;
    try {
      await fbDeleteManager(name);
      renderManagerList();
      refreshManagerSelect();
      showToast('담당자가 삭제되었습니다.', 'info');
    } catch (e) {
      showToast('삭제 실패: ' + e.message, 'error');
    }
  };

  function bindSettings() {
    const addBtn = $('#addManagerBtn');
    const input = $('#newManagerInput');
    if (!addBtn || !input) return;

    // ===== 담당자별 입금요청 정보 =====
    renderPayReqList();

    $('#savePayReqAddBtn')?.addEventListener('click', async () => {
      const btn = $('#savePayReqAddBtn');
      const managerName = $('#payReqAddName').value.trim();
      if (!managerName) { showToast('담당자 이름을 입력하세요.', 'error'); return; }
      const data = {
        managerName,
        phone:   $('#payReqAddPhone').value.trim(),
        ssn:     $('#payReqAddSSN').value.trim(),
        bank:    $('#payReqAddBank').value.trim(),
        account: $('#payReqAddAccount').value.trim(),
      };
      const editId = btn.dataset.editId || '';
      if (editId) data.id = editId;
      btn.disabled = true;
      btn.textContent = '저장 중...';
      try {
        await fbSavePaymentInfo(data);
        // 폼 초기화
        $('#payReqAddName').value = '';
        $('#payReqAddPhone').value = '';
        $('#payReqAddSSN').value = '';
        $('#payReqAddBank').value = '';
        $('#payReqAddAccount').value = '';
        delete btn.dataset.editId;
        btn.textContent = '＋ 등록';
        renderPayReqList();
        showToast(editId ? '수정되었습니다.' : '등록되었습니다.', 'success');
      } catch (e) {
        console.error('입금요청 저장 실패:', e);
        showToast('저장 실패: ' + (e.message || e), 'error', 5000);
        btn.textContent = editId ? '💾 수정 저장' : '＋ 등록';
      } finally {
        btn.disabled = false;
      }
    });

    // ===== 엑셀/CSV 업로드 =====
    $('#uploadCsvBtn')?.addEventListener('click', () => $('#csvFile').click());
    $('#csvFile')?.addEventListener('change', async (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!f) return;
      const statusEl = $('#productUploadStatus');
      try {
        if (statusEl) { statusEl.className = 'form-msg info'; statusEl.textContent = '파일 파싱 중...'; statusEl.style.display = 'block'; }

        const products = await parseProductFile(f);

        if (products.length === 0) {
          if (statusEl) { statusEl.className = 'form-msg error'; statusEl.textContent = '유효한 데이터가 없습니다. 코웨이 탭이 있는 엑셀 파일인지 확인하세요.'; }
          return;
        }
        if (!confirm(`${products.length}개 제품을 업로드합니다.\n기존 목록이 전체 교체됩니다. 계속할까요?`)) { if (statusEl) statusEl.style.display = 'none'; return; }
        if (statusEl) statusEl.textContent = `업로드 중... (${products.length}개)`;
        await uploadProductsToFirestore(products);
        if (statusEl) { statusEl.className = 'form-msg success'; statusEl.textContent = `✅ ${products.length}개 제품 업로드 완료`; }
        showToast(`제품 ${products.length}개 업로드 완료`, 'success');
      } catch (err) {
        if (statusEl) { statusEl.className = 'form-msg error'; statusEl.textContent = '업로드 실패: ' + (err.message || err); }
        showToast('업로드 실패', 'error');
      }
    });

    $('#downloadCsvTemplateBtn')?.addEventListener('click', () => {
      const header = '타이틀,모델명,관리구분,약정명,관리주기,총렌탈기간,렌탈료,13.3제외\n';
      const sample = '코웨이 아이콘 정수기2 (냉정),CP-7211N_V2,방문관리,3년약정,4개월관리,60개월,35900,303638\n';
      const blob = new Blob(['\uFEFF' + header + sample], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'coway-products-template.csv';
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
    });

    // ===== 담당자 추가 =====
    const doAdd = async () => {
      const name = input.value.trim();
      if (!name) { showToast('담당자 이름을 입력하세요.', 'error'); return; }
      if (state.managers.includes(name)) { showToast('이미 등록된 담당자입니다.', 'error'); return; }
      try {
        addBtn.disabled = true;
        await fbAddManager(name);
        renderManagerList();
        refreshManagerSelect();
        input.value = '';
        showToast(`"${name}" 담당자가 추가되었습니다.`, 'success');
      } catch (e) {
        showToast('추가 실패: ' + e.message, 'error');
      } finally {
        addBtn.disabled = false;
      }
    };

    addBtn.addEventListener('click', doAdd);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doAdd(); } });
  }

  // ===== Tabs =====
  const SETTINGS_PW = 'comfreec';
  const SETTINGS_PW_KEY = 'chogpan_settings_auth';
  let settingsUnlocked = false;

  function isSettingsAuthed() {
    return localStorage.getItem(SETTINGS_PW_KEY) === '1';
  }
  function saveSettingsAuth() {
    localStorage.setItem(SETTINGS_PW_KEY, '1');
  }

  function bindTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;

        // 설정 탭 비밀번호 확인
        if (tab === 'settings' && !settingsUnlocked) {
          if (isSettingsAuthed()) {
            // 이미 인증된 기기 → 바로 통과
            settingsUnlocked = true;
          } else {
            const pw = prompt('설정 비밀번호를 입력하세요.');
            if (pw === null) return;
            if (pw !== SETTINGS_PW) {
              showToast('비밀번호가 틀렸습니다.', 'error');
              return;
            }
            settingsUnlocked = true;
            saveSettingsAuth();
          }
        }

        $$('.tab-btn').forEach((b) => b.classList.toggle('active', b === btn));
        $$('.tab-content').forEach((c) => c.classList.toggle('active', c.id === 'tab-' + tab));
        if (tab === 'list') { refreshMonthFilter(); refreshManagerFilter(); renderList(); }
        if (tab === 'db') { updateDbStats(); refreshDbMonthFilter(); refreshDbManagerFilter(); renderDbTable(); }
        if (tab === 'settings') {
          renderManagerList();
          loadPaymentInfosFromFirestore().then(() => renderPayReqList());
        }
      });
    });
  }

  // ===== List Tab =====
  function bindList() {
    $('#searchInput').addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      renderList();
    });
    $('#monthFilter')?.addEventListener('change', (e) => {
      state.monthFilter = e.target.value;
      renderList();
    });
    $('#managerFilter')?.addEventListener('change', (e) => {
      state.managerFilter = e.target.value;
      renderList();
    });
    $('#listContainer').addEventListener('click', (e) => {
      const card = e.target.closest('.record-card');
      if (!card) return;
      openDetail(card.dataset.id);
    });
  }

  // ===== Modal =====
  function bindModal() {
    $$('[data-close]').forEach((el) => el.addEventListener('click', closeDetail));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && $('#detailModal').style.display === 'flex') closeDetail();
    });
    $('#copyAllBtn').addEventListener('click', async () => {
      if (!state.currentDetail) return;
      const ok = await copyToClipboard(buildKakaoText(state.currentDetail, { includeSensitive: true }));
      showToast(ok ? '전체 내용이 복사되었습니다.' : '복사 실패', ok ? 'success' : 'error');
    });
    $('#sendKakaoBtn').addEventListener('click', async () => {
      if (!state.currentDetail) return;
      await shareViaKakao(buildKakaoText(state.currentDetail, { includeSensitive: true }));
    });
    $('#payRequestBtn').addEventListener('click', async () => {
      if (!state.currentDetail) return;
      const text = buildPayRequestText(state.currentDetail);
      await shareViaKakao(text);
    });
    $('#editRecordBtn').addEventListener('click', () => {
      if (!state.currentDetail) return;
      openEdit(state.currentDetail.id);
    });
    $('#deleteRecordBtn').addEventListener('click', async () => {
      if (!state.currentDetail) return;
      if (!confirm('이 접수 기록을 삭제할까요?')) return;
      const id = state.currentDetail.id;
      try {
        await deleteRecord(id);
        closeDetail();
        showToast('삭제되었습니다.', 'success');
      } catch (e) {
        showToast('삭제 실패: ' + e.message, 'error');
      }
    });
  }

  // ===== Init =====
  async function init() {
    loadManagers();

    // Load local first for instant display
    state.records = loadLocalRecords();
    renderList();

    // Init Firebase
    const ok = initFirebase();
    if (ok) {
      startRealtimeSync();
    } else {
      showToast('Firestore 미연결 — 로컬 저장 모드', 'info', 3000);
    }

    bindTabs();
    bindForm();
    bindList();
    bindModal();
    bindDbTab();
    bindSettings();
    bindProductSelect();
    await loadProductsFromFirestore();
    await loadManagersFromFirestore();
    await loadPaymentInfosFromFirestore();
    bindEditModal();
    updateDbStats();
    refreshManagerSelect();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
