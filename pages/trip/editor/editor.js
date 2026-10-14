// pages/trip/editor/editor.js - 行程编辑器
const { call } = require('../../../utils/request.js');

const TYPE_LABEL = { scenic: '景点', transport: '交通', meal: '餐食', hotel: '住宿', custom: '自定义' };

Page({
  data: {
    isEdit: false,
    tripId: '',
    customerId: '',
    customerName: '',
    title: '',
    days: [],
    pageState: 'loading',
    saving: false,
    // 景点选择弹窗
    scenicPickerShow: false,
    scenicPickerDayIdx: -1,
    scenicKeyword: '',
    scenicOptions: [],
    scenicPicking: false,
    // 酒店方案列表
    hotelOptions: []
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, tripId: options.id, pageState: 'loading' });
      this.loadTrip();
    } else if (options.customerId) {
      this.setData({
        customerId: options.customerId,
        customerName: decodeURIComponent(options.customerName || ''),
        pageState: 'ok',
        title: options.customerName ? decodeURIComponent(options.customerName) + '的行程' : '新行程',
        days: [{ dateLabel: 'Day 1', city: '', items: [], transport: '', meal: '', hotel: '' }]
      });
      this.loadHotelOptions(options.customerId);
    } else {
      wx.showToast({ title: '缺少客户信息', icon: 'none' });
      this.setData({ pageState: 'error' });
    }
  },

  async loadTrip() {
    try {
      const res = await call('tripPlan', { action: 'get', id: this.data.tripId });
      const t = res.trip || {};
      // 拉客户名
      let customerName = '';
      if (t.customerId) {
        try {
          const c = await call('customer', { action: 'get', id: t.customerId });
          customerName = (c.customer && c.customer.name) || '';
        } catch (e) {}
      }
      const days = (t.days && t.days.length) ? t.days.map(d => ({
        dateLabel: d.dateLabel || d.date || '',
        city: d.city || '',
        items: (d.items || []).map(it => ({ ...it, typeLabel: TYPE_LABEL[it.type] || '自定义' })),
        transport: d.transport || '',
        meal: d.meal || '',
        hotel: d.hotel || ''
      })) : [{ dateLabel: 'Day 1', city: '', items: [], transport: '', meal: '', hotel: '' }];
      this.setData({
        title: t.title || '',
        days,
        customerId: t.customerId || '',
        customerName,
        pageState: 'ok'
      });
      if (t.customerId) this.loadHotelOptions(t.customerId);
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  async loadHotelOptions(customerId) {
    try {
      const res = await call('hotelPlan', { action: 'list', customerId, pageSize: 50 }, { showError: false });
      const hotelOptions = (res.list || []).map(h => ({
        _id: h._id,
        label: (h.city || '未知') + (h.selectedHotel ? ' · ' + h.selectedHotel.name : '（' + (h.optionCount || 0) + '家待选）'),
        name: h.selectedHotel ? h.selectedHotel.name : ''
      }));
      this.setData({ hotelOptions });
    } catch (e) {
      this.setData({ hotelOptions: [] });
    }
  },

  onLinkHotel(e) {
    const { dayIdx, itemIdx } = e.currentTarget.dataset;
    const opts = this.data.hotelOptions;
    if (!opts.length) {
      wx.showToast({ title: '该客户暂无酒店方案，请先创建', icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: opts.map(o => o.label),
      success: (r) => {
        const selected = opts[r.tapIndex];
        const days = this.data.days;
        days[dayIdx].items[itemIdx].refId = selected._id;
        days[dayIdx].items[itemIdx].name = selected.name || selected.label;
        this.setData({ days });
      }
    });
  },

  onTitleInput(e) { this.setData({ title: e.detail.value }); },

  onDayInput(e) {
    const { idx, field } = e.currentTarget.dataset;
    const days = this.data.days;
    days[idx][field] = e.detail.value;
    this.setData({ days });
  },

  onItemNoteInput(e) {
    const { dayIdx, itemIdx } = e.currentTarget.dataset;
    const days = this.data.days;
    days[dayIdx].items[itemIdx].note = e.detail.value;
    this.setData({ days });
  },

  onAddDay() {
    const days = this.data.days.slice();
    days.push({ dateLabel: 'Day ' + (days.length + 1), city: '', items: [], transport: '', meal: '', hotel: '' });
    this.setData({ days });
  },

  onRemoveDay(e) {
    const idx = e.currentTarget.dataset.idx;
    wx.showModal({
      title: '删除当天',
      content: '确认删除第 ' + (idx + 1) + ' 天？',
      success: (r) => {
        if (!r.confirm) return;
        const days = this.data.days.slice();
        days.splice(idx, 1);
        // 重新编号
        days.forEach((d, i) => { d.dateLabel = 'Day ' + (i + 1); });
        this.setData({ days });
      }
    });
  },

  onMoveItem(e) {
    const { dayIdx, itemIdx, dir } = e.currentTarget.dataset;
    const days = this.data.days;
    const items = days[dayIdx].items;
    const newIdx = dir === 'up' ? itemIdx - 1 : itemIdx + 1;
    if (newIdx < 0 || newIdx >= items.length) return;
    const tmp = items[itemIdx];
    items[itemIdx] = items[newIdx];
    items[newIdx] = tmp;
    this.setData({ days });
  },

  onRemoveItem(e) {
    const { dayIdx, itemIdx } = e.currentTarget.dataset;
    const days = this.data.days;
    days[dayIdx].items.splice(itemIdx, 1);
    this.setData({ days });
  },

  // 景点选择弹窗
  onOpenScenicPicker(e) {
    const dayIdx = e.currentTarget.dataset.dayIdx;
    this.setData({ scenicPickerShow: true, scenicPickerDayIdx: dayIdx, scenicKeyword: '', scenicOptions: [] });
  },

  onCloseScenicPicker() {
    this.setData({ scenicPickerShow: false, scenicPickerDayIdx: -1 });
  },

  onScenicKeywordInput(e) {
    this.setData({ scenicKeyword: e.detail.value });
  },

  async onSearchScenic() {
    if (this.data.scenicPicking) return;
    this.setData({ scenicPicking: true });
    try {
      const res = await call('scenic', {
        action: 'list',
        keyword: this.data.scenicKeyword,
        pageNo: 1,
        pageSize: 30
      }, { showError: false });
      this.setData({ scenicOptions: res.list || [] });
    } catch (e) {}
    this.setData({ scenicPicking: false });
  },

  onPickScenic(e) {
    const s = e.currentTarget.dataset.scenic;
    const dayIdx = this.data.scenicPickerDayIdx;
    const days = this.data.days;
    days[dayIdx].items.push({
      type: 'scenic',
      refId: s._id,
      name: s.name,
      city: s.city || '',
      note: '',
      typeLabel: TYPE_LABEL.scenic
    });
    this.setData({ days, scenicPickerShow: false, scenicPickerDayIdx: -1 });
  },

  // 添加非景点类项目
  onAddCustomItem(e) {
    const { dayIdx, type } = e.currentTarget.dataset;
    const days = this.data.days;
    days[dayIdx].items.push({
      type,
      name: '',
      note: '',
      typeLabel: TYPE_LABEL[type] || '自定义'
    });
    this.setData({ days });
  },

  onItemNameInput(e) {
    const { dayIdx, itemIdx } = e.currentTarget.dataset;
    const days = this.data.days;
    days[dayIdx].items[itemIdx].name = e.detail.value;
    this.setData({ days });
  },

  async onSave() {
    const { title, days, isEdit, tripId, customerId } = this.data;
    if (!title || !title.trim()) return wx.showToast({ title: '请填写标题', icon: 'none' });
    if (!days.length) return wx.showToast({ title: '请至少保留一天', icon: 'none' });

    // 清洗 days（去掉 typeLabel 等展示字段）
    const cleanDays = days.map(d => ({
      dateLabel: d.dateLabel,
      city: d.city || '',
      items: (d.items || []).map(it => ({
        type: it.type,
        refId: it.refId || '',
        name: it.name || '',
        city: it.city || '',
        note: it.note || ''
      })),
      transport: d.transport || '',
      meal: d.meal || '',
      hotel: d.hotel || ''
    }));

    this.setData({ saving: true });
    try {
      if (isEdit) {
        await call('tripPlan', { action: 'update', id: tripId, title: title.trim() });
        await call('tripPlan', { action: 'saveDays', id: tripId, days: cleanDays }, { loading: true });
        wx.showToast({ title: '已保存', icon: 'success' });
      } else {
        const res = await call('tripPlan', {
          action: 'create',
          customerId,
          title: title.trim(),
          days: cleanDays
        }, { loading: true });
        const newId = res && res._id;
        wx.showToast({ title: '已创建', icon: 'success' });
        if (newId) {
          this.setData({ isEdit: true, tripId: newId });
        }
      }
    } catch (e) {}
    this.setData({ saving: false });
  },

  onPreview() {
    if (!this.data.tripId) {
      return wx.showToast({ title: '请先保存', icon: 'none' });
    }
    wx.navigateTo({ url: '/pages/trip/preview/preview?id=' + this.data.tripId });
  },

  onRetry() {
    if (this.data.isEdit) this.loadTrip();
    else this.setData({ pageState: 'ok' });
  }
});
