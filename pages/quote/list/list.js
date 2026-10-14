// pages/quote/list/list.js - 报价单列表
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDateTime } = require('../../../utils/format.js');

const STATUS_TABS = [
  { key: '',         label: '全部',   color: '#1BA0D7' },
  { key: 'draft',    label: '草稿',   color: '#8C8C8C' },
  { key: 'sent',     label: '已发送', color: '#1BA0D7' },
  { key: 'bargaining', label: '议价中', color: '#FF9F2C' },
  { key: 'confirmed', label: '已确认', color: '#07C160' }
];

const STATUS_COLOR = {
  draft: '#8C8C8C', sent: '#1BA0D7', bargaining: '#FF9F2C', confirmed: '#07C160'
};

Page({
  data: {
    statusTabs: STATUS_TABS,
    currentStatus: '',
    customerId: '',
    quoteList: [],
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
    this.setData({ pageNo: 1, pageState: 'loading', quoteList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('quote', {
        action: 'list',
        customerId: this.data.customerId || undefined,
        status: this.data.currentStatus || undefined,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(q => ({
        ...q,
        totalText: formatMoney(q.total),
        profitText: formatMoney(q.profit),
        statusColor: STATUS_COLOR[q.status] || '#8C8C8C',
        updatedAtText: formatDateTime(q.updatedAt)
      }));

      const merged = isReset ? newList : this.data.quoteList.concat(newList);

      this.setData({
        quoteList: merged,
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

  onQuoteTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/quote/detail/detail?id=${id}` });
  },

  onCreateTap() {
    const url = this.data.customerId
      ? `/pages/quote/edit/edit?customerId=${this.data.customerId}`
      : '/pages/quote/edit/edit';
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
