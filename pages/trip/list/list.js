// pages/trip/list/list.js - 行程方案列表（增删改查）
const { call } = require('../../../utils/request.js');
const { formatDateTime } = require('../../../utils/format.js');

const STATUS_LABEL = { draft: '草稿', confirmed: '已确认', archived: '已归档' };

Page({
  data: {
    pageState: 'loading',
    list: [],
    pageNo: 1,
    pageSize: 20,
    total: 0,
    hasMore: true,
    loadingMore: false,
    pickerShow: false,
    pickerKeyword: '',
    pickerList: [],
    pickerLoading: false
  },

  onShow() {
    this.refreshList();
  },

  refreshList() {
    this.setData({ pageNo: 1, hasMore: true });
    this.loadList(true);
  },

  async loadList(isReset) {
    if (!isReset && !this.data.hasMore) return;
    const pageNo = isReset ? 1 : this.data.pageNo;
    if (isReset) this.setData({ pageState: 'loading' });
    try {
      const [tripRes, custRes] = await Promise.all([
        call('tripPlan', { action: 'list', pageNo, pageSize: this.data.pageSize }, { showError: false }),
        call('customer', { action: 'list', pageNo: 1, pageSize: 100, queryAll: true }, { showError: false }).catch(() => null)
      ]);

      const nameMap = {};
      if (custRes) (custRes.list || []).forEach(c => { nameMap[c._id] = c.name; });

      const rows = (tripRes.list || []).map(t => ({
        ...t,
        customerName: nameMap[t.customerId] || '',
        statusLabel: STATUS_LABEL[t.status] || t.status,
        updatedAtText: formatDateTime(t.updatedAt)
      }));

      const list = isReset ? rows : this.data.list.concat(rows);
      const total = tripRes.total || 0;
      this.setData({
        list,
        total,
        pageNo,
        hasMore: list.length < total,
        pageState: list.length ? 'list' : 'empty'
      });
    } catch (e) {
      if (isReset) this.setData({ pageState: 'error' });
    }
  },

  onTripTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/trip/showcase/showcase?id=' + id });
  },

  onEditTap(e) {
    const id = e.currentTarget.dataset.id;
    if (!id) return;
    wx.navigateTo({ url: '/pages/trip/editor/editor?id=' + id });
  },

  onDeleteTap(e) {
    const { id, title } = e.currentTarget.dataset;
    if (!id) return;
    wx.showModal({
      title: '删除行程',
      content: '确认删除「' + (title || '未命名行程') + '」？删除后不可在列表中查看。',
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async (r) => {
        if (!r.confirm) return;
        try {
          await call('tripPlan', { action: 'remove', id }, { loading: true });
          wx.showToast({ title: '已删除', icon: 'success' });
          this.refreshList();
        } catch (e) {}
      }
    });
  },
  onCreateTap() {
    this.setData({ pickerShow: true, pickerKeyword: '', pickerList: [] });
    this.loadCustomers();
  },

  onClosePicker() {
    this.setData({ pickerShow: false });
  },

  onPickerKeywordInput(e) {
    this.setData({ pickerKeyword: e.detail.value });
  },

  onPickerSearch() {
    this.loadCustomers();
  },

  async loadCustomers() {
    if (this.data.pickerLoading) return;
    this.setData({ pickerLoading: true });
    try {
      const res = await call('customer', {
        action: 'list',
        keyword: this.data.pickerKeyword,
        pageNo: 1,
        pageSize: 50,
        queryAll: true
      }, { showError: false });
      this.setData({ pickerList: res.list || [] });
    } catch (e) {
      this.setData({ pickerList: [] });
    }
    this.setData({ pickerLoading: false });
  },

  onPickCustomer(e) {
    const { id, name } = e.currentTarget.dataset;
    if (!id) return;
    this.setData({ pickerShow: false });
    wx.navigateTo({
      url: '/pages/trip/editor/editor?customerId=' + id + '&customerName=' + encodeURIComponent(name || '')
    });
  },

  onPullDownRefresh() {
    this.refreshList();
    setTimeout(() => wx.stopPullDownRefresh(), 600);
  },

  onReachBottom() {
    if (!this.data.hasMore || this.data.loadingMore) return;
    this.setData({ loadingMore: true });
    this.loadList(false).then(() => this.setData({ loadingMore: false }));
  },

  onRetry() {
    this.refreshList();
  },

  noop() {}
});