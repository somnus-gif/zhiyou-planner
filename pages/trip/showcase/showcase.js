// pages/trip/showcase/showcase.js - 行程展示页（面向客户 · 海报风格）
// 访问方式：?id=xxx（内部查看） 或 ?shareToken=xxx（客户扫码只读访问）
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

const TYPE_LABEL = { scenic: '景点', transport: '交通', meal: '餐食', hotel: '住宿', custom: '其他' };

Page({
  data: {
    pageState: 'loading',   // loading | ok | error
    errorMsg: '',
    readOnly: false,
    id: '',
    shareToken: '',
    trip: null,
    customerName: '',
    dayCount: 0,
    cityList: [],
    paxText: '',
    heroImage: '',
    pickup: null,
    hotelList: [],
    days: [],
    serviceList: [],
    gallery: [],
    qrCodeUrl: '',
    showQrModal: false,
    showPosterModal: false,
    posterImage: '',
    posterGenerating: false
  },

  onLoad(options) {
    console.log('[showcase] onLoad options:', options);
    try {
      if (options.shareToken) {
        this.setData({ shareToken: options.shareToken, readOnly: true });
        this.loadShared();
        return;
      }
      if (!options.id) {
        wx.showToast({ title: '缺少行程参数', icon: 'none' });
        this.setData({ pageState: 'error', errorMsg: '缺少行程 ID 参数' });
        return;
      }
      this.setData({ id: options.id });
      this.loadTrip();
    } catch (e) {
      console.error('[showcase] onLoad error:', e);
      this.setData({ pageState: 'error', errorMsg: e.message || '页面初始化失败' });
    }
  },

  async loadTrip() {
    console.log('[showcase] loadTrip start, id:', this.data.id);
    try {
      const res = await call('tripPlan', { action: 'get', id: this.data.id });
      const t = res.trip || {};
      console.log('[showcase] trip loaded:', t.title);
      let customerName = '';
      if (t.customerId) {
        try {
          const c = await call('customer', { action: 'get', id: t.customerId }, { showError: false });
          customerName = (c.customer && c.customer.name) || '';
        } catch (e) {
          console.warn('[showcase] customer load failed:', e);
        }
      }
      await this.applyTrip(t, customerName);
      console.log('[showcase] applyTrip done, pageState=ok');
    } catch (e) {
      console.error('[showcase] loadTrip error:', e);
      const msg = (e && e.message) || (e && e.errMsg) || '行程不存在或加载失败';
      this.setData({ pageState: 'error', errorMsg: msg });
    }
  },

  async loadShared() {
    try {
      const res = await call('tripPlan', { action: 'getShared', shareToken: this.data.shareToken }, { showError: false });
      await this.applyTrip(res.trip || {}, '');
    } catch (e) {
      const msg = (e && e.message) || (e && e.errMsg) || '行程不存在或已失效';
      this.setData({ pageState: 'error', errorMsg: msg });
    }
  },

  async applyTrip(t, customerName) {
    // 收集景点 id，批量拉取详情
    const scenicIds = [];
    (t.days || []).forEach(d => {
      (d.items || []).forEach(it => {
        if (it.type === 'scenic' && it.refId && scenicIds.indexOf(it.refId) === -1) {
          scenicIds.push(it.refId);
        }
      });
    });

    const scenicMap = {};
    if (scenicIds.length) {
      try {
        const sres = await call('scenic', {
          action: 'list', ids: scenicIds, pageSize: 100
        }, { showError: false });
        (sres.list || []).forEach(s => { scenicMap[s._id] = s; });
      } catch (e) {
        console.warn('[showcase] 景点详情加载失败:', e);
      }
    }

    // 酒店安排
    let hotelList = [];
    if (this.data.readOnly) {
      hotelList = (t.hotels || []).map(h => {
        const star = h.star || 0;
        return {
          _id: '', city: h.city || '', checkIn: h.checkIn || '', checkOut: h.checkOut || '',
          name: h.name || '待定', star, starText: star ? ('★'.repeat(star) + star + '星') : '',
          roomType: h.roomType || '', image: h.image || '', facilities: h.facilities || [],
          intro: h.intro || '', priceText: h.totalPrice ? formatMoney(h.totalPrice) : '',
          hasDetail: false
        };
      });
    } else if (t.customerId || t._id) {
      try {
        const hres = await call('hotelPlan', {
          action: 'list',
          customerId: t.customerId || undefined,
          tripId: t._id || undefined,
          pageSize: 50
        }, { showError: false });
        hotelList = (hres.list || []).map(h => {
          const s = h.selectedHotel || {};
          const star = s.star || 0;
          return {
            _id: h._id, city: h.city || '', checkIn: h.checkIn || '', checkOut: h.checkOut || '',
            name: s.name || '待定', star, starText: star ? ('★'.repeat(star) + star + '星') : '',
            roomType: s.roomType || '', image: s.image || '', facilities: s.facilities || [],
            intro: s.intro || '', priceText: s.totalPrice ? formatMoney(s.totalPrice) : '',
            hasDetail: !!h._id
          };
        });
      } catch (e) {}
    }

    // 组装每日行程
    const gallery = [];
    const days = (t.days || []).map((d, di) => {
      const items = (d.items || []).map(it => {
        const item = { ...it, typeLabel: TYPE_LABEL[it.type] || '其他' };
        if (it.type === 'scenic' && it.refId && scenicMap[it.refId]) {
          const s = scenicMap[it.refId];
          item.coverImage = s.coverImage || '';
          item.images = (s.images || []).slice(0, 6);
          item.intro = s.intro || '';
          item.highlights = s.highlights || [];
          item.videoUrl = s.videoUrl || '';
          item.playGuide = s.playGuide || '';
          item.duration = s.duration || 0;
          if (s.coverImage) gallery.push({ url: s.coverImage, name: it.name || s.name || '' });
          (s.images || []).forEach(u => {
            if (u && u !== s.coverImage) gallery.push({ url: u, name: it.name || s.name || '' });
          });
        }
        if (it.type === 'hotel' && it.refId) {
          const hp = hotelList.find(h => h._id === it.refId);
          if (hp) { item.hotelPlanId = hp._id; item.hotelName = hp.name; item.hotelImage = hp.image; }
        }
        return item;
      });
      return {
        dayIndex: di + 1, dayLabel: 'D' + (di + 1),
        dateLabel: d.dateLabel || '', city: d.city || '',
        items, transport: d.transport || '', meal: d.meal || '', hotel: d.hotel || ''
      };
    });

    // 接机服务
    const pickup = this.buildPickup(t, days);

    // 概览信息
    const cities = [];
    (t.days || []).forEach(d => { if (d.city && cities.indexOf(d.city) === -1) cities.push(d.city); });

    let paxText = '';
    if (t.pax) {
      const p = t.pax;
      const parts = [];
      if (p.adult) parts.push(p.adult + '成人');
      if (p.child) parts.push(p.child + '儿童');
      if (p.baby) parts.push(p.baby + '婴儿');
      paxText = parts.join(' · ');
    }

    const heroImage = t.heroImage || (gallery.length ? gallery[0].url : '');

    this.setData({
      trip: t, customerName, dayCount: (t.days || []).length,
      cityList: cities, paxText, heroImage, pickup, hotelList, days,
      gallery: gallery.slice(0, 12),
      serviceList: this.buildServiceList(t, days, hotelList),
      pageState: 'ok'
    });

    if (t.title) wx.setNavigationBarTitle({ title: t.title });
  },

  buildPickup(trip, days) {
    const p = trip.pickup;
    if (p && (p.flightNo || p.arriveTime || p.vehicle || p.note)) {
      return {
        flightNo: p.flightNo || '', arriveTime: p.arriveTime || '', airport: p.airport || '',
        meetPoint: p.meetPoint || '', vehicle: p.vehicle || '', driverName: p.driverName || '',
        driverPhone: p.driverPhone || '', note: p.note || '', fromTransportItem: false
      };
    }
    const first = days[0];
    if (first && first.items) {
      const tp = first.items.find(it => it.type === 'transport');
      if (tp) return { flightNo: '', arriveTime: tp.startTime || '', airport: '', meetPoint: '', vehicle: '', driverName: '', driverPhone: '', note: tp.note || tp.name || '', fromTransportItem: true };
    }
    if (first && first.transport) return { flightNo: '', arriveTime: '', airport: '', meetPoint: '', vehicle: '', driverName: '', driverPhone: '', note: first.transport, fromTransportItem: true };
    return null;
  },

  buildServiceList(trip, days, hotelList) {
    const list = [];
    let hasTransport = false, hasMeal = false, hasHotel = false, hasScenic = false;
    days.forEach(d => {
      if (d.transport) hasTransport = true;
      if (d.meal) hasMeal = true;
      if (d.hotel) hasHotel = true;
      (d.items || []).forEach(it => {
        if (it.type === 'scenic') hasScenic = true;
        if (it.type === 'hotel') hasHotel = true;
        if (it.type === 'transport') hasTransport = true;
        if (it.type === 'meal') hasMeal = true;
      });
    });
    if (this.data.pickup) list.push({ icon: 'car', label: '车', title: '接机服务', desc: '专人举牌接机，直达酒店' });
    if (hasScenic) list.push({ icon: 'ticket', label: '票', title: '景点门票', desc: '含行程所列景点首道大门票' });
    if (hasTransport) list.push({ icon: 'bus', label: '行', title: '行程交通', desc: '含行程内交通接送服务' });
    if (hasHotel) list.push({ icon: 'hotel', label: '宿', title: '住宿安排', desc: hotelList.length ? '精选酒店，详见下方住宿' : '含行程所列酒店住宿' });
    if (hasMeal) list.push({ icon: 'meal', label: '餐', title: '餐饮服务', desc: '含行程标注餐食' });
    list.push({ icon: 'guide', label: '导', title: '导游服务', desc: '专业中文导游全程陪同' });
    list.push({ icon: 'insurance', label: '险', title: '旅游保险', desc: '含旅游意外保险' });
    return list;
  },

  // ===== 交互 =====
  onEditTrip() {
    if (this.data.readOnly || !this.data.id) return;
    wx.navigateTo({ url: '/pages/trip/editor/editor?id=' + this.data.id });
  },

  onHotelTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id || this.data.readOnly) return;
    wx.navigateTo({ url: '/pages/hotel/detail/detail?id=' + id });
  },

  onPreviewImage(e) {
    const urls = e.currentTarget.dataset.urls || [];
    const current = e.currentTarget.dataset.url;
    if (!urls.length) return;
    wx.previewImage({ current, urls });
  },

  onPreviewGallery(e) {
    const urls = this.data.gallery.map(g => g.url);
    const current = e.currentTarget.dataset.url;
    if (!urls.length) return;
    wx.previewImage({ current, urls });
  },

  onCallDriver() {
    const phone = (this.data.pickup && this.data.pickup.driverPhone) || '';
    if (phone) wx.makePhoneCall({ phoneNumber: phone });
  },

  // ===== 二维码 =====
  async onShowQrCode() {
    if (this.data.qrCodeUrl) { this.setData({ showQrModal: true }); return; }
    try {
      const res = await call('tripPlan', { action: 'getQrCode', id: this.data.id, envVersion: this.getEnvVersion() }, { loading: true });
      this.setData({ qrCodeUrl: res.fileID || res.qrCodeUrl || '', showQrModal: true });
    } catch (e) {
      wx.showToast({ title: '二维码生成失败', icon: 'none' });
    }
  },

  onCloseQrModal() { this.setData({ showQrModal: false }); },
  noop() {},

  async onSaveQrCode() {
    if (!this.data.qrCodeUrl) return;
    try {
      const { tempFilePath } = await wx.cloud.downloadFile({ fileID: this.data.qrCodeUrl });
      await wx.saveImageToPhotosAlbum({ filePath: tempFilePath });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: '保存失败', icon: 'none' });
    }
  },

  onRetry() {
    if (this.data.shareToken) this.loadShared();
    else this.loadTrip();
  },

  onShareAppMessage() {
    const t = this.data.trip || {};
    const token = t.shareToken || this.data.shareToken;
    return { title: t.title || '行程安排', path: '/pages/trip/showcase/showcase?shareToken=' + (token || '') };
  },

  onShareTimeline() {
    const t = this.data.trip || {};
    return { title: t.title || '私人定制之旅', query: 'shareToken=' + (t.shareToken || this.data.shareToken || '') };
  },

  onPullDownRefresh() {
    const reload = this.data.shareToken ? this.loadShared() : this.loadTrip();
    Promise.resolve(reload).finally(() => { setTimeout(() => wx.stopPullDownRefresh(), 500); });
  },

  // ===== 海报生成 =====
  // 品牌文案（换品牌只改这里）
  posterBrand: {
    en: 'HELLO TRAVELLER',
    zh: '私人定制',
    enSub: 'PERSONALIZED CUSTOMIZATION',
    company: '智游策划师'
  },

  onOpenPoster() {
    this.setData({ showPosterModal: true });
    if (!this.data.posterImage) this.generatePoster();
  },

  onClosePoster() { this.setData({ showPosterModal: false }); },

  // 当前小程序运行版本（develop/trial/release）：让生成的码打开与生成者一致的版本
  getEnvVersion() {
    try {
      const info = wx.getAccountInfoSync();
      return (info && info.miniProgram && info.miniProgram.envVersion) || 'release';
    } catch (e) { return 'release'; }
  },

  // 确保已拿到小程序码（scene=shareToken，扫码直达本页）
  async ensureQrCode() {
    if (this.data.qrCodeUrl) return this.data.qrCodeUrl;
    if (!this.data.id) return '';
    try {
      const res = await call('tripPlan', { action: 'getQrCode', id: this.data.id, envVersion: this.getEnvVersion() }, { showError: false });
      const url = (res && (res.fileID || res.qrCodeUrl)) || '';
      if (url) this.setData({ qrCodeUrl: url });
      return url;
    } catch (e) {
      console.warn('[showcase] 小程序码获取失败:', e);
      return '';
    }
  },

  // 计算海报内容与画布高度（纯计算，先定尺寸再绘制）
  buildPosterPlan(qrImage) {
    const { trip, heroImage, dayCount, cityList, paxText, pickup, hotelList, gallery } = this.data;
    const W = 750;
    const pad = 36;
    const coverH = 640;
    const gap = 20;
    const hotels = (hotelList || []).slice(0, 2);
    const scenics = (gallery || []).slice(0, 3);
    let h = pad + coverH + 28 + 176 + gap;
    if (pickup) h += 150 + gap;
    if (hotels.length) h += 40 + hotels.length * 92 + gap;
    if (scenics.length) h += 214 + gap;
    h += 30 + 300 + pad;
    return {
      W, H: Math.round(h), pad, coverH, gap,
      heroImage, qrImage,
      title: (trip && trip.title) || '私人定制之旅',
      dayCount: dayCount || 0,
      cityList: cityList || [],
      paxText: paxText || '',
      pickup: pickup || null,
      hotels, scenics,
      brand: this.posterBrand
    };
  },

  // 预加载海报所需全部图片（全部就绪后再统一绘制，避免异步错位）
  async preloadPosterImages(plan) {
    const canvas = this._posterCanvas;
    const load = (src) => (src ? this.loadImage(canvas, src).catch(() => null) : Promise.resolve(null));
    const hero = await load(plan.heroImage);
    const hotels = await Promise.all(plan.hotels.map(h => load(h.image)));
    const scenics = await Promise.all(plan.scenics.map(s => load(s.image)));
    const qr = await load(plan.qrImage);
    return { hero, hotels, scenics, qr };
  },

  async generatePoster() {
    this.setData({ posterGenerating: true, posterImage: '' });
    try {
      const qrImage = await this.ensureQrCode();
      const plan = this.buildPosterPlan(qrImage);

      const node = await new Promise((resolve) => {
        wx.createSelectorQuery().select('#posterCanvas')
          .fields({ node: true, size: true })
          .exec((r) => resolve(r && r[0] && r[0].node));
      });
      if (!node) throw new Error('画布节点获取失败');

      this._posterCanvas = node;
      const imgs = await this.preloadPosterImages(plan);

      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const dpr = (info && info.pixelRatio) || 2;
      node.width = plan.W * dpr;
      node.height = plan.H * dpr;
      const ctx = node.getContext('2d');
      ctx.scale(dpr, dpr);

      this.drawPoster(ctx, plan, imgs);

      await new Promise((resolve) => setTimeout(resolve, 60));
      wx.canvasToTempFilePath({
        canvas: node,
        success: (r) => this.setData({ posterImage: r.tempFilePath, posterGenerating: false }),
        fail: (e) => {
          console.error('[showcase] 海报导出失败:', e);
          this.setData({ posterGenerating: false });
          wx.showToast({ title: '海报生成失败', icon: 'none' });
        }
      });
    } catch (e) {
      console.error('[showcase] 海报生成异常:', e);
      this.setData({ posterGenerating: false });
      wx.showToast({ title: '海报生成失败', icon: 'none' });
    }
  },

  drawPoster(ctx, plan, imgs) {
    const { W, H, pad, coverH, gap, brand } = plan;
    ctx.textBaseline = 'top';
    const cardX = pad, cardW = W - pad * 2;

    // 背景：深青渐变
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#0A3B46');
    bg.addColorStop(1, '#0E5A66');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 封面大图卡
    ctx.save();
    this.roundRect(ctx, cardX, pad, cardW, coverH, 28);
    ctx.clip();
    ctx.fillStyle = '#0E5563';
    ctx.fillRect(cardX, pad, cardW, coverH);
    if (imgs.hero) this.drawImageCover(ctx, imgs.hero, cardX, pad, cardW, coverH);
    const shade = ctx.createLinearGradient(0, pad + coverH * 0.35, 0, pad + coverH);
    shade.addColorStop(0, 'rgba(6,40,50,0)');
    shade.addColorStop(1, 'rgba(6,40,50,0.72)');
    ctx.fillStyle = shade;
    ctx.fillRect(cardX, pad, cardW, coverH);
    ctx.restore();

    // HELLO TRAVELLER
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.96)';
    ctx.font = '600 60px serif';
    const enParts = brand.en.split(' ');
    ctx.fillText(enParts[0] || '', W / 2, pad + 96);
    ctx.fillText(enParts[1] || '', W / 2, pad + 172);

    // 私人定制 徽标
    const sealW = 300, sealH = 74, sealX = (W - sealW) / 2, sealY = pad + 250;
    ctx.fillStyle = 'rgba(255,255,255,0.94)';
    this.roundRect(ctx, sealX, sealY, sealW, sealH, sealH / 2);
    ctx.fill();
    ctx.fillStyle = '#0A3B46';
    ctx.beginPath(); ctx.arc(sealX + 42, sealY + sealH / 2, 22, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '600 26px serif';
    ctx.fillText('私', sealX + 42, sealY + sealH / 2 - 12);
    ctx.fillStyle = '#0A3B46';
    ctx.font = '600 30px serif';
    ctx.textAlign = 'left';
    ctx.fillText(brand.zh.split('').join(' '), sealX + 76, sealY + 18);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.font = '16px sans-serif';
    ctx.fillText(brand.enSub, W / 2, sealY + sealH + 20);

    // 封面底部公司名
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.font = '24px sans-serif';
    ctx.fillText(brand.company.split('').join(' '), W / 2, pad + coverH - 56);

    // 标题信息卡
    let y = pad + coverH + 28;
    ctx.fillStyle = '#FFFFFF';
    this.roundRect(ctx, cardX, y, cardW, 176, 20);
    ctx.fill();
    ctx.textAlign = 'left';
    ctx.fillStyle = '#0A3B46';
    ctx.font = '600 36px sans-serif';
    this.wrapText(ctx, plan.title, cardX + 32, y + 30, cardW - 64, 46, 2);
    const chips = [];
    if (plan.dayCount) chips.push(plan.dayCount + '天' + (plan.dayCount > 1 ? (plan.dayCount - 1) + '晚' : ''));
    if (plan.cityList.length) chips.push(plan.cityList.join(' → '));
    if (plan.paxText) chips.push(plan.paxText);
    if (chips.length) {
      ctx.fillStyle = '#1BA0D7';
      ctx.font = '24px sans-serif';
      ctx.fillText(chips.join('   ·   '), cardX + 32, y + 128);
    }
    y += 176 + gap;

    // 接机服务
    if (plan.pickup) {
      const p = plan.pickup;
      ctx.fillStyle = '#FFFFFF';
      this.roundRect(ctx, cardX, y, cardW, 150, 20);
      ctx.fill();
      ctx.fillStyle = '#1BA0D7';
      ctx.fillRect(cardX, y + 30, 6, 30);
      ctx.fillStyle = '#0A3B46';
      ctx.font = '600 30px sans-serif';
      ctx.fillText('接机服务', cardX + 26, y + 28);
      ctx.fillStyle = '#8C9AA3';
      ctx.font = '22px sans-serif';
      const line = [];
      if (p.flightNo) line.push('航班 ' + p.flightNo);
      if (p.arriveTime) line.push('抵达 ' + p.arriveTime);
      if (p.vehicle) line.push(p.vehicle);
      ctx.fillText(line.join('  ·  '), cardX + 26, y + 76);
      const driver = ((p.driverName || '') + (p.driverPhone ? '  ' + p.driverPhone : '')).trim();
      if (driver) {
        ctx.fillStyle = '#1BA0D7';
        ctx.fillText('司机：' + driver, cardX + 26, y + 108);
      }
      y += 150 + gap;
    }

    // 酒店安排
    if (plan.hotels.length) {
      const boxH = 40 + plan.hotels.length * 92;
      ctx.fillStyle = '#FFFFFF';
      this.roundRect(ctx, cardX, y, cardW, boxH, 20);
      ctx.fill();
      ctx.fillStyle = '#1BA0D7';
      ctx.fillRect(cardX, y + 30, 6, 30);
      ctx.fillStyle = '#0A3B46';
      ctx.font = '600 30px sans-serif';
      ctx.fillText('酒店安排', cardX + 26, y + 28);
      let hy = y + 62;
      plan.hotels.forEach((h, i) => {
        const img = imgs.hotels[i];
        const ix = cardX + 26, iy = hy + 2, iw = 132, ih = 80;
        ctx.save();
        this.roundRect(ctx, ix, iy, iw, ih, 12);
        ctx.clip();
        if (img) this.drawImageCover(ctx, img, ix, iy, iw, ih);
        else { ctx.fillStyle = '#DCEBF2'; ctx.fillRect(ix, iy, iw, ih); }
        ctx.restore();
        const tx = ix + iw + 20;
        ctx.fillStyle = '#0A3B46';
        ctx.font = '600 26px sans-serif';
        this.wrapText(ctx, h.name || '精选酒店', tx, iy + 2, cardW - iw - 76, 32, 1);
        ctx.fillStyle = '#8C9AA3';
        ctx.font = '21px sans-serif';
        const meta = [];
        if (h.star) meta.push('★' + h.star + '星');
        if (h.roomType) meta.push(h.roomType);
        this.wrapText(ctx, meta.join('  ·  '), tx, iy + 38, cardW - iw - 76, 26, 1);
        if (h.checkIn) ctx.fillText(h.checkIn + ' 入住 · ' + (h.checkOut || '') + ' 离店', tx, iy + 66);
        hy += 92;
      });
      y += boxH + gap;
    }

    // 精选景点
    if (plan.scenics.length) {
      const bh = 214;
      ctx.fillStyle = '#FFFFFF';
      this.roundRect(ctx, cardX, y, cardW, bh, 20);
      ctx.fill();
      ctx.fillStyle = '#1BA0D7';
      ctx.fillRect(cardX, y + 30, 6, 30);
      ctx.fillStyle = '#0A3B46';
      ctx.font = '600 30px sans-serif';
      ctx.fillText('精选景点', cardX + 26, y + 28);
      const n = plan.scenics.length;
      const gapI = 12;
      const tw = (cardW - 52 - gapI * (n - 1)) / n;
      const th = 118;
      plan.scenics.forEach((s, i) => {
        const ix = cardX + 26 + i * (tw + gapI);
        const iy = y + 66;
        ctx.save();
        this.roundRect(ctx, ix, iy, tw, th, 12);
        ctx.clip();
        const img = imgs.scenics[i];
        if (img) this.drawImageCover(ctx, img, ix, iy, tw, th);
        else { ctx.fillStyle = '#DCEBF2'; ctx.fillRect(ix, iy, tw, th); }
        ctx.restore();
        ctx.fillStyle = '#33474F';
        ctx.font = '20px sans-serif';
        ctx.textAlign = 'center';
        this.wrapText(ctx, s.name || '', ix + tw / 2, iy + th + 12, tw, 24, 1);
        ctx.textAlign = 'left';
      });
      y += bh + gap;
    }

    // 底部品牌 + 二维码
    const footH = 300;
    const footY = H - pad - footH;
    ctx.fillStyle = '#FFFFFF';
    this.roundRect(ctx, cardX, footY, cardW, footH, 20);
    ctx.fill();
    ctx.textAlign = 'center';
    ctx.fillStyle = '#0A3B46';
    ctx.font = '600 30px sans-serif';
    ctx.fillText(brand.company, W / 2, footY + 40);
    ctx.fillStyle = '#8C9AA3';
    ctx.font = '22px sans-serif';
    ctx.fillText('扫码查看完整行程 · 开启专属之旅', W / 2, footY + 82);
    const qrSize = 150;
    const qrX = (W - qrSize) / 2, qrY = footY + 116;
    ctx.fillStyle = '#F4F8FA';
    this.roundRect(ctx, qrX - 10, qrY - 10, qrSize + 20, qrSize + 20, 14);
    ctx.fill();
    if (imgs.qr) {
      ctx.drawImage(imgs.qr, qrX, qrY, qrSize, qrSize);
    } else {
      ctx.fillStyle = '#8C9AA3';
      ctx.font = '20px sans-serif';
      ctx.fillText('行程码生成中', W / 2, qrY + qrSize / 2 - 10);
    }
    ctx.textAlign = 'left';
  },

  // 等比裁剪居中绘制（aspectFill）
  drawImageCover(ctx, img, x, y, w, h) {
    const scale = Math.max(w / img.width, h / img.height);
    const sw = w / scale, sh = h / scale;
    const sx = (img.width - sw) / 2, sy = (img.height - sh) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
  },
  loadImage(canvas, src) {
    return new Promise((resolve, reject) => {
      if (!src) { reject(new Error('no src')); return; }
      if (src.startsWith('cloud://')) {
        wx.cloud.downloadFile({
          fileID: src,
          success: (res) => { const img = canvas.createImage(); img.onload = () => resolve(img); img.onerror = reject; img.src = res.tempFilePath; },
          fail: reject
        });
      } else {
        const img = canvas.createImage(); img.onload = () => resolve(img); img.onerror = reject; img.src = src;
      }
    });
  },

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r); ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h); ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r); ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y); ctx.closePath();
  },

  wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines) {
    if (!text) return;
    const chars = text.split('');
    let line = '', lines = 0;
    for (let i = 0; i < chars.length; i++) {
      const testLine = line + chars[i];
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && line !== '') {
        ctx.fillText(line, x, y + lines * lineHeight);
        line = chars[i]; lines++;
        if (lines >= maxLines - 1 && i < chars.length - 1) {
          let lastLine = line;
          while (ctx.measureText(lastLine + '…').width <= maxWidth && i < chars.length - 1) { i++; lastLine += chars[i]; }
          if (ctx.measureText(lastLine + '…').width > maxWidth) lastLine = lastLine.slice(0, -1);
          ctx.fillText(lastLine + '…', x, y + lines * lineHeight);
          return;
        }
      } else { line = testLine; }
    }
    if (line) ctx.fillText(line, x, y + lines * lineHeight);
  },

  async onSavePoster() {
    if (!this.data.posterImage) { wx.showToast({ title: '海报生成中，请稍候', icon: 'none' }); return; }
    try {
      await wx.saveImageToPhotosAlbum({ filePath: this.data.posterImage });
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (e) {
      if (e.errMsg && e.errMsg.includes('auth')) {
        wx.showModal({ title: '需要相册权限', content: '请在设置中开启相册权限，以便保存海报', confirmText: '去设置', success: (r) => { if (r.confirm) wx.openSetting(); } });
      } else { wx.showToast({ title: '保存失败', icon: 'none' }); }
    }
  }
});
