// cloudfunctions/scenic/index.js
// 景点库云函数 - 智游策划师 P0
// actions: list | get | create | update | remove | initDemo | updateCovers
// 权限：全员可读；create/update/remove/initDemo 仅 admin

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const ok = (data = null, message = 'ok') => ({ code: 0, message, data });
const fail = (code, message, data = null) => ({ code, message, data });

exports.main = async (event, context) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID;
  if (!openid) return fail(401, '未获取到用户身份');

  const { action } = event;
  try {
    switch (action) {
      case 'list':      return await list(event);
      case 'get':       return await get(event);
      case 'create':    return await create(event, openid);
      case 'update':    return await update(event, openid);
      case 'remove':    return await remove(event, openid);
      case 'initDemo':     return await initDemo(openid, event.force);
      case 'updateCovers': return await updateCovers(openid);
      default:             return fail(400, '未知的 action: ' + action);
    }
  } catch (err) {
    console.error('[scenic] action=%s err:', action, err);
    return fail(500, '服务异常: ' + (err.errMsg || err.message));
  }
};

async function list(event) {
  const { keyword, city, tag, pageNo = 1, pageSize = 20 } = event;
  const skip = (pageNo - 1) * pageSize;

  const where = { status: 'active' };
  if (city) where.city = city;
  if (tag) where.tags = _.in([tag]);
  if (keyword) {
    where.name = db.RegExp({ regexp: String(keyword), options: 'i' });
  }

  const countRes = await db.collection('scenic').where(where).count();
  const total = countRes.total;

  const { data } = await db.collection('scenic')
    .where(where)
    .orderBy('updatedAt', 'desc')
    .skip(skip)
    .limit(pageSize)
    .get();

  const list = data.map(s => ({
    _id: s._id, name: s.name, city: s.city, province: s.province,
    coverImage: s.coverImage || '', images: (s.images || []).slice(0, 1),
    highlights: s.highlights || [], suitableFor: s.suitableFor || [],
    ticketPrice: s.ticketPrice || 0, tags: s.tags || [],
    duration: s.duration || 0
  }));

  return ok({ list, total, pageNo, pageSize });
}

async function get(event) {
  const { id } = event;
  if (!id) return fail(400, '缺少景点 id');
  const { data } = await db.collection('scenic').doc(id).get().catch(() => ({ data: null }));
  if (!data) return fail(404, '景点不存在');
  return ok({ scenic: data });
}

async function create(event, openid) {
  if (!(await assertAdmin(openid))) return fail(403, '仅管理员可创建景点');
  const { name } = event;
  if (!name || !name.trim()) return fail(400, '景点名称不能为空');

  const now = Date.now();
  const doc = {
    _openid: openid,
    name: name.trim(),
    city: event.city || '',
    province: event.province || '',
    address: event.address || '',
    location: event.location || null,
    coverImage: event.coverImage || '',
    images: event.images || [],
    intro: event.intro || '',
    highlights: event.highlights || [],
    suitableFor: event.suitableFor || [],
    ticketPrice: toCents(event.ticketPrice),
    openHours: event.openHours || '',
    duration: Number(event.duration) || 0,
    tags: event.tags || [],
    videoUrl: event.videoUrl || '',
    playGuide: event.playGuide || '',
    status: 'active',
    createdAt: now,
    updatedAt: now
  };
  const res = await db.collection('scenic').add({ data: doc });
  return ok({ _id: res._id }, '景点已创建');
}

async function update(event, openid) {
  if (!(await assertAdmin(openid))) return fail(403, '仅管理员可修改景点');
  const { id } = event;
  if (!id) return fail(400, '缺少景点 id');

  const fields = ['name', 'city', 'province', 'address', 'location', 'coverImage',
                  'images', 'intro', 'highlights', 'suitableFor', 'ticketPrice',
                  'openHours', 'duration', 'tags', 'status', 'videoUrl', 'playGuide'];
  const patch = { updatedAt: Date.now() };
  for (const k of fields) {
    if (event[k] !== undefined) {
      if (k === 'ticketPrice') patch.ticketPrice = toCents(event.ticketPrice);
      else patch[k] = event[k];
    }
  }
  await db.collection('scenic').doc(id).update({ data: patch });
  return ok({ id }, '景点已更新');
}

