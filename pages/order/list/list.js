// pages/order/list/list.js - 订单列表
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const STATUS_TABS = [
  { key: '',            label: '全部',   color: '#1BA0D7' },
  { key: 'in_progress', label: '进行中', color: '#1BA0D7' },
  { key: 'completed',   label: '已完成', color: '#07C160' },
  { key: 'cancelled',   label: '已取消', color: '#8C8C8C' }
];

const STATUS_COLOR = {
  in_progress: '#1BA0D7', completed: '#07C160', cancelled: '#8C8C8C'
};

const STATUS_LABEL = {
  in_progress: '进行中', completed: '已完成', cancelled: '已取消'
};

Page({
  data: {
    statusTabs: STATUS_TABS,
    currentStatus: '',
    customerId: '',
    orderList: [],
    pageState: 'loading',
    pageNo: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loadingMore: false
  },

  onLoad(options) {
    const customerId = options.customerId || '';
    this.setData({ customerId });
    if (options.action === 'new') {
      this.onCreateTap();
    }
  },

  onShow() {
    this.refreshList();
  },

  refreshList() {
    this.setData({ pageNo: 1, pageState: 'loading', orderList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('order', {
        action: 'list',
        customerId: this.data.customerId || undefined,
        status: this.data.currentStatus || undefined,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(o => ({
        ...o,
        totalText: formatMoney(o.totalAmount),
        statusColor: STATUS_COLOR[o.status] || '#8C8C8C',
        statusLabel: STATUS_LABEL[o.status] || o.status,
        updatedAtText: formatDateTime(o.updatedAt)
      }));

      const merged = isReset ? newList : this.data.orderList.concat(newList);

      this.setData({
        orderList: merged,
        total: res.total || 0,
        pageNo,
        hasMore: merged.length < (res.total || 0),
        pageState: merged.length ? 'list' : 'empty'
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  onStatusTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.currentStatus) return;
    this.setData({ currentStatus: key });
    this.refreshList();
  },

  onOrderTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order/detail/detail?id=${id}` });
  },

  onCreateTap() {
    const url = this.data.customerId
      ? `/pages/order/detail/detail?action=new&customerId=${this.data.customerId}`
      : '/pages/order/detail/detail?action=new';
    wx.navigateTo({ url });
  },
  onPullDownRefresh() {
    this.refreshList();
    setTimeout(() => wx.stopPullDownRefresh(), 600);
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    this.loadList(false).then(() => {
      this.setData({ loadingMore: false });
    });
  },

  onRetry() {
    this.refreshList();
  }
});