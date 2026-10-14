// cloudfunctions/hotelPlan/index.js
// 酒店方案云函数 - 智游策划师 P0
// actions: list | get | create | update | selectOption | remove | initDemo
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
      case 'initDemo':     return await initDemo(event, openid);
      default:             return fail(400, '未知 action: ' + action);
    }
  } catch (err) {
    console.error('[hotelPlan] action=%s err:', action, err);
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

  const countRes = await db.collection('hotelPlan').where(where).count();
  const total = countRes.total;
  const { data } = await db.collection('hotelPlan')
    .where(where).orderBy('createdAt', 'desc').skip(skip).limit(pageSize).get();

  const list = data.map(h => ({
    _id: h._id,
    customerId: h.customerId,
    tripId: h.tripId || '',
    city: h.city,
    checkIn: h.checkIn,
    checkOut: h.checkOut,
    rooms: h.rooms,
    optionCount: (h.options || []).length,
    selectedOption: h.selectedOption == null ? -1 : h.selectedOption,
    selectedHotel: h.selectedOption != null && h.selectedOption >= 0 && h.options ? pickSummary(h.options[h.selectedOption]) : null,
    createdAt: h.createdAt || 0
  }));
  return ok({ list, total, pageNo, pageSize });
}

// 详情
async function get(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少方案 id');
  const { data } = await db.collection('hotelPlan').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '方案不存在');
  if (data._openid !== openid) return fail(403, '无权查看该方案');
  return ok({ hotel: data });
}

