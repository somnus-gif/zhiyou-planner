// pages/hotel/list/list.js - 酒店方案列表
const { call } = require('../../../utils/request.js');
const { formatMoney, formatDate } = require('../../../utils/format.js');

Page({
  data: {
    customerId: '',
    hotelList: [],
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
    this.setData({ pageNo: 1, pageState: 'loading', hotelList: [] });
    this.loadList(true);
  },

  async loadList(isReset = false) {
    const pageNo = isReset ? 1 : this.data.pageNo;
    try {
      const res = await call('hotelPlan', {
        action: 'list',
        customerId: this.data.customerId || undefined,
        pageNo,
        pageSize: this.data.pageSize
      }, { showError: false });

      const newList = (res.list || []).map(h => ({
        _id: h._id,
        city: h.city || '',
        checkInText: h.checkIn || '',
        checkOutText: h.checkOut || '',
        optionCount: h.optionCount || 0,
        selectedHotel: h.selectedHotel ? {
          name: h.selectedHotel.name,
          star: h.selectedHotel.star,
          roomType: h.selectedHotel.roomType,
          totalPriceText: formatMoney(h.selectedHotel.totalPrice),
          image: h.selectedHotel.image
        } : null,
        createdAtText: formatDate(h.createdAt)
      }));

      const merged = isReset ? newList : this.data.hotelList.concat(newList);
      this.setData({
        hotelList: merged,
        total: res.total || 0,
        pageNo,
        hasMore: merged.length < (res.total || 0),
        pageState: merged.length ? 'list' : 'empty'
      });
    } catch (err) {
      this.setData({ pageState: 'error' });
    }
  },

  onHotelTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: '/pages/hotel/detail/detail?id=' + id });
  },

  onCreateTap() {
    const url = this.data.customerId
      ? '/pages/hotel/detail/detail?customerId=' + this.data.customerId
      : '/pages/hotel/detail/detail';
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
