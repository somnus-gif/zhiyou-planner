// pages/index/index.js - 工作台首页（流程看板 + 快捷入口）
// 已接入真实 customer 云函数：dashboard 提供统计与 Tab 计数，list 提供当前阶段客户
const { STAGES, getStageColor, getStageLabel } = require('../../utils/stages.js');
const { call } = require('../../utils/request.js');
const { maskPhone, formatDateTime } = require('../../utils/format.js');

Page({
  data: {
    userInfo: null,
    todayStats: { following: 0, newThisWeek: 0, todoCount: 0 },
    stageTabs: [],
    currentStage: 'all',
    customerList: [],
    pageState: 'loading',
    quickActions: [
      { key: 'newCustomer', label: '新建客户', path: '/pages/customer/list/list?action=new' },
      { key: 'flight',      label: '机票查询', path: '/pages/flight/list/list' },
      { key: 'hotel',       label: '酒店查询', path: '/pages/hotel/search/search' },
      { key: 'scenic',      label: '景点库',   path: '/pages/scenic/list/list' }
    ]
  },

  onLoad() {
    const stageTabs = [
      { key: 'all', label: '全部', color: '#1BA0D7', count: 0 },
      ...STAGES.filter(s => s.key !== 'lost').map(s => ({
        key: s.key, label: s.label, color: s.color, count: 0
      }))
    ];
    this.setData({ stageTabs });

    const app = getApp();
    if (app.globalData.isLoggedIn) {
      this.onLoginReady(app.globalData.userInfo);
    } else {
      app.loginReadyCallback = (info) => this.onLoginReady(info);
    }
  },

  onLoginReady(userInfo) {
    this.setData({ userInfo });
    this.loadAll();
  },

  async loadAll() {
    this.setData({ pageState: 'loading' });
    await this.loadDashboard();
    await this.loadList();
  },

  async loadDashboard() {
    try {
      const res = await call('customer', { action: 'dashboard' }, { showError: false });
      const counts = res.stageCounts || {};
      const stageTabs = this.data.stageTabs.map(tab => ({
        ...tab,
        count: tab.key === 'all'
          ? Object.values(counts).reduce((a, b) => a + b, 0)
          : (counts[tab.key] || 0)
      }));
      this.setData({
        todayStats: res.todayStats || { following: 0, newThisWeek: 0, todoCount: 0 },
        stageTabs
      });
    } catch (e) {}
  },

  async loadList() {
    try {
      const res = await call('customer', {
        action: 'list',
        stage: this.data.currentStage,
        pageNo: 1,
        pageSize: 50,
        queryAll: true
      }, { showError: false });

      const list = (res.list || []).map(c => ({
        ...c,
        phoneMask: maskPhone(c.phone),
        stageLabel: getStageLabel(c.stage),
        stageColor: getStageColor(c.stage),
        updatedAtText: formatDateTime(c.updatedAt)
      }));

      this.setData({
        customerList: list,
        pageState: list.length ? 'list' : 'empty'
      });
    } catch (e) {
      this.setData({ pageState: 'error' });
    }
  },

  onStageTap(e) {
    const key = e.currentTarget.dataset.key;
    if (key === this.data.currentStage) return;
    this.setData({ currentStage: key, pageState: 'loading' });
    this.loadList();
  },

  onCustomerTap(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/customer/detail/detail?id=${id}` });
  },

  onQuickTap(e) {
    const path = e.currentTarget.dataset.path;
    if (!path) return;
    if (path.startsWith('/pages/customer/list')) {
      wx.switchTab({ url: path.split('?')[0] });
    } else if (path.includes('/flight/')) {
      wx.navigateToMiniProgram({
        appId: 'wx0e6ed4f51db9d078',
        success() { wx.showToast({ title: '跳转成功', icon: 'success' }); },
        fail(err) {
          console.error('机票跳转失败:', err);
          wx.showModal({ title: '跳转失败', content: err.errMsg || JSON.stringify(err), showCancel: false });
        }
      });
    } else if (path.includes('/hotel/')) {
      wx.navigateToMiniProgram({
        appId: 'wx0e6ed4f51db9d078',
        success() { wx.showToast({ title: '跳转成功', icon: 'success' }); },
        fail(err) {
          console.error('酒店跳转失败:', err);
          wx.showModal({ title: '跳转失败', content: err.errMsg || JSON.stringify(err), showCancel: false });
        }
      });
    } else {
      wx.navigateTo({ url: path });
    }
  },

  onPullDownRefresh() {
    this.loadAll();
    setTimeout(() => wx.stopPullDownRefresh(), 800);
  },

  onRetry() {
    this.loadAll();
  }
});
