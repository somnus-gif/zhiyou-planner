// pages/quote/edit/edit.js - 报价单编辑器
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const ITEM_TYPES = [
  { key: 'flight',    label: '机票' },
  { key: 'hotel',     label: '酒店' },
  { key: 'scenic',    label: '景点' },
  { key: 'transport', label: '交通' },
  { key: 'meal',      label: '餐食' },
  { key: 'guide',     label: '导游' },
  { key: 'insurance', label: '保险' },
  { key: 'other',     label: '其他' }
];

const TYPE_LABEL = ITEM_TYPES.reduce((acc, t) => { acc[t.key] = t.label; return acc; }, {});

function decorateItem(it) {
  return {
    ...it,
    priceText: it.priceText != null ? it.priceText : String(it.price || 0),
    costText: it.costText != null ? it.costText : String(it.cost || 0),
    qtyText: it.qtyText != null ? it.qtyText : String(it.qty || 1),
    typeLabel: TYPE_LABEL[it.type] || '其他'
  };
}

Page({
  data: {
    mode: 'create',        // create | edit
    id: '',
    customerId: '',
    tripId: '',
    customer: null,
    quote: null,
    items: [],
    itemTypes: ITEM_TYPES,
    total: 0,
    costTotal: 0,
    profit: 0,
    totalText: '0.00',
    costTotalText: '0.00',
    profitText: '0.00',
    pageState: 'loading',
    saving: false,
    showAdjust: false,
    adjustItems: [],
    adjustReason: '',
    adjustTotalText: '0.00'
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ mode: 'edit', id: options.id });
      this.loadQuote();
    } else if (options.customerId) {
      this.setData({ mode: 'create', customerId: options.customerId, tripId: options.tripId || '' });
      this.loadCustomer();
    } else {
      wx.showToast({ title: '请从客户详情页进入', icon: 'none' });
      setTimeout(() => wx.navigateBack(), 1200);
    }
  },

  async loadCustomer() {
    try {
      const res = await call('customer', { action: 'get', id: this.data.customerId }, { showError: false });
      this.setData({ customer: res.customer, pageState: 'form' });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  async loadQuote() {
    try {
      const res = await call('quote', { action: 'get', id: this.data.id }, { showError: false });
      const q = res.quote;
      const items = (q.items || []).map(decorateItem);
      this.setData({
        quote: q,
        customerId: q.customerId,
        tripId: q.tripId || '',
        items,
        pageState: 'form'
      });
      this.recalc();
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  // ===== items 编辑 =====
  onTypeChange(e) {
    const { index } = e.currentTarget.dataset;
    const items = this.data.items.slice();
    const picked = ITEM_TYPES[e.detail.value];
    items[index].type = picked.key;
    items[index].typeLabel = picked.label;
    this.setData({ items });
  },

  onItemInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const items = this.data.items.slice();
    items[index][field] = e.detail.value;
    this.setData({ items });
    this.recalc();
  },

  onAddItem() {
    const items = this.data.items.concat([decorateItem({
      type: 'other', name: '', spec: '',
      qty: 1, price: 0, cost: 0
    })]);
    this.setData({ items });
  },

  onRemoveItem(e) {
    const { index } = e.currentTarget.dataset;
    wx.showModal({
      title: '提示',
      content: '确定删除该条目？',
      success: (r) => {
        if (!r.confirm) return;
        const items = this.data.items.slice();
        items.splice(index, 1);
        this.setData({ items });
        this.recalc();
      }
    });
  },

  // 前端实时算价
  recalc() {
    let total = 0, costTotal = 0;
    for (const it of this.data.items) {
      const qty = Number(it.qtyText) || Number(it.qty) || 1;
      const price = Number(it.priceText) || Number(it.price) || 0;
      const cost = Number(it.costText) || Number(it.cost) || 0;
      total += price * qty;
      costTotal += cost * qty;
    }
    const profit = total - costTotal;
    this.setData({
      total: Math.round(total),
      costTotal: Math.round(costTotal),
      profit: Math.round(profit),
      totalText: formatMoney(total),
      costTotalText: formatMoney(costTotal),
      profitText: formatMoney(profit)
    });
  },

  // 校验并组装 items
  buildItems() {
    return this.data.items.map(it => {
      const qty = Number(it.qtyText) || Number(it.qty) || 1;
      const price = Math.round(Number(it.priceText) || Number(it.price) || 0);
      const cost = Math.round(Number(it.costText) || Number(it.cost) || 0);
      return {
        type: it.type || 'other',
        name: (it.name || '').trim(),
        spec: (it.spec || '').trim(),
        qty, price, cost
      };
    });
  },

  async onSave() {
    const items = this.buildItems();
    if (items.length === 0) {
      wx.showToast({ title: '请至少添加一条条目', icon: 'none' });
      return;
    }
    for (const it of items) {
      if (!it.name) {
        wx.showToast({ title: '条目名称不能为空', icon: 'none' });
        return;
      }
    }
    this.setData({ saving: true });
    try {
      if (this.data.mode === 'create') {
        const res = await call('quote', {
          action: 'create',
          customerId: this.data.customerId,
          tripId: this.data.tripId || undefined,
          items
        }, { loading: true });
        wx.showToast({ title: '报价单已创建', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({ url: `/pages/quote/edit/edit?id=${res._id}` });
        }, 800);
      } else {
        await call('quote', {
          action: 'update',
          id: this.data.id,
          items
        }, { loading: true });
        wx.showToast({ title: '已保存', icon: 'success' });
        this.loadQuote();
      }
    } catch (err) {
      // 错误已由 request.js 提示
    } finally {
      this.setData({ saving: false });
    }
  },

  // ===== 发送报价 =====
  async onSend() {
    if (this.data.mode !== 'edit' || !this.data.id) return;
    const items = this.buildItems();
    if (items.length === 0) {
      wx.showToast({ title: '请先添加条目', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '发送报价',
      content: '发送后客户将看到该报价，状态变为"已发送"',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('quote', { action: 'update', id: this.data.id, items }, { loading: true });
          await call('quote', { action: 'sendQuote', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已发送', icon: 'success' });
          this.loadQuote();
        } catch (err) {}
      }
    });
  },

  // ===== 议价弹窗 =====
  onOpenAdjust() {
    if (this.data.mode !== 'edit' || !this.data.id) return;
    const q = this.data.quote;
    if (!q || !['sent', 'bargaining'].includes(q.status)) {
      wx.showToast({ title: '仅已发送/议价中可调价', icon: 'none' });
      return;
    }
    const adjustItems = this.data.items.map(decorateItem);
    this.setData({ showAdjust: true, adjustItems, adjustReason: '' });
    this.recalcAdjust();
  },

  onCloseAdjust() {
    this.setData({ showAdjust: false });
  },

  onAdjustItemInput(e) {
    const { index, field } = e.currentTarget.dataset;
    const adjustItems = this.data.adjustItems.slice();
    adjustItems[index][field] = e.detail.value;
    this.setData({ adjustItems });
    this.recalcAdjust();
  },

  onAdjustReasonInput(e) {
    this.setData({ adjustReason: e.detail.value });
  },

  recalcAdjust() {
    let total = 0;
    for (const it of this.data.adjustItems) {
      const qty = Number(it.qtyText) || Number(it.qty) || 1;
      const price = Number(it.priceText) || Number(it.price) || 0;
      total += price * qty;
    }
    this.setData({ adjustTotalText: formatMoney(total) });
  },

  async onConfirmAdjust() {
    const items = this.data.adjustItems.map(it => {
      const qty = Number(it.qtyText) || Number(it.qty) || 1;
      const price = Math.round(Number(it.priceText) || Number(it.price) || 0);
      const cost = Math.round(Number(it.costText) || Number(it.cost) || 0);
      return {
        type: it.type || 'other',
        name: (it.name || '').trim(),
        spec: (it.spec || '').trim(),
        qty, price, cost
      };
    });
    const reason = (this.data.adjustReason || '').trim();
    if (!reason) {
      wx.showToast({ title: '请填写调价原因', icon: 'none' });
      return;
    }
    try {
      await call('quote', {
        action: 'adjust',
        id: this.data.id,
        items,
        reason
      }, { loading: true });
      wx.showToast({ title: '议价已记录', icon: 'success' });
      this.setData({ showAdjust: false });
      this.loadQuote();
    } catch (err) {}
  }
});
