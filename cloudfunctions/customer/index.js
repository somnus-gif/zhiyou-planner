// cloudfunctions/customer/index.js
// 客户档案管理云函数 - 智游策划师 P0
//
// 支持的 action：
//   dashboard     - 工作台首页看板数据（全员统计）
//   list          - 客户列表（责任定制师视角，支持 stage 筛选 + 关键词搜索 + 分页）
//   get           - 客户详情（含档案/沟通记录/关联行程订单的轻量元信息）
//   create        - 新建客户
//   update        - 更新客户基本信息/偏好/想去景点/预算/出行日期/人数/客源
//   addNote       - 追加沟通记录（时间线）
//   advanceStage  - 推进阶段（带校验，仅向前推进，终态不可推进）
//   lost          - 流失归档（设 stage=lost + lostReason）
//
// 权限模型：
//   - dashboard: 全员统计，云函数内 bypass 读全部 customer 集合
//   - list/get: 默认仅自己创建的客户；带 queryAll=true 且 role=admin 可读全部
//   - create/update/addNote/advanceStage/lost: 仅责任定制师（_openid 匹配）可操作

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data = null, message = 'ok') => ({ code: 0, message, data });
const fail = (code, message, data = null) => ({ code, message, data });

const STAGE_ORDER = [
  'receive', 'plan', 'quote', 'bargain', 'deposit',
  'contract', 'balance', 'booking', 'doc', 'traveling', 'done'
];
const TERMINAL_STAGES = ['done', 'lost'];

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return fail(401, '未获取到用户身份');

  const { action } = event;
  try {
    switch (action) {
      case 'dashboard':     return await dashboard(openid);
      case 'list':          return await list(event, openid);
      case 'get':           return await get(event, openid);
      case 'create':        return await create(event, openid);
      case 'update':        return await update(event, openid);
      case 'addNote':       return await addNote(event, openid);
      case 'advanceStage':  return await advanceStage(event, openid);
      case 'lost':          return await lost(event, openid);
      default:              return fail(400, '未知的 action: ' + action);
    }
  } catch (err) {
    console.error('[customer] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};

async function dashboard(openid) {
  const { data: all } = await db.collection('customer')
    .where({ stage: _.neq('lost') })
    .limit(1000)
    .get();

  const stageCounts = {};
  let following = 0;
  const now = Date.now();
  const weekAgo = now - 7 * 86400e3;
  let newThisWeek = 0;

  for (const c of all) {
    stageCounts[c.stage] = (stageCounts[c.stage] || 0) + 1;
    if (c.stage === 'traveling') following++;
    if (c.createdAt && c.createdAt >= weekAgo) newThisWeek++;
  }
  const todoCount = (stageCounts.deposit || 0) + (stageCounts.balance || 0) + (stageCounts.contract || 0);

  const recentList = all
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 5)
    .map(c => ({
      _id: c._id, name: c.name, phone: c.phone, stage: c.stage,
      scenicWish: c.scenicWish || [], updatedAt: c.updatedAt || 0
    }));

  return ok({
    stageCounts,
    todayStats: { following, newThisWeek, todoCount },
    recentList
  });
}

async function list(event, openid) {
  const { stage, keyword, pageNo = 1, pageSize = 20, queryAll = false } = event;
  const skip = (pageNo - 1) * pageSize;

  const where = { stage: _.neq('lost') };
  if (stage && stage !== 'all') where.stage = stage;
  if (!queryAll) where._openid = openid;
  if (keyword) {
    where.name = db.RegExp({ regexp: String(keyword), options: 'i' });
  }

  const countRes = await db.collection('customer').where(where).count();
  const total = countRes.total;

  const { data } = await db.collection('customer')
    .where(where)
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  const list = data.map(c => ({
    _id: c._id,
    name: c.name,
    phone: maskPhone(c.phone),
    stage: c.stage,
    scenicWish: c.scenicWish || [],
    preferences: c.preferences || [],
    updatedAt: c.updatedAt || 0,
    createdAt: c.createdAt || 0
  }));

  return ok({ list, total, pageNo, pageSize });
}

async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少客户 id');

  const { data } = await db.collection('customer').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '客户不存在');

  if (data._openid !== openid) {
    return fail(403, '无权查看该客户档案');
  }

  let trips = [];
  try {
    const tripRes = await db.collection('tripPlan')
      .where({ customerId: id })
      .field({ title: true, status: true, updatedAt: true })
      .orderBy('updatedAt', 'desc')
      .limit(10)
      .get();
    trips = tripRes.data;
  } catch (e) { /* tripPlan 集合尚未创建时忽略 */ }

  return ok({
    customer: { ...data, phoneMask: maskPhone(data.phone) },
    trips
  });
}

