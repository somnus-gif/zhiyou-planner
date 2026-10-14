// pages/trip/preview/preview.js - 行程预览
const { call } = require('../../../utils/request.js');
const { formatDateTime } = require('../../../utils/format.js');

const TYPE_LABEL = { scenic: '景点', transport: '交通', meal: '餐食', hotel: '住宿', custom: '其他' };
const STATUS_LABEL = { draft: '草稿', confirmed: '已确认', archived: '已归档' };

Page({
  data: {
    id: '',
    shareToken: '',
    readOnly: false,
    pageState: 'loading',
    trip: null,
    customerName: '',
    statusLabel: '',
    updatedAtText: '',
    shareText: '',
    qrCodeUrl: '',
    showQrModal: false,
    hotelPlans: [],
    serviceList: []
  },

  onLoad(options) {
    if (options.shareToken) {
      this.setData({ shareToken: options.shareToken, readOnly: true });
      this.loadShared();
      return;
    }
    if (!options.id) {
      wx.showToast({ title: '缺少行程 id', icon: 'none' });
      this.setData({ pageState: 'error' });
      return;
    }
    this.setData({ id: options.id });
    this.loadTrip();
  },

  async loadTrip() {
    try {
      const res = await call('tripPlan', { action: 'get', id: this.data.id });
      const t = res.trip || {};
      let customerName = '';
      if (t.customerId) {
        try {
          const c = await call('customer', { action: 'get', id: t.customerId }, { showError: false });
          customerName = (c.customer && c.customer.name) || '';
        } catch (e) {}
      }
      this.applyTrip(t, customerName);
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  async loadShared() {
    try {
      const res = await call('tripPlan', { action: 'getShared', shareToken: this.data.shareToken }, { showError: false });
      this.applyTrip(res.trip || {}, '');
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  async applyTrip(t, customerName) {
    const scenicIds = [];
    (t.days || []).forEach(d => {
      (d.items || []).forEach(it => {
        if (it.type === 'scenic' && it.refId) scenicIds.push(it.refId);
      });
    });
    let scenicMap = {};
    if (scenicIds.length) {
      try {
        const sres = await call('scenic', { action: 'list', ids: scenicIds, pageSize: 100, queryAll: true }, { showError: false });
        (sres.list || []).forEach(s => { scenicMap[s._id] = s; });
      } catch (e) {}
    }
    // 获取景点详情（含视频和游玩方式）
    if (scenicIds.length) {
      try {
        const details = await Promise.all(scenicIds.map(sid =>
          call('scenic', { action: 'get', id: sid }, { showError: false }).catch(() => null)
        ));
        details.forEach((d, i) => {
          if (d && d.scenic) scenicMap[scenicIds[i]] = Object.assign({}, scenicMap[scenicIds[i]] || {}, {
            videoUrl: d.scenic.videoUrl || '',
            playGuide: d.scenic.playGuide || ''
          });
        });
      } catch (e) {}
    }

    // 加载关联的酒店方案
    let hotelPlans = [];
    if (t.customerId && !this.data.readOnly) {
      try {
        const hres = await call('hotelPlan', { action: 'list', customerId: t.customerId, tripId: t._id, pageSize: 50 }, { showError: false });
        hotelPlans = (hres.list || []).map(h => ({
          _id: h._id,
          city: h.city,
          selectedHotel: h.selectedHotel
        }));
      } catch (e) {}
    }

    const days = (t.days || []).map(d => {
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
        }
        if (it.type === 'hotel' && it.refId) {
          const hp = hotelPlans.find(h => h._id === it.refId);
          if (hp) {
            item.hotelPlanId = hp._id;
            item.hotelName = (hp.selectedHotel && hp.selectedHotel.name) || it.name;
            item.hotelImage = (hp.selectedHotel && hp.selectedHotel.image) || '';
            item.hotelStar = (hp.selectedHotel && hp.selectedHotel.star) || 0;
            item.hotelPrice = (hp.selectedHotel && hp.selectedHotel.totalPrice) || '';
          }
        }
        return item;
      });
      return {
        dateLabel: d.dateLabel || '',
        city: d.city || '',
        items,
        transport: d.transport || '',
        meal: d.meal || '',
        hotel: d.hotel || ''
      };
    });

    // 服务说明汇总
    const serviceList = this.buildServiceList(t, days, hotelPlans);

    const trip = { ...t, days };
    this.setData({
      trip,
      customerName,
      hotelPlans,
      serviceList,
      statusLabel: STATUS_LABEL[t.status] || t.status || '',
      updatedAtText: t.updatedAt ? formatDateTime(t.updatedAt) : '',
      pageState: 'ok',
      shareText: this.buildShareText(trip, customerName)
    });
  },

  buildServiceList(trip, days, hotelPlans) {
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
    if (hasScenic) list.push({ icon: 'ticket', title: '景点门票', desc: '含行程所列景点首道大门票' });
    if (hasTransport) list.push({ icon: 'car', title: '交通服务', desc: '含行程内交通接送服务' });
    if (hasHotel) list.push({ icon: 'hotel', title: '住宿安排', desc: hotelPlans.length ? '精选酒店，详见各日住宿' : '含行程所列酒店住宿' });
    if (hasMeal) list.push({ icon: 'meal', title: '餐饮服务', desc: '含行程标注餐食' });
    list.push({ icon: 'guide', title: '导游服务', desc: '专业中文导游全程陪同' });
    list.push({ icon: 'insurance', title: '旅游保险', desc: '含旅游意外保险' });
    return list;
  },

  buildShareText(trip, customerName) {
    if (!trip) return '';
    let s = (trip.title || '行程安排') + '\n';
    if (customerName) s += '客户：' + customerName + '\n';
    (trip.days || []).forEach(d => {
      s += '\n' + (d.dateLabel || '') + (d.city ? ' · ' + d.city : '') + '\n';
      (d.items || []).forEach(it => {
        s += '  · [' + (TYPE_LABEL[it.type] || '其他') + '] ' + (it.name || '') + (it.note ? '（' + it.note + '）' : '') + '\n';
      });
      if (d.transport) s += '  · 交通：' + d.transport + '\n';
      if (d.meal) s += '  · 餐食：' + d.meal + '\n';
      if (d.hotel) s += '  · 住宿：' + d.hotel + '\n';
    });
    return s;
  },

  onCopy() {
    if (!this.data.shareText) return;
    wx.setClipboardData({ data: this.data.shareText });
  },

  onShareAppMessage() {
    const t = this.data.trip || {};
    const token = t.shareToken || this.data.shareToken;
    return {
      title: t.title || '行程预览',
      path: '/pages/trip/preview/preview?shareToken=' + (token || '')
    };
  },

  async onRefreshShare() {
    if (!this.data.id) return;
    wx.showModal({
      title: '重置分享链接',
      content: '将生成新的分享链接，旧链接会失效。继续？',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('tripPlan', { action: 'refreshShare', id: this.data.id }, { loading: true });
          this.loadTrip();
          wx.showToast({ title: '已重置', icon: 'success' });
        } catch (e) {}
      }
    });
  },

  async onShowQrCode() {
    if (!this.data.id) return;
    if (this.data.qrCodeUrl) {
      this.setData({ showQrModal: true });
      return;
    }
    try {
      const res = await call('tripPlan', { action: 'getQrCode', id: this.data.id }, { loading: true });
      this.setData({ qrCodeUrl: res.fileID, showQrModal: true });
    } catch (e) {}
  },

  onCloseQrModal() {
    this.setData({ showQrModal: false });
  },

  onSaveQrCode() {
    if (!this.data.qrCodeUrl) return;
    wx.showActionSheet({
      itemList: ['保存到相册'],
      success: async () => {
        try {
          const { tempFilePath } = await wx.cloud.downloadFile({ fileID: this.data.qrCodeUrl });
          await wx.saveImageToPhotosAlbum({ filePath: tempFilePath });
          wx.showToast({ title: '已保存到相册', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '保存失败', icon: 'none' });
        }
      }
    });
  },

  onPreviewImage(e) {
    const urls = e.currentTarget.dataset.urls || [];
    const current = e.currentTarget.dataset.url;
    if (!urls.length) return;
    wx.previewImage({ current, urls });
  },

  onHotelTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/hotel/detail/detail?id=' + id });
  },

  onEdit() {
    wx.redirectTo({ url: '/pages/trip/editor/editor?id=' + this.data.id });
  },

  onRetry() {
    this.loadTrip();
  }
});
