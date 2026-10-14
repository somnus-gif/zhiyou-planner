// pages/flight/list/list.js - 机票查询记录列表
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDate } = require('../../../utils/format.js');

Page({
  data: {
    customerId: '',
    flightList: [],
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
    this.setData({ pageNo: 1, pageState: 'loading', flightList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('flightQuery', {
        action: 'list',
        customerId: this.data.customerId || undefined,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(f => ({
        _id: f._id,
        routeText: (f.from || '') + ' → ' + (f.to || ''),
        fromDateText: f.fromDate || '',
        optionCount: f.optionCount || 0,
        flightNoText: f.selectedFlight ? f.selectedFlight.flightNo : '',
        airlineText: f.selectedFlight ? f.selectedFlight.airline : '',
        depTimeText: f.selectedFlight ? f.selectedFlight.depTime : '',
        priceText: f.selectedFlight ? formatMoney(f.selectedFlight.total) : '',
        createdAtText: formatDate(f.createdAt)
      }));

      const merged = isReset ? newList : this.data.flightList.concat(newList);
      this.setData({
        flightList: merged,
        total: res.total || 0,
        pageNo,
        hasMore: merged.length < (res.total || 0),
        pageState: merged.length ? 'list' : 'empty'
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },  onFlightTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/flight/query/query?id=' + id });
  },

  onCreateTap() {
    const url = this.data.customerId
      ? '/pages/flight/query/query?customerId=' + this.data.customerId
      : '/pages/flight/query/query';
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