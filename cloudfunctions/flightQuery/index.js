// cloudfunctions/flightQuery/index.js
// 机票查询云函数 - 智游策划师 P0
// actions: list | get | create | update | selectOption | remove
// 权限：仅责任定制师（_openid 匹配）可读写
// 携程 API 接入前使用结构化 mock 数据（按携程字段设计，后续无缝替换为真实接口）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (d = null, m = 'ok') => ({ code: 0, message: m, data: d });
const fail = (c, m, d = null) => ({ code: c, message: m, data: d });

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return fail(401, '未获取到用户身份');
  const { action } = event;
  try {
    switch (action) {
      case 'list':         return await list(event, openid);
      case 'get':          return await get(event, openid);
      case 'create':       return await create(event, openid);
      case 'update':       return await update(event, openid);
      case 'selectOption': return await selectOption(event, openid);
      case 'remove':       return await remove(event, openid);
      default:             return fail(400, '未知 action: ' + action);
    }
  } catch (err) {
    console.error('[flightQuery] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};

// 列表（按 customerId / tripId 筛选，分页）
async function list(event, openid) {
  const { customerId, tripId, pageNo = 1, pageSize = 20 } = event;
  const skip = (pageNo - 1) * pageSize;
  const where = { _openid: openid, status: _.neq('archived') };
  if (customerId) where.customerId = customerId;
  if (tripId) where.tripId = tripId;

  const countRes = await db.collection('flightQuery').where(where).count();
  const total = countRes.total;
  const { data } = await db.collection('flightQuery')
    .where(where).orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();

  const list = data.map(f => ({
    _id: f._id,
    customerId: f.customerId,
    tripId: f.tripId || '',
    from: f.from,
    to: f.to,
    fromDate: f.fromDate,
    retDate: f.retDate || '',
    tripType: f.tripType,
    optionCount: (f.options || []).length,
    selectedOption: f.selectedOption == null ? -1 : f.selectedOption,
    selectedFlight: f.selectedOption != null && f.selectedOption >= 0 && f.options ? pickSummary(f.options[f.selectedOption]) : null,
    createdAt: f.createdAt || 0
  }));
  return ok({ list, total, pageNo, pageSize });
}

// 详情
async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少查询 id');
  const { data } = await db.collection('flightQuery').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '查询记录不存在');
  if (data._openid !== openid) return fail(403, '无权查看该查询');
  return ok({ flight: data });
}// 创建（自动生成 mock 航班数据）
async function create(event, openid) {
  const { customerId, tripId, from, to, fromDate, retDate, tripType } = event;
  if (!customerId) return fail(400, '请选择关联客户');
  if (!from || !to) return fail(400, '请填写出发地和目的地机场');
  if (from === to) return fail(400, '出发地与目的地不可相同');
  if (!fromDate) return fail(400, '请选择出发日期');
  if (tripType === 'rt' && !retDate) return fail(400, '往返程请选择返程日期');

  const c = await db.collection('customer').doc(customerId).get().catch(() => ({ data: null }));
  if (!c.data) return fail(404, '关联客户不存在');
  if (c.data._openid !== openid) return fail(403, '无权为该客户创建查询');

  if (tripId) {
    const t = await db.collection('tripPlan').doc(tripId).get().catch(() => ({ data: null }));
    if (!t.data) return fail(404, '关联行程不存在');
    if (t.data._openid !== openid) return fail(403, '无权关联该行程');
  }

  const options = genMockFlights(from, to, fromDate);
  const now = Date.now();
  const doc = {
    _openid: openid,
    customerId,
    tripId: tripId || '',
    from: String(from).toUpperCase(),
    to: String(to).toUpperCase(),
    fromDate,
    retDate: tripType === 'rt' ? retDate : '',
    tripType: tripType || 'ow',
    options,
    selectedOption: -1,
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('flightQuery').add({ data: doc });
  return ok({ _id: res._id, options }, '查询成功，已生成 ' + options.length + ' 条航班');
}

// 更新基本信息（改航线/日期后可触发重新搜索刷新 mock 数据）
async function update(event, openid) {
  const { id, from, to, fromDate, retDate, tripType, refresh } = event;
  if (!id) return fail(400, '缺少查询 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该查询');
  const old = owned.doc;
  const patch = { updatedAt: Date.now() };
  let needRefresh = false;
  if (from !== undefined) { patch.from = String(from).toUpperCase(); needRefresh = true; }
  if (to !== undefined) { patch.to = String(to).toUpperCase(); needRefresh = true; }
  if (fromDate !== undefined) { patch.fromDate = fromDate; needRefresh = true; }
  if (tripType !== undefined) patch.tripType = tripType;
  if (retDate !== undefined) patch.retDate = retDate;
  if (refresh || needRefresh) {
    const nf = patch.from || old.from;
    const nt = patch.to || old.to;
    const nd = patch.fromDate || old.fromDate;
    if (nf && nt && nf !== nt && nd) {
      patch.options = genMockFlights(nf, nt, nd);
      patch.selectedOption = -1;
    }
  }
  await db.collection('flightQuery').doc(id).update({ data: patch });
  return ok({ id, options: patch.options, selectedOption: patch.selectedOption }, '已保存');
}// 选中某航班（按 index 指向 options 中的某条）
async function selectOption(event, openid) {
  const { id, index } = event;
  if (!id) return fail(400, '缺少查询 id');
  if (index == null) return fail(400, '请选择航班序号');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该查询');
  const opts = owned.doc.options || [];
  const idx = Number(index);
  if (idx < 0 || idx >= opts.length) return fail(400, '航班序号越界');
  await db.collection('flightQuery').doc(id).update({
    data: { selectedOption: idx, updatedAt: Date.now() }
  });
  return ok({ id, selectedOption: idx, flight: opts[idx] }, '已选中航班');
}

// 软删除
async function remove(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少查询 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权删除该查询');
  await db.collection('flightQuery').doc(id).update({
    data: { status: 'archived', updatedAt: Date.now() }
  });
  return ok({ id }, '已删除');
}

// ===== 工具函数 =====
async function assertOwned(id, openid) {
  const { data } = await db.collection('flightQuery').doc(id).get().catch(() => ({ data: null }));
  if (!data || data._openid !== openid) return null;
  return { doc: data };
}

function pickSummary(opt) {
  if (!opt) return null;
  return {
    flightNo: opt.flightNo,
    airline: opt.airline,
    depTime: opt.depTime,
    arrTime: opt.arrTime,
    depAirport: opt.depAirport,
    arrAirport: opt.arrAirport,
    total: opt.total
  };
}// ===== Mock 航班数据生成（携程字段对齐，后续可直接替换为携程 API 返回）=====
const AIRPORT_MAP = {
  KMG: { city: '昆明', airport: '长水国际机场' },
  LJG: { city: '丽江', airport: '三义机场' },
  DLU: { city: '大理', airport: '荒草坝机场' },
  JHG: { city: '西双版纳', airport: '嘎洒国际机场' },
  ZAT: { city: '昭通', airport: '机场' },
  LUM: { city: '文山', airport: '普者黑机场' },
  PEK: { city: '北京', airport: '首都国际机场' },
  PKX: { city: '北京', airport: '大兴国际机场' },
  SHA: { city: '上海', airport: '虹桥国际机场' },
  PVG: { city: '上海', airport: '浦东国际机场' },
  CAN: { city: '广州', airport: '白云国际机场' },
  SZX: { city: '深圳', airport: '宝安国际机场' },
  CTU: { city: '成都', airport: '双流国际机场' },
  TFU: { city: '成都', airport: '天府国际机场' },
  XIY: { city: '西安', airport: '咸阳国际机场' },
  HGH: { city: '杭州', airport: '萧山国际机场' },
  SYX: { city: '三亚', airport: '凤凰国际机场' },
  KWE: { city: '贵阳', airport: '龙洞堡机场' }
};

const AIRLINES = [
  { code: 'MU', name: '东方航空' },
  { code: 'CZ', name: '南方航空' },
  { code: 'CA', name: '国际航空' },
  { code: '3U', name: '四川航空' },
  { code: '8L', name: '祥鹏航空' },
  { code: '9C', name: '春秋航空' },
  { code: 'HO', name: '吉祥航空' },
  { code: 'JD', name: '首都航空' }
];

const AIRCRAFTS = ['B737', 'B738', 'A320', 'A321', 'A330', 'B777'];
const CABINS = ['经济舱', '经济舱', '经济舱', '经济舱', '公务舱'];
const TIME_SLOTS = ['07:15', '09:30', '11:50', '14:20', '16:45', '19:10', '20:55'];
const YN_CODES = ['KMG', 'LJG', 'DLU', 'JHG', 'ZAT', 'LUM'];// 生成 5-8 条 mock 航班（按总价升序）
function genMockFlights(from, to, fromDate) {
  const fi = AIRPORT_MAP[from] || { city: from, airport: from + '机场' };
  const ti = AIRPORT_MAP[to] || { city: to, airport: to + '机场' };
  const count = 5 + Math.floor(Math.random() * 4);
  const shuffled = AIRLINES.slice().sort(() => Math.random() - 0.5);
  const sameProvince = YN_CODES.indexOf(from) >= 0 && YN_CODES.indexOf(to) >= 0;
  const opts = [];
  for (let i = 0; i < count; i++) {
    const airline = shuffled[i % shuffled.length];
    const depTime = TIME_SLOTS[i % TIME_SLOTS.length];
    const arrTime = calcArrTime(depTime, sameProvince);
    const base = 500 + Math.floor(Math.random() * 2000);
    const tax = 50;
    const total = base + tax;
    const cabin = CABINS[Math.floor(Math.random() * CABINS.length)];
    const flightNo = airline.code + (1000 + Math.floor(Math.random() * 9000));
    opts.push({
      flightNo: flightNo,
      airline: airline.name,
      aircraft: AIRCRAFTS[Math.floor(Math.random() * AIRCRAFTS.length)],
      depTime: depTime,
      arrTime: arrTime,
      depAirport: fi.airport,
      arrAirport: ti.airport,
      cabin: cabin,
      price: base * 100,
      tax: tax * 100,
      total: total * 100,
      discount: (3 + Math.floor(Math.random() * 7)) + '折',
      stock: 1 + Math.floor(Math.random() * 50),
      source: 'mock'
    });
  }
  opts.sort((a, b) => a.total - b.total);
  return opts;
}

// 根据出发时间和省内/国内粗略计算到达时间
function calcArrTime(depTimeStr, sameProvince) {
  const parts = depTimeStr.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1], 10);
  const hours = sameProvince ? 1 + Math.random() * 0.5 : 2 + Math.random() * 1.5;
  const totalMin = h * 60 + m + Math.round(hours * 60);
  const arrH = Math.floor(totalMin / 60) % 24;
  const arrM = totalMin % 60;
  return pad(arrH) + ':' + pad(arrM);
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }