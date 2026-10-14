// pages/order/preview/preview.js - 订单预览（面向客户，只读脱敏视图）
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const STATUS_LABEL = { in_progress:'进行中', completed:'已完成', cancelled:'已取消' };
const STATUS_COLOR = { in_progress:'#1BA0D7', completed:'#07C160', cancelled:'#8C8C8C' };

Page({
  data: {
    shareToken: '',
    order: null,
    pageState: 'loading',
    totalText: '',
    statusLabel: '',
    statusColor: '',
    depositPaid: false, depositTime: '',
    balancePaid: false, balanceTime: '',
    contractSigned: false, contractTime: '',
    bookingHotel: false, bookingFlight: false, bookingScenic: false, bookingGuide: false, bookingDoneCount: 0,
    docItinerary: false, docCheckin: false, docNotice: false,
    updatedAtText: ''
  },

  onLoad(options) {
    if (!options.shareToken) {
      this.setData({ pageState: 'error' });
      return;
    }
    this.setData({ shareToken: options.shareToken });
    this.loadOrder();
  },
  async loadOrder() {
    this.setData({ pageState: 'loading' });
    try {
      const res = await call('order', { action: 'getShared', shareToken: this.data.shareToken }, { showError: false });
      const o = res.order;
      const d = o.deposit || {}, b = o.balance || {}, c = o.contract || {};
      const bk = o.bookingStatus || {}, doc = o.docSent || {};
      const keys = ['hotel','flight','scenic','guide'];
      const doneCount = keys.filter(k => bk[k] === 'done').length;
      this.setData({
        order: o,
        pageState: 'detail',
        totalText: formatMoney(o.totalAmount),
        statusLabel: STATUS_LABEL[o.status] || o.status,
        statusColor: STATUS_COLOR[o.status] || '#8C8C8C',
        depositPaid: !!d.paidAt, depositTime: formatDateTime(d.paidAt),
        balancePaid: !!b.paidAt, balanceTime: formatDateTime(b.paidAt),
        contractSigned: c.status === 'signed', contractTime: formatDateTime(c.signedAt),
        bookingHotel: bk.hotel === 'done', bookingFlight: bk.flight === 'done',
        bookingScenic: bk.scenic === 'done', bookingGuide: bk.guide === 'done',
        bookingDoneCount: doneCount,
        docItinerary: !!doc.itinerary, docCheckin: !!doc.checkin, docNotice: !!doc.notice,
        updatedAtText: formatDateTime(o.updatedAt)
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  onRetry() {
    this.loadOrder();
  },

  onShareAppMessage() {
    const o = this.data.order || {};
    return {
      title: '您的订单进度：' + (this.data.statusLabel || ''),
      path: '/pages/order/preview/preview?shareToken=' + (o.shareToken || this.data.shareToken)
    };
  }
});