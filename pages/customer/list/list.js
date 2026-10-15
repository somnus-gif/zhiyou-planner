// pages/customer/list/list.js - 客户列表
const { STAGES, getStageColor, getStageLabel } = require('../../../utils/stages.js');
const { call } = require('../../../utils/request.js');
const { maskPhone, formatDateTime } = require('../../../utils/format.js');

Page({
  data: {
    stageTabs: [],
    currentStage: 'all',
    keyword: '',
    customerList: [],
    pageState: 'loading',
    pageNo: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loadingMore: false
  },

  onLoad(options) {
    const stageTabs = [
      { key: 'all', label: '全部', color: '#1BA0D7', count: 0 },
      ...STAGES.filter(s => s.key !== 'lost').map(s => ({
        key: s.key, label: s.label, color: s.color, count: 0
      }))
    ];
    this.setData({ stageTabs });
  },

  onShow() {
    this.refreshList();
  },

  refreshList() {
    this.setData({ pageNo: 1, pageState: 'loading', customerList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('customer', {
        action: 'list',
        stage: this.data.currentStage,
        keyword: this.data.keyword,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(c => ({
        ...c,
        phoneMask: maskPhone(c.phone),
        stageLabel: getStageLabel(c.stage),
        stageColor: getStageColor(c.stage),
        updatedAtText: formatDateTime(c.updatedAt)
      }));

      const merged = isReset ? newList : this.data.customerList.concat(newList);

      this.setData({
        customerList: merged,
        total: res.total || 0,
        pageNo,
        hasMore: merged.length < (res.total || 0),
        pageState: merged.length ? 'list' : 'empty'
      });

      if (isReset) this.loadStageCounts();
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  async loadStageCounts() {
    try {
      const res = await call('customer', { action: 'dashboard' }, { showError: false });
      const counts = res.stageCounts || {};
      const stageTabs = this.data.stageTabs.map(tab => ({
        ...tab,
        count: tab.key === 'all' ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[tab.key] || 0)
      }));
      this.setData({ stageTabs });
    } catch (e) {}
  },

  onStageTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.currentStage) return;
    this.setData({ currentStage: key });
    this.refreshList();
  },

  onSearchInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onSearchConfirm() {
    this.refreshList();
  },

  onClearKeyword() {
    this.setData({ keyword: '' });
    this.refreshList();
  },

  onCustomerTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/customer/detail/detail?id=${id}` });
  },

  onNewTap() {
    wx.navigateTo({ url: '/pages/customer/edit/edit' });
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
