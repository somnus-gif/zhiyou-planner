// pages/order/detail/detail.js - 订单详情（五段式时间线管理）
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const STATUS_LABEL = { in_progress:'进行中', completed:'已完成', cancelled:'已取消' };
const STATUS_COLOR = { in_progress:'#1BA0D7', completed:'#07C160', cancelled:'#8C8C8C' };
const PAY_METHODS = ['微信','支付宝','银行转账','现金'];

Page({
  data: {
    orderId: '',
    order: null,
    pageState: 'loading',
    totalText: '',
    statusLabel: '',
    statusColor: '',
    depositText: '', depositTime: '', depositMethod: '', depositVoucher: '',
    balanceText: '', balanceTime: '', balanceMethod: '', balanceVoucher: '',
    contractNo: '', contractTime: '', contractFile: '', contractSigned: false,
    bookingHotel: false, bookingFlight: false, bookingScenic: false, bookingGuide: false, bookingDoneCount: 0,
    docItinerary: false, docCheckin: false, docNotice: false, docSentTime: '',
    isInProgress: false, isCompleted: false, isCancelled: false
  },
  onLoad(options) {
    if (options.id) {
      this.setData({ orderId: options.id });
      this.loadOrder();
    } else if (options.action === 'new') {
      this.createOrder(options);
    } else {
      this.setData({ pageState: 'error' });
    }
  },

  async createOrder(options) {
    this.setData({ pageState: 'loading' });
    try {
      const res = await call('order', {
        action: 'create',
        customerId: options.customerId || '',
        quoteId: options.quoteId || '',
        tripId: options.tripId || '',
        totalAmount: options.totalAmount ? Number(options.totalAmount) : undefined
      });
      this.setData({ orderId: res._id });
      this.loadOrder();
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  async loadOrder() {
    this.setData({ pageState: 'loading' });
    try {
      const res = await call('order', { action: 'get', id: this.data.orderId }, { showError: false });
      const order = res.order;
      const flat = this.formatOrder(order);
      this.setData({ order, pageState: 'detail', ...flat });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  formatOrder(o) {
    const d = o.deposit || {}, b = o.balance || {}, c = o.contract || {};
    const bk = o.bookingStatus || {}, doc = o.docSent || {};
    const keys = ['hotel','flight','scenic','guide'];
    const doneCount = keys.filter(k => bk[k] === 'done').length;
    return {
      totalText: formatMoney(o.totalAmount),
      statusLabel: STATUS_LABEL[o.status] || o.status,
      statusColor: STATUS_COLOR[o.status] || '#8C8C8C',
      depositText: formatMoney(d.amount), depositTime: formatDateTime(d.paidAt),
      depositMethod: d.method || '', depositVoucher: d.voucher || '',
      balanceText: formatMoney(b.amount), balanceTime: formatDateTime(b.paidAt),
      balanceMethod: b.method || '', balanceVoucher: b.voucher || '',
      contractNo: c.no || '', contractTime: formatDateTime(c.signedAt),
      contractFile: c.file || '', contractSigned: c.status === 'signed',
      bookingHotel: bk.hotel === 'done', bookingFlight: bk.flight === 'done',
      bookingScenic: bk.scenic === 'done', bookingGuide: bk.guide === 'done',
      bookingDoneCount: doneCount,
      docItinerary: !!doc.itinerary, docCheckin: !!doc.checkin, docNotice: !!doc.notice,
      docSentTime: formatDateTime(doc.sentAt),
      isInProgress: o.status === 'in_progress',
      isCompleted: o.status === 'completed',
      isCancelled: o.status === 'cancelled'
    };
  },
  async payFlow(type) {
    if (!this.data.isInProgress) return;
    const o = this.data.order;
    if (type === 'balance' && !(o.deposit && o.deposit.paidAt)) {
      wx.showToast({ title: '请先记录定金', icon: 'none' });
      return;
    }
    const defaultAmount = type === 'deposit'
      ? (o.totalAmount - (o.balance && o.balance.amount || 0))
      : (o.totalAmount - (o.deposit && o.deposit.amount || 0));
    const amtRes = await wx.showModal({
      title: type === 'deposit' ? '记录定金' : '记录尾款',
      editable: true,
      content: (Math.max(0, defaultAmount) / 100).toFixed(2),
      placeholderText: '请输入金额（元）'
    });
    if (!amtRes.confirm) return;
    const yuan = parseFloat(amtRes.content);
    if (isNaN(yuan) || yuan < 0) { wx.showToast({ title: '金额无效', icon: 'none' }); return; }
    const amount = Math.round(yuan * 100);
    const method = await this.chooseMethod();
    if (method === null) return;
    let voucher = '';
    const upRes = await wx.showModal({ title: '支付凭证', content: '是否上传支付凭证？' });
    if (upRes.confirm) voucher = await this.uploadImage();
    wx.showLoading({ title: '提交中' });
    const action = type === 'deposit' ? 'payDeposit' : 'payBalance';
    const res = await call('order', { action, id: this.data.orderId, amount, method, voucher });
    wx.hideLoading();
    if (res) {
      wx.showToast({ title: type === 'deposit' ? '定金已记录' : '尾款已记录', icon: 'success' });
      this.loadOrder();
    }
  },

  onPayDeposit() { return this.payFlow('deposit'); },
  onPayBalance() { return this.payFlow('balance'); },

  chooseMethod() {
    return new Promise(resolve => {
      wx.showActionSheet({
        itemList: PAY_METHODS,
        success: res => resolve(PAY_METHODS[res.tapIndex]),
        fail: () => resolve(null)
      });
    });
  },

  uploadImage() {
    return new Promise(resolve => {
      wx.chooseMedia({
        count: 1, mediaType: ['image'], sourceType: ['album','camera'],
        success: async res => {
          const tempPath = res.tempFiles[0].tempFilePath;
          wx.showLoading({ title: '上传中' });
          const cloudPath = `order/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
          try {
            const up = await wx.cloud.uploadFile({ cloudPath, filePath: tempPath });
            resolve(up.fileID || '');
          } catch (e) { resolve(''); }
          wx.hideLoading();
        },
        fail: () => resolve('')
      });
    });
  },
  async onSignContract() {
    if (!this.data.isInProgress) return;
    const noRes = await wx.showModal({
      title: '签署合同', editable: true,
      placeholderText: '请输入合同编号（可选）'
    });
    let no = '';
    if (noRes.confirm) no = (noRes.content || '').trim();
    let file = '';
    if (!no) {
      const upRes = await wx.showModal({ title: '合同附件', content: '请上传合同文件' });
      if (upRes.confirm) file = await this.uploadImage();
      if (!file) { wx.showToast({ title: '请填写合同号或上传附件', icon: 'none' }); return; }
    }
    wx.showLoading({ title: '提交中' });
    const res = await call('order', { action: 'signContract', id: this.data.orderId, no, file });
    wx.hideLoading();
    if (res) { wx.showToast({ title: '合同已签署', icon: 'success' }); this.loadOrder(); }
  },

  async onToggleBooking(e) {
    if (!this.data.isInProgress) return;
    const key = e.currentTarget.dataset.key;
    const cur = this.data['booking' + key.charAt(0).toUpperCase() + key.slice(1)];
    const value = cur ? 'pending' : 'done';
    const res = await call('order', { action: 'updateBooking', id: this.data.orderId, key, value });
    if (res) this.loadOrder();
  },

  async onToggleDoc(e) {
    if (!this.data.isInProgress) return;
    const field = e.currentTarget.dataset.field;
    const cur = this.data['doc' + field.charAt(0).toUpperCase() + field.slice(1)];
    const value = !cur;
    const res = await call('order', { action: 'sendDoc', id: this.data.orderId, [field]: value });
    if (res) this.loadOrder();
  },

  onPreviewContract() {
    if (this.data.contractFile) {
      wx.previewImage({ urls: [this.data.contractFile], current: this.data.contractFile });
    }
  },

  onPreviewVoucher(e) {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url], current: url });
  },
  async onComplete() {
    const res = await wx.showModal({
      title: '确认完成订单？',
      content: '需所有款项、合同、预订、资料均已完成'
    });
    if (!res.confirm) return;
    const r = await call('order', { action: 'complete', id: this.data.orderId });
    if (r) { wx.showToast({ title: '订单已完成', icon: 'success' }); this.loadOrder(); }
  },

  async onCancel() {
    const res = await wx.showModal({
      title: '取消订单？', content: '取消后订单将无法继续操作',
      confirmColor: '#FF4D4F'
    });
    if (!res.confirm) return;
    const r = await call('order', { action: 'cancel', id: this.data.orderId });
    if (r) { wx.showToast({ title: '已取消', icon: 'success' }); this.loadOrder(); }
  },

  async onRemove() {
    const res = await wx.showModal({
      title: '删除订单？', content: '删除后不可恢复',
      confirmColor: '#FF4D4F'
    });
    if (!res.confirm) return;
    const r = await call('order', { action: 'remove', id: this.data.orderId });
    if (r) {
      wx.showToast({ title: '已删除', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 800);
    }
  },

  onShareAppMessage() {
    const o = this.data.order || {};
    const token = o.shareToken || '';
    return {
      title: '您的订单进度：' + (this.data.statusLabel || '进行中'),
      path: '/pages/order/preview/preview?shareToken=' + token
    };
  },

  async onRefreshShare() {
    if (!this.data.orderId) return;
    wx.showModal({
      title: '重置分享链接',
      content: '将生成新的分享链接，旧链接会失效。继续？',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('order', { action: 'refreshShare', id: this.data.orderId }, { loading: true });
          this.loadOrder();
          wx.showToast({ title: '已重置', icon: 'success' });
        } catch (e) {}
      }
    });
  }
});