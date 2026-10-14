// pages/flight/query/query.js - 机票查询页
// 新建模式：表单 -> 创建 -> 航班列表
// 编辑模式：加载已存查询 -> 修改条件重新搜索 -> 选中航班
const { call } = require('../../../utils/request.js');
const { formatMoney } = require('../../../utils/format.js');

const TRIP_TYPES = [
  { key: 'ow', label: '单程' },
  { key: 'rt', label: '往返' }
];

const AIRPORT_OPTIONS = [
  { code: 'KMG', name: 'KMG·昆明长水' },
  { code: 'LJG', name: 'LJG·丽江三义' },
  { code: 'DLU', name: 'DLU·大理荒草坝' },
  { code: 'JHG', name: 'JHG·西双版纳嘎洒' },
  { code: 'PEK', name: 'PEK·北京首都' },
  { code: 'PKX', name: 'PKX·北京大兴' },
  { code: 'SHA', name: 'SHA·上海虹桥' },
  { code: 'PVG', name: 'PVG·上海浦东' },
  { code: 'CAN', name: 'CAN·广州白云' },
  { code: 'CTU', name: 'CTU·成都双流' },
  { code: 'SYX', name: 'SYX·三亚凤凰' }
];

Page({
  data: {
    tripTypes: TRIP_TYPES,
    airportOptions: AIRPORT_OPTIONS,
    mode: 'new',
    pageState: 'form',
    id: '',
    customerId: '',
    tripId: '',
    from: '',
    to: '',
    fromDate: '',
    retDate: '',
    tripType: 'ow',
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
      this.setData({ mode: 'new', customerId, tripId, fromDate: today, pageState: 'form' });
    }
  },

  async loadDetail(id) {
    try {
      const res = await call('flightQuery', { action: 'get', id }, { showError: false });
      const f = res.flight || {};
      this.setData({
        customerId: f.customerId || '',
        tripId: f.tripId || '',
        from: f.from || '',
        to: f.to || '',
        fromDate: f.fromDate || '',
        retDate: f.retDate || '',
        tripType: f.tripType || 'ow',
        options: this.decorateOptions(f.options || []),
        selectedOption: f.selectedOption == null ? -1 : f.selectedOption,
        pageState: 'list'
      });
      wx.setNavigationBarTitle({ title: '机票查询详情' });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  decorateOptions(opts) {
    return (opts || []).map(o => Object.assign({}, o, {
      totalText: formatMoney(o.total),
      priceText: formatMoney(o.price),
      taxText: formatMoney(o.tax)
    }));
  },

  onTripTypeTap(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ tripType: key, retDate: key === 'ow' ? '' : this.data.retDate });
  },

  onFromChange(e) {
    const idx = e.detail.value;
    this.setData({ from: AIRPORT_OPTIONS[idx].code });
  },

  onToChange(e) {
    const idx = e.detail.value;
    this.setData({ to: AIRPORT_OPTIONS[idx].code });
  },

  onFromDateChange(e) { this.setData({ fromDate: e.detail.value }); },
  onRetDateChange(e) { this.setData({ retDate: e.detail.value }); },

  onSwapTap() {
    const f = this.data.from;
    const t = this.data.to;
    this.setData({ from: t, to: f });
  },  // 查询（新建=create，编辑=update+refresh）
  async onSearchTap() {
    const { from, to, fromDate, tripType, retDate, mode, id } = this.data;
    if (!from) return wx.showToast({ title: '请选择出发地', icon: 'none' });
    if (!to) return wx.showToast({ title: '请选择目的地', icon: 'none' });
    if (from === to) return wx.showToast({ title: '出发地与目的地不可相同', icon: 'none' });
    if (!fromDate) return wx.showToast({ title: '请选择出发日期', icon: 'none' });
    if (tripType === 'rt' && !retDate) return wx.showToast({ title: '请选择返程日期', icon: 'none' });

    this.setData({ searching: true });
    try {
      if (mode === 'new') {
        const res = await call('flightQuery', {
          action: 'create',
          customerId: this.data.customerId || undefined,
          tripId: this.data.tripId || undefined,
          from, to, fromDate, retDate, tripType
        }, { loading: true });
        this.setData({
          mode: 'edit',
          id: res._id,
          options: this.decorateOptions(res.options),
          selectedOption: -1,
          pageState: 'list'
        });
        wx.setNavigationBarTitle({ title: '机票查询详情' });
      } else {
        const res = await call('flightQuery', {
          action: 'update', id, from, to, fromDate, retDate, tripType, refresh: true
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

  // 选中航班
  async onSelectTap(e) {
    const idx = Number(e.currentTarget.dataset.index);
    if (this.data.selectedOption === idx) return;
    try {
      await call('flightQuery', {
        action: 'selectOption', id: this.data.id, index: idx
      }, { loading: true, showError: false });
      this.setData({ selectedOption: idx });
      wx.showToast({ title: '已选中', icon: 'success' });
    } catch (err) {}
  },

  // 删除
  onDeleteTap() {
    wx.showModal({
      title: '确认删除',
      content: '删除后无法恢复，确定删除该查询？',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('flightQuery', { action: 'remove', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已删除', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {}
      }
    });
  },

  onRetry() {
    if (this.data.id) this.loadDetail(this.data.id);
    else this.setData({ pageState: 'form' });
  }
});

function formatDateStr(ts) {
  const d = new Date(ts);
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}