// 创建（自动生成 mock 酒店数据）
async function create(event, openid) {
  const { customerId, tripId, city, checkIn, checkOut, rooms, guests, budget, star, location } = event;
  if (!customerId) return fail(400, '请选择关联客户');
  if (!city) return fail(400, '请填写目的地城市');
  if (!checkIn || !checkOut) return fail(400, '请选择入住和离店日期');

  const c = await db.collection('customer').doc(customerId).get().catch(() => ({ data: null }));
  if (!c.data) return fail(404, '关联客户不存在');
  if (c.data._openid !== openid) return fail(403, '无权为该客户创建方案');

  if (tripId) {
    const t = await db.collection('tripPlan').doc(tripId).get().catch(() => ({ data: null }));
    if (!t.data) return fail(404, '关联行程不存在');
    if (t.data._openid !== openid) return fail(403, '无权关联该行程');
  }

  const options = genMockHotels(city, budget);
  const now = Date.now();
  const doc = {
    _openid: openid,
    customerId,
    tripId: tripId || '',
    city,
    checkIn,
    checkOut,
    rooms: Number(rooms) || 1,
    guests: guests || { adult: 2, child: 0 },
    budget: toCents(budget),
    star: star || [],
    location: location || '',
    options,
    selectedOption: -1,
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('hotelPlan').add({ data: doc });
  return ok({ _id: res._id, options }, '查询成功，已生成 ' + options.length + ' 家酒店');
}

// 更新基本信息（改城市/日期/预算后可触发重新搜索刷新 mock 数据）
async function update(event, openid) {
  const { id, city, checkIn, checkOut, rooms, guests, budget, star, location, refresh } = event;
  if (!id) return fail(400, '缺少方案 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权修改该方案');
  const old = owned.doc;
  const patch = { updatedAt: Date.now() };
  let needRefresh = false;
  if (city !== undefined) { patch.city = city; needRefresh = true; }
  if (checkIn !== undefined) patch.checkIn = checkIn;
  if (checkOut !== undefined) patch.checkOut = checkOut;
  if (rooms !== undefined) patch.rooms = Number(rooms);
  if (guests !== undefined) patch.guests = guests;
  if (budget !== undefined) { patch.budget = toCents(budget); needRefresh = true; }
  if (star !== undefined) patch.star = star;
  if (location !== undefined) patch.location = location;
  if (refresh || needRefresh) {
    const nc = patch.city || old.city;
    const nb = patch.budget != null ? patch.budget : old.budget;
    if (nc) {
      patch.options = genMockHotels(nc, nb ? nb / 100 : 0);
      patch.selectedOption = -1;
    }
  }
  await db.collection('hotelPlan').doc(id).update({ data: patch });
  return ok({ id, options: patch.options, selectedOption: patch.selectedOption }, '已保存');
}

// 选中某酒店（按 index 指向 options 中的某条）
async function selectOption(event, openid) {
  const { id, index } = event;
  if (!id) return fail(400, '缺少方案 id');
  if (index == null) return fail(400, '请选择酒店序号');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权操作该方案');
  const opts = owned.doc.options || [];
  const idx = Number(index);
  if (idx < 0 || idx >= opts.length) return fail(400, '酒店序号越界');
  await db.collection('hotelPlan').doc(id).update({
    data: { selectedOption: idx, updatedAt: Date.now() }
  });
  return ok({ id, selectedOption: idx, hotel: opts[idx] }, '已选中酒店');
}

// 软删除
async function remove(event, openid) {
  const { id } = event;
  if (!id) return fail(400, '缺少方案 id');
  const owned = await assertOwned(id, openid);
  if (!owned) return fail(403, '无权删除该方案');
  await db.collection('hotelPlan').doc(id).update({
    data: { status: 'archived', updatedAt: Date.now() }
  });
  return ok({ id }, '已删除');
}

// 初始化演示数据
async function initDemo(event, openid) {
  const { customerId, tripId, force } = event;
  if (!customerId) return fail(400, '请选择关联客户');
  const exist = await db.collection('hotelPlan').where({ _openid: openid, status: 'active' }).count();
  if (exist.total > 0 && !force) return fail(400, '已有酒店方案，不再重复写入');
  if (force && exist.total > 0) {
    const { data: oldDocs } = await db.collection('hotelPlan').where({ _openid: openid, status: 'active' }).limit(100).get();
    await Promise.all(oldDocs.map(d => db.collection('hotelPlan').doc(d._id).remove()));
  }
  const now = Date.now();
  const city = '巴厘岛';
  const options = genMockHotels(city, 0);
  const doc = {
    _openid: openid,
    customerId,
    tripId: tripId || '',
    city,
    checkIn: '2026-11-01',
    checkOut: '2026-11-05',
    rooms: 2,
    guests: { adult: 2, child: 0 },
    budget: 0,
    star: [4, 5],
    location: '库塔海滩附近',
    options,
    selectedOption: -1,
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('hotelPlan').add({ data: doc });
  return ok({ _id: res._id, options }, '已写入演示酒店方案');
}

// ===== 工具函数 =====
async function assertOwned(id, openid) {
  const { data } = await db.collection('hotelPlan').doc(id).get().catch(() => ({ data: null }));
  if (!data || data._openid !== openid) return null;
  return { doc: data };
}

function pickSummary(opt) {
  if (!opt) return null;
  return {
    name: opt.name,
    star: opt.star,
    roomType: opt.roomType,
    totalPrice: opt.totalPrice,
    breakfast: opt.breakfast,
    image: opt.image || ''
  };
}

function toCents(yuan) {
  if (yuan == null || yuan === '') return 0;
  const n = Number(yuan);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}

// ===== Mock 酒店数据生成（携程字段对齐，后续可直接替换为携程 API 返回）=====
const HOTEL_TEMPLATES = [
  { name: '巴厘岛丽思卡尔顿', star: 5, basePrice: 2800, roomType: '豪华海景房', facilities: ['无边泳池', '私人海滩', 'SPA', '健身房', '米其林餐厅', '儿童俱乐部'] },
  { name: '巴厘岛宝格丽酒店', star: 5, basePrice: 4500, roomType: '悬崖别墅', facilities: ['无边泳池', '私人海滩', 'SPA', '直升机停机坪', '米其林餐厅'] },
  { name: '巴厘岛安纳塔拉', star: 5, basePrice: 2200, roomType: '泳池别墅', facilities: ['私人泳池', '海滩俱乐部', 'SPA', '瑜伽课', '儿童俱乐部'] },
  { name: '库塔喜来登', star: 4, basePrice: 900, roomType: '高级花园房', facilities: ['泳池', '健身房', '餐厅', '商务中心'] },
  { name: '努沙杜瓦万豪', star: 5, basePrice: 1800, roomType: '海景套房', facilities: ['无边泳池', '私人海滩', 'SPA', '健身房', '儿童俱乐部', '网球场'] },
  { name: '乌布四季酒店', star: 5, basePrice: 3800, roomType: '梯田别墅', facilities: ['私人泳池', 'SPA', '瑜伽课', '米其林餐厅', '儿童俱乐部'] },
  { name: '金巴兰悦榕庄', star: 5, basePrice: 3200, roomType: '海景别墅', facilities: ['私人泳池', '私人海滩', 'SPA', '日落酒吧', '米其林餐厅'] },
  { name: '水明漾W酒店', star: 5, basePrice: 2600, roomType: '奇妙套房', facilities: ['无边泳池', '海滩俱乐部', 'SPA', '健身房', '夜店'] }
];

function genMockHotels(city, budgetYuan) {
  const count = 5 + Math.floor(Math.random() * 3);
  const shuffled = HOTEL_TEMPLATES.slice().sort(() => Math.random() - 0.5);
  const opts = [];
  for (let i = 0; i < count && i < shuffled.length; i++) {
    const tpl = shuffled[i];
    const price = tpl.basePrice + Math.floor(Math.random() * 500) - 250;
    const totalPrice = price * 4; // 4晚
    const breakfast = Math.random() > 0.3;
    const cancelable = Math.random() > 0.5;
    opts.push({
      name: tpl.name,
      star: tpl.star,
      price: price * 100,
      totalPrice: totalPrice * 100,
      roomType: tpl.roomType,
      breakfast,
      cancelable,
      image: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=' + encodeURIComponent('豪华酒店外观 ' + tpl.name + ' ' + city + ' 建筑夜景') + '&image_size=landscape_16_9',
      facilities: tpl.facilities,
      intro: tpl.star + '星级豪华酒店，位于' + city + '核心地段，' + tpl.roomType + '配备' + tpl.facilities.slice(0, 3).join('、') + '等设施。',
      bookType: 'agent',
      source: 'mock'
    });
  }
  opts.sort((a, b) => a.totalPrice - b.totalPrice);
  return opts;
}
