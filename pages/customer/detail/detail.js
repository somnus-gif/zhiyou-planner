// pages/customer/detail/detail.js - 客户详情
const { getStageColor, getStageLabel, getStage, getNextStage } = require('../../../utils/stages.js');
const { call } = require('../../../utils/request.js');
const { maskPhone, formatMoney, formatDate, formatDateTime } = require('../../../utils/format.js');

const QUOTE_STATUS_LABEL = {
  draft: '草稿', sent: '已发送', bargaining: '议价中', confirmed: '已确认', archived: '已归档'
};

const ORDER_STATUS_LABEL = {
  in_progress: '进行中', completed: '已完成', cancelled: '已取消'
};

Page({
  data: {
    id: '',
    pageState: 'loading',
    customer: null,
    trips: [],
    quotes: [],
    orders: [],
    flights: [],
    hotels: [],
    stageColor: '#1BA0D7',
    stageLabel: '',
    nextStageLabel: '',
    isTerminal: false,
    notes: [],
    noteInput: '',
    submittingNote: false,
    advancing: false
  },

  onLoad(options) {
    if (!options.id) {
      wx.showToast({ title: '缺少客户 id', icon: 'none' });
      return;
    }
    this.setData({ id: options.id });
    this.loadDetail();
  },

  onShow() {
    if (this.data.id && this.data.customer) this.loadDetail(true);
  },

  async loadDetail(silent = false) {
    if (!silent) this.setData({ pageState: 'loading' });
    try {
      const res = await call('customer', { action: 'get', id: this.data.id }, { showError: !silent });
      const c = res.customer || {};
      const stageInfo = getStage(c.stage) || {};
      const nextStageKey = getNextStage(c.stage);
      const isTerminal = ['done', 'lost'].includes(c.stage);

      const notes = (c.notes || []).slice().reverse().map(n => ({
        ...n, tsText: formatDateTime(n.ts)
      }));

      const customer = {
        ...c,
        phoneMask: maskPhone(c.phone),
        budgetText: c.budget ? formatMoney(c.budget) : '未填写',
        travelStartText: c.travelDate && c.travelDate.start ? formatDate(c.travelDate.start) : '',
        travelEndText: c.travelDate && c.travelDate.end ? formatDate(c.travelDate.end) : '',
        travelDays: c.travelDate && c.travelDate.days,
        paxText: c.pax ? `${c.pax.adult}成人 ${c.pax.child}儿童 ${c.pax.baby}婴儿` : '',
        preferences: c.preferences || [],
        scenicWish: c.scenicWish || [],
        lostReason: c.lostReason || '',
        createdAtText: formatDateTime(c.createdAt)
      };

      // 并行加载该客户的报价单列表
      let quotes = [];
      try {
        const qRes = await call('quote', { action: 'list', customerId: this.data.id, pageSize: 50 }, { showError: false });
        quotes = (qRes.list || []).map(q => ({
          ...q,
          totalText: formatMoney(q.total),
          statusLabel: QUOTE_STATUS_LABEL[q.status] || q.status,
          updatedAtText: formatDateTime(q.updatedAt)
        }));
      } catch (e) {}

      let orders = [];
      try {
        const oRes = await call('order', { action: 'list', customerId: this.data.id, pageSize: 50 }, { showError: false });
        orders = (oRes.list || []).map(o => ({
          ...o,
          totalText: formatMoney(o.totalAmount),
          statusLabel: ORDER_STATUS_LABEL[o.status] || o.status,
          updatedAtText: formatDateTime(o.updatedAt)
        }));
      } catch (e) {}

      let flights = [];
      try {
        const fRes = await call('flightQuery', { action: 'list', customerId: this.data.id, pageSize: 50 }, { showError: false });
        flights = (fRes.list || []).map(f => ({
          ...f,
          routeText: (f.from || '') + ' → ' + (f.to || ''),
          fromDateText: f.fromDate || '',
          priceText: f.selectedFlight ? formatMoney(f.selectedFlight.total) : '',
          flightNoText: f.selectedFlight ? f.selectedFlight.flightNo : '',
          airlineText: f.selectedFlight ? f.selectedFlight.airline : ''
        }));
      } catch (e) {}

      let hotels = [];
      try {
        const hRes = await call('hotelPlan', { action: 'list', customerId: this.data.id, pageSize: 50 }, { showError: false });
        hotels = (hRes.list || []).map(h => ({
          ...h,
          cityText: h.city || '',
          dateText: (h.checkIn || '') + ' ~ ' + (h.checkOut || ''),
          hotelName: h.selectedHotel ? h.selectedHotel.name : '',
          priceText: h.selectedHotel ? formatMoney(h.selectedHotel.totalPrice) : ''
        }));
      } catch (e) {}

      this.setData({
        customer,
        trips: res.trips || [],
        quotes,
        orders,
        flights,
        hotels,
        notes,
        stageColor: stageInfo.color,
        stageLabel: stageInfo.label,
        nextStageLabel: isTerminal ? '' : (getStage(nextStageKey) || {}).label,
        isTerminal,
        pageState: 'ok'
      });
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  onCallPhone() {
    if (!this.data.customer || !this.data.customer.phone) return;
    wx.makePhoneCall({ phoneNumber: this.data.customer.phone });
  },

  onEdit() {
    wx.navigateTo({ url: `/pages/customer/edit/edit?id=${this.data.id}` });
  },

  onCreateTrip() {
    const name = this.data.customer && this.data.customer.name ? encodeURIComponent(this.data.customer.name) : '';
    wx.navigateTo({ url: `/pages/trip/editor/editor?customerId=${this.data.id}&customerName=${name}` });
  },

  onTripTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/trip/showcase/showcase?id=' + id });
  },

  onCreateQuote() {
    wx.navigateTo({ url: `/pages/quote/edit/edit?customerId=${this.data.id}` });
  },

  onQuoteTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/quote/detail/detail?id=' + id });
  },

  onCreateOrder() {
    wx.navigateTo({ url: `/pages/order/detail/detail?action=new&customerId=${this.data.id}` });
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/order/detail/detail?id=' + id });
  },

  onCreateFlight() {
    wx.navigateTo({ url: '/pages/flight/query/query?customerId=' + this.data.id });
  },

  onFlightTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/flight/query/query?id=' + id });
  },

  onCreateHotel() {
    wx.navigateTo({ url: '/pages/hotel/detail/detail?customerId=' + this.data.id });
  },

  onHotelTap(e) {
    const id = e.currentTarget.dataset.id;
    if (id) wx.navigateTo({ url: '/pages/hotel/detail/detail?id=' + id });
  },

  onNoteInput(e) {
    this.setData({ noteInput: e.detail.value });
  },

  async onSubmitNote() {
    const content = this.data.noteInput.trim();
    if (!content) return;
    this.setData({ submittingNote: true });
    try {
      await call('customer', { action: 'addNote', id: this.data.id, content }, { loading: true });
      this.setData({ noteInput: '' });
      wx.showToast({ title: '已记录', icon: 'success' });
      this.loadDetail(true);
    } catch (e) {}
    this.setData({ submittingNote: false });
  },

  onAdvanceStage() {
    if (this.data.isTerminal || this.data.advancing) return;
    const next = this.data.nextStageLabel;
    wx.showModal({
      title: '推进阶段',
      content: '确认将客户推进至「' + next + '」阶段？',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ advancing: true });
        try {
          await call('customer', { action: 'advanceStage', id: this.data.id }, { loading: true });
          wx.showToast({ title: '已推进', icon: 'success' });
          this.loadDetail(true);
        } catch (e) {}
        this.setData({ advancing: false });
      }
    });
  },

  onLost() {
    wx.showModal({
      title: '流失归档',
      content: '将此客户标记为已流失？请填写流失原因',
      editable: true,
      placeholderText: '如：价格未谈拢/客户改期未下单',
      success: async (res) => {
        if (!res.confirm) return;
        if (!res.content || !res.content.trim()) {
          return wx.showToast({ title: '请填写流失原因', icon: 'none' });
        }
        try {
          await call('customer', { action: 'lost', id: this.data.id, reason: res.content.trim() }, { loading: true });
          wx.showToast({ title: '已归档', icon: 'success' });
          this.loadDetail(true);
        } catch (e) {}
      }
    });
  },

  onRetry() {
    this.loadDetail();
  }
});
