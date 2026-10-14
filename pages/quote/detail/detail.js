// pages/quote/detail/detail.js - 报价单详情
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const TYPE_LABEL = {
  flight: '机票', hotel: '酒店', scenic: '景点',
  transport: '交通', meal: '餐食', guide: '导游',
  insurance: '保险', other: '其他'
};

const STATUS_INFO = {
  draft:     { label: '草稿',   color: '#8C8C8C' },
  sent:      { label: '已发送', color: '#1BA0D7' },
  bargaining:{ label: '议价中', color: '#FF9F2C' },
  confirmed: { label: '已确认', color: '#07C160' },
  archived:  { label: '已归档', color: '#BFBFBF' }
};

Page({
  data: {
    id: '',
    pageState: 'loading',
    quote: null,
    items: [],
    adjustHistory: [],
    statusLabel: '',
    statusColor: '#8C8C8C',
    totalText: '0.00',
    costTotalText: '0.00',
    profitText: '0.00',
    createdAtText: '',
    updatedAtText: ''
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少报价单 id', icon: 'none' });
      return;
    }
    this.setData({ id: options.id });
    this.loadDetail();
  },

  onShow() {
    if (this.data.id && this.data.quote) this.loadDetail(true);
  },

  async loadDetail(silent = false) {
    if (!silent) this.setData({ pageState: 'loading' });
    try {
      const res = await call('quote', { action: 'get', id: this.data.id }, { showError: !silent });
      const q = res.quote || {};
      const info = STATUS_INFO[q.status] || STATUS_INFO.draft;

      const items = (q.items || []).map(it => ({
        ...it,
        typeLabel: TYPE_LABEL[it.type] || '其他',
        subtotal: (Number(it.price) || 0) * (Number(it.qty) || 1),
        subtotalText: formatMoney((Number(it.price) || 0) * (Number(it.qty) || 1)),
        priceText: formatMoney(it.price),
        costText: formatMoney(it.cost)
      }));

      // 议价历史按时间倒序
      const adjustHistory = (q.adjustHistory || []).slice().reverse().map(h => ({
        ...h,
        totalText: formatMoney(h.total),
        tsText: formatDateTime(h.ts)
      }));

      this.setData({
        quote: q,
        items,
        adjustHistory,
        statusLabel: info.label,
        statusColor: info.color,
        totalText: formatMoney(q.total),
        costTotalText: formatMoney(q.costTotal),
        profitText: formatMoney(q.profit),
        createdAtText: formatDateTime(q.createdAt),
        updatedAtText: formatDateTime(q.updatedAt),
        pageState: 'ready'
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/quote/edit/edit?id=${this.data.id}` });
  },

  onSend() {
    const q = this.data.quote;
    if (!q) return;
    if (!['draft', 'bargaining'].includes(q.status)) {
      wx.showToast({ title: '当前状态不可发送', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发送报价',
      content: '发送后状态变为"已发送"',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('quote', { action: 'sendQuote', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已发送', icon: 'success' });
          this.loadDetail(true);
        } catch (err) {}
      }
    });
  },

  onConfirm() {
    const q = this.data.quote;
    if (!q) return;
    if (!['sent', 'bargaining'].includes(q.status)) {
      wx.showToast({ title: '当前状态不可确认', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认报价',
      content: '确认后价格锁定，可进入订单流程',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('quote', { action: 'confirm', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已确认', icon: 'success' });
          this.loadDetail(true);
        } catch (err) {}
      }
    });
  },

  onCreateOrder() {
    const q = this.data.quote;
    if (!q) return;
    let url = `/pages/order/detail/detail?action=new&customerId=${q.customerId}&quoteId=${q._id}`;
    if (q.tripId) url += `&tripId=${q.tripId}`;
    if (q.total) url += `&totalAmount=${q.total}`;
    wx.navigateTo({ url });
  },

  onArchive() {
    const q = this.data.quote;
    if (!q) return;
    wx.showModal({
      title: '归档',
      content: '归档后该报价不再显示，确定？',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('quote', { action: 'remove', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已归档', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 800);
        } catch (err) {}
      }
    });
  },

  onRetry() {
    this.loadDetail();
  }
});
