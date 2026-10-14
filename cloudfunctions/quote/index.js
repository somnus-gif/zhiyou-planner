// cloudfunctions/quote/index.js
// 报价单云函数 - 智游策划师 P0
// actions: list | get | create | update | addItem | updateItem | removeItem | sendQuote | adjust | confirm | remove
// 权限：仅责任定制师（_openid 匹配）可读写
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
      case 'list':       return await list(event, openid);
      case 'get':        return await get(event, openid);
      case 'create':     return await create(event, openid);
      case 'update':     return await update(event, openid);
      case 'addItem':    return await addItem(event, openid);
      case 'updateItem': return await updateItem(event, openid);
      case 'removeItem': return await removeItem(event, openid);
      case 'sendQuote':  return await sendQuote(event, openid);
      case 'adjust':     return await adjust(event, openid);
      case 'confirm':    return await confirm(event, openid);
      case 'remove':     return await remove(event, openid);
      default:           return fail(400, '未知 action: ' + action);
    }
  } catch (err) {
    console.error('[quote] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};

// 列表（按 customerId / status 筛选，分页）
async function list(event, openid) {
  const { customerId, status, pageNo = 1, pageSize = 20 } = event;
  const skip = (pageNo - 1) * pageSize;
  const where = { _openid: openid, status: _.neq('archived') };
  if (customerId) where.customerId = customerId;
  if (status) where.status = status;

  const countRes = await db.collection('quote').where(where).count();
  const total = countRes.total;
  const { data } = await db.collection('quote')
    .where(where).orderBy('updatedAt', 'desc').skip(skip).limit(pageSize).get();

  const list = data.map(q => ({
    _id: q._id,
    customerId: q.customerId,
    tripId: q.tripId || '',
    version: q.version || 1,
    total: q.total || 0,
    costTotal: q.costTotal || 0,
    profit: q.profit || 0,
    itemsCount: (q.items || []).length,
    status: q.status,
    updatedAt: q.updatedAt || 0,
    createdAt: q.createdAt || 0
  }));
  return ok({ list, total, pageNo, pageSize });
}

async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const { data } = await db.collection('quote').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '报价单不存在');
  if (data._openid !== openid) return fail(403, '无权查看该报价单');
  return ok({ quote: data });
}

