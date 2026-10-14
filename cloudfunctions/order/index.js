// cloudfunctions/order/index.js
// 订单云函数 - 智游策划师 P0
// actions: list | get | create | update | payDeposit | payBalance | signContract | updateBooking | sendDoc | complete | cancel | remove | getShared | refreshShare
// 权限：仅责任定制师（_openid 匹配）可读写
// 状态机：in_progress（进行中）-> completed / cancelled；archived 为软删除
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (d = null, m = 'ok') => ({ code: 0, message: m, data: d });
const fail = (c, m, d = null) => ({ code: c, message: m, data: d });

const BOOKING_KEYS = ['hotel', 'flight', 'scenic', 'guide'];
const PAY_METHODS = ['微信', '支付宝', '银行转账', '现金'];

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return fail(401, '未获取到用户身份');
  const { action } = event;
  try {
    switch (action) {
      case 'list':           return await list(event, openid);
      case 'get':            return await get(event, openid);
      case 'create':         return await create(event, openid);
      case 'update':         return await update(event, openid);
      case 'payDeposit':     return await payDeposit(event, openid);
      case 'payBalance':     return await payBalance(event, openid);
      case 'signContract':   return await signContract(event, openid);
      case 'updateBooking':  return await updateBooking(event, openid);
      case 'sendDoc':        return await sendDoc(event, openid);
      case 'complete':       return await complete(event, openid);
      case 'cancel':         return await cancel(event, openid);
      case 'remove':         return await remove(event, openid);
      case 'getShared':      return await getShared(event);
      case 'refreshShare':   return await refreshShare(event, openid);
      default:               return fail(400, '未知 action: ' + action);
    }
  } catch (err) {
    console.error('[order] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};
// 列表（按 customerId / status 筛选，分页）
async function list(event, openid) {
  const { customerId, status, pageNo = 1, pageSize = 20 } = event;
  const skip = (pageNo - 1) * pageSize;
  const where = { _openid: openid, status: _.neq('archived') };
  if (customerId) where.customerId = customerId;
  if (status && status !== 'archived') where.status = status;

  const countRes = await db.collection('order').where(where).count();
  const total = countRes.total;
  const { data } = await db.collection('order')
    .where(where).orderBy('updatedAt', 'desc').skip(skip).limit(pageSize).get();

  const list = data.map(o => ({
    _id: o._id,
    customerId: o.customerId,
    quoteId: o.quoteId || '',
    tripId: o.tripId || '',
    totalAmount: o.totalAmount || 0,
    depositPaid: !!(o.deposit && o.deposit.paidAt),
    balancePaid: !!(o.balance && o.balance.paidAt),
    contractStatus: (o.contract && o.contract.status) || 'pending',
    bookingProgress: bookingProgress(o.bookingStatus),
    docSent: !!(o.docSent && o.docSent.sentAt),
    status: o.status,
    updatedAt: o.updatedAt || 0,
    createdAt: o.createdAt || 0
  }));
  return ok({ list, total, pageNo, pageSize });
}
async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少订单 id');
  const { data } = await db.collection('order').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '订单不存在');
  if (data._openid !== openid) return fail(403, '无权查看该订单');
  if (!data.shareToken) {
    const token = genToken();
    await db.collection('order').doc(id).update({ data: { shareToken: token } });
    data.shareToken = token;
  }
  return ok({ order: data });
}