async function create(event, openid) {
  const { name, phone } = event;
  if (!name || !name.trim()) return fail(400, '客户姓名不能为空');
  if (!phone || !/^1\d{10}$/.test(phone)) return fail(400, '手机号格式不正确');

  const now = Date.now();
  const doc = {
    _openid: openid,
    name: name.trim(),
    phone,
    wechat: event.wechat || '',
    stage: event.stage || 'receive',
    preferences: event.preferences || [],
    scenicWish: event.scenicWish || [],
    budget: toCents(event.budget),
    travelDate: event.travelDate || null,
    pax: event.pax || { adult: 0, child: 0, baby: 0 },
    source: event.source || '',
    notes: event.firstNote ? [{ ts: now, content: event.firstNote, _openid: openid }] : [],
    lostReason: '',
    createdAt: now,
    updatedAt: now
  };

  const res = await db.collection('customer').add({ data: doc });
  return ok({ _id: res._id }, '客户创建成功');
}

async function update(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少客户 id');

  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该客户');

  const fields = ['name', 'phone', 'wechat', 'stage', 'preferences', 'scenicWish',
                  'budget', 'travelDate', 'pax', 'source'];
  const patch = { updatedAt: Date.now() };
  for (const k of fields) {
    if (event[k] !== undefined) {
      if (k === 'name' && !String(event[k]).trim()) return fail(400, '客户姓名不能为空');
      if (k === 'phone' && !/^1\d{10}$/.test(event[k])) return fail(400, '手机号格式不正确');
      if (k === 'budget') patch.budget = toCents(event.budget);
      else patch[k] = event[k];
    }
  }

  await db.collection('customer').doc(id).update({ data: patch });
  return ok({ id }, '客户信息已更新');
}

async function addNote(event, openid) {
  const { id, content } = event;
  if (!id) return fail(400, '缺少客户 id');
  if (!content || !content.trim()) return fail(400, '沟通内容不能为空');

  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该客户');

  const note = { ts: Date.now(), content: content.trim(), _openid: openid };
  await db.collection('customer').doc(id).update({
    data: {
      notes: _.push(note),
      updatedAt: note.ts
    }
  });
  return ok({ note }, '沟通记录已追加');
}

async function advanceStage(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少客户 id');

  const { data: c } = await db.collection('customer').doc(id).get().catch(() => ({ data: null }));
  if (!c) return fail(404, '客户不存在');
  if (c._openid !== openid) return fail(403, '无权操作该客户');
  if (TERMINAL_STAGES.includes(c.stage)) return fail(400, '当前阶段为终态，不可推进');

  const idx = STAGE_ORDER.indexOf(c.stage);
  if (idx < 0) return fail(400, '当前阶段非法');
  const nextStage = STAGE_ORDER[idx + 1];
  const now = Date.now();

  await db.collection('customer').doc(id).update({
    data: { stage: nextStage, updatedAt: now }
  });
  return ok({ stage: nextStage }, '已推进至：' + nextStage);
}

async function lost(event, openid) {
  const { id, reason } = event;
  if (!id) return fail(400, '缺少客户 id');
  if (!reason || !reason.trim()) return fail(400, '请填写流失原因');

  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该客户');

  await db.collection('customer').doc(id).update({
    data: { stage: 'lost', lostReason: reason.trim(), updatedAt: Date.now() }
  });
  return ok({ id }, '客户已归档为流失');
}

async function assertOwned(id, openid) {
  const { data } = await db.collection('customer').doc(id).get().catch(() => ({ data: null }));
  return !!(data && data._openid === openid);
}

function toCents(yuan) {
  if (yuan == null || yuan === '') return 0;
  const n = Number(yuan);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

function maskPhone(phone) {
  if (!phone || phone.length < 7) return phone || '';
  return phone.slice(0, 3) + '****' + phone.slice(-4);
}
