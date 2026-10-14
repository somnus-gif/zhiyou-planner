// cloudfunctions/tripPlan/index.js
// 行程规划云函数 - 智游策划师 P0
// actions: list | get | create | update | saveDays | remove | getShared | refreshShare | getQrCode
// 权限：仅责任定制师（_openid 匹配）可读写；getShared 按 shareToken 只读访问
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
      case 'list':     return await list(event, openid);
      case 'get':      return await get(event, openid);
      case 'create':   return await create(event, openid);
      case 'update':   return await update(event, openid);
      case 'saveDays': return await saveDays(event, openid);
      case 'remove':   return await remove(event, openid);
      case 'getShared':   return await getShared(event);
      case 'refreshShare': return await refreshShare(event, openid);
      case 'getQrCode':   return await getQrCode(event, openid);
      default:         return fail(400, '未知 action: ' + action);
    }
  } catch (err) {
    console.error('[tripPlan] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};

async function list(event, openid) {
  const { customerId, pageNo = 1, pageSize = 20 } = event;
  const skip = (pageNo - 1) * pageSize;
  const where = { _openid: openid, status: _.neq('archived') };
  if (customerId) where.customerId = customerId;

  const countRes = await db.collection('tripPlan').where(where).count();
  const total = countRes.total;
  const { data } = await db.collection('tripPlan')
    .where(where).orderBy('updatedAt', 'desc').skip(skip).limit(pageSize).get();

  const list = data.map(t => ({
    _id: t._id, title: t.title, customerId: t.customerId,
    status: t.status, version: t.version || 1,
    daysCount: (t.days || []).length,
    updatedAt: t.updatedAt || 0, createdAt: t.createdAt || 0
  }));
  return ok({ list, total, pageNo, pageSize });
}

async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少行程 id');
  const { data } = await db.collection('tripPlan').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '行程不存在');
  if (data._openid !== openid) return fail(403, '无权查看该行程');
  // 若历史数据没有 shareToken，自动补一个
  if (!data.shareToken) {
    const token = genToken();
    await db.collection('tripPlan').doc(id).update({ data: { shareToken: token } });
    data.shareToken = token;
  }
  return ok({ trip: data });
}

async function create(event, openid) {
  const { customerId, title } = event;
  if (!customerId) return fail(400, '请选择关联客户');
  if (!title || !title.trim()) return fail(400, '请填写行程标题');

  const c = await db.collection('customer').doc(customerId).get().catch(() => ({ data: null }));
  if (!c.data) return fail(404, '关联客户不存在');
  if (c.data._openid !== openid) return fail(403, '无权为该客户创建行程');

  const now = Date.now();
  const doc = {
    _openid: openid,
    customerId,
    title: title.trim(),
    days: event.days || [{
      date: 'Day 1', city: '', items: [],
      transport: '', meal: '', hotel: ''
    }],
    status: event.status || 'draft',
    version: 1,
    shareToken: genToken(),
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('tripPlan').add({ data: doc });
  return ok({ _id: res._id, shareToken: doc.shareToken }, '行程已创建');
}

async function update(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少行程 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该行程');

  const fields = ['title', 'status'];
  const patch = { updatedAt: Date.now() };
  for (const k of fields) {
    if (event[k] !== undefined) patch[k] = event[k];
  }
  if (event.status === 'confirmed') patch.version = _.inc(1);
  await db.collection('tripPlan').doc(id).update({ data: patch });
  return ok({ id }, '行程已更新');
}

async function saveDays(event, openid) {
  const { id, days } = event;
  if (!id) return fail(400, '缺少行程 id');
  if (!Array.isArray(days)) return fail(400, 'days 必须是数组');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该行程');

  await db.collection('tripPlan').doc(id).update({
    data: { days, updatedAt: Date.now() }
  });
  return ok({ id, daysCount: days.length }, '行程已保存');
}

async function remove(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少行程 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权删除该行程');
  await db.collection('tripPlan').doc(id).update({
    data: { status: 'archived', updatedAt: Date.now() }
  });
  return ok({ id }, '行程已归档');
}

async function assertOwned(id, openid) {
  const { data } = await db.collection('tripPlan').doc(id).get().catch(() => ({ data: null }));
  return !!(data && data._openid === openid);
}

// 按 shareToken 只读访问（客户/分享对象使用，不校验 _openid）
async function getShared(event) {
  const { shareToken } = event;
  if (!shareToken) return fail(400, '缺少分享 token');
  const { data } = await db.collection('tripPlan').where({ shareToken }).limit(1).get().catch(() => ({ data: [] }));
  const t = data[0];
  if (!t) return fail(404, '行程不存在或已撤销分享');
  if (t.status === 'archived') return fail(410, '行程已归档');

  // 返回只读视图，剥离敏感字段
  return ok({
    trip: {
      _id: t._id,
      title: t.title,
      days: t.days || [],
      status: t.status,
      version: t.version || 1,
      updatedAt: t.updatedAt || 0,
      shareToken: t.shareToken
    }
  });
}

// 重置 shareToken（撤销旧分享链接）
async function refreshShare(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少行程 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作');
  const newToken = genToken();
  await db.collection('tripPlan').doc(id).update({
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

// 生成小程序码（可扫码直接打开行程预览页，scene=shareToken）
async function getQrCode(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少行程 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作');
  const trip = owned.doc;
  let token = trip.shareToken;
  if (!token) {
    token = genToken();
    await db.collection('tripPlan').doc(id).update({ data: { shareToken: token } });
  }
  try {
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: token,
      page: 'pages/trip/preview/preview',
      width: 280,
      checkPath: false,
      envVersion: 'release'
    });
    if (result.errcode) {
      return fail(result.errcode, '生成小程序码失败：' + (result.errmsg || '未知错误'));
    }
    const ext = result.contentType === 'image/jpeg' ? '.jpg' : '.png';
    const cloudPath = `qrcode/trip_${id}_${Date.now()}${ext}`;
    const upload = await cloud.uploadFile({ cloudPath, fileContent: result.buffer });
    return ok({ fileID: upload.fileID, shareToken: token, shareUrl: 'pages/trip/preview/preview?shareToken=' + token }, '小程序码已生成');
  } catch (err) {
    console.error('[tripPlan] getQrCode err:', err);
    return fail(500, '生成小程序码失败：' + (err.errMsg || err.message));
  }
}
