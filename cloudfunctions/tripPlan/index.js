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
      case 'initDemo':    return await initDemo(openid);
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
    intro: event.intro || '',
    heroImage: event.heroImage || '',
    pickup: event.pickup || null,
    pax: event.pax || null,
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

  const fields = ['title', 'status', 'intro', 'heroImage', 'pickup', 'pax'];
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

  // 关联酒店：云函数内 bypass 权限，仅取展示字段脱敏返回（不含内部 _id / _openid）
  let hotels = [];
  try {
    const where = { status: _.neq('archived') };
    if (t._id) where.tripId = t._id;
    else if (t.customerId) where.customerId = t.customerId;
    const hres = await db.collection('hotelPlan').where(where).limit(50).get().catch(() => ({ data: [] }));
    hotels = (hres.data || [])
      .filter(h => h.selectedOption != null && h.selectedOption >= 0 && h.options && h.options[h.selectedOption])
      .map(h => {
        const s = h.options[h.selectedOption];
        return {
          city: h.city || '',
          checkIn: h.checkIn || '',
          checkOut: h.checkOut || '',
          name: s.name || '',
          star: s.star || 0,
          roomType: s.roomType || '',
          image: s.image || '',
          facilities: s.facilities || [],
          intro: s.intro || '',
          totalPrice: s.totalPrice || 0
        };
      });
  } catch (e) {
    console.error('[tripPlan] getShared hotels err:', e);
  }

  // 返回只读视图，剥离敏感字段
  return ok({
    trip: {
      _id: t._id,
      title: t.title,
      intro: t.intro || '',
      heroImage: t.heroImage || '',
      pickup: t.pickup || null,
      pax: t.pax || null,
      days: t.days || [],
      status: t.status,
      version: t.version || 1,
      updatedAt: t.updatedAt || 0,
      shareToken: t.shareToken,
      hotels
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
  const { data: trip } = await db.collection('tripPlan').doc(id).get().catch(() => ({ data: null }));
  if (!trip) return fail(404, '行程不存在');
  if (trip._openid !== openid) return fail(403, '无权操作');
  let token = trip.shareToken;
  if (!token) {
    token = genToken();
    await db.collection('tripPlan').doc(id).update({ data: { shareToken: token } });
  }
  try {
    const envVersion = ['develop', 'trial', 'release'].indexOf(event.envVersion) >= 0 ? event.envVersion : 'release';
    const result = await cloud.openapi.wxacode.getUnlimited({
      scene: token,
      page: 'pages/trip/showcase/showcase',
      width: 280,
      checkPath: false,
      envVersion: envVersion
    });
    if (result.errcode) {
      return fail(result.errcode, '生成小程序码失败：' + (result.errmsg || '未知错误'));
    }
    const ext = result.contentType === 'image/jpeg' ? '.jpg' : '.png';
    const cloudPath = `qrcode/trip_${id}_${Date.now()}${ext}`;
    const upload = await cloud.uploadFile({ cloudPath, fileContent: result.buffer });
    return ok({ fileID: upload.fileID, shareToken: token, shareUrl: 'pages/trip/showcase/showcase?shareToken=' + token }, '小程序码已生成');
  } catch (err) {
    console.error('[tripPlan] getQrCode err:', err);
    return fail(500, '生成小程序码失败：' + (err.errMsg || err.message));
  }
}

/* ============================================================
 * initDemo  一键生成演示数据：马来西亚-亚庇-仙本那 7天6晚
 * 为当前登录定制师创建：演示客户 + 亚庇/仙本那景点 + 酒店方案 + 完整行程
 * 幂等：同标题行程已存在则拒绝重复生成
 * 图片复用项目已有的 text_to_image 外部生成接口
 * ============================================================ */
async function initDemo(openid) {
  const DEMO_TITLE = '马来西亚·沙巴 亚庇+仙本那7天6晚海岛定制游';
  const exist = await db.collection('tripPlan')
    .where({ _openid: openid, title: DEMO_TITLE }).count();
  if (exist.total > 0) return fail(400, '演示行程已存在，请勿重复生成');

  const now = Date.now();
  const img = (p) => 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt='
    + encodeURIComponent(p) + '&image_size=landscape_4_3';
  const DEMO_VIDEO = 'https://media.w3.org/2010/05/sintel/trailer.mp4'; // 示例视频，正式使用请替换为云存储 fileID

  // ---- 1. 确保景点存在（name -> _id） ----
  const scenicDefs = [
    // —— 亚庇景点 ——
    { name: '丹绒亚路海滩', city: '亚庇', province: '沙巴', duration: 2, ticketPrice: 0,
      highlights: ['世界三大日落', '椰林沙滩', '海边落日酒吧', '夜市小吃街'],
      intro: '丹绒亚路海滩是亚庇最著名的日落观赏点，与马尔代夫、古巴齐名，被誉为"世界三大日落圣地"。绵长的沙滩上椰影婆娑，傍晚时分，整个天空被染成金红色，海面倒映着晚霞，美不胜收。',
      playGuide: '建议日落前1小时到达最佳观赏位（靠近香格里拉酒店一侧）。可以先在海边的 Sunset Bar 小酌，一边享用鸡尾酒一边等待日落。日落后可步行至旁边的夜市品尝沙巴特色小吃。',
      openHours: '全天开放',
      coverImage: img('马来西亚亚庇丹绒亚路海滩金色日落火烧云椰林'),
      images: [
        img('马来西亚亚庇丹绒亚路海滩壮丽日落全景'),
        img('海滩日落剪影情侣漫步'),
        img('海边日落酒吧椰林倒影'),
        img('沙巴海滩金色晚霞海面')
      ]
    },
    { name: '沙巴神山公园', city: '亚庇', province: '沙巴', duration: 8, ticketPrice: 0,
      highlights: ['东南亚最高峰', '神山奶牛牧场', '波令温泉', '热带雨林吊桥', '高山花卉'],
      intro: '京那巴鲁山（神山）海拔4095米，是东南亚最高峰，2000年被列入世界自然遗产。山脚下的奶牛牧场海拔约1500米，绿草如茵，牛羊成群，有"小新西兰"之称。波令温泉是神山深处的天然硫磺温泉，周边雨林中还可体验世界最长的雨林吊桥。',
      playGuide: '一日游建议：早上8点出发，先到神山牧场喂奶牛、品尝鲜奶冰淇淋，中午在牧场餐厅用餐，下午前往波令温泉泡汤，体验雨林吊桥。全程山路较多，建议穿防滑运动鞋，带一件薄外套（山上气温约20°C）。',
      openHours: '08:00 - 17:00',
      coverImage: img('马来西亚沙巴京那巴鲁神山云雾山峰牧场'),
      images: [
        img('沙巴神山奶牛牧场新西兰风光'),
        img('神山热带雨林吊桥'),
        img('神山波令温泉自然景观'),
        img('高山花卉绿色草甸')
      ]
    },
    { name: '亚庇水上清真寺', city: '亚庇', province: '沙巴', duration: 1, ticketPrice: 0,
      highlights: ['蓝色穹顶建筑', '湖面倒影', '网红打卡地标', '日落景观'],
      intro: '亚庇水上清真寺坐落在人工湖畔，是马来西亚最大的水上清真寺之一。白色建筑与蓝色穹顶倒映在平静的湖面上，仿佛漂浮在水面之上，是亚庇最具标志性的建筑，也是游客必打卡的网红景点。',
      playGuide: '进入清真寺参观需租借长袍。最佳拍摄时间是日落时分，夕阳映照在穹顶上，与湖面倒影相映成辉。建议傍晚前往，拍照效果最好。',
      openHours: '09:00 - 18:00（周五休息）',
      coverImage: img('马来西亚亚庇水上清真寺湖面倒影蓝色穹顶'),
      images: [
        img('水上清真寺日落金色穹顶'),
        img('清真寺湖面倒影对称构图'),
        img('亚庇地标建筑蓝天白云')
      ]
    },
    { name: '亚庇加雅街周日市集', city: '亚庇', province: '沙巴', duration: 2, ticketPrice: 0,
      highlights: ['周日市集', '当地美食', '手工艺品', '文化体验'],
      intro: '加雅街是亚庇老城区的中心，每周日上午会举办著名的周日市集。整条街摆满了摊位，从新鲜水果、当地小吃到手工艺品、服饰鞋帽应有尽有，是体验沙巴当地市井文化的最佳去处。',
      playGuide: '周日市集只在每周日 6:00-13:00 开放。建议早点去，可以品尝到沙巴特色的海南鸡饭、牛杂面、叻沙等美食。还可以买一些当地特产如白咖啡、榴莲糖等。',
      openHours: '周日 06:00 - 13:00',
      coverImage: img('马来西亚亚庇加雅街周日市集热闹街道'),
      images: [
        img('东南亚街头市集小吃摊位'),
        img('当地手工艺品市场')
      ]
    },
    // —— 仙本那景点 ——
    { name: '敦沙卡兰海洋公园', city: '仙本那', province: '沙巴', duration: 8, ticketPrice: 0,
      highlights: ['珍珠岛爬山', '600米俯瞰泻湖', '军舰岛浮潜', '巴瑶族水上村落', '珊瑚花园'],
      intro: '敦沙卡兰海洋公园由8个岛屿组成，是仙本那最经典的跳岛路线。珍珠岛是公园的精华，徒步600米登上山顶，可俯瞰整个泻湖，碧绿的海水环绕着岛屿，美得令人窒息。军舰岛以洁白的沙滩和丰富的珊瑚闻名，是浮潜圣地。',
      playGuide: '跳岛游需提前一天预订，包含船费、上岛费、浮潜装备和午餐。必去：珍珠岛（爬山俯瞰全景）、军舰岛（浮潜看珊瑚和鱼群）、曼达布安岛（看巴瑶族水上村落）。穿防滑凉鞋，带好防晒和防水手机袋。',
      openHours: '每日 07:00 - 17:00（需乘船前往）',
      videoUrl: DEMO_VIDEO,
      coverImage: img('仙本那敦沙卡兰海洋公园珍珠岛泻湖全景航拍'),
      images: [
        img('仙本那珍珠岛山顶俯瞰果冻海'),
        img('军舰岛白沙滩浮潜'),
        img('巴瑶族水上村落高脚屋'),
        img('海底珊瑚热带鱼群'),
        img('绿松石色泻湖航拍')
      ]
    },
    { name: '卡帕莱岛', city: '仙本那', province: '沙巴', duration: 6, ticketPrice: 0,
      highlights: ['水上屋度假村', '玻璃海水', '海龟同游', '日落巡航', '星空晚餐'],
      intro: '卡帕莱岛坐落在一片珊瑚礁上，是世界顶级的水上屋度假村。51间水上别墅直接建在海上，通过木栈道相连。这里的海水清澈见底，能见度可达20米，推开房门就能看到海龟、小丑鱼和彩色珊瑚。',
      playGuide: '卡帕莱水上屋非常热门，需提前3-6个月预订。非住客也可以报名一日游，乘船在卡帕莱周边浮潜，经常能看到海龟。建议带水下相机记录与海龟同游的时刻。',
      openHours: '全天（住客专属，一日游需预约）',
      coverImage: img('仙本那卡帕莱水上屋度假村透明海水'),
      images: [
        img('卡帕莱水上别墅木栈道日出'),
        img('浮潜与海龟同游水下摄影'),
        img('海上日落木栈道剪影'),
        img('热带鱼群珊瑚礁水下世界')
      ]
    },
    { name: '马达京岛', city: '仙本那', province: '沙巴', duration: 6, ticketPrice: 0,
      highlights: ['梦幻拖尾沙滩', '一岛两海', '海下邮局', '浮潜圣地', '生态度假村'],
      intro: '马达京岛是仙本那最原生态的私人岛屿，以绝美的拖尾沙滩闻名。退潮时，一条长达1公里的白色沙滩从岛的一端延伸出去，将大海一分为二，一边是浅绿、一边是深蓝，美得像梦境。岛上还有世界上独一无二的海下邮局。',
      playGuide: '马达京岛分为大马达京和小马达京，拖尾沙滩在两岛之间。退潮时才能看到完整的拖尾沙滩，出发前查好潮汐时间。浮潜推荐：岛东侧的珊瑚花园和沉船潜点。',
      openHours: '每日（需乘船前往）',
      coverImage: img('仙本那马达京岛拖尾沙滩渐变海水航拍'),
      images: [
        img('马达京拖尾沙滩退潮全景'),
        img('一岛两海渐变色海水'),
        img('白沙滩碧蓝海岸线'),
        img('海底珊瑚热带鱼浮潜')
      ]
    },
    { name: '马布岛', city: '仙本那', province: '沙巴', duration: 6, ticketPrice: 0,
      highlights: ['巴瑶族故乡', '水上村落', '微距潜水圣地', '人文摄影', '日落渔船'],
      intro: '马布岛是巴瑶族（海上吉普赛人）的主要聚居地之一，岛上有传统的水上高脚屋村落。马布岛同时也是世界顶级的"微距潜水"圣地，海底有各种神奇的小生物：火焰章鱼、蓝环章鱼、青蛙鱼、海龙等。',
      playGuide: '可以参加马布岛+卡帕莱双岛一日游。上午在马布岛参观巴瑶族水上村落，拍摄人文照片，下午去卡帕莱浮潜。与当地人交流请保持尊重，拍照前最好先征得同意。',
      openHours: '全天（需乘船前往）',
      coverImage: img('仙本那马布岛巴瑶族水上村落高脚屋'),
      images: [
        img('巴瑶族小孩划船海上'),
        img('水上高脚屋村落日落'),
        img('海底微距生物章鱼'),
        img('渔村渔船晚霞海面')
      ]
    }
  ];
  const scenicMap = {};
  for (const s of scenicDefs) {
    const ex = await db.collection('scenic')
      .where({ _openid: openid, name: s.name, status: 'active' }).limit(1).get();
    if (ex.data.length) { scenicMap[s.name] = ex.data[0]._id; continue; }
    const images = s.images || [s.coverImage];
    const r = await db.collection('scenic').add({ data: {
      _openid: openid, ...s, images,
      suitableFor: ['蜜月', '情侣', '亲子'], tags: ['海岛', '自然风光', '度假'],
      status: 'active', createdAt: now, updatedAt: now
    } });
    scenicMap[s.name] = r._id;
  }

  // ---- 2. 演示客户 ----
  const CUST_NAME = '演示客户·林先生（蜜月旅行）';
  let customerId;
  const exCust = await db.collection('customer')
    .where({ _openid: openid, name: CUST_NAME }).limit(1).get();
  if (exCust.data.length) {
    customerId = exCust.data[0]._id;
  } else {
    const r = await db.collection('customer').add({ data: {
      _openid: openid, name: CUST_NAME, phone: '13800000000', wechat: 'demo_lin_2026',
      stage: 'plan', preferences: ['蜜月', '海岛', '度假'], scenicWish: ['仙本那', '亚庇', '水上屋'],
      budget: 9000000,
      travelDate: { start: now + 14 * 86400000, end: now + 20 * 86400000, days: 7 },
      pax: { adult: 2, child: 0, baby: 0 },
      notes: [{ ts: now, content: '客户计划11月蜜月旅行，偏好海岛度假，预算充足，希望包含水上屋体验。', _openid: openid }],
      source: '演示数据', lostReason: '', createdAt: now, updatedAt: now
    } });
    customerId = r._id;
  }

  // ---- 3. 行程（引用景点 _id） ----
  const S = scenicMap;
  const days = [
    { dateLabel: 'Day 1 · 抵达亚庇', city: '亚庇',
      items: [
        { type: 'transport', refId: '', name: '接机服务',
          note: '专车接机，举牌等候，送往酒店办理入住',
          startTime: '10:30', endTime: '12:00' },
        { type: 'hotel', refId: '', name: '酒店入住',
          note: '办理入住，稍作休息，倒时差',
          startTime: '12:30', endTime: '15:00' },
        { type: 'meal', refId: '', name: '海鲜大餐',
          note: '欢迎晚宴：大茄来海鲜餐厅，老虎虾、奶油焗龙虾',
          startTime: '18:00', endTime: '19:30' },
        { type: 'scenic', refId: S['丹绒亚路海滩'], name: '丹绒亚路海滩',
          note: '傍晚漫步海滩，观赏世界三大日落',
          startTime: '17:00', endTime: '19:00' }
      ],
      transport: '专车接机（丰田海狮 11座）',
      meal: '午餐（酒店简餐） · 晚餐（海鲜大餐）',
      hotel: '香格里拉丹绒亚路度假酒店（5星）'
    },
    { dateLabel: 'Day 2 · 神山探秘', city: '亚庇',
      items: [
        { type: 'scenic', refId: S['沙巴神山公园'], name: '沙巴神山公园',
          note: '神山奶牛牧场 + 波令温泉 + 雨林吊桥 一日游',
          startTime: '08:00', endTime: '18:00' },
        { type: 'meal', refId: '', name: '牧场午餐',
          note: '神山牧场特色餐：鲜奶火锅 + 烤羊排',
          startTime: '12:30', endTime: '13:30' }
      ],
      transport: '一日游专车（含神山公园门票）',
      meal: '早餐（酒店） · 午餐（牧场） · 晚餐（市区肉骨茶）',
      hotel: '香格里拉丹绒亚路度假酒店（5星）'
    },
    { dateLabel: 'Day 3 · 城市漫步 · 前往仙本那', city: '亚庇',
      items: [
        { type: 'scenic', refId: S['亚庇水上清真寺'], name: '水上清真寺',
          note: '早晨打卡亚庇地标，湖面倒影最美时刻',
          startTime: '07:30', endTime: '08:30' },
        { type: 'scenic', refId: S['亚庇加雅街周日市集'], name: '加雅街周日市集',
          note: '逛周日市集，品尝当地小吃，购买手信',
          startTime: '09:00', endTime: '11:00' },
        { type: 'transport', refId: '', name: '亚庇 → 斗湖 → 仙本那',
          note: '内陆航班 AK6262（12:30-13:20），抵达后专车送往仙本那镇（约1.5小时）',
          startTime: '12:30', endTime: '15:30' },
        { type: 'hotel', refId: '', name: '仙本那酒店入住',
          note: '海丰大酒店，稍作休息后镇上自由活动',
          startTime: '16:00', endTime: '18:00' }
      ],
      transport: '内陆航班 + 斗湖机场专车接送',
      meal: '早餐（酒店） · 午餐（机上简餐） · 晚餐（仙本那海鲜）',
      hotel: '海丰大酒店（4星海景房）'
    },
    { dateLabel: 'Day 4 · 跳岛精华·敦沙卡兰', city: '仙本那',
      items: [
        { type: 'scenic', refId: S['敦沙卡兰海洋公园'], name: '敦沙卡兰海洋公园',
          note: '珍珠岛爬山俯瞰泻湖 + 军舰岛浮潜 + 曼达布安岛巴瑶族村落',
          startTime: '07:30', endTime: '17:00' },
        { type: 'meal', refId: '', name: '岛上简餐',
          note: '军舰岛海鲜 BBQ 午餐',
          startTime: '12:00', endTime: '13:00' }
      ],
      transport: '快艇出海（专业潜导陪同，含浮潜装备）',
      meal: '早餐（酒店） · 午餐（岛上BBQ） · 晚餐（镇上海鲜）',
      hotel: '海丰大酒店（4星海景房）'
    },
    { dateLabel: 'Day 5 · 卡帕莱水上屋体验', city: '仙本那',
      items: [
        { type: 'scenic', refId: S['卡帕莱岛'], name: '卡帕莱岛',
          note: '卡帕莱一日游：水上屋参观 + 浮潜看海龟 + 栈道漫步',
          startTime: '08:00', endTime: '16:00' },
        { type: 'meal', refId: '', name: '卡帕莱自助午餐',
          note: '水上屋度假村自助午餐，海景餐厅',
          startTime: '12:00', endTime: '13:30' }
      ],
      transport: '快艇出海（含浮潜装备 + 热带水果下午茶）',
      meal: '早餐（酒店） · 午餐（卡帕莱自助） · 晚餐（海鲜火锅）',
      hotel: '海丰大酒店（4星海景房）'
    },
    { dateLabel: 'Day 6 · 马达京拖尾沙滩', city: '仙本那',
      items: [
        { type: 'scenic', refId: S['马达京岛'], name: '马达京岛',
          note: '梦幻拖尾沙滩 + 海下邮局寄明信片 + 浮潜',
          startTime: '08:00', endTime: '16:00' },
        { type: 'meal', refId: '', name: '马达京岛午餐',
          note: '岛上度假村自助午餐',
          startTime: '12:00', endTime: '13:00' }
      ],
      transport: '快艇出海（含浮潜装备）',
      meal: '早餐（酒店） · 午餐（岛上自助） · 晚餐（欢送晚宴·海鲜大餐）',
      hotel: '海丰大酒店（4星海景房）'
    },
    { dateLabel: 'Day 7 · 返程', city: '仙本那',
      items: [
        { type: 'transport', refId: '', name: '仙本那 → 斗湖机场',
          note: '专车送往斗湖机场（约1.5小时车程）',
          startTime: '08:00', endTime: '09:30' },
        { type: 'transport', refId: '', name: '斗湖 → 吉隆坡 → 国内',
          note: '返程航班，结束愉快旅程',
          startTime: '11:30', endTime: '' }
      ],
      transport: '专车送机 + 内陆航班',
      meal: '早餐（酒店）',
      hotel: ''
    }
  ];

  const tripRes = await db.collection('tripPlan').add({ data: {
    _openid: openid,
    customerId,
    title: DEMO_TITLE,
    intro: '从亚庇的城市风情到仙本那的"果冻海"，7天6晚深度体验沙巴精华。全程专车接送 + 内陆航班衔接，四次跳岛出海覆盖仙本那三大经典路线，与海龟同游、看世界三大日落，度身定制的蜜月海岛度假之旅。',
    heroImage: img('马来西亚亚庇丹绒亚路海滩壮丽日落全景海浪'),
    pickup: {
      flightNo: 'AK1571',
      arriveTime: '10:30',
      airport: '亚庇国际机场（BKI）T1 航站楼',
      meetPoint: '到达厅 3 号出口',
      vehicle: '丰田海狮 11 座（专车专导）',
      driverName: '陈师傅',
      driverPhone: '13800138000',
      note: '落地后请开启手机漫游，司机将在出口举牌"林先生 林太太"等候；提取行李后请勿走远，如有任何问题请随时拨打司机电话。'
    },
    pax: { adult: 2, child: 0, baby: 0 },
    days,
    status: 'confirmed',
    version: 1,
    shareToken: genToken(),
    createdAt: now,
    updatedAt: now
  } });
  const tripId = tripRes._id;

  // ---- 4. 酒店方案（关联 tripId/customerId） ----
  const hotelDefs = [
    { city: '亚庇', checkIn: 'D1', checkOut: 'D3', rooms: 1,
      options: [
        { name: '香格里拉丹绒亚路度假酒店', star: 5, price: 120000, totalPrice: 240000,
          roomType: '海景大床房（含双早 · 蜜月布置）', breakfast: true, cancelable: true,
          image: img('马来西亚亚庇香格里拉丹绒亚路度假酒店海景泳池'),
          facilities: ['私人沙滩', '无边泳池', 'SPA水疗', '海景餐厅', '日落酒吧', '健身房', '儿童乐园'],
          intro: '亚庇顶级海滨度假酒店，坐拥丹绒亚路海滩，直面世界三大日落。酒店拥有私人沙滩、3个泳池和世界级SPA，是蜜月度假的首选。',
          bookType: 'agent', source: 'mock' }
      ], selectedOption: 0 },
    { city: '仙本那', checkIn: 'D3', checkOut: 'D7', rooms: 1,
      options: [
        { name: '海丰大酒店', star: 4, price: 45000, totalPrice: 180000,
          roomType: '豪华海景双床房（含双早）', breakfast: true, cancelable: true,
          image: img('马来西亚仙本那海丰大酒店海景房阳台'),
          facilities: ['海景阳台', '无边泳池', '码头接送', '自助餐厅', 'SPA', '健身房', '行李寄存'],
          intro: '仙本那镇中心地标酒店，紧邻出海码头，步行5分钟即可到达登船点。所有海景房都有独立阳台，可眺望仙本那海港。',
          bookType: 'agent', source: 'mock' }
      ], selectedOption: 0 }
  ];
  const hotelIds = [];
  for (const h of hotelDefs) {
    const opts = h.options.map(o => Object.assign({}, o, { star: o.star || 0 }));
    const r = await db.collection('hotelPlan').add({ data: {
      _openid: openid, tripId, customerId,
      city: h.city, checkIn: h.checkIn, checkOut: h.checkOut, rooms: h.rooms,
      guests: { adult: 2, child: 0 }, budget: 0, star: [], location: '',
      options: opts,
      selectedOption: h.selectedOption,
      selectedHotel: opts[h.selectedOption] || null,
      status: 'confirmed',
      createdAt: now, updatedAt: now
    } });
    hotelIds.push(r._id);
  }

  return ok({
    tripId, customerId, hotelIds,
    scenicCount: Object.keys(scenicMap).length,
    daysCount: days.length
  }, '演示数据已生成：沙巴·亚庇+仙本那7天6晚蜜月定制游');
}