async function remove(event, openid) {
  if (!(await assertAdmin(openid))) return fail(403, '仅管理员可删除景点');
  const { id } = event;
  if (!id) return fail(400, '缺少景点 id');
  await db.collection('scenic').doc(id).update({ data: { status: 'disabled', updatedAt: Date.now() } });
  return ok({ id }, '景点已下架');
}

/** 写入演示数据：8 条国外经典景点（force=true 时先清空旧数据） */
async function initDemo(openid, force) {
  if (!(await assertAdmin(openid))) return fail(403, '仅管理员可初始化演示数据');

  const exist = await db.collection('scenic').where({ status: 'active' }).count();
  if (exist.total > 0 && !force) return fail(400, '景点库已有数据，不再重复写入');
  if (force && exist.total > 0) {
    const { data: oldDocs } = await db.collection('scenic').where({ status: 'active' }).limit(100).get();
    await Promise.all(oldDocs.map(d => db.collection('scenic').doc(d._id).remove()));
  }

  const now = Date.now();
  const demos = [
    { name: '双子塔', city: '马来西亚', province: '吉隆坡', highlights: ['88层观景台', 'KLCC公园', 'Suria商场'],
      suitableFor: ['亲子', '购物', '摄影'], ticketPrice: 8000, duration: 3,
      tags: ['地标', '人文历史'], intro: '吉隆坡双子塔高452米，曾是世界最高建筑，是马来西亚的国家标志。' },
    { name: '槟城乔治市', city: '马来西亚', province: '槟城', highlights: ['壁画街', '姓氏桥', '极乐寺'],
      suitableFor: ['文艺青年', '美食', '摄影'], ticketPrice: 0, duration: 5,
      tags: ['古城', '人文历史'], intro: '乔治市是马六甲海峡历史名城，世界文化遗产，以街头壁画和南洋美食闻名。' },
    { name: '兰卡威', city: '马来西亚', province: '兰卡威', highlights: ['天空之桥', '红树林', '沙滩日落'],
      suitableFor: ['蜜月', '亲子', '摄影'], ticketPrice: 0, duration: 6,
      tags: ['海岛', '自然风光'], intro: '兰卡威由104个岛屿组成，是马来西亚最大免税岛，拥有热带雨林和碧蓝海水。' },
    { name: '巴厘岛', city: '印尼', province: '巴厘岛', highlights: ['海神庙', '乌布梯田', '库塔海滩'],
      suitableFor: ['蜜月', '亲子', '摄影'], ticketPrice: 0, duration: 7,
      tags: ['海岛', '自然风光'], intro: '巴厘岛是印尼最著名的旅游胜地，集火山、梯田、海滩、寺庙于一体。' },
    { name: '婆罗浮屠', city: '印尼', province: '日惹', highlights: ['世界最大佛塔', '日出观景', '浮雕艺术'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 25000, duration: 4,
      tags: ['寺庙', '人文历史'], intro: '婆罗浮屠是世界最大的佛教建筑遗迹，与长城、泰姬陵并称东方四大奇迹。' },
    { name: '赛武瀑布', city: '印尼', province: '东爪哇', highlights: ['扇形瀑布', '多层水帘', '观景台'],
      suitableFor: ['摄影', '户外探险', '蜜月'], ticketPrice: 10000, duration: 4,
      tags: ['瀑布', '自然风光'], intro: '赛武瀑布是印尼最美瀑布之一，高达120米的扇形瀑布，水流如天幕倾泻。' },
    { name: '布罗莫火山', city: '印尼', province: '东爪哇', highlights: ['火山日出', '吉普车穿越', '火山口'],
      suitableFor: ['摄影', '户外探险', '文艺青年'], ticketPrice: 50000, duration: 6,
      tags: ['火山', '自然风光'], intro: '布罗莫火山是印尼最著名的活火山，海拔2329米，凌晨吉普车穿越沙海看日出是经典体验。' },
    { name: '佩尼达岛', city: '印尼', province: '巴厘岛', highlights: ['精灵坠崖', '破碎沙滩', '天神浴池'],
      suitableFor: ['蜜月', '摄影', '亲子'], ticketPrice: 0, duration: 8,
      tags: ['海岛', '自然风光'], intro: '佩尼达岛是巴厘岛东南离岛，以精灵坠崖T-Rex形状悬崖和碧蓝海水闻名。' },
    { name: '情人崖', city: '印尼', province: '巴厘岛', highlights: ['断崖海景', '寺庙', '日落'],
      suitableFor: ['蜜月', '摄影', '文艺青年'], ticketPrice: 30000, duration: 2,
      tags: ['地标', '人文历史'], intro: '情人崖即乌鲁瓦图断崖，70米高的海崖上的寺庙，是巴厘岛最佳日落观赏点。' },
    { name: '金巴兰海滩', city: '印尼', province: '巴厘岛', highlights: ['沙滩日落', '海鲜烧烤', '星空晚餐'],
      suitableFor: ['蜜月', '亲子', '美食'], ticketPrice: 0, duration: 3,
      tags: ['海滩', '自然风光'], intro: '金巴兰海滩是世界最美日落海滩之一，沙滩烛光海鲜晚餐是经典体验。' },
    { name: '鱼尾狮公园', city: '新加坡', province: '新加坡', highlights: ['鱼尾狮像', '滨海湾全景', '大榴莲'],
      suitableFor: ['亲子', '购物', '摄影'], ticketPrice: 0, duration: 2,
      tags: ['地标', '人文历史'], intro: '鱼尾狮是新加坡的标志，高8.6米，背靠滨海湾，可一览金沙酒店全景。' },
    { name: '红场', city: '俄罗斯', province: '莫斯科', highlights: ['圣瓦西里大教堂', '克里姆林宫', '列宁墓'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 4,
      tags: ['古城', '人文历史'], intro: '红场是莫斯科的中心广场，长695米，周围环绕着俄罗斯最具标志性的建筑群。' },
    { name: '克里姆林宫', city: '俄罗斯', province: '莫斯科', highlights: ['总统府', '教堂广场', '兵器库'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 7000, duration: 3,
      tags: ['地标', '人文历史'], intro: '克里姆林宫是俄罗斯总统府和权力中心，世界最大建筑群之一，内有多个教堂和博物馆。' },
    { name: '圣瓦西里大教堂', city: '俄罗斯', province: '莫斯科', highlights: ['洋葱头穹顶', '彩色塔楼', '内部壁画'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 1000, duration: 2,
      tags: ['教堂', '人文历史'], intro: '圣瓦西里大教堂是莫斯科最著名的地标，伊凡雷帝为纪念攻打喀山胜利而建。' },
    { name: '阿尔巴特大街', city: '俄罗斯', province: '莫斯科', highlights: ['手工艺品', '普希金故居', '街头艺人'],
      suitableFor: ['文艺青年', '购物', '美食'], ticketPrice: 0, duration: 3,
      tags: ['步行街', '人文历史'], intro: '阿尔巴特大街是莫斯科最古老的商业文化大街，出售手工艺品，有普希金故居。' },
    { name: '二战胜利广场', city: '俄罗斯', province: '莫斯科', highlights: ['凯旋门', '卫国战争纪念馆', '喷泉'],
      suitableFor: ['文艺青年', '老人', '亲子'], ticketPrice: 0, duration: 2,
      tags: ['广场', '人文历史'], intro: '为纪念反法西斯战争胜利50周年而建，有仿古罗马凯旋门和卫国战争纪念馆。' },
    { name: '冬宫', city: '俄罗斯', province: '圣彼得堡', highlights: ['艾尔米塔什博物馆', '宫殿广场', '约旦阶梯'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 700, duration: 6,
      tags: ['地标', '人文历史'], intro: '冬宫是俄罗斯帝国皇宫，藏有300万件世界级艺术品，是艾尔米塔什博物馆主馆。' },
    { name: '彼得夏宫', city: '俄罗斯', province: '圣彼得堡', highlights: ['喷泉群', '金色雕塑', '芬兰湾'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 700, duration: 4,
      tags: ['宫殿', '人文历史'], intro: '彼得夏宫是俄罗斯的凡尔赛宫，位于芬兰湾南岸，以140座喷泉和金色雕塑群闻名。' },
    { name: '叶卡捷琳娜宫', city: '俄罗斯', province: '圣彼得堡', highlights: ['琥珀厅', '巴洛克建筑', '花园'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 1000, duration: 3,
      tags: ['宫殿', '人文历史'], intro: '叶卡捷琳娜宫是彼得大帝送给妻子的夏日别墅，琥珀厅全部由琥珀和黄金修饰，极致奢华。' },
    { name: '涅瓦大街', city: '俄罗斯', province: '圣彼得堡', highlights: ['喀山大教堂', '百年书店', '百年糖果屋'],
      suitableFor: ['文艺青年', '购物', '美食'], ticketPrice: 0, duration: 3,
      tags: ['步行街', '人文历史'], intro: '涅瓦大街是圣彼得堡最繁华的步行街，有喀山大教堂、百年书店和百年糖果屋。' },
    { name: '滴血教堂', city: '俄罗斯', province: '圣彼得堡', highlights: ['马赛克壁画', '洋葱头穹顶', '运河'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 350, duration: 1,
      tags: ['教堂', '人文历史'], intro: '滴血教堂为纪念沙皇亚历山大一世殉难而建，典型巴洛克洋葱头风格，内部马赛克壁画精美。' },
    { name: '美人鱼岛', city: '马来西亚', province: '亚庇', highlights: ['浮潜', '私家海滩', '玻璃船'],
      suitableFor: ['亲子', '蜜月', '摄影'], ticketPrice: 0, duration: 8,
      tags: ['海岛', '自然风光'], intro: '美人鱼岛是亚庇最热门的出海浮潜目的地，碧海蓝天中享受浮潜时光，私家海滩派对狂欢。' },
    { name: '仙本那', city: '马来西亚', province: '仙本那', highlights: ['水屋', '跳岛游', '马达京岛'],
      suitableFor: ['蜜月', '亲子', '摄影'], ticketPrice: 0, duration: 7,
      tags: ['海岛', '自然风光'], intro: '仙本那是马来西亚最美的海岛小镇，水屋直接建于海上，跳岛游浮潜探寻海龟和珊瑚礁。' },
    { name: '粉红清真寺', city: '马来西亚', province: '布城', highlights: ['玫瑰色穹顶', '湖畔倒影', '伊斯兰建筑'],
      suitableFor: ['文艺青年', '摄影', '亲子'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '粉红清真寺位于布城湖畔，玫瑰色花岗岩穹顶在水面倒影如画，是马来西亚最具辨识度的清真寺。' },
    { name: '荷兰红屋广场', city: '马来西亚', province: '马六甲', highlights: ['荷兰殖民建筑', '鸡场街', '马六甲河'],
      suitableFor: ['文艺青年', '美食', '摄影'], ticketPrice: 0, duration: 3,
      tags: ['古城', '人文历史'], intro: '荷兰红屋广场是马六甲世界遗产核心区，17世纪荷兰殖民建筑群，旁边鸡场街有南洋美食和娘惹文化。' },
    { name: '德格拉朗梯田', city: '印尼', province: '巴厘岛', highlights: ['梯田风光', '网红秋千', '空中鸟巢'],
      suitableFor: ['蜜月', '文艺青年', '摄影'], ticketPrice: 50000, duration: 3,
      tags: ['梯田', '自然风光'], intro: 'ALAS HARUM德格拉朗梯田俱乐部，集梯田风光、吊桥、玻璃栈道、网红秋千和空中鸟巢拍照打卡于一体。' },
    { name: '乌布皇宫', city: '印尼', province: '巴厘岛', highlights: ['传统宫殿', '巴厘建筑', '文化表演'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '乌布皇宫是巴厘岛王室居所，传统巴厘建筑风格，晚上有传统 kecak 舞蹈表演。' },
    { name: '罗威纳', city: '印尼', province: '巴厘岛', highlights: ['追海豚', '黑沙滩', '日出'],
      suitableFor: ['亲子', '蜜月', '摄影'], ticketPrice: 300000, duration: 4,
      tags: ['海滩', '自然风光'], intro: '罗威纳是巴厘岛北部海滨小镇，清晨出海追海豚是经典体验，黑色火山沙滩独具特色。' },
    { name: '科莫多岛', city: '印尼', province: '科莫多', highlights: ['科莫多龙', '粉色沙滩', '帕达尔岛'],
      suitableFor: ['户外探险', '摄影', '蜜月'], ticketPrice: 200000, duration: 8,
      tags: ['海岛', '自然风光'], intro: '科莫多岛是世界自然遗产，栖息着史前巨蜥科莫多龙，还有罕见的粉色沙滩和绝佳浮潜点。' },
    { name: '水上清真寺', city: '马来西亚', province: '亚庇', highlights: ['湖中清真寺', '白色穹顶', '日落倒影'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '亚庇水上清真寺建于里卡士湖中，白色穹顶映在湖面，是亚庇最经典的日落拍照点。' },
    { name: '丹绒亚路沙滩', city: '马来西亚', province: '亚庇', highlights: ['世界三大日落', '桨板', '海滩酒吧'],
      suitableFor: ['蜜月', '亲子', '摄影'], ticketPrice: 0, duration: 2,
      tags: ['海滩', '自然风光'], intro: '丹绒亚路沙滩被誉为世界TOP三最美日落之一，橙红夕阳映海面是亚庇必体验。' },
    { name: '卡瓦红树林', city: '马来西亚', province: '亚庇', highlights: ['天空之境日落', '长鼻猴', '萤火虫'],
      suitableFor: ['亲子', '摄影', '老人'], ticketPrice: 15000, duration: 4,
      tags: ['自然风光', '海滩'], intro: '卡瓦红树林可乘船探寻长鼻猴和萤火虫，天空之镜日落和椰子布丁下午茶是特色体验。' },
    { name: '鸡场街', city: '马来西亚', province: '马六甲', highlights: ['南洋美食', '娘惹文化', '古董街'],
      suitableFor: ['文艺青年', '美食', '购物'], ticketPrice: 0, duration: 2,
      tags: ['步行街', '人文历史'], intro: '鸡场街是马六甲唐人街核心，300年历史的南洋老街，汇聚娘惹美食和古董店铺。' },
    { name: '海峡清真寺', city: '马来西亚', province: '马六甲', highlights: ['海上清真寺', '彩色玻璃', '马六甲海峡'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '马六甲海峡清真寺建在填海岛上，涨潮时如漂浮海上，彩色玻璃窗在夕阳下绚丽多彩。' },
    { name: '独立广场', city: '马来西亚', province: '吉隆坡', highlights: ['苏丹建筑', '皇家雪兰莪俱乐部', '圣玛丽教堂'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['广场', '人文历史'], intro: '独立广场是马来西亚独立宣言地，周围环绕摩尔式、都铎式和殖民地风格建筑群。' },
    { name: 'Tukcad Cepung瀑布', city: '印尼', province: '巴厘岛', highlights: ['洞穴瀑布', '光束', '溶洞'],
      suitableFor: ['摄影', '户外探险', '文艺青年'], ticketPrice: 20000, duration: 2,
      tags: ['瀑布', '自然风光'], intro: 'Tukcad Cepung是巴厘岛最特别的洞穴峡谷瀑布，阳光穿过溶洞顶形成丁达尔光束，网红拍照地。' },
    { name: '阿勇河漂流', city: '印尼', province: '巴厘岛', highlights: ['热带雨林', '激流漂流', '峡谷'],
      suitableFor: ['亲子', '户外探险', '蜜月'], ticketPrice: 350000, duration: 4,
      tags: ['自然风光'], intro: '阿勇河漂流穿越热带雨林峡谷，全程约2小时，是巴厘岛最经典的户外探险项目。' },
    { name: '乌布集市', city: '印尼', province: '巴厘岛', highlights: ['手工艺品', '蜡染', '银器'],
      suitableFor: ['文艺青年', '购物', '美食'], ticketPrice: 0, duration: 2,
      tags: ['步行街', '人文历史'], intro: '乌布集市是巴厘岛最大的传统市场，出售手工艺品、蜡染布和银器，可体验巴厘岛本土生活。' },
    { name: '悬崖公路', city: '印尼', province: '巴厘岛', highlights: ['沿海断崖', '海景公路', '拍照打卡'],
      suitableFor: ['蜜月', '摄影', '文艺青年'], ticketPrice: 0, duration: 1,
      tags: ['自然风光'], intro: '巴厘岛南部沿海断崖公路，一侧悬崖一侧碧海，是环岛自驾和拍照打卡的经典路线。' },
    { name: '帕达尔岛', city: '印尼', province: '科莫多', highlights: ['徒步登顶', '三湾全景', '星空露营'],
      suitableFor: ['户外探险', '摄影', '蜜月'], ticketPrice: 200000, duration: 3,
      tags: ['海岛', '自然风光'], intro: '帕达尔岛是科莫多国家公园核心景点，徒步登顶可一览三个海湾交汇的壮丽全景。' },
    { name: '粉色沙滩', city: '印尼', province: '科莫多', highlights: ['红色珊瑚碎片', '碧蓝海水', '浮潜'],
      suitableFor: ['蜜月', '摄影', '亲子'], ticketPrice: 200000, duration: 2,
      tags: ['海滩', '自然风光'], intro: '科莫多粉色沙滩因红色珊瑚碎片与白沙混合而呈现粉色，是世界罕见自然奇观。' },
    { name: '列宁墓', city: '俄罗斯', province: '莫斯科', highlights: ['列宁遗体', '红场核心', '历史建筑'],
      suitableFor: ['文艺青年', '老人', '摄影'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '列宁墓位于红场中央，保存着列宁遗体，是苏联时期最具象征意义的建筑。' },
    { name: '基督救世主大教堂', city: '俄罗斯', province: '莫斯科', highlights: ['最高东正教教堂', '金色穹顶', '壁画'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['教堂', '人文历史'], intro: '基督救世主大教堂是世界上最高的东正教教堂，为纪念抗法战争牺牲者而建。' },
    { name: '莫斯科地铁', city: '俄罗斯', province: '莫斯科', highlights: ['宫殿车站', '马赛克壁画', '吊灯'],
      suitableFor: ['文艺青年', '老人', '亲子'], ticketPrice: 500, duration: 1,
      tags: ['地标', '人文历史'], intro: '莫斯科地铁以华丽装饰闻名，被誉为地下宫殿，多个车站有精美马赛克壁画和吊灯。' },
    { name: '谢尔盖耶夫圣三一教堂', city: '俄罗斯', province: '谢尔盖耶夫', highlights: ['三圣教堂', '圣母升天大教堂', '钟楼'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 500, duration: 2,
      tags: ['教堂', '人文历史'], intro: '圣三一教堂群位于谢尔盖耶夫镇，建于1423年，是俄罗斯早期白石建筑艺术典范。' },
    { name: '卡洛明斯克庄园', city: '俄罗斯', province: '莫斯科', highlights: ['皇家避暑山庄', '木质宫殿', '苹果园'],
      suitableFor: ['文艺青年', '老人', '亲子'], ticketPrice: 0, duration: 2,
      tags: ['宫殿', '人文历史'], intro: '卡洛明斯克庄园是沙皇时期皇家避暑山庄，有14-17世纪教堂和木质建筑，被称为天下第八奇观。' },
    { name: '莫斯科大学', city: '俄罗斯', province: '莫斯科', highlights: ['斯大林式建筑', '七姐妹之一', '观景台'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '莫斯科大学主楼是斯大林式建筑七姐妹之一，237米高，结合巴洛克塔和哥特式摩天楼风格。' },
    { name: '彼得堡罗要塞', city: '俄罗斯', province: '圣彼得堡', highlights: ['彼得大帝奠基', '兔子岛', '要塞教堂'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 550, duration: 2,
      tags: ['古城', '人文历史'], intro: '彼得堡罗要塞位于涅瓦河兔子岛，1703年彼得大帝奠基，与圣彼得堡同龄。' },
    { name: '喀山大教堂', city: '俄罗斯', province: '圣彼得堡', highlights: ['半圆回廊', '喀山圣母圣像', '东正教'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 0, duration: 1,
      tags: ['教堂', '人文历史'], intro: '喀山大教堂为存放喀山上帝之母圣像而建，94根柱廊组成半圆回廊，是圣彼得堡地标。' },
    { name: '伊萨基耶夫教堂', city: '俄罗斯', province: '圣彼得堡', highlights: ['金色穹顶', '世界四大教堂', '观景台'],
      suitableFor: ['文艺青年', '摄影', '老人'], ticketPrice: 300, duration: 2,
      tags: ['教堂', '人文历史'], intro: '伊萨基耶夫教堂是世界四大教堂之一，金色穹顶高101米，可登顶俯瞰圣彼得堡全景。' },
    { name: '阿芙乐尔号巡洋舰', city: '俄罗斯', province: '圣彼得堡', highlights: ['十月革命标志', '历史军舰', '博物馆'],
      suitableFor: ['文艺青年', '老人', '亲子'], ticketPrice: 0, duration: 1,
      tags: ['地标', '人文历史'], intro: '阿芙乐尔号巡洋舰是十月革命标志，打响了革命第一枪，现停泊涅瓦河上作博物馆。' },
    { name: '伏特加博物馆', city: '俄罗斯', province: '圣彼得堡', highlights: ['国酒文化', '品鉴', '历史展品'],
      suitableFor: ['文艺青年', '老人', '美食'], ticketPrice: 600, duration: 1,
      tags: ['博物馆', '人文历史'], intro: '伏特加博物馆展示俄罗斯国酒伏特加的历史文化，可品鉴不同口味的伏特加。' }
  ];

  const tasks = demos.map(d => db.collection('scenic').add({
    data: { _openid: openid, images: [], coverImage: '', address: '', location: null,
            openHours: '', status: 'active', createdAt: now, updatedAt: now, ...d }
  }));
  await Promise.all(tasks);
  return ok({ count: demos.length }, '已写入 ' + demos.length + ' 条演示景点');
}

/** 批量更新景点封面图（按名称匹配） */
async function updateCovers(openid) {
  if (!(await assertAdmin(openid))) return fail(403, '仅管理员可更新封面');
  const coverBase = 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=';
  const coverSize = '&image_size=landscape_4_3';
  const covers = {
    '玉龙雪山': '玉龙雪山冰川公园雪景高山',
    '丽江古城': '丽江古城纳西族传统建筑夜景',
    '洱海': '大理洱海湖泊苍山倒影风光',
    '大理古城': '大理古城白族建筑五华楼',
    '香格里拉': '香格里拉普达措国家公园高原湖泊',
    '泸沽湖': '泸沽湖清澈湖水摩梭文化',
    '西双版纳热带植物园': '西双版纳热带植物园郁郁葱葱',
    '蓝月谷': '玉龙雪山蓝月谷蓝宝石色湖水'
  };
  const { data } = await db.collection('scenic').where({ status: 'active' }).get();
  if (!data.length) return fail(400, '景点库为空，请先加载演示数据');
  const tasks = data.map(s => {
    const prompt = covers[s.name];
    if (!prompt) return Promise.resolve();
    const coverImage = coverBase + encodeURIComponent(prompt) + coverSize;
    return db.collection('scenic').doc(s._id).update({ data: { coverImage, updatedAt: Date.now() } });
  });
  await Promise.all(tasks);
  return ok({ updated: data.length }, '封面已更新');
}

async function assertAdmin(openid) {
  try {
    const { data } = await db.collection('staff').where({ _openid: openid }).limit(1).get();
    return !!(data[0] && data[0].role === 'admin');
  } catch (e) {
    return false;
  }
}

function toCents(yuan) {
  if (yuan == null || yuan === '') return 0;
  const n = Number(yuan);
  if (isNaN(n)) return 0;
  return Math.round(n * 100);
}