async function create(event, openid) {
  const { customerId, tripId, items } = event;
  if (!customerId) return fail(400, '请选择关联客户');

  const c = await db.collection('customer').doc(customerId).get().catch(() => ({ data: null }));
  if (!c.data) return fail(404, '关联客户不存在');
  if (c.data._openid !== openid) return fail(403, '无权为该客户创建报价单');

  // 若关联行程，校验归属
  if (tripId) {
    const t = await db.collection('tripPlan').doc(tripId).get().catch(() => ({ data: null }));
    if (!t.data) return fail(404, '关联行程不存在');
    if (t.data._openid !== openid) return fail(403, '无权关联该行程');
  }

  const now = Date.now();
  const itemList = Array.isArray(items) ? items.map(normalizeItem) : [];
  const { total, costTotal, profit } = calcTotals(itemList);

  const doc = {
    _openid: openid,
    customerId,
    tripId: tripId || '',
    version: 1,
    items: itemList,
    total,
    costTotal,
    profit,
    status: 'draft',
    adjustHistory: [],
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('quote').add({ data: doc });
  return ok({ _id: res._id }, '报价单已创建');
}

async function update(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该报价单');
  const q = owned.doc;

  // 仅 draft / bargaining 状态可编辑基本信息
  if (!['draft', 'bargaining'].includes(q.status)) {
    return fail(400, '当前状态不可编辑');
  }

  const patch = { updatedAt: Date.now() };
  if (event.tripId !== undefined) patch.tripId = event.tripId;
  if (Array.isArray(event.items)) {
    const itemList = event.items.map(normalizeItem);
    const totals = calcTotals(itemList);
    patch.items = itemList;
    patch.total = totals.total;
    patch.costTotal = totals.costTotal;
    patch.profit = totals.profit;
  }
  await db.collection('quote').doc(id).update({ data: patch });
  return ok({ id }, '报价单已保存');
}

// 新增条目（自动重算）
async function addItem(event, openid) {
  const { id, item } = event;
  if (!id) return fail(400, '缺少报价单 id');
  if (!item || !item.name) return fail(400, '条目名称不能为空');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该报价单');
  if (!['draft', 'bargaining'].includes(owned.doc.status)) {
    return fail(400, '当前状态不可编辑');
  }
  const newItem = normalizeItem(item);
  const items = (owned.doc.items || []).concat(newItem);
  const totals = calcTotals(items);
  await db.collection('quote').doc(id).update({
    data: { items, ...totals, updatedAt: Date.now() }
  });
  return ok({ id, item: newItem, ...totals }, '条目已添加');
}

// 更新单条条目（按 index）
async function updateItem(event, openid) {
  const { id, index, item } = event;
  if (!id) return fail(400, '缺少报价单 id');
  if (index == null) return fail(400, '缺少条目序号');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该报价单');
  if (!['draft', 'bargaining'].includes(owned.doc.status)) {
    return fail(400, '当前状态不可编辑');
  }
  const items = (owned.doc.items || []).slice();
  if (index < 0 || index >= items.length) return fail(400, '条目序号越界');
  items[index] = normalizeItem({ ...items[index], ...item });
  const totals = calcTotals(items);
  await db.collection('quote').doc(id).update({
    data: { items, ...totals, updatedAt: Date.now() }
  });
  return ok({ id, item: items[index], ...totals }, '条目已更新');
}

// 删除单条条目（按 index）
async function removeItem(event, openid) {
  const { id, index } = event;
  if (!id) return fail(400, '缺少报价单 id');
  if (index == null) return fail(400, '缺少条目序号');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该报价单');
  if (!['draft', 'bargaining'].includes(owned.doc.status)) {
    return fail(400, '当前状态不可编辑');
  }
  const items = (owned.doc.items || []).slice();
  if (index < 0 || index >= items.length) return fail(400, '条目序号越界');
  items.splice(index, 1);
  const totals = calcTotals(items);
  await db.collection('quote').doc(id).update({
    data: { items, ...totals, updatedAt: Date.now() }
  });
  return ok({ id, ...totals }, '条目已删除');
}

// 发送报价（status → sent）
async function sendQuote(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该报价单');
  const q = owned.doc;
  if (!['draft', 'bargaining'].includes(q.status)) {
    return fail(400, '仅草稿/议价中的报价单可发送');
  }
  if (!q.items || q.items.length === 0) return fail(400, '报价单没有条目，无法发送');
  await db.collection('quote').doc(id).update({
    data: { status: 'sent', updatedAt: Date.now() }
  });
  return ok({ id }, '报价单已发送');
}

// 议价：version 自增 + 写 adjustHistory + 重算
async function adjust(event, openid) {
  const { id, items, reason } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该报价单');
  const q = owned.doc;
  if (!['sent', 'bargaining'].includes(q.status)) {
    return fail(400, '仅已发送/议价中的报价单可调价');
  }

  const itemList = Array.isArray(items) ? items.map(normalizeItem) : (q.items || []);
  const totals = calcTotals(itemList);
  const now = Date.now();
  const newVersion = (q.version || 1) + 1;

  const historyEntry = {
    version: newVersion,
    total: totals.total,
    reason: (reason || '调价').trim(),
    _openid: openid,
    ts: now
  };

  await db.collection('quote').doc(id).update({
    data: {
      items: itemList,
      total: totals.total,
      costTotal: totals.costTotal,
      profit: totals.profit,
      version: newVersion,
      status: 'bargaining',
      adjustHistory: _.push(historyEntry),
      updatedAt: now
    }
  });
  return ok({ id, version: newVersion, ...totals, historyEntry }, '议价已记录');
}

// 客户确认（status → confirmed）
async function confirm(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该报价单');
  const q = owned.doc;
  if (!['sent', 'bargaining'].includes(q.status)) {
    return fail(400, '仅已发送/议价中的报价单可确认');
  }
  await db.collection('quote').doc(id).update({
    data: { status: 'confirmed', updatedAt: Date.now() }
  });
  return ok({ id }, '报价已确认');
}

// 归档（软删除）
async function remove(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少报价单 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权删除该报价单');
  await db.collection('quote').doc(id).update({
    data: { status: 'archived', updatedAt: Date.now() }
  });
  return ok({ id }, '报价单已归档');
}

// ===== 工具函数 =====
async function assertOwned(id, openid) {
  const { data } = await db.collection('quote').doc(id).get().catch(() => ({ data: null }));
  if (!data || data._openid !== openid) return null;
  return { doc: data };
}

function normalizeItem(it) {
  const qty = Math.max(1, Number(it.qty) || 1);
  const price = Math.max(0, Math.round(Number(it.price) || 0));
  const cost = Math.max(0, Math.round(Number(it.cost) || 0));
  return {
    type: it.type || 'other',
    name: (it.name || '').trim(),
    spec: it.spec || '',
    qty,
    price,
    cost
  };
}

function calcTotals(items) {
  let total = 0, costTotal = 0;
  for (const it of items) {
    const qty = Number(it.qty) || 1;
    total += (Number(it.price) || 0) * qty;
    costTotal += (Number(it.cost) || 0) * qty;
  }
  return {
    total: Math.round(total),
    costTotal: Math.round(costTotal),
    profit: Math.round(total - costTotal)
  };
}
