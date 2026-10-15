// pages/hotel/detail/detail.js - 酒店方案详情/创建
// 新建模式：表单 -> 创建 -> 酒店列表
// 编辑模式：加载已存方案 -> 修改条件重新搜索 -> 选中酒店
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

Page({
  data: {
    mode: 'new',
    pageState: 'form',
    id: '',
    customerId: '',
    tripId: '',
    city: '',
    checkIn: '',
    checkOut: '',
    rooms: 1,
    budget: '',
    location: '',
    options: [],
    selectedOption: -1,
    searching: false
  },

  onLoad(options) {
    const id = options.id || '';
    const customerId = options.customerId || '';
    const tripId = options.tripId || '';
    if (id) {
      this.setData({ mode: 'edit', id, customerId, tripId, pageState: 'loading' });
      this.loadDetail(id);
    } else {
      const today = formatDateStr(Date.now());
      const tomorrow = formatDateStr(Date.now() + 86400000);
      this.setData({ mode: 'new', customerId, tripId, checkIn: today, checkOut: tomorrow, pageState: 'form' });
      wx.setNavigationBarTitle({ title: '新建酒店方案' });
    }
  },

  async loadDetail(id) {
    try {
      const res = await call('hotelPlan', { action: 'get', id }, { showError: false });
      const h = res.hotel || {};
      this.setData({
        customerId: h.customerId || '',
        tripId: h.tripId || '',
        city: h.city || '',
        checkIn: h.checkIn || '',
        checkOut: h.checkOut || '',
        rooms: h.rooms || 1,
        budget: h.budget ? formatMoney(h.budget) : '',
        location: h.location || '',
        options: this.decorateOptions(h.options || []),
        selectedOption: h.selectedOption == null ? -1 : h.selectedOption,
        pageState: 'list'
      });
      wx.setNavigationBarTitle({ title: '酒店方案详情' });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  decorateOptions(opts) {
    return (opts || []).map(o => Object.assign({}, o, {
      priceText: formatMoney(o.price),
      totalPriceText: formatMoney(o.totalPrice),
      starDots: Array(o.star || 0).fill(1)
    }));
  },

  onCityInput(e) { this.setData({ city: e.detail.value }); },
  onCheckInChange(e) { this.setData({ checkIn: e.detail.value }); },
  onCheckOutChange(e) { this.setData({ checkOut: e.detail.value }); },
  onRoomsChange(e) { this.setData({ rooms: e.detail.value }); },
  onBudgetInput(e) { this.setData({ budget: e.detail.value }); },
  onLocationInput(e) { this.setData({ location: e.detail.value }); },

  async onSearchTap() {
    const { city, checkIn, checkOut, mode, id } = this.data;
    if (!city) return wx.showToast({ title: '请填写目的地城市', icon: 'none' });
    if (!checkIn || !checkOut) return wx.showToast({ title: '请选择入住和离店日期', icon: 'none' });

    this.setData({ searching: true });
    try {
      if (mode === 'new') {
        const res = await call('hotelPlan', {
          action: 'create',
          customerId: this.data.customerId || undefined,
          tripId: this.data.tripId || undefined,
          city,
          checkIn,
          checkOut,
          rooms: Number(this.data.rooms),
          budget: this.data.budget ? Number(this.data.budget) : undefined,
          location: this.data.location
        }, { loading: true });
        this.setData({
          mode: 'edit',
          id: res._id,
          options: this.decorateOptions(res.options),
          selectedOption: -1,
          pageState: 'list'
        });
        wx.setNavigationBarTitle({ title: '酒店方案详情' });
      } else {
        const res = await call('hotelPlan', {
          action: 'update', id,
          city,
          checkIn,
          checkOut,
          rooms: Number(this.data.rooms),
          budget: this.data.budget ? Number(this.data.budget) : undefined,
          location: this.data.location,
          refresh: true
        }, { loading: true });
        this.setData({
          options: this.decorateOptions(res.options || []),
          selectedOption: res.selectedOption == null ? -1 : res.selectedOption
        });
      }
    } catch (err) {
      // 错误提示已由 request.js 处理
    } finally {
      this.setData({ searching: false });
    }
  },

  async onSelectTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (this.data.selectedOption === idx) return;
    try {
      await call('hotelPlan', {
        action: 'selectOption', id: this.data.id, index: idx
      }, { loading: true, showError: false });
      this.setData({ selectedOption: idx });
      wx.showToast({ title: '已选中', icon: 'success' });
    } catch (err) {}
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url;
    const urls = this.data.options.map(o => o.image).filter(Boolean);
    if (!urls.length) return;
    wx.previewImage({ current: url, urls });
  },

  onDeleteTap() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定删除该酒店方案？',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('hotelPlan', { action: 'remove', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {}
      }
    });
  },

  onRetry() {
    if (this.data.id) this.loadDetail(this.data.id);
    else this.setData({ pageState: 'form' });
  },

  onShareAppMessage() {
    const city = this.data.city || '酒店方案';
    return {
      title: '酒店方案：' + city,
      path: '/pages/hotel/detail/detail?id=' + this.data.id
    };
  }
});

function formatDateStr(ts) {
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