async function create(event, openid) {
  const { customerId, quoteId, tripId, totalAmount } = event;
  if (!customerId) return fail(400, '请选择关联客户');

  const c = await db.collection('customer').doc(customerId).get().catch(() => ({ data: null }));
  if (!c.data) return fail(404, '关联客户不存在');
  if (c.data._openid !== openid) return fail(403, '无权为该客户创建订单');

  // 若关联报价单，校验归属并自动带 totalAmount
  let finalTotal = Math.max(0, Math.round(Number(totalAmount) || 0));
  if (quoteId) {
    const q = await db.collection('quote').doc(quoteId).get().catch(() => ({ data: null }));
    if (!q.data) return fail(404, '关联报价单不存在');
    if (q.data._openid !== openid) return fail(403, '无权关联该报价单');
    if (q.data.total) finalTotal = q.data.total;
  }

  // 若关联行程，校验归属
  if (tripId) {
    const t = await db.collection('tripPlan').doc(tripId).get().catch(() => ({ data: null }));
    if (!t.data) return fail(404, '关联行程不存在');
    if (t.data._openid !== openid) return fail(403, '无权关联该行程');
  }

  const now = Date.now();
  const doc = {
    _openid: openid,
    customerId,
    quoteId: quoteId || '',
    tripId: tripId || '',
    totalAmount: finalTotal,
    deposit: emptyPayment(),
    balance: emptyPayment(),
    contract: { no: '', signedAt: 0, status: 'pending', file: '' },
    bookingStatus: { hotel: 'pending', flight: 'pending', scenic: 'pending', guide: 'pending' },
    docSent: { itinerary: false, checkin: false, notice: false, sentAt: 0 },
    status: 'in_progress',
    shareToken: genToken(),
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('order').add({ data: doc });
  return ok({ _id: res._id, shareToken: doc.shareToken }, '订单已创建');
}
// 基本信息更新（仅进行中可改）
async function update(event, openid) {
  const { id, totalAmount } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该订单');
  const o = owned.doc;
  if (o.status !== 'in_progress') return fail(400, '当前订单状态不可编辑基本信息');

  const patch = { updatedAt: Date.now() };
  if (event.tripId !== undefined) patch.tripId = event.tripId;
  if (event.quoteId !== undefined) patch.quoteId = event.quoteId;
  if (totalAmount !== undefined) {
    patch.totalAmount = Math.max(0, Math.round(Number(totalAmount) || 0));
  }
  await db.collection('order').doc(id).update({ data: patch });
  return ok({ id }, '订单已保存');
}

// 定金支付
async function payDeposit(event, openid) {
  const { id, amount, method, voucher, note } = event;
  if (!id) return fail(400, '缺少订单 id');
  if (amount == null) return fail(400, '请填写定金金额');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  if (owned.doc.status !== 'in_progress') return fail(400, '当前订单状态不可支付定金');
  if (method && !PAY_METHODS.includes(method)) return fail(400, '未知的支付方式');

  const deposit = {
    amount: Math.max(0, Math.round(Number(amount) || 0)),
    paidAt: Date.now(),
    method: method || '',
    voucher: voucher || '',
    note: note || ''
  };
  await db.collection('order').doc(id).update({
    data: { deposit, updatedAt: Date.now() }
  });
  return ok({ id, deposit }, '定金已记录');
}
// 尾款支付（需先付定金）
async function payBalance(event, openid) {
  const { id, amount, method, voucher, note } = event;
  if (!id) return fail(400, '缺少订单 id');
  if (amount == null) return fail(400, '请填写尾款金额');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  const o = owned.doc;
  if (o.status !== 'in_progress') return fail(400, '当前订单状态不可支付尾款');
  if (!o.deposit || !o.deposit.paidAt) return fail(400, '请先记录定金');
  if (method && !PAY_METHODS.includes(method)) return fail(400, '未知的支付方式');

  const balance = {
    amount: Math.max(0, Math.round(Number(amount) || 0)),
    paidAt: Date.now(),
    method: method || '',
    voucher: voucher || '',
    note: note || ''
  };
  await db.collection('order').doc(id).update({
    data: { balance, updatedAt: Date.now() }
  });
  return ok({ id, balance }, '尾款已记录');
}

// 签合同
async function signContract(event, openid) {
  const { id, no, file } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  if (owned.doc.status !== 'in_progress') return fail(400, '当前订单状态不可签合同');
  if (!no && !file) return fail(400, '请填写合同号或上传合同附件');

  const contract = {
    no: (no || '').trim(),
    signedAt: Date.now(),
    status: 'signed',
    file: file || ''
  };
  await db.collection('order').doc(id).update({
    data: { contract, updatedAt: Date.now() }
  });
  return ok({ id, contract }, '合同已签署');
}
// 更新预订状态（hotel/flight/scenic/guide）
async function updateBooking(event, openid) {
  const { id, key, value } = event;
  if (!id) return fail(400, '缺少订单 id');
  if (!BOOKING_KEYS.includes(key)) return fail(400, '未知的预订项: ' + key);
  if (!['pending', 'done'].includes(value)) return fail(400, '预订状态值非法');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  if (owned.doc.status !== 'in_progress') return fail(400, '当前订单状态不可更新预订');

  const bookingStatus = Object.assign(
    { hotel: 'pending', flight: 'pending', scenic: 'pending', guide: 'pending' },
    owned.doc.bookingStatus || {},
    { [key]: value }
  );
  await db.collection('order').doc(id).update({
    data: { bookingStatus, updatedAt: Date.now() }
  });
  return ok({ id, bookingStatus }, '预订状态已更新');
}

// 资料下发（itinerary/checkin/notice 任选传，未传者保留原值）
async function sendDoc(event, openid) {
  const { id, itinerary, checkin, notice } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  if (owned.doc.status !== 'in_progress') return fail(400, '当前订单状态不可下发资料');

  const old = owned.doc.docSent || { itinerary: false, checkin: false, notice: false, sentAt: 0 };
  const docSent = {
    itinerary: itinerary !== undefined ? !!itinerary : old.itinerary,
    checkin:   checkin   !== undefined ? !!checkin   : old.checkin,
    notice:    notice    !== undefined ? !!notice    : old.notice,
    sentAt: old.sentAt || Date.now()
  };
  await db.collection('order').doc(id).update({
    data: { docSent, updatedAt: Date.now() }
  });
  return ok({ id, docSent }, '资料下发已记录');
}
// 完成（需定金 + 尾款 + 合同 + 预订 4 项 + 资料 3 项齐全）
async function complete(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  const o = owned.doc;
  if (o.status !== 'in_progress') return fail(400, '仅进行中订单可标记完成');

  const missing = [];
  if (!o.deposit || !o.deposit.paidAt) missing.push('定金');
  if (!o.balance || !o.balance.paidAt) missing.push('尾款');
  if (!o.contract || o.contract.status !== 'signed') missing.push('合同');
  const bs = o.bookingStatus || {};
  if (BOOKING_KEYS.some(k => bs[k] !== 'done')) missing.push('预订');
  const ds = o.docSent || {};
  if (!ds.itinerary || !ds.checkin || !ds.notice) missing.push('资料下发');
  if (missing.length) return fail(400, '尚有未完成项: ' + missing.join('、'));

  await db.collection('order').doc(id).update({
    data: { status: 'completed', updatedAt: Date.now() }
  });
  return ok({ id }, '订单已完成');
}

// 取消
async function cancel(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  if (owned.doc.status !== 'in_progress') return fail(400, '仅进行中订单可取消');
  await db.collection('order').doc(id).update({
    data: { status: 'cancelled', updatedAt: Date.now() }
  });
  return ok({ id }, '订单已取消');
}

// 归档（软删除）
async function remove(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权删除该订单');
  await db.collection('order').doc(id).update({
    data: { status: 'archived', updatedAt: Date.now() }
  });
  return ok({ id }, '订单已归档');
}

// ===== 工具函数 =====
async function assertOwned(id, openid) {
  const { data } = await db.collection('order').doc(id).get().catch(() => ({ data: null }));
  if (!data || data._openid !== openid) return null;
  return { doc: data };
}

function emptyPayment() {
  return { amount: 0, paidAt: 0, method: '', voucher: '', note: '' };
}

function bookingProgress(bs) {
  if (!bs) return '0/4';
  const done = BOOKING_KEYS.filter(k => bs[k] === 'done').length;
  return done + '/4';
}

// 按 shareToken 只读访问（客户/分享对象使用，不校验 _openid，返回脱敏数据）
async function getShared(event) {
  const { shareToken } = event;
  if (!shareToken) return fail(400, '缺少分享 token');
  const { data } = await db.collection('order').where({ shareToken }).limit(1).get().catch(() => ({ data: [] }));
  const o = data[0];
  if (!o) return fail(404, '订单不存在或已撤销分享');
  if (o.status === 'archived') return fail(410, '订单已归档');

  // 返回只读视图，剥离敏感字段（金额明细/凭证/合同号/文件/_openid/关联 id）
  return ok({
    order: {
      _id: o._id,
      totalAmount: o.totalAmount || 0,
      deposit: { paidAt: (o.deposit && o.deposit.paidAt) || 0 },
      balance: { paidAt: (o.balance && o.balance.paidAt) || 0 },
      contract: { status: (o.contract && o.contract.status) || 'pending', signedAt: (o.contract && o.contract.signedAt) || 0 },
      bookingStatus: o.bookingStatus || { hotel:'pending', flight:'pending', scenic:'pending', guide:'pending' },
      docSent: o.docSent || { itinerary:false, checkin:false, notice:false, sentAt:0 },
      status: o.status,
      updatedAt: o.updatedAt || 0,
      shareToken: o.shareToken
    }
  });
}

// 重置 shareToken（撤销旧分享链接）
async function refreshShare(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少订单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该订单');
  const newToken = genToken();
  await db.collection('order').doc(id).update({
    data: { shareToken: newToken, updatedAt: Date.now() }
  });
  return ok({ id, shareToken: newToken }, '分享链接已重置');
}

function genToken() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 12; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}